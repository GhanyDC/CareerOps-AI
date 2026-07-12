import { describe, expect, it, vi } from "vitest";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { getCookies } from "better-auth/cookies";

import type { ServerEnv } from "@/config/env.schema";
import { buildAuthOptions } from "@/server/auth/options";
import { hasProviderTokenMaterial } from "@/server/auth/provider-tokens";

const env: ServerEnv = {
  DATABASE_URL: "postgresql://careerops:test@localhost:5432/careerops_test",
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "01234567890123456789012345678901",
  BETTER_AUTH_URL: "http://127.0.0.1:3100",
  AUTH_TRUSTED_ORIGINS: ["http://127.0.0.1:3100"],
  GOOGLE_CLIENT_ID: "ci-not-used.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "ci-not-used-google-secret",
  DEVELOPMENT_SEED_ENABLED: false,
};

describe("Better Auth compatibility contract", () => {
  it("executes mapped User and AuthAccount writes through the pinned Prisma adapter", async () => {
    const writes: Array<{ model: PropertyKey; data: Record<string, unknown> }> = [];
    const delegates = new Proxy<Record<PropertyKey, unknown>>(
      {},
      {
        get(_target, model) {
          if (model === "$transaction") return undefined;
          return {
            async create({ data }: { data: Record<string, unknown> }) {
              writes.push({ model, data });
              return data;
            },
            async findFirst() {
              return null;
            },
            async findMany() {
              return [];
            },
            async count() {
              return 0;
            },
            async update() {
              return null;
            },
            async updateMany() {
              return { count: 0 };
            },
            async delete() {
              return null;
            },
            async deleteMany() {
              return { count: 0 };
            },
          };
        },
      },
    );
    const auth = betterAuth({
      ...buildAuthOptions(env),
      database: prismaAdapter(delegates, { provider: "postgresql" }),
    });
    const context = await auth.$context;

    const user = await context.internalAdapter.createUser({
      name: "Mapped User",
      email: "mapped@example.test",
      emailVerified: true,
    });
    await context.internalAdapter.createAccount({
      userId: user.id,
      providerId: "google",
      accountId: "stable-provider-subject",
      accessToken: "must-not-persist",
      refreshToken: "must-not-persist",
      idToken: "must-not-persist",
    });

    expect(writes[0]).toMatchObject({
      model: "user",
      data: {
        authName: "Mapped User",
        authEmail: "mapped@example.test",
        authEmailVerified: true,
      },
    });
    expect(writes[1]?.model).toBe("authAccount");
    expect(hasProviderTokenMaterial(writes[1]?.data ?? {})).toBe(false);
  });

  it("maps Better Auth onto the existing User and named auth models", () => {
    const options = buildAuthOptions(env);

    expect(options.user).toMatchObject({
      modelName: "user",
      fields: {
        name: "authName",
        email: "authEmail",
        emailVerified: "authEmailVerified",
        image: "authImage",
      },
    });
    expect(options.account).toMatchObject({
      modelName: "authAccount",
      updateAccountOnSignIn: false,
      storeAccountCookie: false,
      accountLinking: { disableImplicitLinking: true },
    });
    expect(options.session).toMatchObject({
      modelName: "authSession",
      cookieCache: { enabled: false },
    });
    expect(options.verification).toMatchObject({ modelName: "authVerification" });
    expect(options.disabledPaths).toEqual(
      expect.arrayContaining([
        "/link-social",
        "/unlink-account",
        "/get-access-token",
        "/refresh-token",
      ]),
    );
  });

  it("replaces provider token material in account create and update hooks", async () => {
    const options = buildAuthOptions(env);
    const account = {
      id: "account-id",
      accountId: "provider-subject",
      providerId: "google",
      userId: "internal-user-id",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      idToken: "id-secret",
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      scope: "openid email profile",
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const createResult = await options.databaseHooks?.account?.create?.before?.(account, null);
    const updateResult = await options.databaseHooks?.account?.update?.before?.(account, null);

    expect(createResult).toHaveProperty("data");
    expect(updateResult).toHaveProperty("data");
    if (!createResult || typeof createResult === "boolean") throw new Error("Missing create hook");
    if (!updateResult || typeof updateResult === "boolean") throw new Error("Missing update hook");
    expect(hasProviderTokenMaterial(createResult.data)).toBe(false);
    expect(hasProviderTokenMaterial(updateResult.data)).toBe(false);
  });

  it("uses the exact non-secure test cookie without a Domain attribute", () => {
    const cookies = getCookies(buildAuthOptions(env));

    expect(cookies.sessionToken.name).toBe("careerops-dev.session_token");
    expect(cookies.sessionToken.attributes).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
    expect(cookies.sessionToken.attributes.domain).toBeUndefined();
  });

  it("rejects a disallowed user at the pre-session hook", async () => {
    const audit = { canCreateSession: vi.fn(async () => false) };
    const options = buildAuthOptions(env, audit);

    const result = await options.databaseHooks?.session?.create?.before?.(
      {
        userId: "internal-user-id",
        id: "session-id",
        token: "unissued-token",
        expiresAt: new Date(Date.now() + 60_000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      null,
    );

    expect(result).toBe(false);
    expect(audit.canCreateSession).toHaveBeenCalledWith("internal-user-id");
  });
});
