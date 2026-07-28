import { describe, expect, it } from "vitest";

import {
  assessRequirement,
  assertRequirementStatusConsistent,
  deriveRequirementStatus,
  hashRequirementLinkSet,
  hashRequirementOrder,
  summarizeRequirementCoverage,
} from "@/modules/requirement-matching/matching";
import {
  MAX_REQUIREMENT_EVIDENCE_LINKS,
  evidenceLinkCreateSchema,
  requirementCreateSchema,
  requirementReviewCompletionSchema,
} from "@/modules/requirement-matching/schemas";

const fullLink = {
  evidenceItemId: "evidence-full",
  supportLevel: "FULL" as const,
  rationale: "Directly supports the complete requirement.",
  reviewedEvidenceVersion: 2,
  evidence: { version: 2 },
};

const partialLink = {
  evidenceItemId: "evidence-partial",
  supportLevel: "PARTIAL" as const,
  rationale: null,
  reviewedEvidenceVersion: 3,
  evidence: { version: 3 },
};

function reviewedRequirement(
  links: Array<typeof fullLink | typeof partialLink>,
  overrides: Record<string, unknown> = {},
) {
  return {
    version: 4,
    matchSetVersion: 5,
    evidenceLinks: links,
    review: {
      status: deriveRequirementStatus(true, links) as
        "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED",
      reviewedRequirementVersion: 4,
      reviewedMatchSetVersion: 5,
      matchSchemaVersion: 1,
      linkSetHash: hashRequirementLinkSet(links),
    },
    ...overrides,
  };
}

