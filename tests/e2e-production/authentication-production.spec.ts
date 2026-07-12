import { expect, test } from "@playwright/test";
import { getCookies } from "better-auth/cookies";

import { parseServerEnv } from "../../src/config/env.schema";
import { buildAuthOptions } from "../../src/server/auth/options";
import { assertTestAuthenticationEnvironment } from "../support/test-auth-guard";

const validProductionEnvironment = {
  DATABASE_URL: "postgresql://careerops:local@database.internal:5432/careerops",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "sQ9wX2mN7vK4pL8rT6yH3cF5jD1zB0aE",
  BETTER_AUTH_URL: "https://careerops.invalid",
  AUTH_TRUSTED_ORIGINS: "https://careerops.invalid",
  GOOGLE_CLIENT_ID: "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-abcdefghijklmnopqrstuvwxyz123456",
  DEVELOPMENT_SEED_ENABLED: "false",
  DEVELOPMENT_IDENTITY_ENABLED: "false",
};

test("uses exact production session-cookie semantics", () => {
  const env = parseServerEnv(validProductionEnvironment);
  const cookie = getCookies(buildAuthOptions(env)).sessionToken;

  expect(cookie.name).toBe("__Host-careerops.session_token");
  expect(cookie.attributes).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  expect(cookie.attributes.domain).toBeUndefined();
});

test("uses only the validated application trusted-origin allowlist", () => {
  const env = parseServerEnv(validProductionEnvironment);
  expect(buildAuthOptions(env).trustedOrigins).toEqual(["https://careerops.invalid"]);
  expect(() =>
    parseServerEnv({
      ...validProductionEnvironment,
      BETTER_AUTH_TRUSTED_ORIGINS: "https://attacker.invalid",
    }),
  ).toThrow(/AUTH_TRUSTED_ORIGINS exclusively/);
});

test("rejects development and test authentication in production", () => {
  expect(() =>
    parseServerEnv({ ...validProductionEnvironment, DEVELOPMENT_IDENTITY_ENABLED: "true" }),
  ).toThrow(/has been removed/);
  expect(() => assertTestAuthenticationEnvironment("production")).toThrow(
    /unavailable in production/,
  );
});

test("keeps provider credentials outside production cookie configuration", () => {
  const env = parseServerEnv(validProductionEnvironment);
  const serializedCookies = JSON.stringify(getCookies(buildAuthOptions(env)));

  expect(serializedCookies).not.toContain(validProductionEnvironment.GOOGLE_CLIENT_ID);
  expect(serializedCookies).not.toContain(validProductionEnvironment.GOOGLE_CLIENT_SECRET);
  expect(serializedCookies).not.toContain(validProductionEnvironment.BETTER_AUTH_SECRET);
});
