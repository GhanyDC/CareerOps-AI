import { describe, expect, it } from "vitest";

import { canApproveClaim, canTransitionClaim, claimInputSchema } from "@/modules/claims/schemas";

describe("claim rules", () => {
  it("requires verified evidence for approval", () => {
    expect(canApproveClaim("DRAFT", "VERIFIED")).toBe(true);
    expect(canApproveClaim("DRAFT", "DRAFT")).toBe(false);
    expect(canApproveClaim("DRAFT", undefined)).toBe(false);
  });

  it("never allows a prohibited claim to become approved", () => {
    expect(canTransitionClaim("PROHIBITED", "APPROVED")).toBe(false);
    expect(canApproveClaim("PROHIBITED", "VERIFIED")).toBe(false);
  });

  it("rejects whitespace-only and overlong claim text", () => {
    const input = {
      evidenceItemId: "evidence-1",
      claimText: " ",
      reviewerNotes: undefined,
      allowedForResume: false,
      allowedForCoverLetters: false,
      allowedForInterviews: false,
      allowedForRecruiterMessages: false,
    };
    expect(() => claimInputSchema.parse(input)).toThrow();
    expect(() => claimInputSchema.parse({ ...input, claimText: "x".repeat(1001) })).toThrow();
  });
});
