import { createHash } from "node:crypto";

import {
  JOB_FILTER_EXPLANATION_SCHEMA_VERSION,
  JOB_FILTER_RULE_SET_VERSION,
  jobEmploymentTypeSchema,
  jobFilterConfigurationSchema,
  jobFilterExplanationSchema,
  jobSalaryPeriodSchema,
  jobWorkplaceArrangementSchema,
  type JobFilterConfiguration,
  type JobFilterOutcome,
  type JobFilterRuleResult,
} from "./schemas";

type JobFilterInput = Readonly<{
  version: number;
  salaryMin: unknown;
  salaryMax: unknown;
  salaryCurrency: unknown;
  salaryPeriod: unknown;
  employmentType: unknown;
  workplaceArrangement: unknown;
  countryCode: unknown;
}>;

type PrimaryCollapsedJob = Readonly<{
  id: string;
  status: "ACTIVE" | "ARCHIVED";
  duplicateGroupMembership?: Readonly<{
    group: Readonly<{ primaryJobId: string }>;
  }> | null;
}>;

export function isInPrimaryCollapsedConsideration(job: PrimaryCollapsedJob) {
  return (
    job.status === "ACTIVE" &&
    (!job.duplicateGroupMembership || job.duplicateGroupMembership.group.primaryJobId === job.id)
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableSerialize(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function hashStableValue(value: unknown) {
  return createHash("sha256").update(stableSerialize(value), "utf8").digest("hex");
}

function uniqueSorted<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalDecimal(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = BigInt(whole!).toString();
  const normalizedFraction = fraction.replace(/0+$/u, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function decimalHundredths(value: string) {
  const [whole, fraction = ""] = canonicalDecimal(value).split(".");
  return BigInt(whole!) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

export function canonicalizeJobFilterConfiguration(
  untrustedInput: unknown,
): JobFilterConfiguration {
  const parsed = jobFilterConfigurationSchema.parse(untrustedInput);
  const minimumSalary = parsed.rules.MINIMUM_SALARY;
  return jobFilterConfigurationSchema.parse({
    ...parsed,
    rules: {
      MINIMUM_SALARY: {
        ...minimumSalary,
        minimum: minimumSalary.minimum === null ? null : canonicalDecimal(minimumSalary.minimum),
      },
      ALLOWED_EMPLOYMENT_TYPES: {
        ...parsed.rules.ALLOWED_EMPLOYMENT_TYPES,
        allowedEmploymentTypes: uniqueSorted(
          parsed.rules.ALLOWED_EMPLOYMENT_TYPES.allowedEmploymentTypes,
        ),
      },
      ALLOWED_WORKPLACE_ARRANGEMENTS: {
        ...parsed.rules.ALLOWED_WORKPLACE_ARRANGEMENTS,
        allowedWorkplaceArrangements: uniqueSorted(
          parsed.rules.ALLOWED_WORKPLACE_ARRANGEMENTS.allowedWorkplaceArrangements,
        ),
      },
      COUNTRY_ALLOW_DENY: {
        ...parsed.rules.COUNTRY_ALLOW_DENY,
        allowedCountryCodes: uniqueSorted(parsed.rules.COUNTRY_ALLOW_DENY.allowedCountryCodes),
        excludedCountryCodes: uniqueSorted(parsed.rules.COUNTRY_ALLOW_DENY.excludedCountryCodes),
      },
    },
  });
}

export function hashJobFilterConfiguration(configuration: JobFilterConfiguration) {
  return hashStableValue(canonicalizeJobFilterConfiguration(configuration));
}

function disabled(ruleId: JobFilterRuleResult["ruleId"]): JobFilterRuleResult {
  return { ruleId, ruleVersion: 1, enabled: false };
}

function missingOutcome(policy: "NEEDS_REVIEW" | "FAIL"): JobFilterOutcome {
  return policy === "FAIL" ? "FAIL" : "NEEDS_REVIEW";
}

function scalar(value: unknown) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function parsedDecimal(value: unknown) {
  const text = scalar(value);
  if (text === null || !/^\d{1,12}(?:\.\d{1,2})?$/u.test(text)) return null;
  return { text: canonicalDecimal(text), amount: decimalHundredths(text) };
}

function evaluateMinimumSalary(
  configuration: JobFilterConfiguration,
  job: JobFilterInput,
): JobFilterRuleResult {
  const rule = configuration.rules.MINIMUM_SALARY;
  if (!rule.enabled) return disabled(rule.ruleId);
  const configuredValue = {
    minimum: canonicalDecimal(rule.minimum!),
    currency: rule.currency!,
    salaryPeriod: rule.salaryPeriod!,
  };
  const rawMin = scalar(job.salaryMin);
  const rawMax = scalar(job.salaryMax);
  const currency = scalar(job.salaryCurrency);
  const salaryPeriod = scalar(job.salaryPeriod);
  const jobValue = {
    salaryMin: rawMin,
    salaryMax: rawMax,
    salaryCurrency: currency,
    salaryPeriod,
  };
  const nonePresent = rawMin === null && rawMax === null;
  if (nonePresent) {
    const outcome = missingOutcome(rule.missingDataPolicy);
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome,
      reasonCode: outcome === "FAIL" ? "SALARY_MISSING_FAIL" : "SALARY_MISSING_REVIEW",
      reason:
        outcome === "FAIL"
          ? "Salary information is missing and disclosure is required."
          : "Salary information is missing and requires review.",
      jobValue,
      configuredValue,
      missingFields: [
        "salaryMin",
        "salaryMax",
        ...(currency === null ? ["salaryCurrency"] : []),
        ...(salaryPeriod === null ? ["salaryPeriod"] : []),
      ],
      conflictFields: [],
    };
  }

  const minimum = parsedDecimal(job.salaryMin);
  const maximum = parsedDecimal(job.salaryMax);
  const validCurrency = currency === null || /^[A-Z]{3}$/u.test(currency);
  const validPeriod = jobSalaryPeriodSchema.safeParse(salaryPeriod).success;
  const invalidShape =
    (!minimum && rawMin !== null) ||
    (!maximum && rawMax !== null) ||
    (!minimum && !maximum) ||
    currency === null ||
    !validCurrency ||
    salaryPeriod === null ||
    !validPeriod ||
    (minimum !== null && maximum !== null && maximum.amount < minimum.amount);
  if (invalidShape) {
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome: "NEEDS_REVIEW",
      reasonCode: "SALARY_INVALID_SHAPE",
      reason: "The authoritative salary fields have an unexpected shape and require review.",
      jobValue,
      configuredValue,
      missingFields: [
        ...(currency === null ? ["salaryCurrency"] : []),
        ...(salaryPeriod === null ? ["salaryPeriod"] : []),
      ],
      conflictFields: [
        ...(!validCurrency && currency !== null ? ["salaryCurrency"] : []),
        ...(!validPeriod && salaryPeriod !== null ? ["salaryPeriod"] : []),
        ...(minimum && maximum && maximum.amount < minimum.amount
          ? ["salaryMin", "salaryMax"]
          : []),
      ].sort(),
    };
  }

  const conflictFields = [
    ...(currency !== rule.currency ? ["salaryCurrency"] : []),
    ...(salaryPeriod !== rule.salaryPeriod ? ["salaryPeriod"] : []),
  ];
  if (conflictFields.length > 0) {
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome: "NEEDS_REVIEW",
      reasonCode: "SALARY_UNIT_MISMATCH",
      reason: "The salary units differ from the configured comparison units.",
      jobValue,
      configuredValue,
      missingFields: [],
      conflictFields,
    };
  }

  const threshold = decimalHundredths(rule.minimum!);
  if (minimum && minimum.amount >= threshold) {
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome: "PASS",
      reasonCode: "SALARY_MEETS_MINIMUM",
      reason: "The known salary minimum meets the configured minimum.",
      jobValue: { ...jobValue, salaryMin: minimum.text, salaryMax: maximum?.text ?? null },
      configuredValue,
      missingFields: [],
      conflictFields: [],
    };
  }
  if (maximum && maximum.amount < threshold) {
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome: "FAIL",
      reasonCode: "SALARY_MAX_BELOW_MINIMUM",
      reason: "The known salary maximum is below the configured minimum.",
      jobValue: { ...jobValue, salaryMin: minimum?.text ?? null, salaryMax: maximum.text },
      configuredValue,
      missingFields: [],
      conflictFields: [],
    };
  }
  const crossing = minimum !== null && maximum !== null;
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    enabled: true,
    outcome: "NEEDS_REVIEW",
    reasonCode: crossing ? "SALARY_RANGE_CROSSES_MINIMUM" : "SALARY_PARTIAL_RANGE",
    reason: crossing
      ? "The salary range crosses the configured minimum and requires review."
      : "The partial salary range cannot establish whether the configured minimum is met.",
    jobValue: {
      ...jobValue,
      salaryMin: minimum?.text ?? null,
      salaryMax: maximum?.text ?? null,
    },
    configuredValue,
    missingFields: [
      ...(minimum === null ? ["salaryMin"] : []),
      ...(maximum === null ? ["salaryMax"] : []),
    ],
    conflictFields: [],
  };
}

