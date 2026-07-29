import "server-only";

import { Prisma, type EvidenceRetrievalIndexStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { runSerializableTransaction } from "@/server/db/transaction";

import type { EvidenceRetrievalChunkDraft } from "./canonical";
import {
  CHUNKING_SCHEMA_VERSION,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL,
  RETRIEVAL_SCHEMA_VERSION,
  type RetrievalMode,
} from "./schemas";

export type RetrievalChannelRow = Readonly<{
  evidenceItemId: string;
  chunkId: string;
  evidenceVersion: number;
  chunkIndex: number;
  chunkHash: string;
  snippet: string;
  score: number;
  channelRank: bigint;
}>;

export type ExplicitEvidenceRow = Readonly<{
  evidenceItemId: string;
  supportLevel: "FULL" | "PARTIAL";
  position: number;
}>;

export type RetrievalIndexCounts = Readonly<{
  current: number;
  pending: number;
  stale: number;
  failed: number;
  disabled: number;
}>;

type StoredChunk = EvidenceRetrievalChunkDraft & Readonly<{ embedding: readonly number[] | null }>;

export function getIndexableEvidenceRecord(userId: string, evidenceItemId: string) {
  return prisma.evidenceItem.findUnique({
    where: { id_userId: { id: evidenceItemId, userId } },
    include: {
      retrievalIndex: true,
      sourceExperience: { select: { title: true, organization: true } },
      sourceProject: { select: { name: true } },
    },
  });
}

export function getRetrievalIndexState(userId: string, evidenceItemId: string) {
  return prisma.evidenceRetrievalIndex.findUnique({
    where: { evidenceItemId_userId: { evidenceItemId, userId } },
    include: {
      evidenceItem: {
        select: {
          id: true,
          version: true,
          claim: true,
          sourceType: true,
          state: true,
        },
      },
    },
  });
}

export async function replaceEvidenceChunkSet(
  userId: string,
  evidenceItemId: string,
  expectedEvidenceVersion: number,
  input: Readonly<{
    contentHash: string;
    chunks: readonly StoredChunk[];
    status: "CURRENT" | "FAILED" | "DISABLED";
    provider: string | null;
    model: string | null;
    dimensions: number | null;
    errorCode: string | null;
  }>,
) {
  return runSerializableTransaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; version: number; state: "ACTIVE" | "ARCHIVED" }>
    >(Prisma.sql`
        SELECT evidence."id", evidence."version", evidence."state"
        FROM "EvidenceItem" evidence
        WHERE evidence."id" = ${evidenceItemId}
          AND evidence."userId" = ${userId}
        FOR UPDATE
      `);
    const evidence = rows[0];
    if (!evidence || evidence.version !== expectedEvidenceVersion || evidence.state !== "ACTIVE") {
      return { replaced: false as const };
    }

    await tx.evidenceRetrievalChunk.deleteMany({ where: { userId, evidenceItemId } });
    for (const chunk of input.chunks) {
      const vectorSql = chunk.embedding
        ? Prisma.sql`${JSON.stringify(chunk.embedding)}::vector`
        : Prisma.sql`NULL`;
      await tx.$executeRaw(Prisma.sql`
          INSERT INTO "EvidenceRetrievalChunk" (
            "id",
            "userId",
            "evidenceItemId",
            "evidenceVersion",
            "chunkIndex",
            "section",
            "chunkText",
            "chunkHash",
            "characterCount",
            "embeddingDimensions",
            "embedding",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            ${chunk.id},
            ${userId},
            ${evidenceItemId},
            ${chunk.evidenceVersion},
            ${chunk.chunkIndex},
            ${chunk.section},
            ${chunk.text},
            ${chunk.hash},
            ${chunk.characterCount},
            ${chunk.embedding ? EMBEDDING_DIMENSIONS : null},
            ${vectorSql},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);
    }

    const index = await tx.evidenceRetrievalIndex.update({
      where: { evidenceItemId_userId: { evidenceItemId, userId } },
      data: {
        indexedEvidenceVersion: expectedEvidenceVersion,
        canonicalContentHash: input.contentHash,
        chunkingSchemaVersion: CHUNKING_SCHEMA_VERSION,
        retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
        embeddingProvider: input.provider,
        embeddingModel: input.model,
        embeddingDimensions: input.dimensions,
        lexicalCurrent: true,
        semanticCurrent: input.status === "CURRENT",
        status: input.status,
        chunkCount: input.chunks.length,
        lastIndexedAt: new Date(),
        errorCode: input.errorCode,
      },
    });
    return { replaced: true as const, index };
  });
}

export async function lexicalSearch(
  userId: string,
  query: string,
  limit = MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL,
) {
  return prisma.$queryRaw<RetrievalChannelRow[]>(Prisma.sql`
    WITH search_query AS (
      SELECT plainto_tsquery('english', ${query}) AS value
    ),
    eligible AS MATERIALIZED (
      SELECT
        chunk."id" AS "chunkId",
        chunk."evidenceItemId",
        chunk."evidenceVersion",
        chunk."chunkIndex",
        chunk."chunkHash",
        chunk."chunkText",
        to_tsvector('english', chunk."chunkText") AS document,
        search_query.value AS query
      FROM "EvidenceRetrievalChunk" chunk
      INNER JOIN "EvidenceItem" evidence
        ON evidence."id" = chunk."evidenceItemId"
        AND evidence."userId" = chunk."userId"
      INNER JOIN "EvidenceRetrievalIndex" retrieval_index
        ON retrieval_index."evidenceItemId" = evidence."id"
        AND retrieval_index."userId" = evidence."userId"
      CROSS JOIN search_query
      WHERE chunk."userId" = ${userId}
        AND evidence."state" = 'ACTIVE'
        AND retrieval_index."lexicalCurrent"
        AND retrieval_index."indexedEvidenceVersion" = evidence."version"
        AND retrieval_index."canonicalContentHash" IS NOT NULL
        AND retrieval_index."chunkingSchemaVersion" = ${CHUNKING_SCHEMA_VERSION}
        AND retrieval_index."retrievalSchemaVersion" = ${RETRIEVAL_SCHEMA_VERSION}
        AND chunk."evidenceVersion" = evidence."version"
    ),
    scored AS (
      SELECT
        "chunkId",
        "evidenceItemId",
        "evidenceVersion",
        "chunkIndex",
        "chunkHash",
        substring("chunkText" FROM 1 FOR 400) AS snippet,
        ts_rank_cd(document, query, 32)::double precision AS score
      FROM eligible
      WHERE document @@ query
    )
    SELECT
      scored.*,
      row_number() OVER (
        ORDER BY
          score DESC,
          "evidenceItemId" COLLATE "C",
          "chunkIndex",
          "chunkId" COLLATE "C"
      ) AS "channelRank"
    FROM scored
    ORDER BY
      score DESC,
      "evidenceItemId" COLLATE "C",
      "chunkIndex",
      "chunkId" COLLATE "C"
    LIMIT ${Math.min(limit, MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL)}
  `);
}

export async function semanticSearch(
  userId: string,
  queryEmbedding: readonly number[],
  provider: string,
  model: string,
  limit = MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL,
) {
  const vector = JSON.stringify(queryEmbedding);
  return prisma.$queryRaw<RetrievalChannelRow[]>(Prisma.sql`
    WITH tenant_chunks AS MATERIALIZED (
      SELECT
        chunk."id" AS "chunkId",
        chunk."evidenceItemId",
        chunk."evidenceVersion",
        chunk."chunkIndex",
        chunk."chunkHash",
        chunk."chunkText",
        chunk."embedding"
      FROM "EvidenceRetrievalChunk" chunk
      INNER JOIN "EvidenceItem" evidence
        ON evidence."id" = chunk."evidenceItemId"
        AND evidence."userId" = chunk."userId"
      INNER JOIN "EvidenceRetrievalIndex" retrieval_index
        ON retrieval_index."evidenceItemId" = evidence."id"
        AND retrieval_index."userId" = evidence."userId"
      WHERE chunk."userId" = ${userId}
        AND evidence."state" = 'ACTIVE'
        AND retrieval_index."status" = 'CURRENT'
        AND retrieval_index."semanticCurrent"
        AND retrieval_index."indexedEvidenceVersion" = evidence."version"
        AND retrieval_index."canonicalContentHash" IS NOT NULL
        AND retrieval_index."chunkingSchemaVersion" = ${CHUNKING_SCHEMA_VERSION}
        AND retrieval_index."retrievalSchemaVersion" = ${RETRIEVAL_SCHEMA_VERSION}
        AND retrieval_index."embeddingProvider" = ${provider}
        AND retrieval_index."embeddingModel" = ${model}
        AND retrieval_index."embeddingDimensions" = ${EMBEDDING_DIMENSIONS}
        AND chunk."evidenceVersion" = evidence."version"
        AND chunk."embeddingDimensions" = ${EMBEDDING_DIMENSIONS}
        AND chunk."embedding" IS NOT NULL
    ),
    scored AS (
      SELECT
        "chunkId",
        "evidenceItemId",
        "evidenceVersion",
        "chunkIndex",
        "chunkHash",
        substring("chunkText" FROM 1 FOR 400) AS snippet,
        1 - ("embedding"::vector(1536) <=> ${vector}::vector(1536)) AS score,
        "embedding"::vector(1536) <=> ${vector}::vector(1536) AS distance
      FROM tenant_chunks
    )
    SELECT
      "chunkId",
      "evidenceItemId",
      "evidenceVersion",
      "chunkIndex",
      "chunkHash",
      snippet,
      score,
      row_number() OVER (
        ORDER BY
          distance,
          "evidenceItemId" COLLATE "C",
          "chunkIndex",
          "chunkId" COLLATE "C"
      ) AS "channelRank"
    FROM scored
    ORDER BY
      distance,
      "evidenceItemId" COLLATE "C",
      "chunkIndex",
      "chunkId" COLLATE "C"
    LIMIT ${Math.min(limit, MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL)}
  `);
}

export function getActiveRequirementRetrievalRecord(userId: string, requirementId: string) {
  return prisma.jobRequirement.findFirst({
    where: {
      id: requirementId,
      userId,
      state: "ACTIVE",
      job: { status: "ACTIVE" },
    },
    select: {
      id: true,
      jobId: true,
      statement: true,
      importance: true,
      version: true,
      job: { select: { title: true, companyName: true } },
      evidenceLinks: {
        where: { evidence: { state: "ACTIVE" } },
        select: {
          evidenceItemId: true,
          supportLevel: true,
          position: true,
        },
        orderBy: [{ supportLevel: "asc" }, { position: "asc" }, { evidenceItemId: "asc" }],
      },
    },
  });
}

export function getActiveJobRetrievalRecord(userId: string, jobId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, userId, status: "ACTIVE" },
    select: {
      id: true,
      title: true,
      companyName: true,
      requirements: {
        where: { state: "ACTIVE" },
        select: { id: true, statement: true, importance: true, position: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
  });
}

export function getRetrievalEvidenceRecords(userId: string, evidenceItemIds: readonly string[]) {
  return prisma.evidenceItem.findMany({
    where: { userId, id: { in: [...evidenceItemIds] }, state: "ACTIVE" },
    select: {
      id: true,
      version: true,
      claim: true,
      supportingContext: true,
      skillsDemonstrated: true,
      relevantRoleFamilies: true,
      sourceType: true,
      state: true,
      evidenceStrength: true,
      verificationStatus: true,
      retrievalIndex: true,
      sourceExperience: { select: { title: true, organization: true } },
      sourceProject: { select: { name: true } },
    },
  });
}

export function getCurrentCitationChunks(userId: string, evidenceItemIds: readonly string[]) {
  if (evidenceItemIds.length === 0) return Promise.resolve([]);
  return prisma.$queryRaw<
    Array<{
      evidenceItemId: string;
      chunkId: string;
      evidenceVersion: number;
      chunkIndex: number;
      chunkHash: string;
      snippet: string;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (chunk."evidenceItemId" COLLATE "C")
      chunk."evidenceItemId",
      chunk."id" AS "chunkId",
      chunk."evidenceVersion",
      chunk."chunkIndex",
      chunk."chunkHash",
      substring(chunk."chunkText" FROM 1 FOR 400) AS snippet
    FROM "EvidenceRetrievalChunk" chunk
    INNER JOIN "EvidenceItem" evidence
      ON evidence."id" = chunk."evidenceItemId"
      AND evidence."userId" = chunk."userId"
    INNER JOIN "EvidenceRetrievalIndex" retrieval_index
      ON retrieval_index."evidenceItemId" = evidence."id"
      AND retrieval_index."userId" = evidence."userId"
    WHERE chunk."userId" = ${userId}
      AND chunk."evidenceItemId" IN (${Prisma.join([...evidenceItemIds])})
      AND evidence."state" = 'ACTIVE'
      AND retrieval_index."lexicalCurrent"
      AND retrieval_index."indexedEvidenceVersion" = evidence."version"
      AND retrieval_index."canonicalContentHash" IS NOT NULL
      AND retrieval_index."chunkingSchemaVersion" = ${CHUNKING_SCHEMA_VERSION}
      AND retrieval_index."retrievalSchemaVersion" = ${RETRIEVAL_SCHEMA_VERSION}
      AND chunk."evidenceVersion" = evidence."version"
    ORDER BY
      chunk."evidenceItemId" COLLATE "C",
      chunk."chunkIndex",
      chunk."id" COLLATE "C"
  `);
}

export function listRetrievalIndexRecords(
  userId: string,
  statuses: readonly EvidenceRetrievalIndexStatus[],
  cursor?: Readonly<{ updatedAt: Date; evidenceItemId: string }>,
  limit = 10,
) {
  return prisma.evidenceRetrievalIndex.findMany({
    where: {
      userId,
      status: { in: [...statuses] },
      ...(cursor
        ? {
            OR: [
              { updatedAt: { gt: cursor.updatedAt } },
              {
                updatedAt: cursor.updatedAt,
                evidenceItemId: { gt: cursor.evidenceItemId },
              },
            ],
          }
        : {}),
    },
    include: {
      evidenceItem: {
        select: {
          id: true,
          claim: true,
          version: true,
          state: true,
          sourceType: true,
        },
      },
    },
    orderBy: [{ updatedAt: "asc" }, { evidenceItemId: "asc" }],
    take: Math.min(limit, 10) + 1,
  });
}

export async function getRetrievalIndexCounts(userId: string): Promise<RetrievalIndexCounts> {
  const groups = await prisma.evidenceRetrievalIndex.groupBy({
    by: ["status"],
    where: { userId },
    _count: { _all: true },
  });
  const counts = new Map(groups.map((group) => [group.status, group._count._all]));
  return {
    current: counts.get("CURRENT") ?? 0,
    pending: counts.get("PENDING") ?? 0,
    stale: counts.get("STALE") ?? 0,
    failed: counts.get("FAILED") ?? 0,
    disabled: counts.get("DISABLED") ?? 0,
  };
}

export function recordRetrievalEvent(input: {
  userId: string;
  queryHash: string;
  mode: RetrievalMode;
  requestedTopK: number;
  returnedCount: number;
  currentIndexCount: number;
  staleIndexCount: number;
  durationBucket: "LT_100_MS" | "LT_500_MS" | "LT_2_S" | "GTE_2_S";
  resultCode: "RESULTS" | "EMPTY" | "SEMANTIC_UNAVAILABLE";
  embeddingProvider: string | null;
  embeddingModel: string | null;
}) {
  return prisma.evidenceRetrievalEvent.create({ data: input });
}

export function listRecentRetrievalEvents(userId: string, take = 20) {
  return prisma.evidenceRetrievalEvent.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(take, 50),
  });
}
