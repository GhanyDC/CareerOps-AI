import "server-only";

import {
  Prisma,
  type JobEmploymentType,
  type JobStatus,
  type JobWorkplaceArrangement,
} from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export type JobListFilters = Readonly<{
  status?: JobStatus;
  employmentType?: JobEmploymentType;
  workplaceArrangement?: JobWorkplaceArrangement;
  query?: string;
  cursor?: Readonly<{ confirmedAt: Date; id: string }>;
  pageSize?: number;
  direction?: "asc" | "desc";
  consideration?: boolean;
}>;

export type RankedJobListFilters = Readonly<{
  status: JobStatus;
  employmentType?: JobEmploymentType;
  workplaceArrangement?: JobWorkplaceArrangement;
  query?: string;
  consideration?: boolean;
  minimumScore?: number;
  maximumScore?: number;
  filterOutcome?: "PASS" | "FAIL" | "NEEDS_REVIEW" | "STALE_OR_MISSING";
  excludeHardFilterFails?: boolean;
  scoringProfileVersion: number;
  scoringRuleSetVersion: number;
  filterProfileVersion?: number;
  filterRuleSetVersion: number;
  cursor?: Readonly<{
    score: number | null;
    coverage: number | null;
    confirmedAt: Date;
    id: string;
  }>;
  pageSize?: number;
}>;

const jobListInclude = {
  _count: { select: { sources: true } },
  duplicateCandidatesAsA: {
    where: {
      OR: [{ activeCandidate: true, decision: null }, { decisionNeedsReview: true }],
    },
    select: { id: true },
    take: 1,
  },
  duplicateCandidatesAsB: {
    where: {
      OR: [{ activeCandidate: true, decision: null }, { decisionNeedsReview: true }],
    },
    select: { id: true },
    take: 1,
  },
  duplicateGroupMembership: {
    include: { group: { select: { id: true, primaryJobId: true } } },
  },
  filterEvaluation: true,
  preliminaryScore: true,
} satisfies Prisma.JobInclude;

export function listJobRecords(userId: string, filters: JobListFilters = {}) {
  const direction = filters.direction ?? "desc";
  const where: Prisma.JobWhereInput = {
    userId,
    status: filters.status,
    employmentType: filters.employmentType,
    workplaceArrangement: filters.workplaceArrangement,
  };
  const constraints: Prisma.JobWhereInput[] = [];
  if (filters.query) {
    constraints.push({
      OR: [
        { title: { contains: filters.query, mode: "insensitive" } },
        { companyName: { contains: filters.query, mode: "insensitive" } },
      ],
    });
  }
  if (filters.cursor) {
    const range = direction === "desc" ? "lt" : "gt";
    constraints.push({
      OR: [
        { confirmedAt: { [range]: filters.cursor.confirmedAt } },
        { confirmedAt: filters.cursor.confirmedAt, id: { [range]: filters.cursor.id } },
      ],
    });
  }
  if (filters.consideration) {
    constraints.push({
      OR: [{ duplicateGroupMembership: { is: null } }, { primaryDuplicateGroups: { some: {} } }],
    });
  }
  if (constraints.length > 0) where.AND = constraints;
  return prisma.job.findMany({
    where,
    include: jobListInclude,
    orderBy: [{ confirmedAt: direction }, { id: direction }],
    take: Math.min(filters.pageSize ?? 25, 50) + 1,
  });
}

type RankedJobRow = Readonly<{
  id: string;
  freshScore: number | null;
  freshCoverage: number | null;
  confirmedAt: Date;
}>;

