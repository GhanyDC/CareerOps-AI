import { z } from "zod";

export const JOB_FILTER_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const JOB_FILTER_EXPLANATION_SCHEMA_VERSION = 1 as const;
export const JOB_FILTER_RULE_SET_VERSION = 1 as const;
export const JOB_FILTER_RULE_VERSION = 1 as const;

export const jobFilterOutcomeSchema = z.enum(["PASS", "FAIL", "NEEDS_REVIEW"]);
export const missingDataPolicySchema = z.enum(["NEEDS_REVIEW", "FAIL"]);

export const jobEmploymentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "VOLUNTEER",
  "OTHER",
]);

export const jobWorkplaceArrangementSchema = z.enum([
  "ON_SITE",
  "HYBRID",
  "REMOTE",
  "FIELD_BASED",
  "OTHER",
]);

export const jobSalaryPeriodSchema = z.enum([
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "YEAR",
  "PROJECT",
  "OTHER",
]);

const decimalSchema = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/, "Enter a non-negative amount with up to two decimals");
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter uppercase currency code");
const countrySchema = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter uppercase country code");

const commonRule = {
  ruleVersion: z.literal(JOB_FILTER_RULE_VERSION),
  enabled: z.boolean(),
  missingDataPolicy: missingDataPolicySchema,
};

export const minimumSalaryRuleSchema = z
  .object({
    ruleId: z.literal("MINIMUM_SALARY"),
    ...commonRule,
    minimum: decimalSchema.nullable(),
    currency: currencySchema.nullable(),
    salaryPeriod: jobSalaryPeriodSchema.nullable(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (!rule.enabled) return;
    for (const [field, value] of [
      ["minimum", rule.minimum],
      ["currency", rule.currency],
      ["salaryPeriod", rule.salaryPeriod],
    ] as const) {
      if (value === null) {
        context.addIssue({ code: "custom", path: [field], message: `${field} is required` });
      }
    }
  });

export const allowedEmploymentTypesRuleSchema = z
  .object({
    ruleId: z.literal("ALLOWED_EMPLOYMENT_TYPES"),
    ...commonRule,
    allowedEmploymentTypes: z.array(jobEmploymentTypeSchema).max(8),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.enabled && rule.allowedEmploymentTypes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["allowedEmploymentTypes"],
        message: "Select at least one employment type",
      });
    }
  });

export const allowedWorkplaceArrangementsRuleSchema = z
  .object({
    ruleId: z.literal("ALLOWED_WORKPLACE_ARRANGEMENTS"),
    ...commonRule,
    allowedWorkplaceArrangements: z.array(jobWorkplaceArrangementSchema).max(5),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.enabled && rule.allowedWorkplaceArrangements.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["allowedWorkplaceArrangements"],
        message: "Select at least one workplace arrangement",
      });
    }
  });

export const countryAllowDenyRuleSchema = z
  .object({
    ruleId: z.literal("COUNTRY_ALLOW_DENY"),
    ...commonRule,
    allowedCountryCodes: z.array(countrySchema).max(249),
    excludedCountryCodes: z.array(countrySchema).max(249),
  })
  .strict()
  .superRefine((rule, context) => {
    if (
      rule.enabled &&
      rule.allowedCountryCodes.length === 0 &&
      rule.excludedCountryCodes.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedCountryCodes"],
        message: "Add at least one allowed or excluded country",
      });
    }
    const excluded = new Set(rule.excludedCountryCodes);
    for (const [index, country] of rule.allowedCountryCodes.entries()) {
      if (excluded.has(country)) {
        context.addIssue({
          code: "custom",
          path: ["allowedCountryCodes", index],
          message: "A country cannot be both allowed and excluded",
        });
      }
    }
  });

export const jobFilterConfigurationSchema = z
  .object({
    schemaVersion: z.literal(JOB_FILTER_CONFIGURATION_SCHEMA_VERSION),
    rules: z
      .object({
        MINIMUM_SALARY: minimumSalaryRuleSchema,
        ALLOWED_EMPLOYMENT_TYPES: allowedEmploymentTypesRuleSchema,
        ALLOWED_WORKPLACE_ARRANGEMENTS: allowedWorkplaceArrangementsRuleSchema,
        COUNTRY_ALLOW_DENY: countryAllowDenyRuleSchema,
      })
      .strict(),
  })
  .strict();

