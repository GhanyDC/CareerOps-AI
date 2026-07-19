import { z } from "zod";

export const DUPLICATE_RULE_SET_VERSION = 1 as const;
export const DUPLICATE_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const duplicateFieldSchema = z.enum([
  "title",
  "companyName",
  "employmentType",
  "workplaceArrangement",
  "experienceLevel",
  "countryCode",
  "region",
  "city",
  "locationLabel",
  "salary",
  "postedAt",
  "closesAt",
  "sourceUrl",
  "description",
  "responsibilities",
  "qualifications",
  "skills",
  "sourceProvenance",
]);

export const duplicateRuleCodeSchema = z.enum([
  "EXACT_CANONICAL_URL",
  "SHARED_LIVE_SOURCE",
  "SHARED_SOURCE_HASH_AND_CORE",
  "EXACT_COMPANY_TITLE_AND_LOCATION",
  "EXACT_CORE_POSTED_AND_CONTENT",
  "EXACT_CORE_WITH_CORROBORATION",
  "TITLE_MATCH",
  "COMPANY_MATCH",
  "EMPLOYMENT_TYPE_MATCH",
  "WORKPLACE_ARRANGEMENT_MATCH",
  "EXPERIENCE_LEVEL_MATCH",
  "SALARY_MATCH",
  "POSTED_DATE_MATCH",
  "CLOSING_DATE_MATCH",
  "DESCRIPTION_MATCH",
  "RESPONSIBILITIES_MATCH",
  "QUALIFICATIONS_MATCH",
  "SKILLS_MATCH",
]);

export const duplicateConflictCodeSchema = z.enum([
  "CANONICAL_COMPANY_MISMATCH",
  "EMPLOYMENT_TYPE_MISMATCH",
  "COUNTRY_MISMATCH",
  "EXPERIENCE_LEVEL_MISMATCH",
  "SALARY_CURRENCY_MISMATCH",
  "SALARY_PERIOD_MISMATCH",
  "SALARY_RANGES_NON_OVERLAPPING",
  "POSTED_DATE_GAP_OVER_45_DAYS",
  "CLOSING_DATE_INCOMPATIBLE",
  "CANONICAL_URL_MISMATCH",
]);

const evidenceRuleSchema = z
  .object({
    code: duplicateRuleCodeSchema,
    strength: z.enum(["STRONG", "MODERATE", "WEAK"]),
    fields: z.array(duplicateFieldSchema).min(1).max(8),
    valueHashes: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .max(8)
      .optional(),
    categories: z.array(z.string().min(1).max(80)).max(8).optional(),
  })
  .strict();

export const duplicateEvidenceSchema = z
  .object({
    schemaVersion: z.literal(DUPLICATE_EVIDENCE_SCHEMA_VERSION),
    qualifyingRules: z.array(evidenceRuleSchema).max(16),
    supportingRules: z.array(evidenceRuleSchema).max(32),
  })
  .strict();

const conflictItemSchema = z
  .object({
    code: duplicateConflictCodeSchema,
    fields: z.array(duplicateFieldSchema).min(1).max(4),
    leftCategory: z.string().min(1).max(80).optional(),
    rightCategory: z.string().min(1).max(80).optional(),
  })
  .strict();

export const duplicateConflictsSchema = z
  .object({
    schemaVersion: z.literal(DUPLICATE_EVIDENCE_SCHEMA_VERSION),
    items: z.array(conflictItemSchema).max(32),
  })
  .strict();

export const duplicateDecisionInputSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    decision: z.enum(["SAME_OPPORTUNITY", "DIFFERENT_OPPORTUNITIES", "DEFERRED"]),
    primaryJobId: z.string().min(1).max(100).optional(),
    splitPrimaryJobIds: z.array(z.string().min(1).max(100)).max(20).default([]),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const duplicatePrimaryInputSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    primaryJobId: z.string().min(1).max(100),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const duplicateScanInputSchema = z
  .object({
    cursor: z.string().min(1).max(100).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

export type DuplicateEvidence = z.infer<typeof duplicateEvidenceSchema>;
export type DuplicateConflicts = z.infer<typeof duplicateConflictsSchema>;
export type DuplicateRule = DuplicateEvidence["qualifyingRules"][number];
