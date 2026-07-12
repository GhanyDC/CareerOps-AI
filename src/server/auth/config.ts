import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/config/env.server";
import { prisma } from "@/server/db/client";
import { authenticationAuditSink } from "./audit";
import { buildAuthOptions } from "./options";

export const auth = betterAuth({
  ...buildAuthOptions(env, authenticationAuditSink),
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  plugins: [nextCookies()],
});
