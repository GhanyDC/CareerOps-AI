import { z } from "zod";

export const JOB_SCORING_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const JOB_SCORING_EXPLANATION_SCHEMA_VERSION = 1 as const;
export const JOB_SCORING_RULE_SET_VERSION = 1 as const;
export const JOB_SCORING_COMPONENT_VERSION = 1 as const;

export const JOB_SCORING_COMPONENT_IDS = [
  "SALARY",
  "EMPLOYMENT_TYPE",
  "WORKPLACE_ARRANGEMENT",
  "COUNTRY",
] as const;

export const jobScoringComponentIdSchema = z.enum(JOB_SCORING_COMPONENT_IDS);
export const scoreAvailabilitySchema = z.enum(["AVAILABLE", "MISSING", "INCOMPARABLE"]);

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
const weightSchema = z.number().int().min(0).max(100);

const componentBase = {
  componentVersion: z.literal(JOB_SCORING_COMPONENT_VERSION),
  enabled: z.boolean(),
  weight: weightSchema,
};

function decimalHundredths(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

function addTierIssues(
  tiers: Readonly<Record<"mostPreferred" | "acceptable" | "lessPreferred", readonly string[]>>,
  context: z.RefinementCtx,
) {
  const seen = new Map<string, string>();
  for (const [tier, values] of Object.entries(tiers)) {
    for (const [index, value] of values.entries()) {
      const previous = seen.get(value);
      if (previous && previous !== tier) {
        context.addIssue({
          code: "custom",
          path: ["tiers", tier, index],
          message: `${value} is already assigned to ${previous}`,
        });
      }
      seen.set(value, tier);
    }
  }
}

function tierSchema<T extends z.ZodType>(item: T, maximum: number) {
  return z
    .object({
      mostPreferred: z.array(item).max(maximum),
      acceptable: z.array(item).max(maximum),
      lessPreferred: z.array(item).max(maximum),
    })
    .strict();
}

export const salaryScoringComponentSchema = z
  .object({
    componentId: z.literal("SALARY"),
    ...componentBase,
    preferredMinimum: decimalSchema.nullable(),
    target: decimalSchema.nullable(),
    currency: currencySchema.nullable(),
    salaryPeriod: jobSalaryPeriodSchema.nullable(),
  })
  .strict()
  .superRefine((component, context) => {
    if (!component.enabled) return;
    for (const [field, value] of [
      ["preferredMinimum", component.preferredMinimum],
      ["target", component.target],
      ["currency", component.currency],
      ["salaryPeriod", component.salaryPeriod],
    ] as const) {
      if (value === null) {
        context.addIssue({ code: "custom", path: [field], message: `${field} is required` });
      }
    }
    if (
      component.preferredMinimum !== null &&
      component.target !== null &&
      decimalHundredths(component.target) < decimalHundredths(component.preferredMinimum)
    ) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "Target salary must be at least the preferred minimum",
      });
    }
  });

export const employmentTypeScoringComponentSchema = z
  .object({
    componentId: z.literal("EMPLOYMENT_TYPE"),
    ...componentBase,
    tiers: tierSchema(jobEmploymentTypeSchema, 8),
  })
  .strict()
  .superRefine((component, context) => {
    addTierIssues(component.tiers, context);
  });

export const workplaceArrangementScoringComponentSchema = z
  .object({
    componentId: z.literal("WORKPLACE_ARRANGEMENT"),
    ...componentBase,
    tiers: tierSchema(jobWorkplaceArrangementSchema, 5),
  })
  .strict()
  .superRefine((component, context) => {
    addTierIssues(component.tiers, context);
  });

export const countryScoringComponentSchema = z
  .object({
    componentId: z.literal("COUNTRY"),
    ...componentBase,
    tiers: tierSchema(countrySchema, 249),
  })
  .strict()
  .superRefine((component, context) => {
    addTierIssues(component.tiers, context);
  });

