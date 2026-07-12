import { describe, expect, it } from "vitest";

import { parseDatabaseEnv, parseServerEnv } from "../../src/config/env.schema";

const validDatabaseUrl =
  "postgresql://careerops:careerops_local_only@localhost:55432/careerops?schema=public";
const productionGoogleClientId =
  "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const productionGoogleClientSecret = "GOCSPX-abcdefghijklmnopqrstuvwxyz123456";

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: validDatabaseUrl,
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "01234567890123456789012345678901",
    BETTER_AUTH_URL: "http://127.0.0.1:3100",
    AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3100",
    GOOGLE_CLIENT_ID: "ci-not-used.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "ci-not-used-google-secret",
    ...overrides,
  };
}

describe("parseDatabaseEnv", () => {
  it("parses database-only configuration for Prisma tooling", () => {
    expect(parseDatabaseEnv({ DATABASE_URL: validDatabaseUrl, NODE_ENV: "test" })).toEqual({
      DATABASE_URL: validDatabaseUrl,
      NODE_ENV: "test",
    });
  });

  it("rejects missing and non-PostgreSQL URLs", () => {
    expect(() => parseDatabaseEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
    expect(() =>
      parseDatabaseEnv({ DATABASE_URL: "https://example.test/database", NODE_ENV: "test" }),
    ).toThrow(/postgresql:\/\//);
  });
});

describe("parseServerEnv", () => {
  it("parses exact trusted origins and keeps all authentication controls server-side", () => {
    expect(parseServerEnv(validEnvironment())).toMatchObject({
      NODE_ENV: "test",
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      AUTH_TRUSTED_ORIGINS: ["http://127.0.0.1:3100"],
      DEVELOPMENT_SEED_ENABLED: false,
    });
  });

  it("requires a strong authentication secret", () => {
    expect(() => parseServerEnv(validEnvironment({ BETTER_AUTH_SECRET: "too-short" }))).toThrow(
      /at least 32/,
    );
  });

  it("rejects wildcard, path-bearing, and incomplete trusted-origin configuration", () => {
    expect(() =>
      parseServerEnv(validEnvironment({ AUTH_TRUSTED_ORIGINS: "http://*.example.test" })),
    ).toThrow(/wildcard/);
    expect(() =>
      parseServerEnv(validEnvironment({ AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3100/path" })),
    ).toThrow(/exact origin/);
    expect(() =>
      parseServerEnv(validEnvironment({ AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3200" })),
    ).toThrow(/include BETTER_AUTH_URL/);
  });

  it("rejects Better Auth's secondary trusted-origin environment variable", () => {
    expect(() =>
      parseServerEnv(
        validEnvironment({
          BETTER_AUTH_TRUSTED_ORIGINS: "https://attacker.invalid",
        }),
      ),
    ).toThrow(/AUTH_TRUSTED_ORIGINS exclusively/);
    expect(parseServerEnv(validEnvironment({ BETTER_AUTH_TRUSTED_ORIGINS: "" }))).toMatchObject({
      AUTH_TRUSTED_ORIGINS: ["http://127.0.0.1:3100"],
    });
  });

  it("rejects the removed development identity in every environment", () => {
    expect(() =>
      parseServerEnv(validEnvironment({ DEVELOPMENT_IDENTITY_ENABLED: "true" })),
    ).toThrow(/has been removed/);
  });

  it("requires the local seed key only when seeding is explicitly enabled", () => {
    expect(() => parseServerEnv(validEnvironment({ DEVELOPMENT_SEED_ENABLED: "true" }))).toThrow(
      /DEVELOPMENT_USER_KEY/,
    );
    expect(
      parseServerEnv(
        validEnvironment({
          DEVELOPMENT_SEED_ENABLED: "true",
          DEVELOPMENT_USER_KEY: "local-seed-user",
        }),
      ),
    ).toMatchObject({ DEVELOPMENT_SEED_ENABLED: true, DEVELOPMENT_USER_KEY: "local-seed-user" });
  });

  it("requires HTTPS, real credentials, and no development seed in production", () => {
    expect(() => parseServerEnv(validEnvironment({ NODE_ENV: "production" }))).toThrow(/HTTPS/);
    expect(() =>
      parseServerEnv(
        validEnvironment({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://careerops.example",
          AUTH_TRUSTED_ORIGINS: "https://careerops.example",
        }),
      ),
    ).toThrow(/placeholder/);
    expect(() =>
      parseServerEnv(
        validEnvironment({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://careerops.example",
          AUTH_TRUSTED_ORIGINS: "https://careerops.example",
          BETTER_AUTH_SECRET: "production-secret-0123456789012345",
          GOOGLE_CLIENT_ID: productionGoogleClientId,
          GOOGLE_CLIENT_SECRET: productionGoogleClientSecret,
          DEVELOPMENT_SEED_ENABLED: "true",
          DEVELOPMENT_USER_KEY: "must-not-seed",
        }),
      ),
    ).toThrow(/cannot be enabled in production/);
  });

  it("reports malformed production origins through validation rather than throwing URL internals", () => {
    expect(() =>
      parseServerEnv(
        validEnvironment({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "not-an-origin",
          AUTH_TRUSTED_ORIGINS: "also-not-an-origin",
        }),
      ),
    ).toThrow(/valid origin/);
  });

  it("accepts a valid production environment", () => {
    expect(
      parseServerEnv(
        validEnvironment({
          NODE_ENV: "production",
          BETTER_AUTH_URL: "https://careerops.example",
          AUTH_TRUSTED_ORIGINS: "https://careerops.example",
          BETTER_AUTH_SECRET: "production-secret-0123456789012345",
          GOOGLE_CLIENT_ID: productionGoogleClientId,
          GOOGLE_CLIENT_SECRET: productionGoogleClientSecret,
        }),
      ),
    ).toMatchObject({ NODE_ENV: "production", DEVELOPMENT_SEED_ENABLED: false });
  });

  it("rejects short or clearly synthetic production provider credentials", () => {
    const productionBase = {
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://careerops.example",
      AUTH_TRUSTED_ORIGINS: "https://careerops.example",
      BETTER_AUTH_SECRET: "production-secret-0123456789012345",
    };
    expect(() =>
      parseServerEnv(
        validEnvironment({
          ...productionBase,
          GOOGLE_CLIENT_ID: "fake.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "short",
        }),
      ),
    ).toThrow(/GOOGLE_CLIENT/);
  });
});
