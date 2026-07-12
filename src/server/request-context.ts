import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/config/env.server";
import { auth } from "@/server/auth/config";
import { AUTH_SESSION_ABSOLUTE_MILLISECONDS } from "@/server/auth/constants";
import {
  AccountUnavailableError,
  SessionExpiredError,
  UnauthenticatedError,
} from "@/server/auth/errors";
import { assertTrustedMutationOrigin } from "@/server/auth/origin";
import { prisma } from "@/server/db/client";

export type RequestContext = Readonly<{
  userId: string;
  sessionId: string;
  identityMode: "authenticated";
}>;

export async function resolveRequestContext(
  requestHeaders: Headers,
  now = new Date(),
): Promise<RequestContext> {
  const authenticated = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  });
  if (!authenticated) throw new UnauthenticatedError();

  const sessionCreatedAt = new Date(authenticated.session.createdAt);
  if (now.getTime() - sessionCreatedAt.getTime() >= AUTH_SESSION_ABSOLUTE_MILLISECONDS) {
    await prisma.authSession.deleteMany({ where: { id: authenticated.session.id } });
    throw new SessionExpiredError();
  }

  const user = await prisma.user.findUnique({
    where: { id: authenticated.user.id },
    select: { id: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    if (user) await prisma.authSession.deleteMany({ where: { userId: user.id } });
    throw new AccountUnavailableError();
  }

  return {
    userId: user.id,
    sessionId: authenticated.session.id,
    identityMode: "authenticated",
  };
}

export const getRequestContext = cache(async (): Promise<RequestContext> => {
  try {
    return await resolveRequestContext(await headers());
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    if (error instanceof AccountUnavailableError) redirect("/auth/error");
    throw error;
  }
});

export async function getMutationRequestContext(): Promise<RequestContext> {
  const requestHeaders = await headers();
  assertTrustedMutationOrigin(requestHeaders, env.AUTH_TRUSTED_ORIGINS);
  return resolveRequestContext(requestHeaders);
}
