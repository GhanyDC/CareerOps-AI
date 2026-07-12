import { describe, expect, it, vi } from "vitest";

import { getCookies } from "better-auth/cookies";

import type { ServerEnv } from "@/config/env.schema";
import { InvalidMutationOriginError } from "@/server/auth/errors";
import { buildAuthOptions } from "@/server/auth/options";
import { assertTrustedMutationOrigin } from "@/server/auth/origin";
import { safeReturnPath } from "@/server/auth/redirects";

const productionEnv: ServerEnv = {
  DATABASE_URL: "postgresql://careerops:secret@database.example/careerops",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "production-secret-0123456789012345",
  BETTER_AUTH_URL: "https://careerops.example",
  AUTH_TRUSTED_ORIGINS: ["https://careerops.example"],
  GOOGLE_CLIENT_ID: "production.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "production-google-secret",
  DEVELOPMENT_SEED_ENABLED: false,
};

describe("authentication redirect policy", () => {
  it.each(["/", "/candidate-profile", "/experiences/owned-id", "/evidence?status=VERIFIED"])(
    "accepts protected relative return path %s",
    (path) => expect(safeReturnPath(path)).toBe(path),
  );

  it.each([
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/api/health",
    "/sign-in",
    "%2F%2Fattacker.example",
    "/claims%0d%0aLocation:https://attacker.example",
  ])("rejects unsafe return path %s", (path) => expect(safeReturnPath(path)).toBe("/"));
});

describe("mutation origin policy", () => {
  it("accepts only an exact trusted Origin and matching Host", () => {
    const headers = new Headers({
      origin: "https://careerops.example",
      host: "careerops.example",
    });
    expect(() =>
      assertTrustedMutationOrigin(headers, productionEnv.AUTH_TRUSTED_ORIGINS),
    ).not.toThrow();
  });

  it.each([
    new Headers({ host: "careerops.example" }),
    new Headers({ origin: "https://attacker.example", host: "careerops.example" }),
    new Headers({ origin: "https://careerops.example", host: "spoofed.example" }),
  ])("rejects missing, untrusted, or host-mismatched origins", (headers) => {
    expect(() => assertTrustedMutationOrigin(headers, productionEnv.AUTH_TRUSTED_ORIGINS)).toThrow(
      InvalidMutationOriginError,
    );
  });
});

describe("production cookie policy", () => {
  it("uses the exact host-only secure session cookie", () => {
    const cookie = getCookies(buildAuthOptions(productionEnv)).sessionToken;
    expect(cookie.name).toBe("__Host-careerops.session_token");
    expect(cookie.attributes).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(cookie.attributes.domain).toBeUndefined();
  });

  it("redacts raw authentication logger messages and payloads", () => {
    const logger = buildAuthOptions(productionEnv).logger;
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger?.log?.("error", "raw provider payload", { accessToken: "secret-token" });

    expect(JSON.stringify(report.mock.calls)).toContain("authentication_service");
    expect(JSON.stringify(report.mock.calls)).not.toContain("raw provider payload");
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret-token");
    report.mockRestore();
  });
});
