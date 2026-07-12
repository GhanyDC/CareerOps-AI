import type { BetterAuthOptions } from "better-auth";

import type { ServerEnv } from "@/config/env.schema";
import { AUTH_SESSION_IDLE_SECONDS, AUTH_SESSION_UPDATE_SECONDS } from "./constants";
import { stripProviderTokens } from "./provider-tokens";

type AuditSink = Readonly<{
  canCreateSession?: (userId: string) => Promise<boolean>;
}>;

export function buildAuthOptions(env: ServerEnv, audit: AuditSink = {}): BetterAuthOptions {
  const production = env.NODE_ENV === "production";
  const sessionCookieName = production
    ? "__Host-careerops.session_token"
    : "careerops-dev.session_token";

  return {
    appName: "CareerOps AI",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
    logger: {
      level: production ? "error" : "warn",
      log(level) {
        console.error("Authentication service event", {
          category: "authentication_service",
          level,
        });
      },
    },
    disabledPaths: [
      "/link-social",
      "/unlink-account",
      "/get-access-token",
      "/refresh-token",
      "/account-info",
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: "online",
        disableDefaultScope: true,
        scope: ["openid", "email", "profile"],
      },
    },
    user: {
      modelName: "user",
      fields: {
        name: "authName",
        email: "authEmail",
        emailVerified: "authEmailVerified",
        image: "authImage",
      },
      deleteUser: { enabled: false },
    },
    account: {
      modelName: "authAccount",
      updateAccountOnSignIn: false,
      storeAccountCookie: false,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    session: {
      modelName: "authSession",
      expiresIn: AUTH_SESSION_IDLE_SECONDS,
      updateAge: AUTH_SESSION_UPDATE_SECONDS,
      cookieCache: { enabled: false },
    },
    verification: { modelName: "authVerification" },
    advanced: {
      useSecureCookies: false,
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        session_token: {
          name: sessionCookieName,
          attributes: {
            httpOnly: true,
            secure: production,
            sameSite: "lax",
            path: "/",
          },
        },
      },
    },
    databaseHooks: {
      account: {
        create: {
          async before(account) {
            return { data: stripProviderTokens(account) };
          },
        },
        update: {
          async before(account) {
            return { data: stripProviderTokens(account) };
          },
        },
      },
      session: {
        create: {
          async before(session) {
            if ((await audit.canCreateSession?.(session.userId)) === false) return false;
          },
        },
      },
    },
  };
}
