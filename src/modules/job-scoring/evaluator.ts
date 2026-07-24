import { canonicalDecimal, hashStableValue } from "@/modules/job-hard-filters/public";

import {
  JOB_SCORING_COMPONENT_VERSION,
  JOB_SCORING_EXPLANATION_SCHEMA_VERSION,
  JOB_SCORING_RULE_SET_VERSION,
  jobEmploymentTypeSchema,
  jobSalaryPeriodSchema,
  jobScoringConfigurationSchema,
  jobScoringExplanationSchema,
  jobWorkplaceArrangementSchema,
  type JobScoringComponentResult,
  type JobScoringConfiguration,
} from "./schemas";

type JobScoringInput = Readonly<{
  version: number;
  salaryMin: unknown;
  salaryMax: unknown;
  salaryCurrency: unknown;
  salaryPeriod: unknown;
  employmentType: unknown;
  workplaceArrangement: unknown;
  countryCode: unknown;
}>;

function uniqueSorted<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalTiers<T extends string>(tiers: {
  mostPreferred: T[];
  acceptable: T[];
  lessPreferred: T[];
}) {
  return {
    mostPreferred: uniqueSorted(tiers.mostPreferred),
    acceptable: uniqueSorted(tiers.acceptable),
    lessPreferred: uniqueSorted(tiers.lessPreferred),
  };
}

export function canonicalizeJobScoringConfiguration(
  untrustedInput: unknown,
): JobScoringConfiguration {
  const parsed = jobScoringConfigurationSchema.parse(untrustedInput);
  const salary = parsed.components.SALARY;
  return jobScoringConfigurationSchema.parse({
    ...parsed,
    components: {
      SALARY: {
        ...salary,
        preferredMinimum:
          salary.preferredMinimum === null ? null : canonicalDecimal(salary.preferredMinimum),
        target: salary.target === null ? null : canonicalDecimal(salary.target),
      },
      EMPLOYMENT_TYPE: {
        ...parsed.components.EMPLOYMENT_TYPE,
        tiers: canonicalTiers(parsed.components.EMPLOYMENT_TYPE.tiers),
      },
      WORKPLACE_ARRANGEMENT: {
        ...parsed.components.WORKPLACE_ARRANGEMENT,
        tiers: canonicalTiers(parsed.components.WORKPLACE_ARRANGEMENT.tiers),
      },
      COUNTRY: {
        ...parsed.components.COUNTRY,
        tiers: canonicalTiers(parsed.components.COUNTRY.tiers),
      },
    },
  });
}

export function hashJobScoringConfiguration(configuration: JobScoringConfiguration) {
  return hashStableValue(canonicalizeJobScoringConfiguration(configuration));
}