function evaluateEmployment(
  configuration: JobFilterConfiguration,
  job: JobFilterInput,
): JobFilterRuleResult {
  const rule = configuration.rules.ALLOWED_EMPLOYMENT_TYPES;
  if (!rule.enabled) return disabled(rule.ruleId);
  const parsed = jobEmploymentTypeSchema.safeParse(job.employmentType);
  const employmentType = parsed.success ? parsed.data : null;
  const configuredValue = { allowedEmploymentTypes: rule.allowedEmploymentTypes };
  if (employmentType === null) {
    const outcome = missingOutcome(rule.missingDataPolicy);
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome,
      reasonCode:
        outcome === "FAIL" ? "EMPLOYMENT_TYPE_MISSING_FAIL" : "EMPLOYMENT_TYPE_MISSING_REVIEW",
      reason:
        outcome === "FAIL"
          ? "Employment type is missing and disclosure is required."
          : "Employment type is missing and requires review.",
      jobValue: { employmentType: null },
      configuredValue,
      missingFields: ["employmentType"],
      conflictFields: [],
    };
  }
  const allowed = rule.allowedEmploymentTypes.includes(employmentType);
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    enabled: true,
    outcome: allowed ? "PASS" : "FAIL",
    reasonCode: allowed ? "EMPLOYMENT_TYPE_ALLOWED" : "EMPLOYMENT_TYPE_DISALLOWED",
    reason: allowed ? "The employment type is allowed." : "The employment type is not allowed.",
    jobValue: { employmentType },
    configuredValue,
    missingFields: [],
    conflictFields: [],
  };
}

