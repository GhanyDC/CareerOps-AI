import "server-only";

import type { CandidateProfileInput } from "./schemas";
import { prisma } from "@/server/db/client";

export function getCandidateProfile(userId: string) {
  return prisma.candidateProfile.findUnique({ where: { userId } });
}

export function saveCandidateProfile(userId: string, input: CandidateProfileInput) {
  return prisma.candidateProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
}
