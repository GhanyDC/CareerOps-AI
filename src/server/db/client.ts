import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";

const databaseEnv = parseDatabaseEnv(process.env);

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: databaseEnv.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: databaseEnv.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (databaseEnv.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
