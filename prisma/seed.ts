import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { parseDatabaseEnv } from "../src/config/env.schema";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDevelopmentData } from "../src/server/db/seed-data";

const env = parseDatabaseEnv(process.env);
const developmentSeedEnabled = process.env.DEVELOPMENT_SEED_ENABLED === "true";
const developmentUserKey = process.env.DEVELOPMENT_USER_KEY?.trim();

if (env.NODE_ENV === "production" || !developmentSeedEnabled || !developmentUserKey) {
  throw new Error("Development seed data must be explicitly enabled outside production.");
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const client = new PrismaClient({ adapter });

try {
  const seeded = await seedDevelopmentData(client, developmentUserKey);
  console.log(`Seeded development candidate evidence for user ${seeded.userId}.`);
} finally {
  await client.$disconnect();
}