function evaluateWorkplace(
  configuration: JobFilterConfiguration,
  job: JobFilterInput,
): JobFilterRuleResult {
  const rule = configuration.rules.ALLOWED_WORKPLACE_ARRANGEMENTS;
  if (!rule.enabled) return disabled(rule.ruleId);
  const parsed = jobWorkplaceArrangementSchema.safeParse(job.workplaceArrangement);
  const workplaceArrangement = parsed.success ? parsed.data : null;
  const configuredValue = {
    allowedWorkplaceArrangements: rule.allowedWorkplaceArrangements,
  };
  if (workplaceArrangement === null) {
    const outcome = missingOutcome(rule.missingDataPolicy);
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome,
      reasonCode:
        outcome === "FAIL"
          ? "WORKPLACE_ARRANGEMENT_MISSING_FAIL"
          : "WORKPLACE_ARRANGEMENT_MISSING_REVIEW",
      reason:
        outcome === "FAIL"
          ? "Workplace arrangement is missing and disclosure is required."
          : "Workplace arrangement is missing and requires review.",
      jobValue: { workplaceArrangement: null },
      configuredValue,
      missingFields: ["workplaceArrangement"],
      conflictFields: [],
    };
  }
  const allowed = rule.allowedWorkplaceArrangements.includes(workplaceArrangement);
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    enabled: true,
    outcome: allowed ? "PASS" : "FAIL",
    reasonCode: allowed ? "WORKPLACE_ARRANGEMENT_ALLOWED" : "WORKPLACE_ARRANGEMENT_DISALLOWED",
    reason: allowed
      ? "The workplace arrangement is allowed."
      : "The workplace arrangement is not allowed.",
    jobValue: { workplaceArrangement },
    configuredValue,
    missingFields: [],
    conflictFields: [],
  };
}

