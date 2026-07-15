import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export function findOwnedDiscoveryForParsing(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  return tx.jobDiscovery.findUnique({
    where: { id_userId: { id, userId } },
    include: {
      batch: { select: { payloadHash: true, contractVersion: true, importMethod: true } },
    },
  });
}
