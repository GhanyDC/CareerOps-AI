import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { parseServerEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";

export async function cleanupCandidateEvidenceRun(marker: string) {
  const env = parseServerEnv(process.env);
  if (!env.DEVELOPMENT_USER_KEY) return;

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const user = await client.user.findUnique({
      where: { developmentKey: env.DEVELOPMENT_USER_KEY },
      select: { id: true },
    });
    if (!user) return;

    const [claims, evidence] = await Promise.all([
      client.claim.findMany({
        where: { userId: user.id, claimText: { contains: marker } },
        select: { id: true },
      }),
      client.evidenceItem.findMany({
        where: { userId: user.id, claim: { contains: marker } },
        select: { id: true },
      }),
    ]);
    const claimIds = claims.map(({ id }) => id);
    const evidenceIds = evidence.map(({ id }) => id);

    await client.$transaction([
      client.auditLog.deleteMany({
        where: { userId: user.id, entityId: { in: [...claimIds, ...evidenceIds] } },
      }),
      client.claim.deleteMany({ where: { userId: user.id, id: { in: claimIds } } }),
      client.evidenceItem.deleteMany({ where: { userId: user.id, id: { in: evidenceIds } } }),
      client.experience.deleteMany({
        where: { userId: user.id, title: { contains: marker } },
      }),
      client.project.deleteMany({ where: { userId: user.id, name: { contains: marker } } }),
    ]);
  } finally {
    await client.$disconnect();
  }
}
