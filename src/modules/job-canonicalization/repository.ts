import "server-only";

import type { Job, Prisma } from "@/generated/prisma/client";

import { canonicalizeJob } from "./canonicalize";

export async function refreshCanonicalRepresentation(
  tx: Prisma.TransactionClient,
  userId: string,
  job: Job,
) {
  const previous = await tx.jobCanonicalRepresentation.findUnique({
    where: { jobId_userId: { jobId: job.id, userId } },
  });
  const canonical = canonicalizeJob(job);
  const representation = await tx.jobCanonicalRepresentation.upsert({
    where: { jobId_userId: { jobId: job.id, userId } },
    create: { userId, jobId: job.id, ...canonical },
    update: canonical,
  });
  return {
    representation,
    comparisonChanged:
      previous !== null && previous.comparisonHash !== representation.comparisonHash,
    created: previous === null,
  };
}
