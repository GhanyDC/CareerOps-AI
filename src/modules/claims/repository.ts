import "server-only";

import type { ClaimBankStatus, ClaimInput } from "./schemas";
import { prisma } from "@/server/db/client";

export function listClaims(userId: string, status?: ClaimBankStatus) {
  return prisma.claim.findMany({
    where: {
      userId,
      status,
    },
    include: {
      evidenceItem: { select: { id: true, claim: true, verificationStatus: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getClaim(userId: string, id: string) {
  return prisma.claim.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      evidenceItem: { select: { id: true, claim: true, verificationStatus: true } },
    },
  });
}

export function createClaimRecord(userId: string, input: ClaimInput) {
  return prisma.claim.create({ data: { userId, ...input } });
}

export function updateClaimRecord(userId: string, id: string, input: ClaimInput) {
  return prisma.claim.update({ where: { id_userId: { id, userId } }, data: input });
}