function evaluateCountry(
  configuration: JobFilterConfiguration,
  job: JobFilterInput,
): JobFilterRuleResult {
  const rule = configuration.rules.COUNTRY_ALLOW_DENY;
  if (!rule.enabled) return disabled(rule.ruleId);
  const countryCode =
    typeof job.countryCode === "string" && /^[A-Z]{2}$/u.test(job.countryCode)
      ? job.countryCode
      : null;
  const configuredValue = {
    allowedCountryCodes: rule.allowedCountryCodes,
    excludedCountryCodes: rule.excludedCountryCodes,
  };
  if (countryCode === null) {
    const outcome = missingOutcome(rule.missingDataPolicy);
    return {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      enabled: true,
      outcome,
      reasonCode: outcome === "FAIL" ? "COUNTRY_MISSING_FAIL" : "COUNTRY_MISSING_REVIEW",
      reason:
        outcome === "FAIL"
          ? "Country is missing and disclosure is required."
          : "Country is missing and requires review.",
      jobValue: { countryCode: null },
      configuredValue,
      missingFields: ["countryCode"],
      conflictFields: [],
    };
  }
  const excluded = rule.excludedCountryCodes.includes(countryCode);
  const outsideAllowlist =
    rule.allowedCountryCodes.length > 0 && !rule.allowedCountryCodes.includes(countryCode);
  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    enabled: true,
    outcome: excluded || outsideAllowlist ? "FAIL" : "PASS",
    reasonCode: excluded
      ? "COUNTRY_EXCLUDED"
      : outsideAllowlist
        ? "COUNTRY_NOT_ALLOWED"
        : "COUNTRY_ALLOWED",
    reason: excluded
      ? "The Job country is explicitly excluded."
      : outsideAllowlist
        ? "The Job country is outside the configured allowlist."
        : "The Job country is allowed.",
    jobValue: { countryCode },
    configuredValue,
    missingFields: [],
    conflictFields: [],
  };
}

export function evaluateJobHardFilters(
  untrustedConfiguration: unknown,
  profileVersion: number,
  job: JobFilterInput,
) {
  const configuration = canonicalizeJobFilterConfiguration(untrustedConfiguration);
  const ruleResults = [
    evaluateMinimumSalary(configuration, job),
    evaluateEmployment(configuration, job),
    evaluateWorkplace(configuration, job),
    evaluateCountry(configuration, job),
  ];
  const enabledResults = ruleResults.filter((result) => result.enabled);
  const overallOutcome: JobFilterOutcome = enabledResults.some(
    (result) => result.enabled && result.outcome === "FAIL",
  )
    ? "FAIL"
    : enabledResults.some((result) => result.enabled && result.outcome === "NEEDS_REVIEW")
      ? "NEEDS_REVIEW"
      : "PASS";
  const noEnabledRules = enabledResults.length === 0;
  const explanation = jobFilterExplanationSchema.parse({
    schemaVersion: JOB_FILTER_EXPLANATION_SCHEMA_VERSION,
    ruleSetVersion: JOB_FILTER_RULE_SET_VERSION,
    profileVersion,
    jobVersion: job.version,
    overallOutcome,
    summaryReasonCode: noEnabledRules ? "NO_HARD_FILTERS_ENABLED" : "RULE_RESULTS_COMBINED",
    summaryReason: noEnabledRules
      ? "No hard constraints are enabled."
      : "The overall result follows FAIL, then NEEDS_REVIEW, then PASS precedence.",
    ruleResults,
  });
  return {
    configuration,
    configurationHash: hashJobFilterConfiguration(configuration),
    outcome: overallOutcome,
    explanation,
    explanationHash: hashStableValue(explanation),
  } as const;
}
