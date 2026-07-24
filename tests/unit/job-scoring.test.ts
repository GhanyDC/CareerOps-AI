import { describe, expect, it } from "vitest";

import {
  canonicalizeJobScoringConfiguration,
  defaultJobScoringConfiguration,
  evaluatePreliminaryJobScore,
  hashJobScoringConfiguration,
  type JobScoringConfiguration,
} from "@/modules/job-scoring/public";

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
    description: "must never enter scoring",
    contactDetails: "private@example.test",
    ...overrides,
  };
}

function salaryConfiguration(
  update: Partial<JobScoringConfiguration["components"]["SALARY"]> = {},
) {
  const configuration = defaultJobScoringConfiguration();
  Object.assign(configuration.components.SALARY, {
    enabled: true,
    weight: 100,
    preferredMinimum: "100000",
    target: "120000",
    currency: "USD",
    salaryPeriod: "YEAR",
    ...update,
  });
  return configuration;
}

describe("Preliminary Job Scoring", () => {
  it("requires positive enabled weights totaling exactly 100 and zero disabled weights", () => {
    const invalidTotal = salaryConfiguration({ weight: 99 });
    expect(() => canonicalizeJobScoringConfiguration(invalidTotal)).toThrow(/total exactly 100/);

    const disabledWeight = salaryConfiguration();
    disabledWeight.components.SALARY.enabled = false;
    expect(() => canonicalizeJobScoringConfiguration(disabledWeight)).toThrow(
      /Disabled component weights must be zero/,
    );
  });

  it("requires complete, ordered salary preferences", () => {
    expect(() =>
      canonicalizeJobScoringConfiguration(salaryConfiguration({ preferredMinimum: null })),
    ).toThrow(/preferredMinimum is required/);
    expect(() =>
      canonicalizeJobScoringConfiguration(
        salaryConfiguration({ preferredMinimum: "120000", target: "100000" }),
      ),
    ).toThrow(/Target salary must be at least/);
  });

  it.each([
    ["120000", 100, "SALARY_AT_OR_ABOVE_TARGET"],
    ["100000", 60, "SALARY_BETWEEN_MINIMUM_AND_TARGET"],
    ["99999.99", 0, "SALARY_BELOW_PREFERRED_MINIMUM"],
  ])("applies deterministic salary boundaries", (salaryMin, score, reasonCode) => {
    const result = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin,
        salaryMax: "140000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(result).toMatchObject({ score, coverage: 100 });
    expect(result.explanation.componentResults[0]).toMatchObject({
      availability: "AVAILABLE",
      rawScore: score,
      reasonCode,
    });
  });

  it("uses the known salary floor conservatively and a lone maximum when necessary", () => {
    expect(
      evaluatePreliminaryJobScore(
        salaryConfiguration(),
        1,
        job({
          salaryMin: "90000",
          salaryMax: "140000",
          salaryCurrency: "USD",
          salaryPeriod: "YEAR",
        }),
      ).score,
    ).toBe(0);
    expect(
      evaluatePreliminaryJobScore(
        salaryConfiguration(),
        1,
        job({
          salaryMax: "120000",
          salaryCurrency: "USD",
          salaryPeriod: "YEAR",
        }),
      ).score,
    ).toBe(100);
  });

  it("excludes missing and unit-mismatched salary without treating it as a mismatch", () => {
    const missing = evaluatePreliminaryJobScore(salaryConfiguration(), 1, job());
    expect(missing).toMatchObject({ score: 0, coverage: 0 });
    expect(missing.explanation.componentResults[0]).toMatchObject({
      availability: "MISSING",
      rawScore: null,
      weightedContribution: 0,
      reasonCode: "SALARY_DATA_MISSING",
    });

    const mismatched = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "130000",
        salaryCurrency: "PHP",
        salaryPeriod: "YEAR",
      }),
    );
    expect(mismatched).toMatchObject({ score: 0, coverage: 0 });
    expect(mismatched.explanation.componentResults[0]).toMatchObject({
      availability: "INCOMPARABLE",
      reasonCode: "SALARY_UNIT_MISMATCH",
    });
  });

  it("scores employment preference tiers and known unlisted values", () => {
    const configuration = defaultJobScoringConfiguration();
    Object.assign(configuration.components.EMPLOYMENT_TYPE, {
      enabled: true,
      weight: 100,
      tiers: {
        mostPreferred: ["FULL_TIME"],
        acceptable: ["CONTRACT"],
        lessPreferred: ["PART_TIME"],
      },
    });
    expect(
      evaluatePreliminaryJobScore(configuration, 1, job({ employmentType: "FULL_TIME" })).score,
    ).toBe(100);
    expect(
      evaluatePreliminaryJobScore(configuration, 1, job({ employmentType: "CONTRACT" })).score,
    ).toBe(70);
    expect(
      evaluatePreliminaryJobScore(configuration, 1, job({ employmentType: "PART_TIME" })).score,
    ).toBe(40);
    expect(
      evaluatePreliminaryJobScore(configuration, 1, job({ employmentType: "INTERNSHIP" })).score,
    ).toBe(0);
  });

  it("scores workplace tiers without inferring arrangements", () => {
    const configuration = defaultJobScoringConfiguration();
    Object.assign(configuration.components.WORKPLACE_ARRANGEMENT, {
      enabled: true,
      weight: 100,
      tiers: {
        mostPreferred: ["REMOTE"],
        acceptable: ["HYBRID"],
        lessPreferred: ["ON_SITE"],
      },
    });
    expect(
      evaluatePreliminaryJobScore(configuration, 1, job({ workplaceArrangement: "REMOTE" })).score,
    ).toBe(100);
    expect(evaluatePreliminaryJobScore(configuration, 1, job()).coverage).toBe(0);
  });

  it("scores only the authoritative country code", () => {
    const configuration = defaultJobScoringConfiguration();
    Object.assign(configuration.components.COUNTRY, {
      enabled: true,
      weight: 100,
      tiers: {
        mostPreferred: ["PH"],
        acceptable: ["SG"],
        lessPreferred: ["JP"],
      },
    });
    expect(evaluatePreliminaryJobScore(configuration, 1, job({ countryCode: "PH" })).score).toBe(
      100,
    );
    expect(
      evaluatePreliminaryJobScore(
        configuration,
        1,
        job({ countryCode: null, locationLabel: "Manila, Philippines" }),
      ),
    ).toMatchObject({ score: 0, coverage: 0 });
  });

  it("rejects values assigned to multiple tiers", () => {
    const configuration = defaultJobScoringConfiguration();
    Object.assign(configuration.components.COUNTRY, {
      enabled: true,
      weight: 100,
      tiers: {
        mostPreferred: ["PH"],
        acceptable: ["PH"],
        lessPreferred: [],
      },
    });
    expect(() => canonicalizeJobScoringConfiguration(configuration)).toThrow(/already assigned/);
  });

  it("excludes missing components from the denominator and exposes weighted coverage", () => {
    const configuration = salaryConfiguration({ weight: 60 });
    Object.assign(configuration.components.EMPLOYMENT_TYPE, {
      enabled: true,
      weight: 40,
      tiers: {
        mostPreferred: [],
        acceptable: ["CONTRACT"],
        lessPreferred: [],
      },
    });
    const result = evaluatePreliminaryJobScore(
      configuration,
      1,
      job({ employmentType: "CONTRACT" }),
    );
    expect(result).toMatchObject({ score: 70, coverage: 40 });
    expect(result.explanation).toMatchObject({ coveredWeight: 40, totalEnabledWeight: 100 });
  });

  it("rounds the weighted average half up using integer arithmetic", () => {
    const configuration = defaultJobScoringConfiguration();
    Object.assign(configuration.components.EMPLOYMENT_TYPE, {
      enabled: true,
      weight: 45,
      tiers: {
        mostPreferred: [],
        acceptable: ["CONTRACT"],
        lessPreferred: [],
      },
    });
    Object.assign(configuration.components.COUNTRY, {
      enabled: true,
      weight: 55,
      tiers: {
        mostPreferred: [],
        acceptable: [],
        lessPreferred: [],
      },
    });
    const result = evaluatePreliminaryJobScore(
      configuration,
      1,
      job({ employmentType: "CONTRACT", countryCode: "PH" }),
    );
    expect(result.explanation.componentResults[1]).toMatchObject({
      rawScore: 70,
      weightedContribution: 3150,
    });
    expect(result.score).toBe(32);
  });

  it("keeps every score and coverage within 0 to 100", () => {
    const low = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "1",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    const high = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "999999999999",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(low.score).toBe(0);
    expect(high.score).toBe(100);
    expect([low.coverage, high.coverage]).toEqual([100, 100]);
  });

  it("canonicalizes decimals and sorted tiers into stable configuration hashes", () => {
    const left = salaryConfiguration({ preferredMinimum: "100000.00", target: "120000.0" });
    left.components.SALARY.weight = 50;
    Object.assign(left.components.COUNTRY, {
      enabled: true,
      weight: 50,
      tiers: {
        mostPreferred: ["SG", "PH", "SG"],
        acceptable: [],
        lessPreferred: [],
      },
    });
    const right = structuredClone(left);
    right.components.COUNTRY.tiers.mostPreferred.reverse();
    const canonical = canonicalizeJobScoringConfiguration(left);
    expect(canonical.components.SALARY.preferredMinimum).toBe("100000");
    expect(canonical.components.COUNTRY.tiers.mostPreferred).toEqual(["PH", "SG"]);
    expect(hashJobScoringConfiguration(left)).toBe(hashJobScoringConfiguration(right));
  });

  it("keeps disabled components out of score and coverage", () => {
    const result = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "120000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
        employmentType: "OTHER",
      }),
    );
    expect(result.explanation.componentResults[1]).toEqual({
      componentId: "EMPLOYMENT_TYPE",
      componentVersion: 1,
      enabled: false,
      weight: 0,
    });
  });

  it("uses fixed safe explanations and excludes sensitive Job fields", () => {
    const result = evaluatePreliminaryJobScore(salaryConfiguration(), 2, job());
    const serialized = JSON.stringify(result.explanation);
    expect(serialized).toContain("excluded from the score denominator");
    expect(serialized).not.toContain("must never enter scoring");
    expect(serialized).not.toContain("private@example.test");
    expect(result.explanationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scores duplicate members independently from their own authoritative fields", () => {
    const primary = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "120000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    const secondary = evaluatePreliminaryJobScore(
      salaryConfiguration(),
      1,
      job({
        salaryMin: "90000",
        salaryCurrency: "USD",
        salaryPeriod: "YEAR",
      }),
    );
    expect(primary.score).toBe(100);
    expect(secondary.score).toBe(0);
    expect(primary.explanationHash).not.toBe(secondary.explanationHash);
  });
});
