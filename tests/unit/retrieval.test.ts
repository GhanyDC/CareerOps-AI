import { describe, expect, it } from "vitest";

import {
  HARD_SPLIT_OVERLAP_CHARACTERS,
  MAX_CANONICAL_DOCUMENT_CHARACTERS,
  MAX_CHUNK_CHARACTERS,
  MAX_CHUNKS_PER_EVIDENCE,
  RetrievalChunkingError,
  buildCanonicalEvidenceDocument,
  chunkCanonicalEvidenceDocument,
} from "@/modules/retrieval/canonical";
import {
  EmbeddingProviderError,
  validateEmbeddingBatch,
  validateEmbeddingVector,
} from "@/modules/retrieval/embedding-provider";
import { evaluateRetrievalCases, recallAtK, reciprocalRank } from "@/modules/retrieval/evaluation";
import { deriveRetrievalIndexFreshness } from "@/modules/retrieval/freshness";
import { bestChunkForEvidence, reciprocalRankFusion } from "@/modules/retrieval/ranking";
import {
  CHUNKING_SCHEMA_VERSION,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_QUERY_LENGTH,
  RETRIEVAL_SCHEMA_VERSION,
  retrievalRequestSchema,
} from "@/modules/retrieval/schemas";

const evidence = {
  id: "evidence-1",
  version: 3,
  claim: "Built Odoo automation for a finance workflow.",
  supportingContext:
    "Automated approval routing.\n\nReduced manual reconciliation effort by 40 percent.",
  skillsDemonstrated: ["Odoo", "Python", "Workflow automation"],
  relevantRoleFamilies: ["ERP Engineer"],
  sourceType: "PROJECT" as const,
  evidenceStrength: "DIRECT" as const,
  verificationStatus: "VERIFIED" as const,
};

describe("Grounded retrieval canonical documents and chunks", () => {
  it("builds stable labeled content and excludes private or operational fields", () => {
    const withExcludedFields = {
      ...evidence,
      sourceNotes: "private reviewer note",
      allowedForResume: true,
      createdAt: new Date(),
      projectUrl: "https://private.invalid",
    };
    const first = buildCanonicalEvidenceDocument(withExcludedFields);
    const withChangedExcludedFields = {
      ...withExcludedFields,
      sourceNotes: "different private note",
      allowedForResume: false,
    };
    const second = buildCanonicalEvidenceDocument(withChangedExcludedFields);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.content).toContain("[Evidence statement]");
    expect(first.content).toContain("[Supporting context]");
    expect(first.content).toContain("[Skills demonstrated]");
    expect(first.content).not.toContain("private reviewer note");
    expect(first.content).not.toContain("private.invalid");
    expect(first.content).not.toContain("allowedForResume");
    expect(first.characterCount).toBeLessThanOrEqual(MAX_CANONICAL_DOCUMENT_CHARACTERS);
  });

  it("normalizes whitespace and Unicode deterministically", () => {
    const first = buildCanonicalEvidenceDocument({
      ...evidence,
      claim: "Built   cafe\u0301\r\nworkflow",
    });
    const second = buildCanonicalEvidenceDocument({
      ...evidence,
      claim: "Built café\nworkflow",
    });
    expect(first.content).toBe(second.content);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("produces stable bounded chunks with stable IDs, indexes, and hashes", () => {
    const canonical = buildCanonicalEvidenceDocument(evidence);
    const first = chunkCanonicalEvidenceDocument(canonical);
    const second = chunkCanonicalEvidenceDocument(canonical);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_EVIDENCE);
    for (const [index, chunk] of first.entries()) {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.characterCount).toBeLessThanOrEqual(MAX_CHUNK_CHARACTERS);
      expect(chunk.hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(chunk.id).toMatch(/^erc_[0-9a-f]{32}$/u);
    }
  });

  it("uses only the documented small overlap for hard character fallback", () => {
    const chunks = chunkCanonicalEvidenceDocument(
      buildCanonicalEvidenceDocument({
        ...evidence,
        claim: "x".repeat(MAX_CHUNK_CHARACTERS * 2),
        supportingContext: null,
        skillsDemonstrated: [],
        relevantRoleFamilies: [],
      }),
    );
    const statementChunks = chunks.filter((chunk) => chunk.section === "Evidence statement");
    expect(statementChunks.length).toBeGreaterThan(1);
    const firstTail = statementChunks[0]!.text.slice(-HARD_SPLIT_OVERLAP_CHARACTERS);
    expect(statementChunks[1]!.text).toContain(firstTail);
  });

  it("fails explicitly instead of truncating when deterministic chunking exceeds the bound", () => {
    const overLimitDocument = {
      evidenceItemId: "evidence-over-limit",
      evidenceVersion: 1,
      content: "",
      contentHash: "a".repeat(64),
      characterCount: 0,
      sections: Array.from({ length: MAX_CHUNKS_PER_EVIDENCE + 1 }, (_, index) => ({
        label: `Section ${index}`,
        text: `Bounded chunk ${index}`,
      })),
    };

    expect(() => chunkCanonicalEvidenceDocument(overLimitDocument)).toThrowError(
      expect.objectContaining({
        name: RetrievalChunkingError.name,
        code: "CHUNK_LIMIT_EXCEEDED",
        generatedChunkCount: MAX_CHUNKS_PER_EVIDENCE + 1,
      }),
    );
  });
});

