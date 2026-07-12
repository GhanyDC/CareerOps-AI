import "dotenv/config";

import { defineConfig } from "prisma/config";

import { parseServerEnv } from "./src/config/env.schema";

const env = parseServerEnv(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env.DATABASE_URL,
  },
});
