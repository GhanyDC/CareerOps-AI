import { describe, expect, it } from "vitest";

import type { Job } from "@/generated/prisma/client";
import {
  JOB_CANONICALIZATION_VERSION,
  canonicalizeComparisonText,
  canonicalizeJob,
  canonicalizeSourceUrl,
} from "@/modules/job-canonicalization/public";

function job(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-19T00:00:00.000Z");
  return {
    id: "job-a",
    userId: "user-a",
    title: "Senior Engineer",
    companyName: "ACME, Inc.",
    employmentType: null,
    workplaceArrangement: null,
    experienceLevel: null,
    countryCode: null,
    region: null,
    city: null,
    locationLabel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    postedAt: null,
    closesAt: null,
    sourceUrl: null,
    description: null,
    responsibilities: [],
    qualifications: [],
    preferredQualifications: [],
    benefits: [],
    skills: [],
    applicationInstructions: null,
    contactDetails: null,
    notes: null,
    fieldProvenance: { schemaVersion: 1, fields: {} },
    status: "ACTIVE",
    version: 1,
    confirmedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Job canonicalization", () => {
  it("normalizes Unicode compatibility, case, and whitespace without stripping punctuation", () => {
    expect(canonicalizeComparisonText("  Senior　Engineer  ")).toBe("senior engineer");
    expect(canonicalizeComparisonText("ACME, Inc.")).toBe("acme, inc.");
    expect(canonicalizeComparisonText("NCR")).toBe("ncr");
  });

  it("uses stable JavaScript Unicode lowercase without translation or transliteration", () => {
    const cases = [
      ["İ", "i\u0307"],
      ["ı", "ı"],
      ["ПРИВЕТ МИР", "привет мир"],
      ["東京 エンジニア", "東京 エンジニア"],
      ["مهندس برمجيات", "مهندس برمجيات"],
    ] as const;

    for (const [input, expected] of cases) {
      const first = canonicalizeComparisonText(input);
      expect(first).toBe(expected);
      expect(canonicalizeComparisonText(input)).toBe(first);
    }
  });

  it("uses conservative comparison-only URL rules", () => {
    expect(
      canonicalizeSourceUrl(
        "HTTPS://Example.COM:443/jobs/%7euser/42/?jobId=42&utm_source=test&ref=kept#details",
      ),
    ).toBe("https://example.com/jobs/~user/42/?jobId=42&ref=kept");
    expect(canonicalizeSourceUrl("http://example.com/job/1")).toBe("http://example.com/job/1");
    expect(canonicalizeSourceUrl("https://example.com/job/1/")).toBe("https://example.com/job/1/");
    expect(() => canonicalizeSourceUrl("https://user:secret@example.com/job")).toThrow();
    expect(() => canonicalizeSourceUrl("javascript:alert(1)")).toThrow();
  });

  it("preserves authoritative values and produces stable order-insensitive list fingerprints", () => {
    const original = job({
      title: " Senior Engineer ",
      companyName: "ACME, Inc.",
      responsibilities: ["Build APIs", "Review code"],
      skills: ["TypeScript", "PostgreSQL"],
    });
    const reordered = job({
      responsibilities: ["Review code", " build  APIs "],
      skills: ["postgresql", "typescript"],
    });
    const first = canonicalizeJob(original);
    const second = canonicalizeJob(reordered);
    expect(first.canonicalizationVersion).toBe(JOB_CANONICALIZATION_VERSION);
    expect(first.canonicalTitle).toBe("senior engineer");
    expect(first.canonicalCompanyName).toBe("acme, inc.");
    expect(first.responsibilitiesFingerprint).toBe(second.responsibilitiesFingerprint);
    expect(first.skillsFingerprint).toBe(second.skillsFingerprint);
    expect(original.title).toBe(" Senior Engineer ");
    expect(original.responsibilities).toEqual(["Build APIs", "Review code"]);
  });

  it("does not infer unknown companies, locations, enums, or structured content", () => {
    const canonical = canonicalizeJob(job({ companyName: null, locationLabel: "Remote – PH" }));
    expect(canonical.canonicalCompanyName).toBeNull();
    expect(canonical.countryCode).toBeNull();
    expect(canonical.canonicalLocationLabel).toBe("remote – ph");
    expect(canonical.companyTitleHash).toBeNull();
    expect(canonical.descriptionFingerprint).toBeNull();
  });
});
