import { z } from "zod";

export const DISCOVERY_VALIDATOR_VERSION = "discovery-import-v1" as const;
export const MAX_BATCH_DISCOVERIES = 20;
export const MAX_RAW_CONTENT_BYTES = 50_000;
export const MAX_CANONICAL_PAYLOAD_BYTES = 262_144;
export const MAX_STRUCTURED_INPUT_BYTES = 262_144;

const bidiControls = /[\u202A-\u202E\u2066-\u2069]/u;
const singleLineControls = /[\u0000-\u001F\u007F-\u009F]/u;
const rawControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function hasValidUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function scalarLength(value: string) {
  return [...value].length;
}

function safeUnicode(value: string) {
  return hasValidUnicode(value) && !bidiControls.test(value);
}

function optionalFormString(schema: z.ZodType<string>) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

function singleLine(label: string, maximum: number) {
  return z
    .string()
    .refine((value) => scalarLength(value) <= maximum, `${label} is too long`)
    .refine((value) => value.trim().length > 0, `${label} cannot be blank`)
    .refine(safeUnicode, `${label} contains unsupported Unicode`)
    .refine((value) => !singleLineControls.test(value), `${label} contains control characters`);
}

const sourceLabelSchema = singleLine("Source label", 160);
const titleHintSchema = singleLine("Title hint", 200);
const companyHintSchema = singleLine("Company hint", 200);
const locationHintSchema = singleLine("Location hint", 200);
const producerLabelSchema = singleLine("Producer label", 160);

const sourceUrlSchema = z
  .string()
  .refine((value) => scalarLength(value) <= 2048, "Source URL is too long")
  .refine((value) => value === value.trim(), "Source URL cannot have surrounding whitespace")
  .refine(safeUnicode, "Source URL contains unsupported Unicode")
  .refine((value) => !singleLineControls.test(value), "Source URL contains control characters")
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Source URL is invalid" });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Source URL must use http:// or https://" });
    }
    if (parsed.username || parsed.password) {
      context.addIssue({ code: "custom", message: "Source URL cannot contain credentials" });
    }
  });

const discoveredAtSchema = z
  .string()
  .max(35)
  .refine(
    (value) => rfc3339.test(value),
    "Discovered at must be an RFC 3339 timestamp with timezone",
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "Discovered at is invalid");

const rawTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Raw text is required")
  .refine(safeUnicode, "Raw text contains unsupported Unicode")
  .refine((value) => !rawControls.test(value), "Raw text contains control characters")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_RAW_CONTENT_BYTES,
    `Raw text must be at most ${MAX_RAW_CONTENT_BYTES} UTF-8 bytes`,
  );

const formOpportunityFields = {
  sourceLabel: optionalFormString(sourceLabelSchema),
  sourceUrl: optionalFormString(sourceUrlSchema),
  titleHint: optionalFormString(titleHintSchema),
  companyHint: optionalFormString(companyHintSchema),
  locationHint: optionalFormString(locationHintSchema),
  discoveredAt: optionalFormString(discoveredAtSchema),
  rawText: rawTextSchema,
} as const;

export const manualDiscoveryDraftSchema = z
  .object({
    contractVersion: z.literal(1),
    importMethod: z.literal("MANUAL_ENTRY"),
    ...formOpportunityFields,
  })
  .strict();

export const pastedDiscoveryDraftSchema = z
  .object({
    contractVersion: z.literal(1),
    importMethod: z.literal("PASTED_TEXT"),
    ...formOpportunityFields,
  })
  .strict();

const structuredDiscoverySchema = z
  .object({
    sourceLabel: sourceLabelSchema.optional(),
    sourceUrl: sourceUrlSchema.optional(),
    titleHint: titleHintSchema.optional(),
    companyHint: companyHintSchema.optional(),
    locationHint: locationHintSchema.optional(),
    rawText: rawTextSchema,
  })
  .strict();

export const structuredDiscoveryImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    producerLabel: producerLabelSchema.optional(),
    discoveredAt: discoveredAtSchema.optional(),
    discoveries: z.array(structuredDiscoverySchema).min(1).max(MAX_BATCH_DISCOVERIES),
  })
  .strict();

export const signedImportPayloadSchema = z
  .object({
    idempotencyKey: z.uuid(),
    draft: z.union([
      manualDiscoveryDraftSchema,
      pastedDiscoveryDraftSchema,
      structuredDiscoveryImportSchema,
    ]),
  })
  .strict();

export const discoveryBatchValidationSummarySchema = z
  .object({
    validatorVersion: z.literal(DISCOVERY_VALIDATOR_VERSION),
    discoveryCount: z.number().int().min(1).max(MAX_BATCH_DISCOVERIES),
    totalPayloadBytes: z.number().int().nonnegative().max(MAX_CANONICAL_PAYLOAD_BYTES),
  })
  .strict();

export const discoveryValidationSummarySchema = z
  .object({
    rawContentBytes: z.number().int().positive().max(MAX_RAW_CONTENT_BYTES),
    urlValidated: z.boolean(),
    controlCharacterCheck: z.literal("PASSED"),
  })
  .strict();

export const discoveryTransitionSchema = z
  .object({
    targetStatus: z.enum(["INBOX", "REJECTED", "ARCHIVED"]),
    expectedVersion: z.coerce.number().int().positive(),
  })
  .strict();

export const purgeConfirmationSchema = z.object({ confirmation: z.string().max(80) }).strict();

export type ManualDiscoveryDraftV1 = z.infer<typeof manualDiscoveryDraftSchema>;
export type PastedDiscoveryDraftV1 = z.infer<typeof pastedDiscoveryDraftSchema>;
export type StructuredDiscoveryImportV1 = z.infer<typeof structuredDiscoveryImportSchema>;
export type DiscoveryDraftV1 =
  ManualDiscoveryDraftV1 | PastedDiscoveryDraftV1 | StructuredDiscoveryImportV1;
export type SignedImportPayloadV1 = z.infer<typeof signedImportPayloadSchema>;
export type DiscoveryBatchValidationSummaryV1 = z.infer<
  typeof discoveryBatchValidationSummarySchema
>;
export type DiscoveryValidationSummaryV1 = z.infer<typeof discoveryValidationSummarySchema>;

export function normalizePresentationValue(value: string | undefined) {
  return value?.trim().replace(/\s+/gu, " ");
}
