import { createHash } from "node:crypto";

import type { EmbeddingProvider } from "./embedding-provider";
import { EMBEDDING_DIMENSIONS } from "./schemas";

function deterministicVector(input: string) {
  const vector = Array.from<number>({ length: EMBEDDING_DIMENSIONS }).fill(0);
  const terms =
    input
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const term of terms) {
    const digest = createHash("sha256").update(term, "utf8").digest();
    const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    const sign = digest[4]! % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) vector[0] = 1;
  else {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = vector[index]! / norm;
    }
  }
  return vector;
}

/**
 * Algorithm-only test double. It is intentionally unavailable in production
 * and must never be represented as a semantic-quality embedding model.
 */
export class DeterministicTestEmbeddingProvider implements EmbeddingProvider {
  readonly descriptor = {
    provider: "deterministic-test",
    model: "deterministic-token-hash-v1",
    dimensions: EMBEDDING_DIMENSIONS,
    maximumBatchSize: 32,
  } as const;

  async embedDocuments(inputs: readonly string[]) {
    return inputs.map(deterministicVector);
  }

  async embedQuery(input: string) {
    return deterministicVector(input);
  }
}
