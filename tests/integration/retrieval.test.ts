import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  deleteEvidenceItem,
  transitionEvidenceState,
  transitionEvidenceStatus,
} from "@/modules/evidence/use-cases";
import { RetrievalChunkingError } from "@/modules/retrieval/canonical";
import { DeterministicTestEmbeddingProvider } from "@/modules/retrieval/deterministic-test-provider";
import { hashRetrievalDiagnosticQuery } from "@/modules/retrieval/diagnostic-query-hmac.server";
import {
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "@/modules/retrieval/embedding-provider";
import {
  lexicalSearch,
  replaceEvidenceChunkSet,
  semanticSearch,
} from "@/modules/retrieval/repository";
import {
  indexEvidenceItem,
  reindexEvidencePage,
  retrieveForRequirement,
  retrieveForUserQuery,
} from "@/modules/retrieval/use-cases";

const fakeAvailability = {
  provider: new DeterministicTestEmbeddingProvider(),
  unavailableCode: null,
} as const;

class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly descriptor = {
    provider: "failing-test",
    model: "failing-test-v1",
    dimensions: 1536,
    maximumBatchSize: 8,
  } as const;

  async embedDocuments(): Promise<readonly (readonly number[])[]> {
    throw new EmbeddingProviderError("EMBEDDING_TIMEOUT");
  }

  async embedQuery(): Promise<readonly number[]> {
    throw new EmbeddingProviderError("EMBEDDING_TIMEOUT");
  }
}

