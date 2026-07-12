import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { parseServerEnv } from "../src/config/env.schema";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDevelopmentData } from "../src/server/db/seed-data";

const env = parseServerEnv(process.env);

if (!env.DEVELOPMENT_IDENTITY_ENABLED || !env.DEVELOPMENT_USER_KEY) {
  throw new Error("Development identity must be enabled and configured before seeding.");
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const client = new PrismaClient({ adapter });

try {
  const seeded = await seedDevelopmentData(client, env.DEVELOPMENT_USER_KEY);
  console.log(`Seeded development candidate evidence for user ${seeded.userId}.`);
} finally {
  await client.$disconnect();
}