function scalar(value: unknown) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function decimalHundredths(value: string) {
  const [whole, fraction = ""] = canonicalDecimal(value).split(".");
  return BigInt(whole!) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

function parsedDecimal(value: unknown) {
  const text = scalar(value);
  if (text === null || !/^\d{1,12}(?:\.\d{1,2})?$/u.test(text)) return null;
  return { text: canonicalDecimal(text), amount: decimalHundredths(text) };
}

function disabled(
  componentId: JobScoringComponentResult["componentId"],
): JobScoringComponentResult {
  return {
    componentId,
    componentVersion: JOB_SCORING_COMPONENT_VERSION,
    enabled: false,
    weight: 0,
  };
}

function evaluateSalary(
  configuration: JobScoringConfiguration,
  job: JobScoringInput,
): JobScoringComponentResult {
  const component = configuration.components.SALARY;
  if (!component.enabled) return disabled(component.componentId);
  const rawMin = scalar(job.salaryMin);
  const rawMax = scalar(job.salaryMax);
  const minimum = parsedDecimal(job.salaryMin);
  const maximum = parsedDecimal(job.salaryMax);
  const currency = scalar(job.salaryCurrency);
  const salaryPeriod = scalar(job.salaryPeriod);
  const configuredValue = {
    preferredMinimum: canonicalDecimal(component.preferredMinimum!),
    target: canonicalDecimal(component.target!),
    currency: component.currency!,
    salaryPeriod: component.salaryPeriod!,
  };
  const baseJobValue = {
    salaryMin: rawMin,
    salaryMax: rawMax,
    salaryCurrency: currency,
    salaryPeriod,
    comparisonAmount: null,
  };
  if (rawMin === null && rawMax === null) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "MISSING",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "SALARY_DATA_MISSING",
      reason: "Salary data is missing, so salary is excluded from the score denominator.",
      jobValue: baseJobValue,
      configuredValue,
      missingFields: ["salaryMin", "salaryMax"],
    };
  }
  const validPeriod = jobSalaryPeriodSchema.safeParse(salaryPeriod).success;
  const invalidShape =
    (!minimum && rawMin !== null) ||
    (!maximum && rawMax !== null) ||
    (!minimum && !maximum) ||
    currency === null ||
    !/^[A-Z]{3}$/u.test(currency ?? "") ||
    salaryPeriod === null ||
    !validPeriod ||
    (minimum !== null && maximum !== null && maximum.amount < minimum.amount);
  if (invalidShape) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "INCOMPARABLE",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "SALARY_INVALID_SHAPE",
      reason:
        "The authoritative salary fields have an unexpected shape, so salary is excluded from scoring.",
      jobValue: baseJobValue,
      configuredValue,
      missingFields: [
        ...(currency === null ? ["salaryCurrency"] : []),
        ...(salaryPeriod === null ? ["salaryPeriod"] : []),
      ],
    };
  }
  if (currency !== component.currency || salaryPeriod !== component.salaryPeriod) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "INCOMPARABLE",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "SALARY_UNIT_MISMATCH",
      reason:
        "Salary currency or period differs from the preference, so salary is excluded without conversion.",
      jobValue: {
        ...baseJobValue,
        salaryMin: minimum?.text ?? null,
        salaryMax: maximum?.text ?? null,
      },
      configuredValue,
      missingFields: [],
    };
  }

  // Prefer the known range floor. If only a maximum is known, use that explicit amount.
  const comparison = minimum ?? maximum!;
  const preferredMinimum = decimalHundredths(component.preferredMinimum!);
  const target = decimalHundredths(component.target!);
  const rawScore =
    comparison.amount >= target ? 100 : comparison.amount >= preferredMinimum ? 60 : 0;
  const reasonCode =
    rawScore === 100
      ? "SALARY_AT_OR_ABOVE_TARGET"
      : rawScore === 60
        ? "SALARY_BETWEEN_MINIMUM_AND_TARGET"
        : "SALARY_BELOW_PREFERRED_MINIMUM";
  const reason =
    rawScore === 100
      ? "The conservative known salary amount is at or above the configured target."
      : rawScore === 60
        ? "The conservative known salary amount is between the preferred minimum and target."
        : "The conservative known salary amount is below the preferred minimum.";
  return {
    componentId: component.componentId,
    componentVersion: component.componentVersion,
    enabled: true,
    weight: component.weight,
    availability: "AVAILABLE",
    rawScore,
    weightedContribution: rawScore * component.weight,
    reasonCode,
    reason,
    jobValue: {
      ...baseJobValue,
      salaryMin: minimum?.text ?? null,
      salaryMax: maximum?.text ?? null,
      comparisonAmount: comparison.text,
    },
    configuredValue,
    missingFields: [],
  };
}

type TierName = "mostPreferred" | "acceptable" | "lessPreferred";

function tierRawScore(
  value: string,
  tiers: Readonly<Record<TierName, readonly string[]>>,
): Readonly<{ tier: TierName | "notPreferred"; rawScore: number }> {
  if (tiers.mostPreferred.includes(value)) return { tier: "mostPreferred", rawScore: 100 };
  if (tiers.acceptable.includes(value)) return { tier: "acceptable", rawScore: 70 };
  if (tiers.lessPreferred.includes(value)) return { tier: "lessPreferred", rawScore: 40 };
  return { tier: "notPreferred", rawScore: 0 };
}

