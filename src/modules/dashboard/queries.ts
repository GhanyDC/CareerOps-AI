import "server-only";

import { prisma } from "@/server/db/client";

export async function getDashboardSummary(userId: string) {
  const [
    experiences,
    projects,
    evidenceItems,
    verifiedEvidence,
    approvedClaims,
    evidenceRequiringVerification,
    claimsRequiringVerification,
    prohibitedClaims,
  ] = await prisma.$transaction([
    prisma.experience.count({ where: { userId } }),
    prisma.project.count({ where: { userId } }),
    prisma.evidenceItem.count({ where: { userId } }),
    prisma.evidenceItem.count({ where: { userId, verificationStatus: "VERIFIED" } }),
    prisma.claim.count({ where: { userId, status: "APPROVED" } }),
    prisma.evidenceItem.count({ where: { userId, verificationStatus: "REQUIRES_VERIFICATION" } }),
    prisma.claim.count({ where: { userId, status: "REQUIRES_VERIFICATION" } }),
    prisma.claim.count({ where: { userId, status: "PROHIBITED" } }),
  ]);

  return {
    experiences,
    projects,
    evidenceItems,
    verifiedEvidence,
    approvedClaims,
    requiresVerification: evidenceRequiringVerification + claimsRequiringVerification,
    prohibitedClaims,
  };
}
