import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";

import { parseDatabaseEnv } from "../src/config/env.schema";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  assertDevelopmentLinkingEnvironment,
  linkDevelopmentUser,
} from "../src/server/auth/development-linker";

const argumentSchema = z.object({
  developmentKey: z.string().trim().min(1).max(100),
  providerId: z.literal("google"),
  providerSubject: z.string().trim().min(1).max(255),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(1).max(160),
  confirm: z.literal("LINK_LOCAL_DEVELOPMENT_USER"),
});

function readArguments(argv: string[]) {
  const entries = argv.map((argument) => {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(argument);
    if (!match) throw new Error(`Invalid argument format: ${argument}`);
    return [match[1], match[2]];
  });
  return argumentSchema.parse(Object.fromEntries(entries));
}

const env = parseDatabaseEnv(process.env);
assertDevelopmentLinkingEnvironment(env.NODE_ENV, env.DATABASE_URL);

const input = readArguments(process.argv.slice(2));
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

try {
  const linked = await linkDevelopmentUser(client, input);
  console.log(
    linked.outcome === "created"
      ? `Linked the local development user ${linked.userId} explicitly.`
      : `The explicit provider mapping already exists for local user ${linked.userId}.`,
  );
} finally {
  await client.$disconnect();
}
