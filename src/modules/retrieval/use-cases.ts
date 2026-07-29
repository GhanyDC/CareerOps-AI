import "server-only";

import { Buffer } from "node:buffer";

import {
  buildCanonicalEvidenceDocument,
  chunkCanonicalEvidenceDocument,
  RetrievalChunkingError,
} from "./canonical";
import { hashRetrievalDiagnosticQuery } from "./diagnostic-query-hmac.server";
import {
  EmbeddingProviderError,
  validateEmbeddingBatch,
  validateEmbeddingVector,
  type EmbeddingProvider,
} from "./embedding-provider";
import { deriveRetrievalIndexFreshness, type RetrievalIndexFreshness } from "./freshness";
import { getConfiguredEmbeddingProvider } from "./provider-factory.server";
import {
  getActiveJobRetrievalRecord,
  getActiveRequirementRetrievalRecord,
  getCurrentCitationChunks,
  getIndexableEvidenceRecord,
  getRetrievalEvidenceRecords,
  getRetrievalIndexCounts,
  getRetrievalIndexState,
  lexicalSearch,
  listRecentRetrievalEvents,
  listRetrievalIndexRecords,
  recordRetrievalEvent,
  replaceEvidenceChunkSet,
  semanticSearch,
  type RetrievalChannelRow,
} from "./repository";
import { reciprocalRankFusion, type RankedChunk } from "./ranking";
import {
  DEFAULT_RETRIEVAL_TOP_K,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_QUERY_LENGTH,
  reindexPageSchema,
  retrievalIdentifierSchema,
  retrievalRequestSchema,
  retrievalTopKSchema,
  type RetrievalMode,
  type RetrievalReason,
} from "./schemas";
import { DomainError } from "@/modules/shared/errors";

type ProviderAvailability = ReturnType<typeof getConfiguredEmbeddingProvider>;

export type GroundedEvidenceResult = Readonly<{
  evidenceItemId: string;
  evidenceVersion: number;
  displayLabel: string;
  evidenceType: "EXPERIENCE" | "PROJECT";
  evidenceState: "ACTIVE" | "ARCHIVED";
  verificationStatus: "DRAFT" | "REQUIRES_VERIFICATION" | "VERIFIED" | "REJECTED";
  evidenceStrength: "DIRECT" | "TRANSFERABLE" | "SUPPORTING" | "WEAK";
  retrievalReasons: readonly RetrievalReason[];
  explicitSupportLevel: "FULL" | "PARTIAL" | null;
  bestChunkId: string | null;
  bestChunkIndex: number | null;
  snippet: string;
  chunkHash: string | null;
  canonicalContentHash: string | null;
  indexFreshness: RetrievalIndexFreshness;
  lexicalRank: number | null;
  semanticRank: number | null;
  hybridRank: number | null;
  finalRank: number;
  navigationTarget: string;
}>;

export type GroundedRetrievalPacket = Readonly<{
  mode: RetrievalMode;
  queryLabel: string;
  topK: number;
  semanticAvailable: boolean;
  semanticUnavailableCode: string | null;
  explicitResults: readonly GroundedEvidenceResult[];
  retrievedResults: readonly GroundedEvidenceResult[];
  indexCounts: Awaited<ReturnType<typeof getRetrievalIndexCounts>>;
  requirement?: Readonly<{
    id: string;
    jobId: string;
    version: number;
    importance: "REQUIRED" | "PREFERRED" | "OTHER";
  }>;
  job?: Readonly<{
    id: string;
    contributions: readonly Readonly<{
      requirementId: string;
      importance: "REQUIRED" | "PREFERRED" | "OTHER";
    }>[];
  }>;
}>;

function providerAvailability(): ProviderAvailability {
  try {
    return getConfiguredEmbeddingProvider();
  } catch {
    return { provider: null, unavailableCode: "SEMANTIC_PROVIDER_DISABLED" };
  }
}

function asRankedChunk(row: RetrievalChannelRow): RankedChunk {
  return {
    evidenceItemId: row.evidenceItemId,
    chunkId: row.chunkId,
    chunkIndex: row.chunkIndex,
    chunkHash: row.chunkHash,
    snippet: row.snippet,
    rank: Number(row.channelRank),
    score: row.score,
  };
}

