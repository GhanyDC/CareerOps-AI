import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import type { EvidenceInput } from "./schemas";

export type EvidenceFilters = Readonly<{
  sourceType?: "EXPERIENCE" | "PROJECT";
  verificationStatus?: "DRAFT" | "REQUIRES_VERIFICATION" | "VERIFIED" | "REJECTED";
  evidenceStrength?: "DIRECT" | "TRANSFERABLE" | "SUPPORTING" | "WEAK";
  query?: string;
}>;

export function listEvidenceItems(userId: string, filters: EvidenceFilters = {}) {
  const where: Prisma.EvidenceItemWhereInput = {
    userId,
    sourceType: filters.sourceType,
    verificationStatus: filters.verificationStatus,
    evidenceStrength: filters.evidenceStrength,
  };

  if (filters.query) {
    where.OR = [
      { claim: { contains: filters.query, mode: "insensitive" } },
      { skillsDemonstrated: { has: filters.query } },
      { relevantRoleFamilies: { has: filters.query } },
    ];
  }

  return prisma.evidenceItem.findMany({
    where,
    include: {
      sourceExperience: { select: { id: true, title: true, organization: true } },
      sourceProject: { select: { id: true, name: true } },
      _count: { select: { claims: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function listVerifiedEvidenceOptions(userId: string) {
  return prisma.evidenceItem.findMany({
    where: { userId, verificationStatus: "VERIFIED" },
    select: { id: true, claim: true },
    orderBy: { updatedAt: "desc" },
  });
}

export function getEvidenceItem(userId: string, id: string) {
  return prisma.evidenceItem.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      sourceExperience: { select: { id: true, title: true, organization: true } },
      sourceProject: { select: { id: true, name: true } },
      _count: { select: { claims: true } },
    },
  });
}

export function createEvidenceRecord(userId: string, input: EvidenceInput) {
  return prisma.evidenceItem.create({ data: { userId, ...input } });
}

export function updateEvidenceRecord(userId: string, id: string, input: EvidenceInput) {
  return prisma.evidenceItem.update({ where: { id_userId: { id, userId } }, data: input });
}