export const jobFilterProfileMutationSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive().optional(),
    configuration: jobFilterConfigurationSchema,
  })
  .strict();

export const jobFilterScanInputSchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();

export const jobFilterScanCursorSchema = z
  .object({
    lastJobId: z.string().min(1).max(100),
    profileVersion: z.number().int().positive(),
  })
  .strict();

export const jobFilterRuleIdSchema = z.enum([
  "MINIMUM_SALARY",
  "ALLOWED_EMPLOYMENT_TYPES",
  "ALLOWED_WORKPLACE_ARRANGEMENTS",
  "COUNTRY_ALLOW_DENY",
]);

const explanationBase = {
  ruleVersion: z.literal(JOB_FILTER_RULE_VERSION),
  enabled: z.literal(true),
  outcome: jobFilterOutcomeSchema,
  reason: z.string().min(1).max(500),
  missingFields: z.array(z.string().min(1).max(80)).max(8),
  conflictFields: z.array(z.string().min(1).max(80)).max(8),
};

const disabledRuleResultSchema = z
  .object({
    ruleId: jobFilterRuleIdSchema,
    ruleVersion: z.literal(JOB_FILTER_RULE_VERSION),
    enabled: z.literal(false),
  })
  .strict();

const minimumSalaryResultSchema = z
  .object({
    ruleId: z.literal("MINIMUM_SALARY"),
    ...explanationBase,
    reasonCode: z.enum([
      "SALARY_MEETS_MINIMUM",
      "SALARY_MAX_BELOW_MINIMUM",
      "SALARY_RANGE_CROSSES_MINIMUM",
      "SALARY_PARTIAL_RANGE",
      "SALARY_MISSING_REVIEW",
      "SALARY_MISSING_FAIL",
      "SALARY_UNIT_MISMATCH",
      "SALARY_INVALID_SHAPE",
    ]),
    jobValue: z
      .object({
        salaryMin: z.string().nullable(),
        salaryMax: z.string().nullable(),
        salaryCurrency: z.string().nullable(),
        salaryPeriod: z.string().nullable(),
      })
      .strict(),
    configuredValue: z
      .object({ minimum: z.string(), currency: z.string(), salaryPeriod: z.string() })
      .strict(),
  })
  .strict();

const employmentResultSchema = z
  .object({
    ruleId: z.literal("ALLOWED_EMPLOYMENT_TYPES"),
    ...explanationBase,
    reasonCode: z.enum([
      "EMPLOYMENT_TYPE_ALLOWED",
      "EMPLOYMENT_TYPE_DISALLOWED",
      "EMPLOYMENT_TYPE_MISSING_REVIEW",
      "EMPLOYMENT_TYPE_MISSING_FAIL",
    ]),
    jobValue: z.object({ employmentType: jobEmploymentTypeSchema.nullable() }).strict(),
    configuredValue: z
      .object({ allowedEmploymentTypes: z.array(jobEmploymentTypeSchema).min(1).max(8) })
      .strict(),
  })
  .strict();

const workplaceResultSchema = z
  .object({
    ruleId: z.literal("ALLOWED_WORKPLACE_ARRANGEMENTS"),
    ...explanationBase,
    reasonCode: z.enum([
      "WORKPLACE_ARRANGEMENT_ALLOWED",
      "WORKPLACE_ARRANGEMENT_DISALLOWED",
      "WORKPLACE_ARRANGEMENT_MISSING_REVIEW",
      "WORKPLACE_ARRANGEMENT_MISSING_FAIL",
    ]),
    jobValue: z.object({ workplaceArrangement: jobWorkplaceArrangementSchema.nullable() }).strict(),
    configuredValue: z
      .object({
        allowedWorkplaceArrangements: z.array(jobWorkplaceArrangementSchema).min(1).max(5),
      })
      .strict(),
  })
  .strict();

