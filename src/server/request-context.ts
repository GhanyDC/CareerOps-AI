import "server-only";

import { cache } from "react";

import { env } from "@/config/env.server";
import { prisma } from "@/server/db/client";

export type RequestContext = Readonly<{
  userId: string;
  identityMode: "development";
}>;

/**
 * Development-only identity seam. A real authentication provider can replace this function
 * without changing domain use cases, which accept only the trusted userId returned here.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  if (!env.DEVELOPMENT_IDENTITY_ENABLED || !env.DEVELOPMENT_USER_KEY) {
    throw new Error("No server-side identity provider is configured.");
  }

  const user = await prisma.user.findUnique({
    where: { developmentKey: env.DEVELOPMENT_USER_KEY },
    select: { id: true },
  });

  if (!user) {
    throw new Error("The development identity has not been seeded. Run npm run db:seed.");
  }

  return { userId: user.id, identityMode: "development" };
});
