import "server-only";

import { prisma } from "@/server/db/client";

export function getParseDraft(userId: string, id: string) {
  return prisma.jobParseDraft.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      discovery: {
        include: {
          batch: {
            select: {
              id: true,
              producerLabel: true,
              importMethod: true,
              payloadHash: true,
              contractVersion: true,
            },
          },
        },
      },
      targetJob: true,
      source: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function listReviewDrafts(
  userId: string,
  status: "READY_FOR_REVIEW" | "REJECTED" | "SUPERSEDED" = "READY_FOR_REVIEW",
) {
  return prisma.jobParseDraft.findMany({
    where: { userId, status },
    include: {
      discovery: { select: { id: true, titleHint: true, companyHint: true, status: true } },
      targetJob: { select: { id: true, title: true, companyName: true } },
    },
    orderBy:
      status === "READY_FOR_REVIEW"
        ? [{ updatedAt: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }],
    take: 50,
  });
}