function durationBucket(milliseconds: number) {
  if (milliseconds < 100) return "LT_100_MS" as const;
  if (milliseconds < 500) return "LT_500_MS" as const;
  if (milliseconds < 2000) return "LT_2_S" as const;
  return "GTE_2_S" as const;
}

function displayLabel(evidence: Awaited<ReturnType<typeof getRetrievalEvidenceRecords>>[number]) {
  if (evidence.sourceExperience) {
    return evidence.sourceExperience.organization
      ? `${evidence.sourceExperience.title} · ${evidence.sourceExperience.organization}`
      : evidence.sourceExperience.title;
  }
  return evidence.sourceProject?.name ?? evidence.claim;
}

function freshness(
  evidence: Awaited<ReturnType<typeof getRetrievalEvidenceRecords>>[number],
  provider: EmbeddingProvider | null,
): RetrievalIndexFreshness {
  const canonical = buildCanonicalEvidenceDocument(evidence);
  return deriveRetrievalIndexFreshness({
    evidenceVersion: evidence.version,
    canonicalContentHash: canonical.contentHash,
    expectedSemanticCoordinates: provider?.descriptor ?? null,
    index: evidence.retrievalIndex,
  });
}

async function embedDocumentChunks(provider: EmbeddingProvider, texts: readonly string[]) {
  if (provider.descriptor.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingProviderError("EMBEDDING_DIMENSION_MISMATCH");
  }
  const vectors: (readonly number[])[] = [];
  for (let index = 0; index < texts.length; index += provider.descriptor.maximumBatchSize) {
    const batch = texts.slice(index, index + provider.descriptor.maximumBatchSize);
    const embedded = await provider.embedDocuments(batch);
    vectors.push(...validateEmbeddingBatch(embedded, batch.length, provider.descriptor.dimensions));
  }
  return vectors;
}

export async function indexEvidenceItem(
  userId: string,
  untrustedEvidenceItemId: unknown,
  dependencies: {
    availability?: ProviderAvailability;
    chunkDocument?: typeof chunkCanonicalEvidenceDocument;
  } = {},
) {
  const evidenceItemId = retrievalIdentifierSchema.parse(untrustedEvidenceItemId);
  const evidence = await getIndexableEvidenceRecord(userId, evidenceItemId);
  if (!evidence) throw new DomainError("Evidence item not found.");
  if (evidence.state !== "ACTIVE") {
    throw new DomainError("Archived Evidence cannot be indexed. Restore it first.");
  }

  const canonical = buildCanonicalEvidenceDocument(evidence);
  let chunks: ReturnType<typeof chunkCanonicalEvidenceDocument>;
  try {
    chunks = (dependencies.chunkDocument ?? chunkCanonicalEvidenceDocument)(canonical);
  } catch (error) {
    if (!(error instanceof RetrievalChunkingError)) throw error;
    const failed = await replaceEvidenceChunkSet(userId, evidence.id, evidence.version, {
      contentHash: canonical.contentHash,
      chunks: [],
      status: "FAILED",
      provider: null,
      model: null,
      dimensions: null,
      errorCode: error.code,
    });
    if (!failed.replaced) {
      throw new DomainError("Evidence changed during indexing. Retry with the current version.");
    }
    return failed.index;
  }
  const availability = dependencies.availability ?? providerAvailability();
  let embeddings: readonly (readonly number[])[] = [];
  let status: "CURRENT" | "FAILED" | "DISABLED" = "DISABLED";
  let errorCode: string | null = availability.unavailableCode;

  if (availability.provider) {
    try {
      embeddings = await embedDocumentChunks(
        availability.provider,
        chunks.map((chunk) => chunk.text),
      );
      status = "CURRENT";
      errorCode = null;
    } catch (error) {
      status = "FAILED";
      errorCode =
        error instanceof EmbeddingProviderError ? error.code : "EMBEDDING_INVALID_RESPONSE";
    }
  }

  const result = await replaceEvidenceChunkSet(userId, evidence.id, evidence.version, {
    contentHash: canonical.contentHash,
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: status === "CURRENT" ? embeddings[index]! : null,
    })),
    status,
    provider: availability.provider?.descriptor.provider ?? null,
    model: availability.provider?.descriptor.model ?? null,
    dimensions: status === "CURRENT" ? availability.provider!.descriptor.dimensions : null,
    errorCode,
  });
  if (!result.replaced) {
    throw new DomainError("Evidence changed during indexing. Retry with the current version.");
  }
  return result.index;
}