const countryResultSchema = z
  .object({
    ruleId: z.literal("COUNTRY_ALLOW_DENY"),
    ...explanationBase,
    reasonCode: z.enum([
      "COUNTRY_ALLOWED",
      "COUNTRY_EXCLUDED",
      "COUNTRY_NOT_ALLOWED",
      "COUNTRY_MISSING_REVIEW",
      "COUNTRY_MISSING_FAIL",
    ]),
    jobValue: z.object({ countryCode: countrySchema.nullable() }).strict(),
    configuredValue: z
      .object({
        allowedCountryCodes: z.array(countrySchema).max(249),
        excludedCountryCodes: z.array(countrySchema).max(249),
      })
      .strict(),
  })
  .strict();

export const jobFilterRuleResultSchema = z.union([
  disabledRuleResultSchema,
  minimumSalaryResultSchema,
  employmentResultSchema,
  workplaceResultSchema,
  countryResultSchema,
]);

export const jobFilterExplanationSchema = z
  .object({
    schemaVersion: z.literal(JOB_FILTER_EXPLANATION_SCHEMA_VERSION),
    ruleSetVersion: z.literal(JOB_FILTER_RULE_SET_VERSION),
    profileVersion: z.number().int().positive(),
    jobVersion: z.number().int().positive(),
    overallOutcome: jobFilterOutcomeSchema,
    summaryReasonCode: z.enum(["NO_HARD_FILTERS_ENABLED", "RULE_RESULTS_COMBINED"]),
    summaryReason: z.string().min(1).max(500),
    ruleResults: z.array(jobFilterRuleResultSchema).length(4),
  })
  .strict()
  .superRefine((explanation, context) => {
    const expected = [
      "MINIMUM_SALARY",
      "ALLOWED_EMPLOYMENT_TYPES",
      "ALLOWED_WORKPLACE_ARRANGEMENTS",
      "COUNTRY_ALLOW_DENY",
    ];
    for (const [index, ruleId] of expected.entries()) {
      if (explanation.ruleResults[index]?.ruleId !== ruleId) {
        context.addIssue({
          code: "custom",
          path: ["ruleResults", index, "ruleId"],
          message: "Rule results must use the fixed rule order",
        });
      }
    }
  });

export type JobFilterOutcome = z.infer<typeof jobFilterOutcomeSchema>;
export type JobFilterConfiguration = z.infer<typeof jobFilterConfigurationSchema>;
export type JobFilterExplanation = z.infer<typeof jobFilterExplanationSchema>;
export type JobFilterRuleResult = z.infer<typeof jobFilterRuleResultSchema>;

export function defaultJobFilterConfiguration(): JobFilterConfiguration {
  return {
    schemaVersion: JOB_FILTER_CONFIGURATION_SCHEMA_VERSION,
    rules: {
      MINIMUM_SALARY: {
        ruleId: "MINIMUM_SALARY",
        ruleVersion: JOB_FILTER_RULE_VERSION,
        enabled: false,
        missingDataPolicy: "NEEDS_REVIEW",
        minimum: null,
        currency: null,
        salaryPeriod: null,
      },
      ALLOWED_EMPLOYMENT_TYPES: {
        ruleId: "ALLOWED_EMPLOYMENT_TYPES",
        ruleVersion: JOB_FILTER_RULE_VERSION,
        enabled: false,
        missingDataPolicy: "NEEDS_REVIEW",
        allowedEmploymentTypes: [],
      },
      ALLOWED_WORKPLACE_ARRANGEMENTS: {
        ruleId: "ALLOWED_WORKPLACE_ARRANGEMENTS",
        ruleVersion: JOB_FILTER_RULE_VERSION,
        enabled: false,
        missingDataPolicy: "NEEDS_REVIEW",
        allowedWorkplaceArrangements: [],
      },
      COUNTRY_ALLOW_DENY: {
        ruleId: "COUNTRY_ALLOW_DENY",
        ruleVersion: JOB_FILTER_RULE_VERSION,
        enabled: false,
        missingDataPolicy: "NEEDS_REVIEW",
        allowedCountryCodes: [],
        excludedCountryCodes: [],
      },
    },
  };
}