export const jobScoringConfigurationSchema = z
  .object({
    schemaVersion: z.literal(JOB_SCORING_CONFIGURATION_SCHEMA_VERSION),
    components: z
      .object({
        SALARY: salaryScoringComponentSchema,
        EMPLOYMENT_TYPE: employmentTypeScoringComponentSchema,
        WORKPLACE_ARRANGEMENT: workplaceArrangementScoringComponentSchema,
        COUNTRY: countryScoringComponentSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const components = Object.values(configuration.components);
    for (const component of components) {
      if (component.enabled && component.weight === 0) {
        context.addIssue({
          code: "custom",
          path: ["components", component.componentId, "weight"],
          message: "Enabled component weights must be positive",
        });
      }
      if (!component.enabled && component.weight !== 0) {
        context.addIssue({
          code: "custom",
          path: ["components", component.componentId, "weight"],
          message: "Disabled component weights must be zero",
        });
      }
    }
    const total = components.reduce(
      (sum, component) => sum + (component.enabled ? component.weight : 0),
      0,
    );
    if (total !== 100) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: "Enabled component weights must total exactly 100",
      });
    }
  });

export const jobScoringProfileMutationSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive().optional(),
    configuration: jobScoringConfigurationSchema,
  })
  .strict();

export const jobScoringScanInputSchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();

export const jobScoringScanCursorSchema = z
  .object({
    lastJobId: z.string().min(1).max(100),
    profileVersion: z.number().int().positive(),
  })
  .strict();

const disabledComponentResultSchema = z
  .object({
    componentId: jobScoringComponentIdSchema,
    componentVersion: z.literal(JOB_SCORING_COMPONENT_VERSION),
    enabled: z.literal(false),
    weight: z.literal(0),
  })
  .strict();

const enabledResultBase = {
  componentVersion: z.literal(JOB_SCORING_COMPONENT_VERSION),
  enabled: z.literal(true),
  weight: z.number().int().min(1).max(100),
  availability: scoreAvailabilitySchema,
  rawScore: z.number().int().min(0).max(100).nullable(),
  weightedContribution: z.number().int().min(0).max(10_000),
  reason: z.string().min(1).max(500),
  missingFields: z.array(z.string().min(1).max(80)).max(8),
};

const salaryResultSchema = z
  .object({
    componentId: z.literal("SALARY"),
    ...enabledResultBase,
    reasonCode: z.enum([
      "SALARY_AT_OR_ABOVE_TARGET",
      "SALARY_BETWEEN_MINIMUM_AND_TARGET",
      "SALARY_BELOW_PREFERRED_MINIMUM",
      "SALARY_DATA_MISSING",
      "SALARY_UNIT_MISMATCH",
      "SALARY_INVALID_SHAPE",
    ]),
    jobValue: z
      .object({
        salaryMin: z.string().nullable(),
        salaryMax: z.string().nullable(),
        salaryCurrency: z.string().nullable(),
        salaryPeriod: z.string().nullable(),
        comparisonAmount: z.string().nullable(),
      })
      .strict(),
    configuredValue: z
      .object({
        preferredMinimum: z.string(),
        target: z.string(),
        currency: z.string(),
        salaryPeriod: z.string(),
      })
      .strict(),
  })
  .strict();

function tierConfiguredValueSchema<T extends z.ZodType>(item: T, maximum: number) {
  return z
    .object({
      mostPreferred: z.array(item).max(maximum),
      acceptable: z.array(item).max(maximum),
      lessPreferred: z.array(item).max(maximum),
    })
    .strict();
}

const employmentResultSchema = z
  .object({
    componentId: z.literal("EMPLOYMENT_TYPE"),
    ...enabledResultBase,
    reasonCode: z.enum([
      "EMPLOYMENT_TYPE_MOST_PREFERRED",
      "EMPLOYMENT_TYPE_ACCEPTABLE",
      "EMPLOYMENT_TYPE_LESS_PREFERRED",
      "EMPLOYMENT_TYPE_NOT_PREFERRED",
      "EMPLOYMENT_TYPE_MISSING",
    ]),
    jobValue: z.object({ employmentType: jobEmploymentTypeSchema.nullable() }).strict(),
    configuredValue: tierConfiguredValueSchema(jobEmploymentTypeSchema, 8),
  })
  .strict();

