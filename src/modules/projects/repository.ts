import "server-only";

import type { ProjectInput } from "./schemas";
import { prisma } from "@/server/db/client";

export function listProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    include: { _count: { select: { evidenceItems: true } } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
}

export function listProjectOptions(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export function getProject(userId: string, id: string) {
  return prisma.project.findUnique({
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

export function createProjectRecord(
  userId: string,
  candidateProfileId: string,
  input: ProjectInput,
) {
  return prisma.project.create({ data: { userId, candidateProfileId, ...input } });
}

export function updateProjectRecord(userId: string, id: string, input: ProjectInput) {
  return prisma.project.update({ where: { id_userId: { id, userId } }, data: input });
}

export function deleteProjectRecord(userId: string, id: string) {
  return prisma.project.delete({ where: { id_userId: { id, userId } } });
}
