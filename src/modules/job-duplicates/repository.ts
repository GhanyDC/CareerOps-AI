import "server-only";

import type { JobDuplicateDecision, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export type DuplicateQueueView =
  "PENDING" | "DEFERRED" | "SAME_OPPORTUNITY" | "DIFFERENT_OPPORTUNITIES" | "STALE" | "HISTORY";

export type DuplicateQueueFilters = Readonly<{
  view?: DuplicateQueueView;
  cursor?: Readonly<{ updatedAt: Date; id: string }>;
  pageSize?: number;
}>;

function decisionFilter(view: DuplicateQueueView): Prisma.JobDuplicateCandidateWhereInput {
  if (view === "STALE") return { decisionNeedsReview: true };
  if (view === "HISTORY") return { activeCandidate: false };
  if (view === "PENDING") {
    return { activeCandidate: true, decision: null, decisionNeedsReview: false };
  }
  return {
    activeCandidate: true,
    decision: view as JobDuplicateDecision,
    decisionNeedsReview: false,
  };
}

export function listDuplicateCandidateRecords(userId: string, filters: DuplicateQueueFilters = {}) {
  const where: Prisma.JobDuplicateCandidateWhereInput = {
    userId,
    ...decisionFilter(filters.view ?? "PENDING"),
  };
  if (filters.cursor) {
    where.AND = [
      {
        OR: [
          { updatedAt: { lt: filters.cursor.updatedAt } },
          { updatedAt: filters.cursor.updatedAt, id: { lt: filters.cursor.id } },
        ],
      },
    ];
  }
  return prisma.jobDuplicateCandidate.findMany({
    where,
    include: {
      jobA: { select: { id: true, title: true, companyName: true, status: true, version: true } },
      jobB: { select: { id: true, title: true, companyName: true, status: true, version: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: Math.min(filters.pageSize ?? 25, 50) + 1,
  });
}

const candidateJobInclude = {
  canonicalRepresentation: true,
  sources: {
    select: {
      id: true,
      purpose: true,
      sourceDiscoveryRef: true,
      sourceBatchRef: true,
      parserVersion: true,
      sourcePurgedAt: true,
      confirmedAt: true,
    },
    orderBy: { confirmedAt: "desc" as const },
  },
  duplicateGroupMembership: {
    include: {
      group: {
        include: {
          members: {
            include: {
              job: { select: { id: true, title: true, companyName: true, status: true } },
            },
            orderBy: { createdAt: "asc" as const },
          },
        },
      },
    },
  },
} satisfies Prisma.JobInclude;

export function getDuplicateCandidateRecord(userId: string, id: string) {
  return prisma.jobDuplicateCandidate.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      jobA: { include: candidateJobInclude },
      jobB: { include: candidateJobInclude },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function getDuplicateGroupRecord(userId: string, id: string) {
  return prisma.jobDuplicateGroup.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      primaryJob: { select: { id: true, title: true, companyName: true, status: true } },
      members: {
        include: {
          job: {
            select: {
              id: true,
              title: true,
              companyName: true,
              status: true,
              version: true,
              confirmedAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export function countPendingDuplicateReviews(userId: string) {
  return prisma.jobDuplicateCandidate.count({
    where: {
      userId,
      OR: [{ activeCandidate: true, decision: null }, { decisionNeedsReview: true }],
    },
  });
}
