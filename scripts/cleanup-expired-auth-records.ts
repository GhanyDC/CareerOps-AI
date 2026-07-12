import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { parseDatabaseEnv } from "../src/config/env.schema";
import { PrismaClient } from "../src/generated/prisma/client";

const env = parseDatabaseEnv(process.env);
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

try {
  const now = new Date();
  const [sessions, verifications] = await client.$transaction([
    client.authSession.deleteMany({ where: { expiresAt: { lte: now } } }),
    client.authVerification.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
  console.log(
    `Removed ${sessions.count} expired authentication sessions and ${verifications.count} expired verification records.`,
  );
} finally {
  await client.$disconnect();
}
