import { z } from "zod";

import { optionalMultiline, requiredClaim } from "@/modules/shared/validation";

export const claimStatuses = [
  "DRAFT",
  "REQUIRES_VERIFICATION",
  "APPROVED",
  "PROHIBITED",
  "ARCHIVED",
] as const;

export const claimInputSchema = z.object({
  evidenceItemId: z.string().min(1).max(100).optional(),
  claimText: requiredClaim("Claim text"),
  reviewerNotes: optionalMultiline(3000),
  allowedForResume: z.boolean(),
  allowedForCoverLetters: z.boolean(),
  allowedForInterviews: z.boolean(),
  allowedForRecruiterMessages: z.boolean(),
});

export const claimTransitionSchema = z.object({ targetStatus: z.enum(claimStatuses) });

export type ClaimInput = z.infer<typeof claimInputSchema>;
export type ClaimBankStatus = (typeof claimStatuses)[number];

const allowedClaimTransitions: Record<ClaimBankStatus, readonly ClaimBankStatus[]> = {
  DRAFT: ["REQUIRES_VERIFICATION", "APPROVED", "PROHIBITED", "ARCHIVED"],
  REQUIRES_VERIFICATION: ["DRAFT", "APPROVED", "PROHIBITED", "ARCHIVED"],
  APPROVED: ["REQUIRES_VERIFICATION", "PROHIBITED", "ARCHIVED"],
  PROHIBITED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionClaim(from: ClaimBankStatus, to: ClaimBankStatus) {
  return allowedClaimTransitions[from].includes(to);
}

export function canApproveClaim(status: ClaimBankStatus, evidenceStatus?: string) {
  return (
    status !== "PROHIBITED" &&
    status !== "ARCHIVED" &&
    evidenceStatus === "VERIFIED" &&
    canTransitionClaim(status, "APPROVED")
  );
}