function evaluateEmployment(
  configuration: JobScoringConfiguration,
  job: JobScoringInput,
): JobScoringComponentResult {
  const component = configuration.components.EMPLOYMENT_TYPE;
  if (!component.enabled) return disabled(component.componentId);
  const parsed = jobEmploymentTypeSchema.safeParse(job.employmentType);
  const employmentType = parsed.success ? parsed.data : null;
  if (employmentType === null) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "MISSING",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "EMPLOYMENT_TYPE_MISSING",
      reason: "Employment type is missing, so this component is excluded from scoring.",
      jobValue: { employmentType: null },
      configuredValue: component.tiers,
      missingFields: ["employmentType"],
    };
  }
  const result = tierRawScore(employmentType, component.tiers);
  const reasonCodes = {
    mostPreferred: "EMPLOYMENT_TYPE_MOST_PREFERRED",
    acceptable: "EMPLOYMENT_TYPE_ACCEPTABLE",
    lessPreferred: "EMPLOYMENT_TYPE_LESS_PREFERRED",
    notPreferred: "EMPLOYMENT_TYPE_NOT_PREFERRED",
  } as const;
  const reasons = {
    mostPreferred: "The employment type is in the most-preferred tier.",
    acceptable: "The employment type is in the acceptable tier.",
    lessPreferred: "The employment type is in the less-preferred tier.",
    notPreferred: "The employment type is not in a configured preference tier.",
  } as const;
  return {
    componentId: component.componentId,
    componentVersion: component.componentVersion,
    enabled: true,
    weight: component.weight,
    availability: "AVAILABLE",
    rawScore: result.rawScore,
    weightedContribution: result.rawScore * component.weight,
    reasonCode: reasonCodes[result.tier],
    reason: reasons[result.tier],
    jobValue: { employmentType },
    configuredValue: component.tiers,
    missingFields: [],
  };
}

function evaluateWorkplace(
  configuration: JobScoringConfiguration,
  job: JobScoringInput,
): JobScoringComponentResult {
  const component = configuration.components.WORKPLACE_ARRANGEMENT;
  if (!component.enabled) return disabled(component.componentId);
  const parsed = jobWorkplaceArrangementSchema.safeParse(job.workplaceArrangement);
  const workplaceArrangement = parsed.success ? parsed.data : null;
  if (workplaceArrangement === null) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "MISSING",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "WORKPLACE_ARRANGEMENT_MISSING",
      reason: "Workplace arrangement is missing, so this component is excluded from scoring.",
      jobValue: { workplaceArrangement: null },
      configuredValue: component.tiers,
      missingFields: ["workplaceArrangement"],
    };
  }
  const result = tierRawScore(workplaceArrangement, component.tiers);
  const reasonCodes = {
    mostPreferred: "WORKPLACE_ARRANGEMENT_MOST_PREFERRED",
    acceptable: "WORKPLACE_ARRANGEMENT_ACCEPTABLE",
    lessPreferred: "WORKPLACE_ARRANGEMENT_LESS_PREFERRED",
    notPreferred: "WORKPLACE_ARRANGEMENT_NOT_PREFERRED",
  } as const;
  const reasons = {
    mostPreferred: "The workplace arrangement is in the most-preferred tier.",
    acceptable: "The workplace arrangement is in the acceptable tier.",
    lessPreferred: "The workplace arrangement is in the less-preferred tier.",
    notPreferred: "The workplace arrangement is not in a configured preference tier.",
  } as const;
  return {
    componentId: component.componentId,
    componentVersion: component.componentVersion,
    enabled: true,
    weight: component.weight,
    availability: "AVAILABLE",
    rawScore: result.rawScore,
    weightedContribution: result.rawScore * component.weight,
    reasonCode: reasonCodes[result.tier],
    reason: reasons[result.tier],
    jobValue: { workplaceArrangement },
    configuredValue: component.tiers,
    missingFields: [],
  };
}

