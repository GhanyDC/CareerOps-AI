import { describe, expect, it } from "vitest";

import type { Job, JobCanonicalRepresentation } from "@/generated/prisma/client";
import { canonicalizeJob } from "@/modules/job-canonicalization/public";
import { evaluateDuplicatePair, orderDuplicatePair } from "@/modules/job-duplicates/rules";
import { duplicateEvidenceSchema } from "@/modules/job-duplicates/schemas";

function job(id: string, overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-19T00:00:00.000Z");
  return {
    id,
    userId: "user-a",
    title: "Backend Engineer",
    companyName: "Example Company",
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

function representation(id: string, overrides: Partial<Job> = {}): JobCanonicalRepresentation {
  const now = new Date("2026-07-19T00:00:00.000Z");
  return {
    id: `representation-${id}`,
    userId: "user-a",
    jobId: id,
    ...canonicalizeJob(job(id, overrides)),
    createdAt: now,
    updatedAt: now,
  };
}

describe("deterministic duplicate rules", () => {
  it("treats an exact canonical URL as strong evidence", () => {
    const left = representation("a", {
      sourceUrl: "https://example.com/job/1?utm_source=a&jobId=1",
    });
    const right = representation("b", {
      sourceUrl: "https://example.com/job/1?utm_campaign=b&jobId=1",
    });
    const result = evaluateDuplicatePair(left, right);
    expect(result.qualifies).toBe(true);
    expect(result.tier).toBe("STRONG");
    expect(result.evidence.qualifyingRules.map((rule) => rule.code)).toContain(
      "EXACT_CANONICAL_URL",
    );
  });

  it("uses exact company, title, and location as moderate evidence", () => {
    const left = representation("a", { locationLabel: "Remote – Philippines" });
    const right = representation("b", { locationLabel: " remote – philippines " });
    const result = evaluateDuplicatePair(left, right);
    expect(result.qualifies).toBe(true);
    expect(result.tier).toBe("MODERATE");
    expect(result.evidence.qualifyingRules.map((rule) => rule.code)).toContain(
      "EXACT_COMPANY_TITLE_AND_LOCATION",
    );
  });

  it("does not generate a candidate from weak title-only evidence", () => {
    const left = representation("a", { companyName: null });
    const right = representation("b", { companyName: "Different" });
    const result = evaluateDuplicatePair(left, right);
    expect(result.qualifies).toBe(false);
    expect(result.evidence.supportingRules.map((rule) => rule.code)).toContain("TITLE_MATCH");
  });

  it("records conflicts without automatically deciding the pair", () => {
    const left = representation("a", {
      sourceUrl: "https://example.com/job/1",
      employmentType: "FULL_TIME",
      countryCode: "PH",
      experienceLevel: "MID_LEVEL",
    });
    const right = representation("b", {
      sourceUrl: "https://example.com/job/1",
      companyName: "Another Company",
      employmentType: "CONTRACT",
      countryCode: "SG",
      experienceLevel: "SENIOR",
    });
    const result = evaluateDuplicatePair(left, right);
    expect(result.qualifies).toBe(true);
    expect(result.conflicts.items.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "CANONICAL_COMPANY_MISMATCH",
        "EMPLOYMENT_TYPE_MISMATCH",
        "COUNTRY_MISMATCH",
        "EXPERIENCE_LEVEL_MISMATCH",
      ]),
    );
  });

  it("orders pairs and rejects self-pairs", () => {
    expect(orderDuplicatePair("job-z", "job-a")).toEqual({ jobAId: "job-a", jobBId: "job-z" });
    expect(() => orderDuplicatePair("job-a", "job-a")).toThrow(/cannot be compared with itself/);
  });

  it("strictly rejects evidence containing unreviewed raw fields", () => {
    expect(() =>
      duplicateEvidenceSchema.parse({
        schemaVersion: 1,
        qualifyingRules: [],
        supportingRules: [],
        rawDescription: "must not persist",
      }),
    ).toThrow();
  });
});
