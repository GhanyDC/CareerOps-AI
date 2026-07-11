import { z } from "zod";

import { optionalMultiline, requiredClaim, stringListSchema } from "@/modules/shared/validation";

export const evidenceStrengths = ["DIRECT", "TRANSFERABLE", "SUPPORTING", "WEAK"] as const;
export const verificationStatuses = [
  "DRAFT",
  "REQUIRES_VERIFICATION",
  "VERIFIED",
  "REJECTED",
] as const;

export const evidenceInputSchema = z
  .object({
    sourceType: z.enum(["EXPERIENCE", "PROJECT"]),
    sourceExperienceId: z.string().min(1).max(100).optional(),
    sourceProjectId: z.string().min(1).max(100).optional(),
    claim: requiredClaim(),
    supportingContext: optionalMultiline(5000),
    skillsDemonstrated: stringListSchema,
    relevantRoleFamilies: stringListSchema,
    evidenceStrength: z.enum(evidenceStrengths),
    allowedForResume: z.boolean(),
    allowedForCoverLetters: z.boolean(),
    allowedForInterviews: z.boolean(),
    allowedForRecruiterMessages: z.boolean(),
    sourceNotes: optionalMultiline(3000),
  })
  .superRefine((value, context) => {
    const hasExperience = Boolean(value.sourceExperienceId);
    const hasProject = Boolean(value.sourceProjectId);

    if (hasExperience === hasProject) {
      context.addIssue({
        code: "custom",
        path: ["sourceType"],
        message: "Evidence must have exactly one experience or project source",
      });
    }

    if (value.sourceType === "EXPERIENCE" && (!hasExperience || hasProject)) {
      context.addIssue({
        code: "custom",
        path: ["sourceExperienceId"],
        message: "Experience evidence must reference one experience",
      });
    }

    if (value.sourceType === "PROJECT" && (!hasProject || hasExperience)) {
      context.addIssue({
        code: "custom",
        path: ["sourceProjectId"],
        message: "Project evidence must reference one project",
      });
    }
  });

export const evidenceTransitionSchema = z.object({
  targetStatus: z.enum(verificationStatuses),
});

export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type EvidenceVerificationStatus = (typeof verificationStatuses)[number];

const allowedEvidenceTransitions: Record<
  EvidenceVerificationStatus,
  readonly EvidenceVerificationStatus[]
> = {
  DRAFT: ["REQUIRES_VERIFICATION", "VERIFIED", "REJECTED"],
  REQUIRES_VERIFICATION: ["DRAFT", "VERIFIED", "REJECTED"],
  VERIFIED: ["REQUIRES_VERIFICATION", "REJECTED"],
  REJECTED: ["DRAFT", "REQUIRES_VERIFICATION"],
};

export function canTransitionEvidence(
  from: EvidenceVerificationStatus,
  to: EvidenceVerificationStatus,
) {
  return allowedEvidenceTransitions[from].includes(to);
}
