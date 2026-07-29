import { z } from "zod";

export const RETRIEVAL_SCHEMA_VERSION = 1 as const;
export const CHUNKING_SCHEMA_VERSION = 1 as const;
export const EMBEDDING_DIMENSIONS = 1536 as const;
export const DEFAULT_RETRIEVAL_TOP_K = 5 as const;
export const MAX_RETRIEVAL_TOP_K = 10 as const;
export const MAX_RETRIEVAL_QUERY_LENGTH = 500 as const;
export const MAX_RETRIEVAL_CANDIDATES_PER_CHANNEL = 50 as const;
export const MAX_REINDEX_BATCH_SIZE = 10 as const;

const bidiControls = /[\u202A-\u202E\u2066-\u2069]/u;
const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .replace(/[ \t]+/gu, " ");
  return normalized.length > 0 ? normalized : undefined;
}

export const retrievalQuerySchema = z.preprocess(
  normalizeQuery,
  z
    .string({ error: "Search query is required" })
    .min(1, "Search query is required")
    .max(MAX_RETRIEVAL_QUERY_LENGTH, "Search query is too long")
    .refine((text) => !unsafeControls.test(text), "Search query contains control characters")
    .refine(
      (text) => !bidiControls.test(text),
      "Search query contains unsupported Unicode controls",
    ),
);

export const retrievalTopKSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_RETRIEVAL_TOP_K)
  .default(DEFAULT_RETRIEVAL_TOP_K);

export const retrievalRequestSchema = z
  .object({
    query: retrievalQuerySchema,
    topK: retrievalTopKSchema,
  })
  .strict();

export const retrievalIdentifierSchema = z.string().min(1).max(100);

export const reindexPageSchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_REINDEX_BATCH_SIZE).default(5),
  })
  .strict();

export const evidenceStateTransitionSchema = z
  .object({
    targetState: z.enum(["ACTIVE", "ARCHIVED"]),
    expectedVersion: z.coerce.number().int().positive(),
  })
  .strict();

export type RetrievalReason =
  "EXPLICIT_FULL_LINK" | "EXPLICIT_PARTIAL_LINK" | "LEXICAL" | "SEMANTIC" | "HYBRID";

export type RetrievalMode = "REQUIREMENT" | "JOB" | "USER_QUERY";