describe("requirement matching domain", () => {
  it("distinguishes not reviewed from explicitly unsupported", () => {
    expect(deriveRequirementStatus(false, [])).toBe("NOT_REVIEWED");
    expect(deriveRequirementStatus(true, [])).toBe("UNSUPPORTED");
  });

  it("derives full support before partial support and rejects inconsistent snapshots", () => {
    expect(deriveRequirementStatus(true, [partialLink])).toBe("PARTIALLY_SUPPORTED");
    expect(deriveRequirementStatus(true, [partialLink, fullLink])).toBe("SUPPORTED");
    expect(() => assertRequirementStatusConsistent("SUPPORTED", [partialLink])).toThrow(
      /inconsistent/,
    );
    expect(() => assertRequirementStatusConsistent("UNSUPPORTED", [fullLink])).toThrow(
      /inconsistent/,
    );
  });

  it("hashes link sets and ordering deterministically", () => {
    const forward = hashRequirementLinkSet([fullLink, partialLink]);
    const reverse = hashRequirementLinkSet([partialLink, fullLink]);
    expect(forward).toBe(reverse);
    expect(forward).toMatch(/^[0-9a-f]{64}$/);
    expect(
      hashRequirementLinkSet([{ ...fullLink, rationale: "Changed rationale" }, partialLink]),
    ).not.toBe(forward);

    const order = [
      { id: "requirement-b", position: 1 },
      { id: "requirement-a", position: 0 },
    ];
    expect(hashRequirementOrder(order)).toBe(hashRequirementOrder([...order].reverse()));
    expect(
      hashRequirementOrder([
        { id: "requirement-b", position: 0 },
        { id: "requirement-a", position: 1 },
      ]),
    ).not.toBe(hashRequirementOrder(order));
  });

  it("detects requirement, link-set, schema, hash, and evidence staleness independently", () => {
    expect(assessRequirement(reviewedRequirement([fullLink])).freshness).toBe("CURRENT");
    expect(
      assessRequirement(reviewedRequirement([fullLink], { version: 5 })).staleReasons,
    ).toContain("REQUIREMENT_VERSION_CHANGED");
    expect(
      assessRequirement(reviewedRequirement([fullLink], { matchSetVersion: 6 })).staleReasons,
    ).toContain("LINK_SET_VERSION_CHANGED");
    expect(
      assessRequirement({
        ...reviewedRequirement([fullLink]),
        review: { ...reviewedRequirement([fullLink]).review!, matchSchemaVersion: 2 },
      }).staleReasons,
    ).toContain("MATCH_SCHEMA_VERSION_CHANGED");
    expect(
      assessRequirement({
        ...reviewedRequirement([fullLink]),
        review: { ...reviewedRequirement([fullLink]).review!, linkSetHash: "0".repeat(64) },
      }).staleReasons,
    ).toContain("LINK_SET_HASH_CHANGED");
    expect(
      assessRequirement(reviewedRequirement([{ ...fullLink, evidence: { version: 3 } }]))
        .staleReasons,
    ).toContain("EVIDENCE_VERSION_CHANGED");
  });

  it("keeps stale separate from current status in required and preferred coverage", () => {
    const coverage = summarizeRequirementCoverage([
      {
        importance: "REQUIRED",
        assessment: assessRequirement(reviewedRequirement([fullLink])),
      },
      {
        importance: "REQUIRED",
        assessment: assessRequirement(
          reviewedRequirement([{ ...partialLink, evidence: { version: 4 } }]),
        ),
      },
      {
        importance: "REQUIRED",
        assessment: assessRequirement({ ...reviewedRequirement([]), review: null }),
      },
      {
        importance: "PREFERRED",
        assessment: assessRequirement(reviewedRequirement([partialLink])),
      },
      {
        importance: "PREFERRED",
        assessment: assessRequirement(reviewedRequirement([])),
      },
    ]);
    expect(coverage.REQUIRED).toEqual({
      supported: 1,
      partiallySupported: 0,
      unsupported: 0,
      notReviewed: 1,
      stale: 1,
      total: 3,
    });
    expect(coverage.PREFERRED).toEqual({
      supported: 0,
      partiallySupported: 1,
      unsupported: 1,
      notReviewed: 0,
      stale: 0,
      total: 2,
    });
  });

  it("validates bounded plain-text requirements and rationale", () => {
    expect(
      requirementCreateSchema.parse({
        statement: "  Build reliable APIs.  ",
        category: "SKILL",
        importance: "REQUIRED",
        source: "MANUAL",
      }).statement,
    ).toBe("Build reliable APIs.");
    expect(() =>
      requirementCreateSchema.parse({
        statement: "x".repeat(1001),
        category: "SKILL",
        importance: "REQUIRED",
        source: "MANUAL",
      }),
    ).toThrow();
    expect(() =>
      evidenceLinkCreateSchema.parse({
        evidenceItemId: "evidence",
        expectedEvidenceVersion: 1,
        expectedRequirementVersion: 1,
        expectedMatchSetVersion: 1,
        supportLevel: "FULL",
        rationale: "x".repeat(501),
      }),
    ).toThrow();
  });

  it("does not accept an arbitrary final status during review completion", () => {
    expect(() =>
      requirementReviewCompletionSchema.parse({
        expectedRequirementVersion: 1,
        expectedMatchSetVersion: 1,
        expectedReviewVersion: 0,
        evidenceCoordinates: [],
        status: "SUPPORTED",
      }),
    ).toThrow();
  });

  it("bounds the review coordinate set to the same maximum as linked evidence", () => {
    const coordinates = Array.from({ length: MAX_REQUIREMENT_EVIDENCE_LINKS }, (_, index) => ({
      evidenceItemId: `evidence-${index}`,
      evidenceVersion: 1,
    }));
    expect(
      requirementReviewCompletionSchema.parse({
        expectedRequirementVersion: 1,
        expectedMatchSetVersion: 1,
        expectedReviewVersion: 0,
        evidenceCoordinates: coordinates,
      }).evidenceCoordinates,
    ).toHaveLength(MAX_REQUIREMENT_EVIDENCE_LINKS);
    expect(() =>
      requirementReviewCompletionSchema.parse({
        expectedRequirementVersion: 1,
        expectedMatchSetVersion: 1,
        expectedReviewVersion: 0,
        evidenceCoordinates: [
          ...coordinates,
          { evidenceItemId: "evidence-overflow", evidenceVersion: 1 },
        ],
      }),
    ).toThrow();
  });

  it("keeps duplicate-member assessments independent until projection", () => {
    const requirements = [
      {
        jobId: "primary",
        importance: "REQUIRED" as const,
        assessment: assessRequirement(reviewedRequirement([fullLink])),
      },
      {
        jobId: "member",
        importance: "REQUIRED" as const,
        assessment: assessRequirement(reviewedRequirement([])),
      },
    ];
    expect(
      summarizeRequirementCoverage(
        requirements
          .filter((requirement) => requirement.jobId === "primary")
          .map(({ importance, assessment }) => ({ importance, assessment })),
      ).REQUIRED,
    ).toMatchObject({ supported: 1, unsupported: 0, total: 1 });
    expect(
      summarizeRequirementCoverage(
        requirements.map(({ importance, assessment }) => ({ importance, assessment })),
      ).REQUIRED,
    ).toMatchObject({ supported: 1, unsupported: 1, total: 2 });
  });
});