function evaluateCountry(
  configuration: JobScoringConfiguration,
  job: JobScoringInput,
): JobScoringComponentResult {
  const component = configuration.components.COUNTRY;
  if (!component.enabled) return disabled(component.componentId);
  const countryCode =
    typeof job.countryCode === "string" && /^[A-Z]{2}$/u.test(job.countryCode)
      ? job.countryCode
      : null;
  if (countryCode === null) {
    return {
      componentId: component.componentId,
      componentVersion: component.componentVersion,
      enabled: true,
      weight: component.weight,
      availability: "MISSING",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "COUNTRY_MISSING",
      reason: "Country is missing, so this component is excluded from scoring.",
      jobValue: { countryCode: null },
      configuredValue: component.tiers,
      missingFields: ["countryCode"],
    };
  }
  const result = tierRawScore(countryCode, component.tiers);
  const reasonCodes = {
    mostPreferred: "COUNTRY_MOST_PREFERRED",
    acceptable: "COUNTRY_ACCEPTABLE",
    lessPreferred: "COUNTRY_LESS_PREFERRED",
    notPreferred: "COUNTRY_NOT_PREFERRED",
  } as const;
  const reasons = {
    mostPreferred: "The Job country is in the most-preferred tier.",
    acceptable: "The Job country is in the acceptable tier.",
    lessPreferred: "The Job country is in the less-preferred tier.",
    notPreferred: "The Job country is not in a configured preference tier.",
  } as const;
  return {
    componentId: component.componentId,
    componentVersion: component.componentVersion,
    enabled: true,
    weight: component.weight,
    availability: "AVAILABLE",
    rawScore: result.rawScore,
    weightedContribution: result.rawScore * component.weight,
    reasonCode: reasonCodes[result.tier],
    reason: reasons[result.tier],
    jobValue: { countryCode },
    configuredValue: component.tiers,
    missingFields: [],
  };
}

export function evaluatePreliminaryJobScore(
  untrustedConfiguration: unknown,
  profileVersion: number,
  job: JobScoringInput,
) {
  const configuration = canonicalizeJobScoringConfiguration(untrustedConfiguration);
  const componentResults = [
    evaluateSalary(configuration, job),
    evaluateEmployment(configuration, job),
    evaluateWorkplace(configuration, job),
    evaluateCountry(configuration, job),
  ];
  const coveredWeight = componentResults.reduce(
    (sum, component) =>
      component.enabled && component.availability === "AVAILABLE" ? sum + component.weight : sum,
    0,
  );
  const weightedTotal = componentResults.reduce(
    (sum, component) =>
      component.enabled && component.availability === "AVAILABLE"
        ? sum + component.weightedContribution
        : sum,
    0,
  );
  const finalScore =
    coveredWeight === 0
      ? 0
      : Math.floor((weightedTotal + Math.floor(coveredWeight / 2)) / coveredWeight);
  const explanation = jobScoringExplanationSchema.parse({
    schemaVersion: JOB_SCORING_EXPLANATION_SCHEMA_VERSION,
    ruleSetVersion: JOB_SCORING_RULE_SET_VERSION,
    profileVersion,
    jobVersion: job.version,
    finalScore,
    coverage: coveredWeight,
    coveredWeight,
    totalEnabledWeight: 100,
    summaryReasonCode: coveredWeight === 0 ? "NO_COVERED_COMPONENTS" : "SCORE_CALCULATED",
    summaryReason:
      coveredWeight === 0
        ? "No enabled component has comparable Job data; the stored score is 0 with 0% coverage."
        : "The score is the rounded weighted average of available preference components.",
    componentResults,
  });
  return {
    configuration,
    configurationHash: hashJobScoringConfiguration(configuration),
    score: finalScore,
    coverage: coveredWeight,
    explanation,
    explanationHash: hashStableValue(explanation),
  } as const;
}
