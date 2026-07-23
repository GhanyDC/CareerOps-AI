import "server-only";

import { Prisma, type JobFilterOutcome } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export function getJobFilterProfileRecord(userId: string) {
  return prisma.jobFilterProfile.findUnique({ where: { userId } });
}

export function getJobFilterEvaluationRecord(userId: string, jobId: string) {
  return prisma.jobFilterEvaluation.findUnique({
    where: { jobId_userId: { jobId, userId } },
  });
}

export function listJobFilterEvents(userId: string, profileId: string) {
  return prisma.jobFilterEvent.findMany({
    where: { userId, profileId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export function listActiveJobIdsForFilterScan(
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

type CountRow = Readonly<{
  pass: bigint;
  fail: bigint;
  needsReview: bigint;
  staleOrMissing: bigint;
  considered: bigint;
}>;

export async function countPrimaryCollapsedFilterResults(
  userId: string,
  profileVersion: number,
  ruleSetVersion: number,
) {
  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
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
    )
    SELECT
      count(*) FILTER (
        WHERE evaluation."outcome" = 'PASS'
          AND evaluation."filterProfileVersion" = ${profileVersion}
          AND evaluation."ruleSetVersion" = ${ruleSetVersion}
          AND evaluation."sourceJobVersion" = considered."version"
      ) AS "pass",
      count(*) FILTER (
        WHERE evaluation."outcome" = 'FAIL'
          AND evaluation."filterProfileVersion" = ${profileVersion}
          AND evaluation."ruleSetVersion" = ${ruleSetVersion}
          AND evaluation."sourceJobVersion" = considered."version"
      ) AS "fail",
      count(*) FILTER (
        WHERE evaluation."outcome" = 'NEEDS_REVIEW'
          AND evaluation."filterProfileVersion" = ${profileVersion}
          AND evaluation."ruleSetVersion" = ${ruleSetVersion}
          AND evaluation."sourceJobVersion" = considered."version"
      ) AS "needsReview",
      count(*) FILTER (
        WHERE evaluation."id" IS NULL
          OR evaluation."filterProfileVersion" <> ${profileVersion}
          OR evaluation."ruleSetVersion" <> ${ruleSetVersion}
          OR evaluation."sourceJobVersion" <> considered."version"
      ) AS "staleOrMissing",
      count(*) AS "considered"
    FROM considered
    LEFT JOIN "JobFilterEvaluation" evaluation
      ON evaluation."jobId" = considered."id" AND evaluation."userId" = ${userId}
  `);
  const row = rows[0] ?? {
    pass: BigInt(0),
    fail: BigInt(0),
    needsReview: BigInt(0),
    staleOrMissing: BigInt(0),
    considered: BigInt(0),
  };
  return {
    pass: Number(row.pass),
    fail: Number(row.fail),
    needsReview: Number(row.needsReview),
    staleOrMissing: Number(row.staleOrMissing),
    considered: Number(row.considered),
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

export type FilterResultView = JobFilterOutcome | "STALE_OR_MISSING";
