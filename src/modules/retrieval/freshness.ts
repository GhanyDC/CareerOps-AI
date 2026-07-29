import { CHUNKING_SCHEMA_VERSION, RETRIEVAL_SCHEMA_VERSION } from "./schemas";

export type RetrievalFreshnessCoordinates = Readonly<{
  evidenceVersion: number;
  canonicalContentHash: string;
  expectedSemanticCoordinates: null | Readonly<{
    provider: string;
    model: string;
    dimensions: number;
  }>;
  index: null | Readonly<{
    status: "PENDING" | "CURRENT" | "STALE" | "FAILED" | "DISABLED";
    indexedEvidenceVersion: number | null;
    canonicalContentHash: string | null;
    chunkingSchemaVersion: number;
    retrievalSchemaVersion: number;
    lexicalCurrent: boolean;
    semanticCurrent: boolean;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddingDimensions: number | null;
  }>;
}>;

export type RetrievalIndexFreshness =
  "CURRENT" | "LEXICAL_ONLY" | "PENDING" | "STALE" | "FAILED" | "DISABLED" | "NOT_INDEXED";

export function deriveRetrievalIndexFreshness(
  coordinates: RetrievalFreshnessCoordinates,
): RetrievalIndexFreshness {
  const index = coordinates.index;
  if (!index) return "NOT_INDEXED";
  if (index.status === "PENDING") return "PENDING";
  if (
    index.status === "STALE" ||
    index.indexedEvidenceVersion !== coordinates.evidenceVersion ||
    index.canonicalContentHash !== coordinates.canonicalContentHash ||
    index.chunkingSchemaVersion !== CHUNKING_SCHEMA_VERSION ||
    index.retrievalSchemaVersion !== RETRIEVAL_SCHEMA_VERSION ||
    !index.lexicalCurrent
  ) {
    return "STALE";
  }
  if (index.status === "FAILED") return "FAILED";
  if (index.status === "DISABLED") return "DISABLED";
  if (
    index.status === "CURRENT" &&
    index.semanticCurrent &&
    coordinates.expectedSemanticCoordinates &&
    index.embeddingProvider === coordinates.expectedSemanticCoordinates.provider &&
    index.embeddingModel === coordinates.expectedSemanticCoordinates.model &&
    index.embeddingDimensions === coordinates.expectedSemanticCoordinates.dimensions
  ) {
    return "CURRENT";
  }
  return "LEXICAL_ONLY";
}
