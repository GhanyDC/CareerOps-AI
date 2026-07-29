import "server-only";

import { z } from "zod";

import type { EmbeddingProvider } from "./embedding-provider";
import { DeterministicTestEmbeddingProvider } from "./deterministic-test-provider";
import { createOpenAIEmbeddingProvider } from "./openai-provider.server";

const providerEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CAREEROPS_EMBEDDING_PROVIDER: z
      .enum(["disabled", "openai", "deterministic-test"])
      .default("disabled"),
    CAREEROPS_EMBEDDING_MODEL: z.string().trim().min(1).max(160).optional(),
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.CAREEROPS_EMBEDDING_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when OpenAI semantic retrieval is enabled",
      });
    }
    if (value.CAREEROPS_EMBEDDING_PROVIDER === "deterministic-test" && value.NODE_ENV !== "test") {
      context.addIssue({
        code: "custom",
        path: ["CAREEROPS_EMBEDDING_PROVIDER"],
        message: "The deterministic embedding provider is test-only",
      });
    }
  });

export type EmbeddingProviderAvailability = Readonly<{
  provider: EmbeddingProvider | null;
  unavailableCode: "SEMANTIC_PROVIDER_DISABLED" | null;
}>;

export function getConfiguredEmbeddingProvider(
  environment: Record<string, string | undefined> = process.env,
): EmbeddingProviderAvailability {
  const parsed = providerEnvironmentSchema.parse(environment);
  if (parsed.CAREEROPS_EMBEDDING_PROVIDER === "disabled") {
    return { provider: null, unavailableCode: "SEMANTIC_PROVIDER_DISABLED" };
  }
  if (parsed.CAREEROPS_EMBEDDING_PROVIDER === "deterministic-test") {
    return { provider: new DeterministicTestEmbeddingProvider(), unavailableCode: null };
  }
  return {
    provider: createOpenAIEmbeddingProvider({
      apiKey: parsed.OPENAI_API_KEY!,
      model: parsed.CAREEROPS_EMBEDDING_MODEL ?? "text-embedding-3-small",
    }),
    unavailableCode: null,
  };
}
