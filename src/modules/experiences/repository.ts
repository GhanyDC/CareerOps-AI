import "server-only";

import type { ExperienceInput } from "./schemas";
import { prisma } from "@/server/db/client";

export function listExperiences(userId: string) {
  return prisma.experience.findMany({
    where: { userId },
    include: { _count: { select: { evidenceItems: true } } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
}

export function listExperienceOptions(userId: string) {
  return prisma.experience.findMany({
    where: { userId },
    select: { id: true, title: true, organization: true },
    orderBy: { title: "asc" },
  });
}

export function getExperience(userId: string, id: string) {
  return prisma.experience.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      _count: { select: { evidenceItems: true } },
      evidenceItems: {
        where: { verificationStatus: "VERIFIED" },
        select: { id: true },
        take: 1,
      },
    },
  });
}

export function createExperienceRecord(
  userId: string,
  candidateProfileId: string,
  input: ExperienceInput,
) {
  return prisma.experience.create({ data: { userId, candidateProfileId, ...input } });
}

export function updateExperienceRecord(userId: string, id: string, input: ExperienceInput) {
  return prisma.experience.update({ where: { id_userId: { id, userId } }, data: input });
}

export function deleteExperienceRecord(userId: string, id: string) {
  return prisma.experience.delete({ where: { id_userId: { id, userId } } });
}