describe("Grounded retrieval validation, freshness, ranking, and evaluation", () => {
  it("validates vector dimensions, batch counts, and finite values", () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    expect(validateEmbeddingVector(vector, EMBEDDING_DIMENSIONS)).toBe(vector);
    expect(() => validateEmbeddingVector([0], EMBEDDING_DIMENSIONS)).toThrow(
      EmbeddingProviderError,
    );
    expect(() =>
      validateEmbeddingVector([...vector.slice(0, -1), Number.NaN], EMBEDDING_DIMENSIONS),
    ).toThrow(EmbeddingProviderError);
    expect(() => validateEmbeddingBatch([vector], 2, EMBEDDING_DIMENSIONS)).toThrow(
      EmbeddingProviderError,
    );
  });

  it("derives current, disabled, and stale states from every freshness coordinate", () => {
    const current = {
      status: "CURRENT" as const,
      indexedEvidenceVersion: 3,
      canonicalContentHash: "a".repeat(64),
      chunkingSchemaVersion: CHUNKING_SCHEMA_VERSION,
      retrievalSchemaVersion: RETRIEVAL_SCHEMA_VERSION,
      lexicalCurrent: true,
      semanticCurrent: true,
      embeddingProvider: "test",
      embeddingModel: "test-v1",
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    };
    expect(
      deriveRetrievalIndexFreshness({
        evidenceVersion: 3,
        canonicalContentHash: "a".repeat(64),
        expectedSemanticCoordinates: {
          provider: "test",
          model: "test-v1",
          dimensions: EMBEDDING_DIMENSIONS,
        },
        index: current,
      }),
    ).toBe("CURRENT");
    expect(
      deriveRetrievalIndexFreshness({
        evidenceVersion: 3,
        canonicalContentHash: "a".repeat(64),
        expectedSemanticCoordinates: null,
        index: { ...current, status: "DISABLED", semanticCurrent: false },
      }),
    ).toBe("DISABLED");
    expect(
      deriveRetrievalIndexFreshness({
        evidenceVersion: 4,
        canonicalContentHash: "a".repeat(64),
        expectedSemanticCoordinates: {
          provider: "test",
          model: "test-v1",
          dimensions: EMBEDDING_DIMENSIONS,
        },
        index: current,
      }),
    ).toBe("STALE");
    expect(
      deriveRetrievalIndexFreshness({
        evidenceVersion: 3,
        canonicalContentHash: "b".repeat(64),
        expectedSemanticCoordinates: {
          provider: "test",
          model: "test-v1",
          dimensions: EMBEDDING_DIMENSIONS,
        },
        index: current,
      }),
    ).toBe("STALE");
    expect(
      deriveRetrievalIndexFreshness({
        evidenceVersion: 3,
        canonicalContentHash: "a".repeat(64),
        expectedSemanticCoordinates: {
          provider: "test",
          model: "test-v2",
          dimensions: EMBEDDING_DIMENSIONS,
        },
        index: current,
      }),
    ).toBe("LEXICAL_ONLY");
  });

  it("enforces query, control-character, and top-K bounds", () => {
    expect(retrievalRequestSchema.parse({ query: "Odoo automation", topK: 5 })).toEqual({
      query: "Odoo automation",
      topK: 5,
    });
    expect(() =>
      retrievalRequestSchema.parse({
        query: "x".repeat(MAX_RETRIEVAL_QUERY_LENGTH + 1),
        topK: 5,
      }),
    ).toThrow();
    expect(() => retrievalRequestSchema.parse({ query: "valid", topK: 11 })).toThrow();
    expect(() => retrievalRequestSchema.parse({ query: "bad\u202Equery", topK: 5 })).toThrow();
  });

  it("deduplicates Evidence, chooses the best chunk, fuses ranks, and breaks ties stably", () => {
    const lexical = [
      {
        evidenceItemId: "b",
        chunkId: "b-1",
        chunkIndex: 1,
        chunkHash: "b".repeat(64),
        snippet: "B",
        rank: 1,
      },
      {
        evidenceItemId: "b",
        chunkId: "b-2",
        chunkIndex: 2,
        chunkHash: "c".repeat(64),
        snippet: "B2",
        rank: 2,
      },
      {
        evidenceItemId: "a",
        chunkId: "a-1",
        chunkIndex: 0,
        chunkHash: "a".repeat(64),
        snippet: "A",
        rank: 3,
      },
    ];
    expect(bestChunkForEvidence(lexical.slice(0, 2)).chunkId).toBe("b-1");
    const fused = reciprocalRankFusion(lexical, [{ ...lexical[2]!, rank: 1 }]);
    expect(fused).toHaveLength(2);
    expect(fused[0]!.evidenceItemId).toBe("a");
    expect(fused[0]!.reasons).toEqual(["HYBRID", "LEXICAL", "SEMANTIC"]);
    expect(fused.map((item) => item.hybridRank)).toEqual([1, 2]);
  });

  it("computes recall, MRR, explicit, isolation, stale, and citation metrics", () => {
    expect(recallAtK(["a", "b"], ["b", "c"])).toBe(0.5);
    expect(reciprocalRank(["b"], ["a", "b"])).toBe(0.5);
    expect(
      evaluateRetrievalCases([
        {
          expectedEvidenceIds: ["b"],
          returnedEvidenceIds: ["a", "b"],
          explicitExpectedEvidenceIds: ["x"],
          explicitReturnedEvidenceIds: ["x"],
          tenantLeakageIds: [],
          staleReturnedIds: [],
          citations: [
            {
              evidenceItemId: "b",
              citedEvidenceItemId: "b",
              evidenceVersion: 2,
              citedEvidenceVersion: 2,
            },
          ],
        },
      ]),
    ).toEqual({
      recallAtK: 1,
      meanReciprocalRank: 0.5,
      explicitLinkInclusion: 1,
      tenantIsolationFailures: 0,
      staleIndexFailures: 0,
      citationCorrectness: 1,
    });
  });
});
