import "server-only";

import { prisma } from "@/server/db/client";
import { getJobFilterDashboardSummary } from "@/modules/job-hard-filters/public.server";
import { getJobScoringDashboardSummary } from "@/modules/job-scoring/public.server";

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
    inboxDiscoveries,
    activeJobs,
    pendingDuplicateReviews,
  ] = await prisma.$transaction([
    prisma.experience.count({ where: { userId } }),
    prisma.project.count({ where: { userId } }),
    prisma.evidenceItem.count({ where: { userId } }),
    prisma.evidenceItem.count({ where: { userId, verificationStatus: "VERIFIED" } }),
    prisma.claim.count({ where: { userId, status: "APPROVED" } }),
    prisma.evidenceItem.count({ where: { userId, verificationStatus: "REQUIRES_VERIFICATION" } }),
    prisma.claim.count({ where: { userId, status: "REQUIRES_VERIFICATION" } }),
    prisma.claim.count({ where: { userId, status: "PROHIBITED" } }),
    prisma.jobDiscovery.count({ where: { userId, status: "INBOX" } }),
    prisma.job.count({ where: { userId, status: "ACTIVE" } }),
    prisma.jobDuplicateCandidate.count({
      where: {
        userId,
        OR: [{ activeCandidate: true, decision: null }, { decisionNeedsReview: true }],
      },
    }),
  ]);
  const [jobFilters, jobScoring] = await Promise.all([
    getJobFilterDashboardSummary(userId),
    getJobScoringDashboardSummary(userId),
  ]);

  return {
    experiences,
    projects,
    evidenceItems,
    verifiedEvidence,
    approvedClaims,
    requiresVerification: evidenceRequiringVerification + claimsRequiringVerification,
    prohibitedClaims,
    inboxDiscoveries,
    activeJobs,
    pendingDuplicateReviews,
    jobFilters,
    jobScoring,
  };
}