export async function listRankedJobRecords(userId: string, filters: RankedJobListFilters) {
  const baseConditions: Prisma.Sql[] = [
    Prisma.sql`j."userId" = ${userId}`,
    Prisma.sql`j."status" = ${filters.status}::"JobStatus"`,
  ];
  if (filters.employmentType) {
    baseConditions.push(
      Prisma.sql`j."employmentType" = ${filters.employmentType}::"JobEmploymentType"`,
    );
  }
  if (filters.workplaceArrangement) {
    baseConditions.push(
      Prisma.sql`j."workplaceArrangement" = ${filters.workplaceArrangement}::"JobWorkplaceArrangement"`,
    );
  }
  if (filters.query) {
    const pattern = `%${filters.query}%`;
    baseConditions.push(
      Prisma.sql`(j."title" ILIKE ${pattern} OR j."companyName" ILIKE ${pattern})`,
    );
  }
  if (filters.consideration) {
    baseConditions.push(
      Prisma.sql`(member."jobId" IS NULL OR duplicate_group."primaryJobId" = j."id")`,
    );
  }

  const projectedConditions: Prisma.Sql[] = [];
  if (filters.minimumScore !== undefined) {
    projectedConditions.push(
      Prisma.sql`"freshCoverage" > 0 AND "freshScore" >= ${filters.minimumScore}`,
    );
  }
  if (filters.maximumScore !== undefined) {
    projectedConditions.push(
      Prisma.sql`"freshCoverage" > 0 AND "freshScore" <= ${filters.maximumScore}`,
    );
  }
  if (filters.filterOutcome === "STALE_OR_MISSING") {
    projectedConditions.push(Prisma.sql`"freshFilterOutcome" IS NULL`);
  } else if (filters.filterOutcome) {
    projectedConditions.push(
      Prisma.sql`"freshFilterOutcome" = ${filters.filterOutcome}::"JobFilterOutcome"`,
    );
  }
  if (filters.excludeHardFilterFails) {
    projectedConditions.push(
      Prisma.sql`("freshFilterOutcome" IS NULL OR "freshFilterOutcome" <> 'FAIL'::"JobFilterOutcome")`,
    );
  }
  if (filters.cursor) {
    const cursor = filters.cursor;
    if (cursor.score === null) {
      projectedConditions.push(Prisma.sql`
        "freshScore" IS NULL
        AND (
          "confirmedAt" < ${cursor.confirmedAt}
          OR ("confirmedAt" = ${cursor.confirmedAt} AND "id" < ${cursor.id})
        )
      `);
    } else {
      projectedConditions.push(Prisma.sql`
        (
          "freshScore" < ${cursor.score}
          OR "freshScore" IS NULL
          OR (
            "freshScore" = ${cursor.score}
            AND "freshCoverage" < ${cursor.coverage!}
          )
          OR (
            "freshScore" = ${cursor.score}
            AND "freshCoverage" = ${cursor.coverage!}
            AND "confirmedAt" < ${cursor.confirmedAt}
          )
          OR (
            "freshScore" = ${cursor.score}
            AND "freshCoverage" = ${cursor.coverage!}
            AND "confirmedAt" = ${cursor.confirmedAt}
            AND "id" < ${cursor.id}
          )
        )
      `);
    }
  }

  const rows = await prisma.$queryRaw<RankedJobRow[]>(Prisma.sql`
    WITH projected AS (
      SELECT
        j."id",
        j."confirmedAt",
        CASE
          WHEN score."scoringProfileVersion" = ${filters.scoringProfileVersion}
            AND score."ruleSetVersion" = ${filters.scoringRuleSetVersion}
            AND score."sourceJobVersion" = j."version"
          THEN score."score"
        END AS "freshScore",
        CASE
          WHEN score."scoringProfileVersion" = ${filters.scoringProfileVersion}
            AND score."ruleSetVersion" = ${filters.scoringRuleSetVersion}
            AND score."sourceJobVersion" = j."version"
          THEN score."coverage"
        END AS "freshCoverage",
        CASE
          WHEN ${filters.filterProfileVersion ?? 0} > 0
            AND filter_evaluation."filterProfileVersion" = ${filters.filterProfileVersion ?? 0}
            AND filter_evaluation."ruleSetVersion" = ${filters.filterRuleSetVersion}
            AND filter_evaluation."sourceJobVersion" = j."version"
          THEN filter_evaluation."outcome"
        END AS "freshFilterOutcome"
      FROM "Job" j
      LEFT JOIN "JobPreliminaryScore" score
        ON score."jobId" = j."id" AND score."userId" = j."userId"
      LEFT JOIN "JobFilterEvaluation" filter_evaluation
        ON filter_evaluation."jobId" = j."id" AND filter_evaluation."userId" = j."userId"
      LEFT JOIN "JobDuplicateGroupMember" member
        ON member."jobId" = j."id" AND member."userId" = j."userId"
      LEFT JOIN "JobDuplicateGroup" duplicate_group
        ON duplicate_group."id" = member."groupId" AND duplicate_group."userId" = j."userId"
      WHERE ${Prisma.join(baseConditions, " AND ")}
    )
    SELECT "id", "freshScore", "freshCoverage", "confirmedAt"
    FROM projected
    ${
      projectedConditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(projectedConditions, " AND ")}`
        : Prisma.empty
    }
    ORDER BY
      "freshScore" DESC NULLS LAST,
      "freshCoverage" DESC NULLS LAST,
      "confirmedAt" DESC,
      "id" DESC
    LIMIT ${Math.min(filters.pageSize ?? 25, 50) + 1}
  `);
  const records = await prisma.job.findMany({
    where: { userId, id: { in: rows.map((row) => row.id) } },
    include: jobListInclude,
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return rows.flatMap((row) => {
    const record = byId.get(row.id);
    return record ? [{ record, rank: row }] : [];
  });
}

export function getJobRecord(userId: string, id: string) {
  return prisma.job.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      sources: {
        include: {
          discovery: { select: { id: true, status: true, titleHint: true } },
          parseDraft: { select: { id: true, status: true, version: true, contentPurgedAt: true } },
        },
        orderBy: { confirmedAt: "desc" },
      },
      parsingEvents: { orderBy: { createdAt: "asc" } },
      duplicateCandidatesAsA: {
        select: { id: true, decision: true, decisionNeedsReview: true },
        take: 1,
      },
      duplicateCandidatesAsB: {
        select: { id: true, decision: true, decisionNeedsReview: true },
        take: 1,
      },
      duplicateGroupMembership: {
        include: { group: { select: { id: true, primaryJobId: true } } },
      },
      filterEvaluation: true,
      preliminaryScore: true,
    },
  });
}

export function countActiveJobs(userId: string) {
  return prisma.job.count({ where: { userId, status: "ACTIVE" } });
}