function encodeCursor(value: { updatedAt: Date; evidenceItemId: string }) {
  return Buffer.from(
    JSON.stringify({
      updatedAt: value.updatedAt.toISOString(),
      evidenceItemId: value.evidenceItemId,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      evidenceItemId?: unknown;
    };
    const updatedAt = new Date(String(parsed.updatedAt));
    const evidenceItemId = retrievalIdentifierSchema.parse(parsed.evidenceItemId);
    if (Number.isNaN(updatedAt.getTime())) throw new Error("Invalid date");
    return { updatedAt, evidenceItemId };
  } catch {
    throw new DomainError("The retrieval cursor is invalid.");
  }
}

export async function listRetrievalDiagnostics(userId: string, untrustedInput: unknown = {}) {
  const input = reindexPageSchema.parse(untrustedInput);
  const [rows, counts, events] = await Promise.all([
    listRetrievalIndexRecords(
      userId,
      ["PENDING", "STALE", "FAILED", "DISABLED", "CURRENT"],
      decodeCursor(input.cursor),
      input.limit,
    ),
    getRetrievalIndexCounts(userId),
    listRecentRetrievalEvents(userId),
  ]);
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    counts,
    events,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export async function reindexEvidencePage(
  userId: string,
  untrustedInput: unknown,
  dependencies: {
    availability?: ProviderAvailability;
    chunkDocument?: typeof chunkCanonicalEvidenceDocument;
  } = {},
) {
  const input = reindexPageSchema.parse(untrustedInput);
  const rows = await listRetrievalIndexRecords(
    userId,
    ["PENDING", "STALE", "FAILED", "DISABLED"],
    decodeCursor(input.cursor),
    input.limit,
  );
  const page = rows.slice(0, input.limit);
  const outcomes: Array<{ evidenceItemId: string; status: string }> = [];
  for (const row of page) {
    if (row.evidenceItem.state !== "ACTIVE") continue;
    try {
      const indexed = await indexEvidenceItem(userId, row.evidenceItemId, dependencies);
      outcomes.push({ evidenceItemId: row.evidenceItemId, status: indexed.status });
    } catch {
      outcomes.push({ evidenceItemId: row.evidenceItemId, status: "FAILED" });
    }
  }
  const last = page.at(-1);
  return {
    outcomes,
    nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
  };
}

function buildJobQuery(
  requirements: readonly Readonly<{
    id: string;
    statement: string;
    importance: "REQUIRED" | "PREFERRED" | "OTHER";
  }>[],
) {
  const contributions: Array<{
    requirementId: string;
    importance: "REQUIRED" | "PREFERRED" | "OTHER";
  }> = [];
  let query = "";
  for (const requirement of requirements) {
    const label =
      requirement.importance === "REQUIRED"
        ? "Required"
        : requirement.importance === "PREFERRED"
          ? "Preferred"
          : "Other";
    const segment = `${label}: ${requirement.statement}`;
    const separator = query ? "\n" : "";
    const remaining = MAX_RETRIEVAL_QUERY_LENGTH - Array.from(query + separator).length;
    if (remaining <= 0) break;
    const text = Array.from(segment).slice(0, remaining).join("").trimEnd();
    if (!text) break;
    query += `${separator}${text}`;
    contributions.push({
      requirementId: requirement.id,
      importance: requirement.importance,
    });
    if (text.length < segment.length) break;
  }
  return { query, contributions };
}

function indexStatusCount(counts: Awaited<ReturnType<typeof getRetrievalIndexCounts>>) {
  return counts.pending + counts.stale + counts.failed;
}

async function executeRetrieval(input: {
  userId: string;
  mode: RetrievalMode;
  query: string;
  queryLabel: string;
  topK: number;
  explicitLinks?: readonly Readonly<{
    evidenceItemId: string;
    supportLevel: "FULL" | "PARTIAL";
    position: number;
  }>[];
  requirement?: GroundedRetrievalPacket["requirement"];
  job?: GroundedRetrievalPacket["job"];
  availability?: ProviderAvailability;
}): Promise<GroundedRetrievalPacket> {
  const startedAt = performance.now();
  const queryHash = hashRetrievalDiagnosticQuery(input.userId, input.query);
  const availability = input.availability ?? providerAvailability();
  const lexicalRows = await lexicalSearch(input.userId, input.query);
  let semanticRows: RetrievalChannelRow[] = [];
  let semanticUnavailableCode: string | null = availability.unavailableCode;

  if (availability.provider) {
    try {
      const queryVector = validateEmbeddingVector(
        await availability.provider.embedQuery(input.query),
        availability.provider.descriptor.dimensions,
      );
      semanticRows = await semanticSearch(
        input.userId,
        queryVector,
        availability.provider.descriptor.provider,
        availability.provider.descriptor.model,
      );
      semanticUnavailableCode = null;
    } catch (error) {
      semanticUnavailableCode =
        error instanceof EmbeddingProviderError ? error.code : "EMBEDDING_INVALID_RESPONSE";
    }
  }

  const fused = reciprocalRankFusion(
    lexicalRows.map(asRankedChunk),
    semanticRows.map(asRankedChunk),
  );
  const explicitLinks = [...(input.explicitLinks ?? [])].sort(
    (left, right) =>
      (left.supportLevel === right.supportLevel ? 0 : left.supportLevel === "FULL" ? -1 : 1) ||
      left.position - right.position ||
      (left.evidenceItemId < right.evidenceItemId ? -1 : 1),
  );
  const explicitIds = new Set(explicitLinks.map((link) => link.evidenceItemId));
  const retrieved = fused
    .filter((item) => !explicitIds.has(item.evidenceItemId))
    .slice(0, input.topK);
  const ids = [
    ...explicitLinks.map((link) => link.evidenceItemId),
    ...retrieved.map((item) => item.evidenceItemId),
  ];
  const [evidenceRecords, citationChunks, counts] = await Promise.all([
    getRetrievalEvidenceRecords(input.userId, ids),
    getCurrentCitationChunks(input.userId, ids),
    getRetrievalIndexCounts(input.userId),
  ]);
  const evidenceById = new Map(evidenceRecords.map((item) => [item.id, item]));
  const citationByEvidence = new Map(citationChunks.map((item) => [item.evidenceItemId, item]));

  function toResult(
    evidenceItemId: string,
    ranking: {
      reasons: readonly RetrievalReason[];
      supportLevel: "FULL" | "PARTIAL" | null;
      lexicalRank: number | null;
      semanticRank: number | null;
      hybridRank: number | null;
      chunk?: RankedChunk;
    },
    finalRank: number,
  ): GroundedEvidenceResult | null {
    const evidence = evidenceById.get(evidenceItemId);
    if (!evidence) return null;
    const citation = ranking.chunk ?? citationByEvidence.get(evidenceItemId);
    return {
      evidenceItemId: evidence.id,
      evidenceVersion: evidence.version,
      displayLabel: displayLabel(evidence),
      evidenceType: evidence.sourceType,
      evidenceState: evidence.state,
      verificationStatus: evidence.verificationStatus,
      evidenceStrength: evidence.evidenceStrength,
      retrievalReasons: ranking.reasons,
      explicitSupportLevel: ranking.supportLevel,
      bestChunkId: citation?.chunkId ?? null,
      bestChunkIndex: citation?.chunkIndex ?? null,
      snippet: citation?.snippet ?? evidence.claim.slice(0, 400),
      chunkHash: citation?.chunkHash ?? null,
      canonicalContentHash: evidence.retrievalIndex?.canonicalContentHash ?? null,
      indexFreshness: freshness(evidence, availability.provider),
      lexicalRank: ranking.lexicalRank,
      semanticRank: ranking.semanticRank,
      hybridRank: ranking.hybridRank,
      finalRank,
      navigationTarget: `/evidence/${evidence.id}?citationVersion=${evidence.version}`,
    };
  }

  const explicitResults = explicitLinks
    .map((link, index) =>
      toResult(
        link.evidenceItemId,
        {
          reasons: [link.supportLevel === "FULL" ? "EXPLICIT_FULL_LINK" : "EXPLICIT_PARTIAL_LINK"],
          supportLevel: link.supportLevel,
          lexicalRank: null,
          semanticRank: null,
          hybridRank: null,
        },
        index + 1,
      ),
    )
    .filter((item): item is GroundedEvidenceResult => item !== null);
  const retrievedResults = retrieved
    .map((item, index) =>
      toResult(
        item.evidenceItemId,
        {
          reasons: item.reasons,
          supportLevel: null,
          lexicalRank: item.lexicalRank,
          semanticRank: item.semanticRank,
          hybridRank: item.hybridRank,
          chunk: item.bestChunk,
        },
        explicitResults.length + index + 1,
      ),
    )
    .filter((item): item is GroundedEvidenceResult => item !== null);
  const uniqueReturnedCount = Math.min(
    input.topK,
    new Set([
      ...explicitResults.map((item) => item.evidenceItemId),
      ...retrievedResults.map((item) => item.evidenceItemId),
    ]).size,
  );
  await recordRetrievalEvent({
    userId: input.userId,
    queryHash,
    mode: input.mode,
    requestedTopK: input.topK,
    returnedCount: uniqueReturnedCount,
    currentIndexCount: counts.current,
    staleIndexCount: indexStatusCount(counts),
    durationBucket: durationBucket(performance.now() - startedAt),
    resultCode: semanticUnavailableCode
      ? "SEMANTIC_UNAVAILABLE"
      : uniqueReturnedCount > 0
        ? "RESULTS"
        : "EMPTY",
    embeddingProvider: availability.provider?.descriptor.provider ?? null,
    embeddingModel: availability.provider?.descriptor.model ?? null,
  });

  return {
    mode: input.mode,
    queryLabel: input.queryLabel,
    topK: input.topK,
    semanticAvailable: semanticUnavailableCode === null,
    semanticUnavailableCode,
    explicitResults,
    retrievedResults,
    indexCounts: counts,
    ...(input.requirement ? { requirement: input.requirement } : {}),
    ...(input.job ? { job: input.job } : {}),
  };
}

export async function retrieveForUserQuery(
  userId: string,
  untrustedInput: unknown,
  dependencies: { availability?: ProviderAvailability } = {},
) {
  const input = retrievalRequestSchema.parse(untrustedInput);
  return executeRetrieval({
    userId,
    mode: "USER_QUERY",
    query: input.query,
    queryLabel: "User-authored query",
    topK: input.topK,
    availability: dependencies.availability,
  });
}

export async function retrieveForRequirement(
  userId: string,
  untrustedRequirementId: unknown,
  untrustedTopK: unknown = DEFAULT_RETRIEVAL_TOP_K,
  dependencies: { availability?: ProviderAvailability } = {},
) {
  const requirementId = retrievalIdentifierSchema.parse(untrustedRequirementId);
  const topK = retrievalTopKSchema.parse(untrustedTopK);
  const requirement = await getActiveRequirementRetrievalRecord(userId, requirementId);
  if (!requirement) {
    throw new DomainError("Active Job requirement not found.", "REQUIREMENT_NOT_FOUND");
  }
  return executeRetrieval({
    userId,
    mode: "REQUIREMENT",
    query: requirement.statement,
    queryLabel: requirement.statement,
    topK,
    explicitLinks: requirement.evidenceLinks,
    requirement: {
      id: requirement.id,
      jobId: requirement.jobId,
      version: requirement.version,
      importance: requirement.importance,
    },
    availability: dependencies.availability,
  });
}

export async function retrieveForJob(
  userId: string,
  untrustedJobId: unknown,
  untrustedTopK: unknown = DEFAULT_RETRIEVAL_TOP_K,
  dependencies: { availability?: ProviderAvailability } = {},
) {
  const jobId = retrievalIdentifierSchema.parse(untrustedJobId);
  const topK = retrievalTopKSchema.parse(untrustedTopK);
  const job = await getActiveJobRetrievalRecord(userId, jobId);
  if (!job) throw new DomainError("Active Job not found.", "JOB_NOT_FOUND");
  const built = buildJobQuery(job.requirements);
  if (!built.query) {
    throw new DomainError("This Job has no active authoritative requirements.");
  }
  return executeRetrieval({
    userId,
    mode: "JOB",
    query: built.query,
    queryLabel: `${job.title}${job.companyName ? ` · ${job.companyName}` : ""}`,
    topK,
    job: { id: job.id, contributions: built.contributions },
    availability: dependencies.availability,
  });
}

export async function viewEvidenceRetrievalIndex(userId: string, evidenceItemId: string) {
  const id = retrievalIdentifierSchema.parse(evidenceItemId);
  const index = await getRetrievalIndexState(userId, id);
  if (!index) throw new DomainError("Evidence retrieval index not found.");
  return index;
}
