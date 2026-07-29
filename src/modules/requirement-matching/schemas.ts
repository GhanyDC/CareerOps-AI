import { z } from "zod";

export const REQUIREMENT_MATCH_SCHEMA_VERSION = 1 as const;
export const MAX_REQUIREMENT_EVIDENCE_LINKS = 100 as const;

export const requirementCategories = [
  "SKILL",
  "EXPERIENCE",
  "EDUCATION",
  "CERTIFICATION",
  "RESPONSIBILITY",
  "DOMAIN_KNOWLEDGE",
  "OTHER",
] as const;

export const requirementImportances = ["REQUIRED", "PREFERRED", "OTHER"] as const;

export const requirementSources = [
  "MANUAL",
  "JOB_RESPONSIBILITY",
  "JOB_QUALIFICATION",
  "JOB_PREFERRED_QUALIFICATION",
  "JOB_SKILL",
] as const;

export const requirementSupportLevels = ["FULL", "PARTIAL"] as const;

const bidiControls = /[\u202A-\u202E\u2066-\u2069]/u;
const unsafeControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function normalizePlainText(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function plainTextValue(label: string, maximum: number) {
  return z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(maximum, `${label} is too long`)
    .refine((text) => !unsafeControls.test(text), `${label} contains control characters`)
    .refine((text) => !bidiControls.test(text), `${label} contains unsupported Unicode controls`);
}

function boundedPlainText(label: string, maximum: number) {
  return z.preprocess(normalizePlainText, plainTextValue(label, maximum));
}

function optionalBoundedPlainText(label: string, maximum: number) {
  return z.preprocess(normalizePlainText, plainTextValue(label, maximum).optional());
}

const positiveVersion = z.coerce.number().int().positive();

const requirementValuesSchema = z
  .object({
    statement: boundedPlainText("Requirement statement", 1000),
    category: z.enum(requirementCategories),
    importance: z.enum(requirementImportances),
    source: z.enum(requirementSources),
  })
  .strict();

export const requirementCreateSchema = requirementValuesSchema;

export const requirementUpdateSchema = requirementValuesSchema
  .extend({ expectedVersion: positiveVersion })
  .strict();

export const requirementStateTransitionSchema = z
  .object({
    targetState: z.enum(["ACTIVE", "ARCHIVED"]),
    expectedVersion: positiveVersion,
  })
  .strict();

export const requirementMoveSchema = z
  .object({
    direction: z.enum(["UP", "DOWN"]),
    expectedOrderHash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

const linkValuesSchema = z
  .object({
    supportLevel: z.enum(requirementSupportLevels),
    rationale: optionalBoundedPlainText("Rationale", 500),
  })
  .strict();

export const evidenceLinkCreateSchema = linkValuesSchema
  .extend({
    evidenceItemId: z.string().min(1).max(100),
    expectedEvidenceVersion: positiveVersion,
    expectedRequirementVersion: positiveVersion,
    expectedMatchSetVersion: positiveVersion,
  })
  .strict();

export const evidenceLinkUpdateSchema = linkValuesSchema
  .extend({
    expectedLinkVersion: positiveVersion,
    expectedRequirementVersion: positiveVersion,
    expectedMatchSetVersion: positiveVersion,
  })
  .strict();

export const evidenceLinkDeleteSchema = z
  .object({
    expectedLinkVersion: positiveVersion,
    expectedRequirementVersion: positiveVersion,
    expectedMatchSetVersion: positiveVersion,
  })
  .strict();

const evidenceCoordinateSchema = z
  .object({
    evidenceItemId: z.string().min(1).max(100),
    evidenceVersion: positiveVersion,
  })
  .strict();

export const requirementReviewCompletionSchema = z
  .object({
    expectedRequirementVersion: positiveVersion,
    expectedMatchSetVersion: positiveVersion,
    expectedReviewVersion: z.coerce.number().int().nonnegative(),
    evidenceCoordinates: z.array(evidenceCoordinateSchema).max(MAX_REQUIREMENT_EVIDENCE_LINKS),
  })
  .strict();

export const evidenceCoordinateListSchema = z
  .array(evidenceCoordinateSchema)
  .max(MAX_REQUIREMENT_EVIDENCE_LINKS);

export type RequirementValues = z.infer<typeof requirementValuesSchema>;
export type RequirementImportance = (typeof requirementImportances)[number];
export type RequirementSupportLevel = (typeof requirementSupportLevels)[number];
