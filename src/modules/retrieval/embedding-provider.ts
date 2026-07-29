export type EmbeddingProviderDescriptor = Readonly<{
  provider: string;
  model: string;
  dimensions: number;
  maximumBatchSize: number;
}>;

export type EmbeddingFailureCode =
  | "EMBEDDING_CONFIGURATION_ERROR"
  | "EMBEDDING_AUTHENTICATION_ERROR"
  | "EMBEDDING_RATE_LIMITED"
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_TRANSIENT_ERROR"
  | "EMBEDDING_INVALID_RESPONSE"
  | "EMBEDDING_DIMENSION_MISMATCH";

export class EmbeddingProviderError extends Error {
  constructor(
    public readonly code: EmbeddingFailureCode,
    options?: ErrorOptions,
  ) {
    super("Embedding provider operation failed.", options);
    this.name = "EmbeddingProviderError";
  }
}

export interface EmbeddingProvider {
  readonly descriptor: EmbeddingProviderDescriptor;
  embedDocuments(inputs: readonly string[]): Promise<readonly (readonly number[])[]>;
  embedQuery(input: string): Promise<readonly number[]>;
}

export function validateEmbeddingVector(vector: readonly number[], dimensions: number) {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingProviderError("EMBEDDING_DIMENSION_MISMATCH");
  }
  return vector;
}

export function validateEmbeddingBatch(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  dimensions: number,
) {
  if (vectors.length !== expectedCount) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_RESPONSE");
  }
  return vectors.map((vector) => validateEmbeddingVector(vector, dimensions));
}
