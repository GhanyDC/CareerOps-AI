import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export function getJobScoringProfileRecord(userId: string) {
  return prisma.jobScoringProfile.findUnique({ where: { userId } });
}

export function getJobPreliminaryScoreRecord(userId: string, jobId: string) {
  return prisma.jobPreliminaryScore.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });
}

export function listJobScoringEvents(userId: string, profileId: string) {
  return prisma.jobScoringEvent.findMany({
    where: { userId, profileId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export function listActiveJobIdsForScoringScan(
  userId: string,
  cursor: string | undefined,
  pageSize: number,
) {
  return prisma.job.findMany({
    where: { userId, status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take: pageSize + 1,
  });
}

type SummaryRow = Readonly<{
  high: bigint;
  medium: bigint;
  low: bigint;
  noCoverage: bigint;
  staleOrMissing: bigint;
  considered: bigint;
  averageScore: number;
}>;

export async function summarizePrimaryCollapsedScores(
  userId: string,
  profileVersion: number,
  ruleSetVersion: number,
) {
  const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH considered AS (
      SELECT j."id", j."version"
      FROM "Job" j
      LEFT JOIN "JobDuplicateGroupMember" member
        ON member."jobId" = j."id" AND member."userId" = j."userId"
      LEFT JOIN "JobDuplicateGroup" duplicate_group
        ON duplicate_group."id" = member."groupId" AND duplicate_group."userId" = j."userId"
      WHERE j."userId" = ${userId}
        AND j."status" = 'ACTIVE'
        AND (member."jobId" IS NULL OR duplicate_group."primaryJobId" = j."id")
    ),
    projected AS (
      SELECT
        considered."id",
        CASE
          WHEN score."scoringProfileVersion" = ${profileVersion}
            AND score."ruleSetVersion" = ${ruleSetVersion}
            AND score."sourceJobVersion" = considered."version"
          THEN score."score"
        END AS fresh_score,
        CASE
          WHEN score."scoringProfileVersion" = ${profileVersion}
            AND score."ruleSetVersion" = ${ruleSetVersion}
            AND score."sourceJobVersion" = considered."version"
          THEN score."coverage"
        END AS fresh_coverage
      FROM considered
      LEFT JOIN "JobPreliminaryScore" score
        ON score."jobId" = considered."id" AND score."userId" = ${userId}
    )
    SELECT
      count(*) FILTER (WHERE fresh_coverage > 0 AND fresh_score >= 80) AS "high",
      count(*) FILTER (WHERE fresh_coverage > 0 AND fresh_score BETWEEN 60 AND 79) AS "medium",
      count(*) FILTER (WHERE fresh_coverage > 0 AND fresh_score < 60) AS "low",
      count(*) FILTER (WHERE fresh_coverage = 0) AS "noCoverage",
      count(*) FILTER (WHERE fresh_score IS NULL) AS "staleOrMissing",
      count(*) AS "considered",
      COALESCE(round(avg(fresh_score) FILTER (WHERE fresh_coverage > 0))::integer, 0)
        AS "averageScore"
    FROM projected
  `);
  const row = rows[0] ?? {
    high: BigInt(0),
    medium: BigInt(0),
    low: BigInt(0),
    noCoverage: BigInt(0),
    staleOrMissing: BigInt(0),
    considered: BigInt(0),
    averageScore: 0,
  };
  return {
    high: Number(row.high),
    medium: Number(row.medium),
    low: Number(row.low),
    noCoverage: Number(row.noCoverage),
    staleOrMissing: Number(row.staleOrMissing),
    considered: Number(row.considered),
    averageScore: Number(row.averageScore),
  };
}

export function countActivePrimaryCollapsedJobs(userId: string) {
  return prisma.job.count({
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ duplicateGroupMembership: { is: null } }, { primaryDuplicateGroups: { some: {} } }],
    },
  });
}