describe("Grounded RAG retrieval PostgreSQL integration", () => {
  const token = `${Date.now()}-${randomUUID()}`;
  const env = parseDatabaseEnv(process.env);
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  let userAId: string;
  let userBId: string;
  let experienceAId: string;
  let odooEvidenceId: string;
  let partialEvidenceId: string;
  let otherTenantEvidenceId: string;
  let requirementId: string;

  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      client.user.create({ data: { developmentKey: `retrieval-a-${token}` } }),
      client.user.create({ data: { developmentKey: `retrieval-b-${token}` } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    const [profileA, profileB] = await Promise.all([
      client.candidateProfile.create({ data: { userId: userA.id } }),
      client.candidateProfile.create({ data: { userId: userB.id } }),
    ]);
    const [experienceA, experienceB] = await Promise.all([
      client.experience.create({
        data: {
          userId: userA.id,
          candidateProfileId: profileA.id,
          title: "ERP Automation Engineer",
          organization: "Tenant A",
          experienceType: "EMPLOYMENT",
        },
      }),
      client.experience.create({
        data: {
          userId: userB.id,
          candidateProfileId: profileB.id,
          title: "ERP Automation Engineer",
          organization: "Tenant B",
          experienceType: "EMPLOYMENT",
        },
      }),
    ]);
    experienceAId = experienceA.id;
    const [odoo, partial, otherTenant] = await Promise.all([
      client.evidenceItem.create({
        data: {
          userId: userA.id,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceA.id,
          claim: "Built Odoo automation for finance approval workflows.",
          supportingContext: "Implemented Python routing and reconciliation controls.",
          skillsDemonstrated: ["Odoo", "Python", "Workflow automation"],
          relevantRoleFamilies: ["ERP Engineer"],
          evidenceStrength: "DIRECT",
          verificationStatus: "VERIFIED",
        },
      }),
      client.evidenceItem.create({
        data: {
          userId: userA.id,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceA.id,
          claim: "Mapped finance processes for an ERP migration.",
          supportingContext: "Supported discovery and partial workflow design.",
          skillsDemonstrated: ["ERP", "Process mapping"],
          evidenceStrength: "TRANSFERABLE",
        },
      }),
      client.evidenceItem.create({
        data: {
          userId: userB.id,
          sourceType: "EXPERIENCE",
          sourceExperienceId: experienceB.id,
          claim: "Built Odoo automation for finance approval workflows.",
          supportingContext: "This same-text record belongs only to tenant B.",
          skillsDemonstrated: ["Odoo", "Python"],
          evidenceStrength: "DIRECT",
        },
      }),
    ]);
    odooEvidenceId = odoo.id;
    partialEvidenceId = partial.id;
    otherTenantEvidenceId = otherTenant.id;

    const job = await client.$transaction(async (tx) => {
      const reference = `retrieval-integration-${randomUUID()}`;
      const draft = await tx.jobParseDraft.create({
        data: {
          userId: userA.id,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          sourcePayloadHash: "a".repeat(64),
          parsedPayload: {},
          validationSummary: { schemaVersion: 1 },
          fieldProvenance: { schemaVersion: 1, fields: {} },
          status: "CONFIRMED",
          userCorrections: {},
          confirmedAt: new Date(),
          contentPurgedAt: new Date(),
        },
      });
      const createdJob = await tx.job.create({
        data: {
          userId: userA.id,
          title: "Odoo Automation Engineer",
          companyName: "Grounded Retrieval Tests",
          fieldProvenance: { schemaVersion: 1, fields: {} },
        },
      });
      await tx.jobSource.create({
        data: {
          userId: userA.id,
          jobId: createdJob.id,
          parseDraftId: draft.id,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          purpose: "INITIAL_CONFIRMATION",
          sourcePayloadHash: "a".repeat(64),
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          appliedFields: ["title"],
          confirmedByUserId: userA.id,
          idempotencyKey: randomUUID(),
          confirmationHash: randomUUID().replaceAll("-", "").repeat(2),
          sourcePurgedAt: new Date(),
        },
      });
      return createdJob;
    });
    const requirement = await client.jobRequirement.create({
      data: {
        userId: userA.id,
        jobId: job.id,
        statement: "Demonstrate Odoo automation experience.",
        category: "EXPERIENCE",
        importance: "REQUIRED",
        source: "MANUAL",
        position: 0,
      },
    });
    requirementId = requirement.id;
    await client.jobRequirementEvidenceLink.createMany({
      data: [
        {
          userId: userA.id,
          requirementId: requirement.id,
          evidenceItemId: odoo.id,
          supportLevel: "FULL",
          position: 0,
        },
        {
          userId: userA.id,
          requirementId: requirement.id,
          evidenceItemId: partial.id,
          supportLevel: "PARTIAL",
          position: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userAId, userBId].filter(Boolean) } } });
    await client.$disconnect();
  });

  it("has pgvector, retrieval tables, automatic index state, and composite ownership", async () => {
    const extensions = await client.$queryRaw<Array<{ extname: string; extversion: string }>>`
      SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'
    `;
    expect(extensions[0]?.extname).toBe("vector");
    expect(
      await client.evidenceRetrievalIndex.findUnique({
        where: {
          evidenceItemId_userId: { evidenceItemId: odooEvidenceId, userId: userAId },
        },
      }),
    ).toMatchObject({ status: "PENDING", chunkCount: 0 });

    await expect(
      client.$executeRaw(Prisma.sql`
        INSERT INTO "EvidenceRetrievalChunk" (
          "id", "userId", "evidenceItemId", "evidenceVersion", "chunkIndex",
          "section", "chunkText", "chunkHash", "characterCount", "createdAt", "updatedAt"
        )
        VALUES (
          ${`cross-user-${randomUUID()}`}, ${userBId}, ${odooEvidenceId}, 1, 0,
          'Evidence statement', 'Cross-user insertion must fail', ${"a".repeat(64)}, 30,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `),
    ).rejects.toThrow();
  });

  it("indexes atomically and retrieves lexical, semantic, and hybrid results without tenant leakage", async () => {
    for (const [ownerId, evidenceItemId] of [
      [userAId, odooEvidenceId],
      [userAId, partialEvidenceId],
      [userBId, otherTenantEvidenceId],
    ] as const) {
      await indexEvidenceItem(ownerId, evidenceItemId, { availability: fakeAvailability });
    }
    const before = await client.evidenceRetrievalChunk.findMany({
      where: { userId: userAId, evidenceItemId: odooEvidenceId },
      select: { id: true, chunkHash: true, evidenceVersion: true },
      orderBy: { chunkIndex: "asc" },
    });
    await indexEvidenceItem(userAId, odooEvidenceId, { availability: fakeAvailability });
    const after = await client.evidenceRetrievalChunk.findMany({
      where: { userId: userAId, evidenceItemId: odooEvidenceId },
      select: { id: true, chunkHash: true, evidenceVersion: true },
      orderBy: { chunkIndex: "asc" },
    });
    expect(after).toEqual(before);

    const packet = await retrieveForUserQuery(
      userAId,
      { query: "Odoo automation", topK: 5 },
      { availability: fakeAvailability },
    );
    expect(packet.semanticAvailable).toBe(true);
    expect(packet.retrievedResults[0]).toMatchObject({
      evidenceItemId: odooEvidenceId,
      evidenceVersion: 1,
      indexFreshness: "CURRENT",
    });
    expect(packet.retrievedResults[0]!.retrievalReasons).toContain("LEXICAL");
    expect(packet.retrievedResults[0]!.retrievalReasons).toContain("SEMANTIC");
    expect(packet.retrievedResults[0]!.retrievalReasons).toContain("HYBRID");
    expect(packet.retrievedResults.map((item) => item.evidenceItemId)).not.toContain(
      otherTenantEvidenceId,
    );
    expect(packet.retrievedResults[0]!.bestChunkId).not.toBeNull();
    expect(packet.retrievedResults[0]!.chunkHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(packet.retrievedResults[0]!.navigationTarget).toContain(
      `citationVersion=${packet.retrievedResults[0]!.evidenceVersion}`,
    );

    const lexicalRows = await lexicalSearch(userAId, "Odoo automation");
    expect(lexicalRows.map((item) => item.evidenceItemId)).toContain(odooEvidenceId);
    expect(lexicalRows.map((item) => item.evidenceItemId)).not.toContain(otherTenantEvidenceId);
    const queryVector = await fakeAvailability.provider.embedQuery("Odoo automation");
    const semanticRows = await semanticSearch(
      userAId,
      queryVector,
      fakeAvailability.provider.descriptor.provider,
      fakeAvailability.provider.descriptor.model,
    );
    expect(semanticRows.map((item) => item.evidenceItemId)).toContain(odooEvidenceId);
    expect(semanticRows.map((item) => item.evidenceItemId)).not.toContain(otherTenantEvidenceId);

    const mismatchedProvider: EmbeddingProvider = {
      descriptor: {
        ...fakeAvailability.provider.descriptor,
        model: "deterministic-token-hash-v2",
      },
      embedDocuments: (inputs) => fakeAvailability.provider.embedDocuments(inputs),
      embedQuery: (input) => fakeAvailability.provider.embedQuery(input),
    };
    const coordinateMismatch = await retrieveForUserQuery(
      userAId,
      { query: "Odoo automation", topK: 5 },
      { availability: { provider: mismatchedProvider, unavailableCode: null } },
    );
    expect(coordinateMismatch.retrievedResults[0]).toMatchObject({
      evidenceItemId: odooEvidenceId,
      retrievalReasons: ["LEXICAL"],
      indexFreshness: "LEXICAL_ONLY",
    });

    const rollbackSnapshot = await client.evidenceRetrievalChunk.findMany({
      where: { userId: userAId, evidenceItemId: odooEvidenceId },
      select: { id: true, chunkHash: true, chunkText: true },
      orderBy: { chunkIndex: "asc" },
    });
    await expect(
      replaceEvidenceChunkSet(userAId, odooEvidenceId, 1, {
        contentHash: "f".repeat(64),
        chunks: [
          {
            id: `erc_${"1".repeat(32)}`,
            evidenceItemId: odooEvidenceId,
            evidenceVersion: 1,
            chunkIndex: 0,
            section: "Evidence statement",
            text: "Valid replacement prefix.",
            hash: "1".repeat(64),
            characterCount: 25,
            embedding: null,
          },
          {
            id: `erc_${"2".repeat(32)}`,
            evidenceItemId: odooEvidenceId,
            evidenceVersion: 1,
            chunkIndex: 1,
            section: "Evidence statement",
            text: "Invalid character count forces rollback.",
            hash: "2".repeat(64),
            characterCount: 1,
            embedding: null,
          },
        ],
        status: "FAILED",
        provider: "failing-test",
        model: "failing-test-v1",
        dimensions: null,
        errorCode: "EMBEDDING_INVALID_RESPONSE",
      }),
    ).rejects.toThrow();
    expect(
      await client.evidenceRetrievalChunk.findMany({
        where: { userId: userAId, evidenceItemId: odooEvidenceId },
        select: { id: true, chunkHash: true, chunkText: true },
        orderBy: { chunkIndex: "asc" },
      }),
    ).toEqual(rollbackSnapshot);
  }, 30_000);

  it("integrates explicit FULL/PARTIAL links without presenting them as discoveries", async () => {
    const packet = await retrieveForRequirement(userAId, requirementId, 5, {
      availability: fakeAvailability,
    });
    expect(packet.explicitResults.map((item) => item.evidenceItemId)).toEqual([
      odooEvidenceId,
      partialEvidenceId,
    ]);
    expect(packet.explicitResults[0]).toMatchObject({
      explicitSupportLevel: "FULL",
      retrievalReasons: ["EXPLICIT_FULL_LINK"],
    });
    expect(packet.explicitResults[1]).toMatchObject({
      explicitSupportLevel: "PARTIAL",
      retrievalReasons: ["EXPLICIT_PARTIAL_LINK"],
    });
    expect(packet.retrievedResults.map((item) => item.evidenceItemId)).not.toContain(
      odooEvidenceId,
    );
  });

  it("stales and removes old chunks on edit, archives safely, restores stale, and reindexes current", async () => {
    await transitionEvidenceStatus(userAId, odooEvidenceId, {
      targetStatus: "REQUIRES_VERIFICATION",
    });
    const changed = await client.evidenceItem.findUniqueOrThrow({
      where: { id: odooEvidenceId },
    });
    expect(changed.version).toBe(2);
    expect(
      await client.evidenceRetrievalChunk.count({
        where: { userId: userAId, evidenceItemId: odooEvidenceId },
      }),
    ).toBe(0);
    expect(
      await client.evidenceRetrievalIndex.findUniqueOrThrow({
        where: {
          evidenceItemId_userId: { evidenceItemId: odooEvidenceId, userId: userAId },
        },
      }),
    ).toMatchObject({ status: "STALE", lexicalCurrent: false, semanticCurrent: false });
    const staleSearch = await retrieveForUserQuery(
      userAId,
      { query: "Odoo automation", topK: 5 },
      { availability: fakeAvailability },
    );
    expect(staleSearch.retrievedResults.map((item) => item.evidenceItemId)).not.toContain(
      odooEvidenceId,
    );

    const indexed = await indexEvidenceItem(userAId, odooEvidenceId, {
      availability: fakeAvailability,
    });
    await transitionEvidenceState(userAId, odooEvidenceId, {
      targetState: "ARCHIVED",
      expectedVersion: indexed.indexedEvidenceVersion,
    });
    const archivedPacket = await retrieveForRequirement(userAId, requirementId, 5, {
      availability: fakeAvailability,
    });
    expect(archivedPacket.explicitResults.map((item) => item.evidenceItemId)).not.toContain(
      odooEvidenceId,
    );
    const archived = await client.evidenceItem.findUniqueOrThrow({
      where: { id: odooEvidenceId },
    });
    await transitionEvidenceState(userAId, odooEvidenceId, {
      targetState: "ACTIVE",
      expectedVersion: archived.version,
    });
    expect(
      await client.evidenceRetrievalIndex.findUniqueOrThrow({
        where: {
          evidenceItemId_userId: { evidenceItemId: odooEvidenceId, userId: userAId },
        },
      }),
    ).toMatchObject({ status: "STALE", chunkCount: 0 });
    const restored = await indexEvidenceItem(userAId, odooEvidenceId, {
      availability: fakeAvailability,
    });
    expect(restored).toMatchObject({
      status: "CURRENT",
      indexedEvidenceVersion: archived.version + 1,
      semanticCurrent: true,
    });
  }, 30_000);

  it("retains current lexical retrieval on provider failure and clears failure on retry", async () => {
    const evidence = await client.evidenceItem.create({
      data: {
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: "Administered PostgreSQL reliability testing.",
        evidenceStrength: "SUPPORTING",
      },
    });
    const failed = await indexEvidenceItem(userAId, evidence.id, {
      availability: {
        provider: new FailingEmbeddingProvider(),
        unavailableCode: null,
      },
    });
    expect(failed).toMatchObject({
      status: "FAILED",
      errorCode: "EMBEDDING_TIMEOUT",
      lexicalCurrent: true,
      semanticCurrent: false,
    });
    const lexicalOnly = await retrieveForUserQuery(
      userAId,
      { query: "PostgreSQL reliability", topK: 5 },
      {
        availability: {
          provider: new FailingEmbeddingProvider(),
          unavailableCode: null,
        },
      },
    );
    expect(lexicalOnly.semanticAvailable).toBe(false);
    expect(lexicalOnly.retrievedResults.map((item) => item.evidenceItemId)).toContain(evidence.id);
    expect(
      await indexEvidenceItem(userAId, evidence.id, { availability: fakeAvailability }),
    ).toMatchObject({ status: "CURRENT", errorCode: null });
  });

  it("fails safely without partial chunks when the chunk bound is exceeded and permits retry", async () => {
    const evidence = await client.evidenceItem.create({
      data: {
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: "Maintained a bounded retrieval indexing workflow.",
        evidenceStrength: "SUPPORTING",
      },
    });
    const current = await indexEvidenceItem(userAId, evidence.id, {
      availability: fakeAvailability,
    });
    expect(current.chunkCount).toBeGreaterThan(0);

    const failed = await indexEvidenceItem(userAId, evidence.id, {
      availability: fakeAvailability,
      chunkDocument: () => {
        throw new RetrievalChunkingError(21);
      },
    });
    expect(failed).toMatchObject({
      status: "FAILED",
      errorCode: "CHUNK_LIMIT_EXCEEDED",
      chunkCount: 0,
      semanticCurrent: false,
    });
    expect(
      await client.evidenceRetrievalChunk.count({
        where: { userId: userAId, evidenceItemId: evidence.id },
      }),
    ).toBe(0);
    expect(
      (
        await retrieveForUserQuery(
          userAId,
          { query: "bounded retrieval indexing workflow", topK: 5 },
          { availability: fakeAvailability },
        )
      ).retrievedResults.map((item) => item.evidenceItemId),
    ).not.toContain(evidence.id);

    expect(
      await indexEvidenceItem(userAId, evidence.id, { availability: fakeAvailability }),
    ).toMatchObject({
      status: "CURRENT",
      errorCode: null,
      semanticCurrent: true,
    });
  });

  it("bounds stale-page indexing, continues with a cursor, and tolerates concurrent reindex", async () => {
    const records = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        client.evidenceItem.create({
          data: {
            userId: userAId,
            sourceType: "EXPERIENCE",
            sourceExperienceId: experienceAId,
            claim: `Bounded retrieval indexing fixture ${index}.`,
            evidenceStrength: "SUPPORTING",
          },
        }),
      ),
    );
    const first = await reindexEvidencePage(
      userAId,
      { limit: 2 },
      { availability: fakeAvailability },
    );
    expect(first.outcomes).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await reindexEvidencePage(
      userAId,
      { limit: 2, cursor: first.nextCursor },
      { availability: fakeAvailability },
    );
    expect(second.outcomes).toHaveLength(2);
    expect(
      await client.evidenceRetrievalIndex.count({
        where: {
          userId: userAId,
          evidenceItemId: { in: records.map((item) => item.id) },
          status: "CURRENT",
        },
      }),
    ).toBe(4);

    const concurrent = await Promise.all([
      indexEvidenceItem(userAId, records[0]!.id, { availability: fakeAvailability }),
      indexEvidenceItem(userAId, records[0]!.id, { availability: fakeAvailability }),
    ]);
    expect(concurrent.map((item) => item.status)).toEqual(["CURRENT", "CURRENT"]);
  }, 30_000);

  it("stores only compact diagnostic hashes and cascades chunks/indexes on Evidence and User deletion", async () => {
    const rawQuery = `private-query-${randomUUID()}`;
    const packet = await retrieveForUserQuery(
      userAId,
      { query: rawQuery, topK: 3 },
      { availability: fakeAvailability },
    );
    const event = await client.evidenceRetrievalEvent.findFirstOrThrow({
      where: { userId: userAId },
      orderBy: { createdAt: "desc" },
    });
    const expectedHash = hashRetrievalDiagnosticQuery(userAId, rawQuery);
    expect(event.queryHash).toBe(expectedHash);
    expect(event.queryHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(event.queryHash).not.toBe(createHash("sha256").update(rawQuery, "utf8").digest("hex"));
    expect(JSON.stringify(event)).not.toContain(rawQuery);
    expect(packet).not.toHaveProperty("queryHash");
    expect(JSON.stringify(packet)).not.toContain(rawQuery);
    expect(event).toMatchObject({
      mode: "USER_QUERY",
      requestedTopK: 3,
      embeddingProvider: fakeAvailability.provider.descriptor.provider,
      embeddingModel: fakeAvailability.provider.descriptor.model,
    });
    expect(event.returnedCount).toBeGreaterThanOrEqual(0);
    expect(event.returnedCount).toBeLessThanOrEqual(event.requestedTopK);
    expect(event.currentIndexCount).toBeGreaterThanOrEqual(0);
    expect(event.staleIndexCount).toBeGreaterThanOrEqual(0);

    await retrieveForUserQuery(
      userBId,
      { query: rawQuery, topK: 3 },
      { availability: fakeAvailability },
    );
    const otherTenantEvent = await client.evidenceRetrievalEvent.findFirstOrThrow({
      where: { userId: userBId },
      orderBy: { createdAt: "desc" },
    });
    expect(otherTenantEvent.queryHash).not.toBe(event.queryHash);

    const rollbackQueryHash = hashRetrievalDiagnosticQuery(userAId, "rollback probe");
    const beforeRollbackCount = await client.evidenceRetrievalEvent.count({
      where: { userId: userAId, queryHash: rollbackQueryHash },
    });
    await expect(
      client.$transaction(async (tx) => {
        await tx.evidenceRetrievalEvent.create({
          data: {
            userId: userAId,
            queryHash: rollbackQueryHash,
            mode: "USER_QUERY",
            requestedTopK: 1,
            returnedCount: 0,
            currentIndexCount: 0,
            staleIndexCount: 0,
            durationBucket: "LT_100_MS",
            resultCode: "EMPTY",
          },
        });
        throw new Error("force retrieval event rollback");
      }),
    ).rejects.toThrow("force retrieval event rollback");
    expect(
      await client.evidenceRetrievalEvent.count({
        where: { userId: userAId, queryHash: rollbackQueryHash },
      }),
    ).toBe(beforeRollbackCount);

    const deletable = await client.evidenceItem.create({
      data: {
        userId: userAId,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experienceAId,
        claim: "Disposable retrieval narrative.",
        evidenceStrength: "WEAK",
      },
    });
    await indexEvidenceItem(userAId, deletable.id, { availability: fakeAvailability });
    await deleteEvidenceItem(userAId, deletable.id);
    expect(
      await client.evidenceRetrievalIndex.count({
        where: { userId: userAId, evidenceItemId: deletable.id },
      }),
    ).toBe(0);
    expect(
      await client.evidenceRetrievalChunk.count({
        where: { userId: userAId, evidenceItemId: deletable.id },
      }),
    ).toBe(0);

    const temporaryUser = await client.user.create({
      data: { developmentKey: `retrieval-delete-${randomUUID()}` },
    });
    const temporaryProfile = await client.candidateProfile.create({
      data: { userId: temporaryUser.id },
    });
    const temporaryExperience = await client.experience.create({
      data: {
        userId: temporaryUser.id,
        candidateProfileId: temporaryProfile.id,
        title: "Temporary",
        experienceType: "OTHER",
      },
    });
    const temporaryEvidence = await client.evidenceItem.create({
      data: {
        userId: temporaryUser.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: temporaryExperience.id,
        claim: "Temporary user retrieval narrative.",
        evidenceStrength: "WEAK",
      },
    });
    await indexEvidenceItem(temporaryUser.id, temporaryEvidence.id, {
      availability: fakeAvailability,
    });
    await client.user.delete({ where: { id: temporaryUser.id } });
    expect(await client.evidenceRetrievalChunk.count({ where: { userId: temporaryUser.id } })).toBe(
      0,
    );
    expect(await client.evidenceRetrievalIndex.count({ where: { userId: temporaryUser.id } })).toBe(
      0,
    );
  }, 30_000);
});
