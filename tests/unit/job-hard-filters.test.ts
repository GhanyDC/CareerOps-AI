import { describe, expect, it } from "vitest";

import {
  canonicalizeJobFilterConfiguration,
  defaultJobFilterConfiguration,
  evaluateJobHardFilters,
  hashJobFilterConfiguration,
  isInPrimaryCollapsedConsideration,
  stableSerialize,
  type JobFilterConfiguration,
} from "@/modules/job-hard-filters/public";

function configuration(update: (value: JobFilterConfiguration) => void): JobFilterConfiguration {
  const value = structuredClone(defaultJobFilterConfiguration());
  update(value);
  return value;
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    employmentType: null,
    workplaceArrangement: null,
    countryCode: null,
    description: "must never enter explanations",
    contactDetails: "private@example.test",
    ...overrides,
  };
}

function salaryConfiguration(missingDataPolicy: "NEEDS_REVIEW" | "FAIL" = "NEEDS_REVIEW") {
  return configuration((value) => {
    Object.assign(value.rules.MINIMUM_SALARY, {
      enabled: true,
      minimum: "100000.00",
      currency: "USD",
      salaryPeriod: "YEAR",
      missingDataPolicy,
    });
  });
}

describe("Job Hard Filters", () => {
  it("returns PASS with a fixed explanation when every rule is disabled", () => {
    const result = evaluateJobHardFilters(defaultJobFilterConfiguration(), 1, job());
    expect(result.outcome).toBe("PASS");
    expect(result.explanation.summaryReasonCode).toBe("NO_HARD_FILTERS_ENABLED");
    expect(result.explanation.ruleResults.every((rule) => !rule.enabled)).toBe(true);
  });

  it("passes a salary minimum equal to the threshold", () => {
    const result = evaluateJobHardFilters(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "100000",
        salaryMax: "125000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(result.outcome).toBe("PASS");
    expect(result.explanation.ruleResults[0]).toMatchObject({
      reasonCode: "SALARY_MEETS_MINIMUM",
    });
  });

  it("fails only when a comparable known maximum is below the threshold", () => {
    const result = evaluateJobHardFilters(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "80000",
        salaryMax: "99999.99",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(result.outcome).toBe("FAIL");
    expect(result.explanation.ruleResults[0]).toMatchObject({
      reasonCode: "SALARY_MAX_BELOW_MINIMUM",
    });
  });

  it.each([
    [{ salaryMin: "90000", salaryMax: "110000" }, "SALARY_RANGE_CROSSES_MINIMUM"],
    [{ salaryMin: "90000", salaryMax: null }, "SALARY_PARTIAL_RANGE"],
    [{ salaryMin: null, salaryMax: "110000" }, "SALARY_PARTIAL_RANGE"],
  ])("reviews crossing and partial salary ranges", (range, reasonCode) => {
    const result = evaluateJobHardFilters(
      salaryConfiguration(),
      1,
      job({ ...range, salaryCurrency: "USD", salaryPeriod: "YEAR" }),
    );
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.explanation.ruleResults[0]).toMatchObject({ reasonCode });
  });

  it.each([
    [{ salaryCurrency: "PHP", salaryPeriod: "YEAR" }, ["salaryCurrency"]],
    [{ salaryCurrency: "USD", salaryPeriod: "MONTH" }, ["salaryPeriod"]],
  ])("reviews salary unit mismatches without conversion", (units, conflictFields) => {
    const result = evaluateJobHardFilters(
      salaryConfiguration(),
      1,
      job({ salaryMin: "120000", salaryMax: "140000", ...units }),
    );
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.explanation.ruleResults[0]).toMatchObject({
      reasonCode: "SALARY_UNIT_MISMATCH",
      conflictFields,
    });
  });

  it("uses the configured salary missing-data outcome", () => {
    expect(evaluateJobHardFilters(salaryConfiguration(), 1, job()).outcome).toBe("NEEDS_REVIEW");
    expect(evaluateJobHardFilters(salaryConfiguration("FAIL"), 1, job()).outcome).toBe("FAIL");
    expect(
      evaluateJobHardFilters(
        salaryConfiguration("FAIL"),
        1,
        job({ salaryCurrency: "USD", salaryPeriod: "YEAR" }),
      ).explanation.ruleResults[0],
    ).toMatchObject({ outcome: "FAIL", reasonCode: "SALARY_MISSING_FAIL" });
  });

  it("reviews unexpected legacy-invalid salary shapes", () => {
    const result = evaluateJobHardFilters(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "120000",
        salaryMax: "90000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(result.outcome).toBe("NEEDS_REVIEW");
    expect(result.explanation.ruleResults[0]).toMatchObject({
      reasonCode: "SALARY_INVALID_SHAPE",
      conflictFields: ["salaryMax", "salaryMin"],
    });
  });

  it("evaluates employment allowlists and both missing policies", () => {
    const config = configuration((value) => {
      Object.assign(value.rules.ALLOWED_EMPLOYMENT_TYPES, {
        enabled: true,
        allowedEmploymentTypes: ["FULL_TIME"],
      });
    });
    expect(evaluateJobHardFilters(config, 1, job({ employmentType: "FULL_TIME" })).outcome).toBe(
      "PASS",
    );
    expect(evaluateJobHardFilters(config, 1, job({ employmentType: "CONTRACT" })).outcome).toBe(
      "FAIL",
    );
    expect(evaluateJobHardFilters(config, 1, job()).outcome).toBe("NEEDS_REVIEW");
    config.rules.ALLOWED_EMPLOYMENT_TYPES.missingDataPolicy = "FAIL";
    expect(evaluateJobHardFilters(config, 1, job()).outcome).toBe("FAIL");
  });

  it("evaluates workplace allowlists without inferring missing arrangements", () => {
    const config = configuration((value) => {
      Object.assign(value.rules.ALLOWED_WORKPLACE_ARRANGEMENTS, {
        enabled: true,
        allowedWorkplaceArrangements: ["REMOTE", "HYBRID"],
      });
    });
    expect(evaluateJobHardFilters(config, 1, job({ workplaceArrangement: "REMOTE" })).outcome).toBe(
      "PASS",
    );
    expect(
      evaluateJobHardFilters(config, 1, job({ workplaceArrangement: "ON_SITE" })).outcome,
    ).toBe("FAIL");
    expect(evaluateJobHardFilters(config, 1, job()).outcome).toBe("NEEDS_REVIEW");
    config.rules.ALLOWED_WORKPLACE_ARRANGEMENTS.missingDataPolicy = "FAIL";
    expect(evaluateJobHardFilters(config, 1, job()).outcome).toBe("FAIL");
  });

  it("gives country denylist matches precedence over the allowlist", () => {
    const config = configuration((value) => {
      Object.assign(value.rules.COUNTRY_ALLOW_DENY, {
        enabled: true,
        allowedCountryCodes: ["PH", "SG"],
        excludedCountryCodes: ["US"],
      });
    });
    expect(evaluateJobHardFilters(config, 1, job({ countryCode: "PH" })).outcome).toBe("PASS");
    expect(evaluateJobHardFilters(config, 1, job({ countryCode: "US" })).outcome).toBe("FAIL");
    expect(evaluateJobHardFilters(config, 1, job({ countryCode: "JP" })).outcome).toBe("FAIL");
    expect(evaluateJobHardFilters(config, 1, job()).outcome).toBe("NEEDS_REVIEW");
  });

  it("rejects overlapping country allow and deny lists", () => {
    const config = configuration((value) => {
      Object.assign(value.rules.COUNTRY_ALLOW_DENY, {
        enabled: true,
        allowedCountryCodes: ["PH"],
        excludedCountryCodes: ["PH"],
      });
    });
    expect(() => canonicalizeJobFilterConfiguration(config)).toThrow(/both allowed and excluded/);
  });

  it("uses FAIL before NEEDS_REVIEW before PASS", () => {
    const config = salaryConfiguration();
    Object.assign(config.rules.ALLOWED_EMPLOYMENT_TYPES, {
      enabled: true,
      allowedEmploymentTypes: ["FULL_TIME"],
    });
    const result = evaluateJobHardFilters(config, 1, job({ employmentType: "CONTRACT" }));
    expect(result.explanation.ruleResults[0]).toMatchObject({ outcome: "NEEDS_REVIEW" });
    expect(result.explanation.ruleResults[1]).toMatchObject({ outcome: "FAIL" });
    expect(result.outcome).toBe("FAIL");
  });

  it("sorts configuration lists and produces stable serialization and hashes", () => {
    const left = configuration((value) => {
      Object.assign(value.rules.ALLOWED_EMPLOYMENT_TYPES, {
        enabled: true,
        allowedEmploymentTypes: ["FULL_TIME", "CONTRACT"],
      });
      Object.assign(value.rules.COUNTRY_ALLOW_DENY, {
        enabled: true,
        allowedCountryCodes: ["SG", "PH", "SG"],
      });
    });
    const right = structuredClone(left);
    right.rules.ALLOWED_EMPLOYMENT_TYPES.allowedEmploymentTypes.reverse();
    right.rules.COUNTRY_ALLOW_DENY.allowedCountryCodes.reverse();
    const canonical = canonicalizeJobFilterConfiguration(left);
    expect(canonical.rules.ALLOWED_EMPLOYMENT_TYPES.allowedEmploymentTypes).toEqual([
      "CONTRACT",
      "FULL_TIME",
    ]);
    expect(canonical.rules.COUNTRY_ALLOW_DENY.allowedCountryCodes).toEqual(["PH", "SG"]);
    expect(hashJobFilterConfiguration(left)).toBe(hashJobFilterConfiguration(right));
    expect(stableSerialize({ b: 1, a: 2 })).toBe(stableSerialize({ a: 2, b: 1 }));
  });

  it("uses fixed reasons and excludes sensitive Job fields from explanations", () => {
    const result = evaluateJobHardFilters(salaryConfiguration(), 2, job());
    const serialized = JSON.stringify(result.explanation);
    expect(serialized).toContain("Salary information is missing and requires review.");
    expect(serialized).not.toContain("must never enter explanations");
    expect(serialized).not.toContain("private@example.test");
    expect(result.explanationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evaluates duplicate members independently", () => {
    const config = salaryConfiguration();
    const primary = evaluateJobHardFilters(
      config,
      1,
      job({
        salaryMin: "120000",
        salaryMax: "140000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    const secondary = evaluateJobHardFilters(
      config,
      1,
      job({
        salaryMin: "80000",
        salaryMax: "90000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(primary.outcome).toBe("PASS");
    expect(secondary.outcome).toBe("FAIL");
    expect(primary.explanationHash).not.toBe(secondary.explanationHash);
  });

  it("projects standalone Jobs and only the explicit active duplicate-group primary", () => {
    const membership = (primaryJobId: string) => ({ group: { primaryJobId } });
    expect(isInPrimaryCollapsedConsideration({ id: "standalone", status: "ACTIVE" })).toBe(true);
    expect(
      isInPrimaryCollapsedConsideration({
        id: "primary",
        status: "ACTIVE",
        duplicateGroupMembership: membership("primary"),
      }),
    ).toBe(true);
    expect(
      isInPrimaryCollapsedConsideration({
        id: "secondary",
        status: "ACTIVE",
        duplicateGroupMembership: membership("primary"),
      }),
    ).toBe(false);
    expect(
      isInPrimaryCollapsedConsideration({
        id: "primary",
        status: "ARCHIVED",
        duplicateGroupMembership: membership("primary"),
      }),
    ).toBe(false);
  });
});