const workplaceResultSchema = z
  .object({
    componentId: z.literal("WORKPLACE_ARRANGEMENT"),
    ...enabledResultBase,
    reasonCode: z.enum([
      "WORKPLACE_ARRANGEMENT_MOST_PREFERRED",
      "WORKPLACE_ARRANGEMENT_ACCEPTABLE",
      "WORKPLACE_ARRANGEMENT_LESS_PREFERRED",
      "WORKPLACE_ARRANGEMENT_NOT_PREFERRED",
      "WORKPLACE_ARRANGEMENT_MISSING",
    ]),
    jobValue: z.object({ workplaceArrangement: jobWorkplaceArrangementSchema.nullable() }).strict(),
    configuredValue: tierConfiguredValueSchema(jobWorkplaceArrangementSchema, 5),
  })
  .strict();

const countryResultSchema = z
  .object({
    componentId: z.literal("COUNTRY"),
    ...enabledResultBase,
    reasonCode: z.enum([
      "COUNTRY_MOST_PREFERRED",
      "COUNTRY_ACCEPTABLE",
      "COUNTRY_LESS_PREFERRED",
      "COUNTRY_NOT_PREFERRED",
      "COUNTRY_MISSING",
    ]),
    jobValue: z.object({ countryCode: countrySchema.nullable() }).strict(),
    configuredValue: tierConfiguredValueSchema(countrySchema, 249),
  })
  .strict();

export const jobScoringComponentResultSchema = z.union([
  disabledComponentResultSchema,
  salaryResultSchema,
  employmentResultSchema,
  workplaceResultSchema,
  countryResultSchema,
]);

export const jobScoringExplanationSchema = z
  .object({
    schemaVersion: z.literal(JOB_SCORING_EXPLANATION_SCHEMA_VERSION),
    ruleSetVersion: z.literal(JOB_SCORING_RULE_SET_VERSION),
    profileVersion: z.number().int().positive(),
    jobVersion: z.number().int().positive(),
    finalScore: z.number().int().min(0).max(100),
    coverage: z.number().int().min(0).max(100),
    coveredWeight: z.number().int().min(0).max(100),
    totalEnabledWeight: z.literal(100),
    summaryReasonCode: z.enum(["SCORE_CALCULATED", "NO_COVERED_COMPONENTS"]),
    summaryReason: z.string().min(1).max(500),
    componentResults: z.array(jobScoringComponentResultSchema).length(4),
  })
  .strict()
  .superRefine((explanation, context) => {
    for (const [index, componentId] of JOB_SCORING_COMPONENT_IDS.entries()) {
      if (explanation.componentResults[index]?.componentId !== componentId) {
        context.addIssue({
          code: "custom",
          path: ["componentResults", index, "componentId"],
          message: "Component results must use the fixed component order",
        });
      }
    }
  });

export type JobScoringConfiguration = z.infer<typeof jobScoringConfigurationSchema>;
export type JobScoringExplanation = z.infer<typeof jobScoringExplanationSchema>;
export type JobScoringComponentResult = z.infer<typeof jobScoringComponentResultSchema>;

function emptyTiers<T>() {
  return { mostPreferred: [] as T[], acceptable: [] as T[], lessPreferred: [] as T[] };
}

export function defaultJobScoringConfiguration(): JobScoringConfiguration {
  return {
    schemaVersion: JOB_SCORING_CONFIGURATION_SCHEMA_VERSION,
    components: {
      SALARY: {
        componentId: "SALARY",
        componentVersion: JOB_SCORING_COMPONENT_VERSION,
        enabled: false,
        weight: 0,
        preferredMinimum: null,
        target: null,
        currency: null,
        salaryPeriod: null,
      },
      EMPLOYMENT_TYPE: {
        componentId: "EMPLOYMENT_TYPE",
        componentVersion: JOB_SCORING_COMPONENT_VERSION,
        enabled: false,
        weight: 0,
        tiers: emptyTiers<z.infer<typeof jobEmploymentTypeSchema>>(),
      },
      WORKPLACE_ARRANGEMENT: {
        componentId: "WORKPLACE_ARRANGEMENT",
        componentVersion: JOB_SCORING_COMPONENT_VERSION,
        enabled: false,
        weight: 0,
        tiers: emptyTiers<z.infer<typeof jobWorkplaceArrangementSchema>>(),
      },
      COUNTRY: {
        componentId: "COUNTRY",
        componentVersion: JOB_SCORING_COMPONENT_VERSION,
        enabled: false,
        weight: 0,
        tiers: emptyTiers<string>(),
      },
    },
  };
}
