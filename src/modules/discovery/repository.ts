import "server-only";

import type { JobDiscoveryStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export type DiscoveryInboxFilters = Readonly<{
  status?: JobDiscoveryStatus;
  sourceLabel?: string;
  query?: string;
  cursor?: Readonly<{ createdAt: Date; id: string }>;
  pageSize?: number;
}>;

export function listDiscoveryRecords(userId: string, filters: DiscoveryInboxFilters = {}) {
  const where: Prisma.JobDiscoveryWhereInput = {
    userId,
    status: filters.status,
    sourceLabel: filters.sourceLabel,
  };
  if (filters.query) {
    where.OR = [
      { titleHint: { contains: filters.query, mode: "insensitive" } },
      { companyHint: { contains: filters.query, mode: "insensitive" } },
      { locationHint: { contains: filters.query, mode: "insensitive" } },
      { sourceLabel: { contains: filters.query, mode: "insensitive" } },
      { rawContent: { contains: filters.query, mode: "insensitive" } },
    ];
  }
  if (filters.cursor) {
    where.AND = [
      {
        OR: [
          { createdAt: { lt: filters.cursor.createdAt } },
          { createdAt: filters.cursor.createdAt, id: { lt: filters.cursor.id } },
        ],
      },
    ];
  }
  return prisma.jobDiscovery.findMany({
    where,
    include: { batch: { select: { id: true, producerLabel: true, importMethod: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(filters.pageSize ?? 25, 50) + 1,
  });
}

export function listOwnedSourceLabels(userId: string) {
  return prisma.jobDiscovery.findMany({
    where: { userId, sourceLabel: { not: null } },
    select: { sourceLabel: true },
    distinct: ["sourceLabel"],
    orderBy: { sourceLabel: "asc" },
  });
}

export function getDiscoveryRecord(userId: string, id: string) {
  return prisma.jobDiscovery.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      batch: true,
      processingEvents: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function getDiscoveryBatch(userId: string, id: string) {
  return prisma.discoveryImportBatch.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      discoveries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      processingEvents: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function findBatchByIdempotency(userId: string, idempotencyKey: string) {
  return prisma.discoveryImportBatch.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: { discoveries: true },
  });
}

export function countInboxDiscoveries(userId: string) {
  return prisma.jobDiscovery.count({ where: { userId, status: "INBOX" } });
}
