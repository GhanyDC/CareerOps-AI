import "server-only";

import type {
  JobEmploymentType,
  JobStatus,
  JobWorkplaceArrangement,
  Prisma,
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
}>;

export function listJobRecords(userId: string, filters: JobListFilters = {}) {
  const direction = filters.direction ?? "desc";
  const where: Prisma.JobWhereInput = {
    userId,
    status: filters.status,
    employmentType: filters.employmentType,
    workplaceArrangement: filters.workplaceArrangement,
  };
  if (filters.query) {
    where.OR = [
      { title: { contains: filters.query, mode: "insensitive" } },
      { companyName: { contains: filters.query, mode: "insensitive" } },
    ];
  }
  if (filters.cursor) {
    const range = direction === "desc" ? "lt" : "gt";
    where.AND = [
      {
        OR: [
          { confirmedAt: { [range]: filters.cursor.confirmedAt } },
          { confirmedAt: filters.cursor.confirmedAt, id: { [range]: filters.cursor.id } },
        ],
      },
    ];
  }
  return prisma.job.findMany({
    where,
    include: { _count: { select: { sources: true } } },
    orderBy: [{ confirmedAt: direction }, { id: direction }],
    take: Math.min(filters.pageSize ?? 25, 50) + 1,
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
    },
  });
}

export function countActiveJobs(userId: string) {
  return prisma.job.count({ where: { userId, status: "ACTIVE" } });
}
