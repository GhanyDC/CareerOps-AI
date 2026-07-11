import { describe, expect, it } from "vitest";

import { canTransitionEvidence, evidenceInputSchema } from "@/modules/evidence/schemas";

const validEvidence = {
  sourceType: "EXPERIENCE",
  sourceExperienceId: "experience-1",
  sourceProjectId: undefined,
  claim: "Reduced migration time.",
  supportingContext: undefined,
  skillsDemonstrated: [],
  relevantRoleFamilies: [],
  evidenceStrength: "DIRECT",
  allowedForResume: true,
  allowedForCoverLetters: true,
  allowedForInterviews: true,
  allowedForRecruiterMessages: false,
  sourceNotes: undefined,
};

describe("evidence validation and transitions", () => {
  it("requires exactly one source that matches the source type", () => {
    expect(() =>
      evidenceInputSchema.parse({ ...validEvidence, sourceProjectId: "project-1" }),
    ).toThrow(/exactly one/);
  });

  it("validates evidence strength", () => {
    expect(() =>
      evidenceInputSchema.parse({ ...validEvidence, evidenceStrength: "CERTAIN" }),
    ).toThrow();
  });

  it("rejects whitespace-only and overlong claims", () => {
    expect(() => evidenceInputSchema.parse({ ...validEvidence, claim: "   " })).toThrow();
    expect(() =>
      evidenceInputSchema.parse({ ...validEvidence, claim: "x".repeat(1001) }),
    ).toThrow();
  });

  it("allows reviewed verification transitions and blocks invalid ones", () => {
    expect(canTransitionEvidence("DRAFT", "VERIFIED")).toBe(true);
    expect(canTransitionEvidence("VERIFIED", "DRAFT")).toBe(false);
    expect(canTransitionEvidence("REJECTED", "VERIFIED")).toBe(false);
  });
});
