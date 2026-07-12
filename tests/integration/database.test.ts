import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../../src/generated/prisma/client";
import { parseDatabaseEnv } from "../../src/config/env.schema";

let prisma: PrismaClient;

describe("PostgreSQL connectivity", () => {
  beforeAll(() => {
    const env = parseDatabaseEnv(process.env);
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("executes a parameterized SELECT 1 without creating tables", async () => {
    const rows = await prisma.$queryRaw<Array<{ value: number }>>`SELECT ${1}::int AS value`;

    expect(rows).toEqual([{ value: 1 }]);
  });
});
