import { describe, expect, it } from "vitest";

import {
  emptyJobValues,
  jobValuesSchema,
  mergeSelectedJobFields,
  structuredJobContractSchema,
} from "@/modules/jobs/schemas";

describe("authoritative Job contracts", () => {
  it("accepts a strict versioned structured contract", () => {
    const job = {
      ...emptyJobValues(),
      title: "Backend Developer",
      employmentType: "FULL_TIME",
      sourceUrl: "https://example.com/jobs/1",
      responsibilities: ["Build APIs"],
    } as const;
    expect(structuredJobContractSchema.parse({ contractVersion: 1, job }).job).toEqual(job);
  });

  it("rejects unknown enums, unsafe URLs, unknown keys, and invalid dates", () => {
    const valid = { ...emptyJobValues(), title: "Developer" };
    expect(() => jobValuesSchema.parse({ ...valid, employmentType: "PERMANENT" })).toThrow();
    expect(() => jobValuesSchema.parse({ ...valid, sourceUrl: "javascript:alert(1)" })).toThrow();
    expect(() => jobValuesSchema.parse({ ...valid, postedDate: "2026-02-30" })).toThrow();
    expect(() =>
      structuredJobContractSchema.parse({ contractVersion: 1, job: valid, extra: true }),
    ).toThrow();
  });

  it("validates salary shape and ordering", () => {
    const valid = { ...emptyJobValues(), title: "Developer" };
    expect(() => jobValuesSchema.parse({ ...valid, salaryMin: "1000.00" })).toThrow();
    expect(() =>
      jobValuesSchema.parse({
        ...valid,
        salaryMin: "2000",
        salaryMax: "1000",
        salaryCurrency: "PHP",
        salaryPeriod: "MONTH",
      }),
    ).toThrow();
    expect(
      jobValuesSchema.parse({
        ...valid,
        salaryMin: "1000",
        salaryMax: "2000",
        salaryCurrency: "PHP",
        salaryPeriod: "MONTH",
      }).salaryMax,
    ).toBe("2000");
  });

  it("rejects duplicate normalized array values", () => {
    expect(() =>
      jobValuesSchema.parse({
        ...emptyJobValues(),
        title: "Developer",
        skills: ["TypeScript", "typescript"],
      }),
    ).toThrow(/duplicate/);
  });

  it("merges only selected reparse fields", () => {
    const current = { ...emptyJobValues(), title: "Current", companyName: "Kept" };
    const proposed = { ...emptyJobValues(), title: "Proposed", companyName: "Ignored" };
    expect(mergeSelectedJobFields(current, proposed, ["title"])).toMatchObject({
      title: "Proposed",
      companyName: "Kept",
    });
  });
});
