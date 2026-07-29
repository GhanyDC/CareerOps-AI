import "server-only";

import OpenAI from "openai";

import {
  EmbeddingProviderError,
  type EmbeddingFailureCode,
  type EmbeddingProvider,
  validateEmbeddingBatch,
} from "./embedding-provider";
import { EMBEDDING_DIMENSIONS } from "./schemas";

const OPENAI_EMBEDDING_TIMEOUT_MILLISECONDS = 20_000;
const OPENAI_TRANSIENT_RETRIES = 2;
const OPENAI_MAXIMUM_BATCH_SIZE = 32;

function failureCode(error: unknown): EmbeddingFailureCode {
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return "EMBEDDING_AUTHENTICATION_ERROR";
  }
  if (error instanceof OpenAI.RateLimitError) return "EMBEDDING_RATE_LIMITED";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "EMBEDDING_TIMEOUT";
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) {
    return "EMBEDDING_TRANSIENT_ERROR";
  }
  return "EMBEDDING_INVALID_RESPONSE";
}

export function createOpenAIEmbeddingProvider(input: {
  apiKey: string;
  model: string;
}): EmbeddingProvider {
  const client = new OpenAI({
    apiKey: input.apiKey,
    timeout: OPENAI_EMBEDDING_TIMEOUT_MILLISECONDS,
    maxRetries: OPENAI_TRANSIENT_RETRIES,
  });
  const descriptor = {
    provider: "openai",
    model: input.model,
    dimensions: EMBEDDING_DIMENSIONS,
    maximumBatchSize: OPENAI_MAXIMUM_BATCH_SIZE,
  } as const;

  async function embed(values: readonly string[]) {
    if (values.length < 1 || values.length > descriptor.maximumBatchSize) {
      throw new EmbeddingProviderError("EMBEDDING_CONFIGURATION_ERROR");
    }
    try {
      const response = await client.embeddings.create({
        model: descriptor.model,
        input: [...values],
        dimensions: descriptor.dimensions,
        encoding_format: "float",
      });
      const ordered = [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
      return validateEmbeddingBatch(ordered, values.length, descriptor.dimensions);
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      throw new EmbeddingProviderError(failureCode(error), { cause: error });
    }
  }

  return {
    descriptor,
    embedDocuments: embed,
    async embedQuery(value) {
      return (await embed([value]))[0]!;
    },
  };
}
