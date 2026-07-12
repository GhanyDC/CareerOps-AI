import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";

import type { ServerEnv } from "@/config/env.schema";
import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";
import { buildAuthOptions } from "@/server/auth/options";
import { assertTestAuthenticationEnvironment } from "./test-auth-guard";

assertTestAuthenticationEnvironment(process.env.NODE_ENV);
const databaseEnv = parseDatabaseEnv(process.env);

export const testAuthenticationEnv: ServerEnv = {
  ...databaseEnv,
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "careerops-e2e-auth-secret-0123456789",
  BETTER_AUTH_URL: "http://127.0.0.1:3100",
  AUTH_TRUSTED_ORIGINS: ["http://127.0.0.1:3100"],
  GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "e2e-google-secret",
  DEVELOPMENT_SEED_ENABLED: false,
};

export const authTestClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseEnv.DATABASE_URL }),
});

const auditSink = {
  async canCreateSession(userId: string) {
    const user = await authTestClient.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status === "ACTIVE";
  },
};

export const testAuth = betterAuth({
  ...buildAuthOptions(testAuthenticationEnv, auditSink),
  database: prismaAdapter(authTestClient, { provider: "postgresql", transaction: true }),
  plugins: [testUtils()],
});

export async function getAuthTestHelpers() {
  return (await testAuth.$context).test;
}
