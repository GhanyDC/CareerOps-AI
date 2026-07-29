import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export const requirementAssessmentInclude = {
  review: true,
  evidenceLinks: {
    include: {
      evidence: {
        select: {
          id: true,
          version: true,
          claim: true,
          verificationStatus: true,
          evidenceStrength: true,
          sourceExperience: { select: { id: true, title: true, organization: true } },
          sourceProject: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.JobRequirementInclude;

export function getRequirementMatchingJobRecord(userId: string, jobId: string) {
  return prisma.job.findUnique({
    where: { id_userId: { id: jobId, userId } },
    select: {
      id: true,
      userId: true,
      title: true,
      companyName: true,
      status: true,
      responsibilities: true,
      qualifications: true,
      preferredQualifications: true,
      skills: true,
      requirements: {
        include: requirementAssessmentInclude,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

export function getRequirementRecord(userId: string, requirementId: string) {
  return prisma.jobRequirement.findUnique({
    where: { id_userId: { id: requirementId, userId } },
    include: {
      ...requirementAssessmentInclude,
      job: {
        select: {
          id: true,
          title: true,
          companyName: true,
          status: true,
          responsibilities: true,
          qualifications: true,
          preferredQualifications: true,
          skills: true,
        },
      },
    },
  });
}

export function listEvidenceForRequirement(userId: string, requirementId: string) {
  return prisma.evidenceItem.findMany({
    where: {
      userId,
      state: "ACTIVE",
      requirementLinks: { none: { requirementId } },
    },
    select: {
      id: true,
      version: true,
      claim: true,
      verificationStatus: true,
      evidenceStrength: true,
      sourceExperience: { select: { title: true, organization: true } },
      sourceProject: { select: { name: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 50,
  });
}

type CoverageSummaryRow = Readonly<{
  importance: "REQUIRED" | "PREFERRED" | "OTHER";
  supported: bigint;
  partiallySupported: bigint;
  unsupported: bigint;
  notReviewed: bigint;
  stale: bigint;
  total: bigint;
}>;

export async function summarizeActiveRequirementCoverageRecords(
  userId: string,
  includeDuplicateMembers: boolean,
  matchSchemaVersion: number,
) {
  const duplicateProjection = includeDuplicateMembers
    ? Prisma.sql`TRUE`
    : Prisma.sql`(member."jobId" IS NULL OR duplicate_group."primaryJobId" = job."id")`;
  const rows = await prisma.$queryRaw<CoverageSummaryRow[]>(Prisma.sql`
    WITH considered AS (
      SELECT
        requirement."id",
        requirement."importance",
        requirement."version",
        requirement."matchSetVersion"
      FROM "JobRequirement" requirement
      INNER JOIN "Job" job
        ON job."id" = requirement."jobId" AND job."userId" = requirement."userId"
      LEFT JOIN "JobDuplicateGroupMember" member
        ON member."jobId" = job."id" AND member."userId" = job."userId"
      LEFT JOIN "JobDuplicateGroup" duplicate_group
        ON duplicate_group."id" = member."groupId" AND duplicate_group."userId" = job."userId"
      WHERE requirement."userId" = ${userId}
        AND requirement."state" = 'ACTIVE'
        AND job."status" = 'ACTIVE'
        AND ${duplicateProjection}
    ),
    classified AS (
      SELECT
        considered."importance",
        review."status",
        review."id" IS NULL AS not_reviewed,
        review."id" IS NOT NULL
          AND (
            review."reviewedRequirementVersion" <> considered."version"
            OR review."reviewedMatchSetVersion" <> considered."matchSetVersion"
            OR review."matchSchemaVersion" <> ${matchSchemaVersion}
            OR review."linkSetHash" <> "careerops_requirement_link_set_hash"(
              considered."id",
              ${userId}
            )
            OR EXISTS (
              SELECT 1
              FROM "JobRequirementEvidenceLink" link
              INNER JOIN "EvidenceItem" evidence
                ON evidence."id" = link."evidenceItemId" AND evidence."userId" = link."userId"
              WHERE link."requirementId" = considered."id"
                AND link."userId" = ${userId}
                AND (
                  link."reviewedEvidenceVersion" IS NULL
                  OR link."reviewedEvidenceVersion" <> evidence."version"
                )
            )
          ) AS stale
      FROM considered
      LEFT JOIN "JobRequirementReview" review
        ON review."requirementId" = considered."id" AND review."userId" = ${userId}
    )
    SELECT
      "importance",
      count(*) FILTER (WHERE NOT stale AND "status" = 'SUPPORTED') AS supported,
      count(*) FILTER (WHERE NOT stale AND "status" = 'PARTIALLY_SUPPORTED') AS "partiallySupported",
      count(*) FILTER (WHERE NOT stale AND "status" = 'UNSUPPORTED') AS unsupported,
      count(*) FILTER (WHERE not_reviewed) AS "notReviewed",
      count(*) FILTER (WHERE stale) AS stale,
      count(*) AS total
    FROM classified
    GROUP BY "importance"
  `);
  return rows;
}

export function listRequirementMatchEvents(userId: string, requirementId: string, take = 50) {
  return prisma.jobRequirementMatchEvent.findMany({
    where: { userId, requirementId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(take, 50),
  });
}
