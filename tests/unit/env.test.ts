import { describe, expect, it } from "vitest";

import { parseServerEnv } from "../../src/config/env.schema";

const validDatabaseUrl =
  "postgresql://careerops:careerops_local_only@localhost:55432/careerops?schema=public";

describe("parseServerEnv", () => {
  it("parses a valid environment", () => {
    expect(
      parseServerEnv({
        DATABASE_URL: validDatabaseUrl,
        NODE_ENV: "test",
      }),
    ).toEqual({
      DATABASE_URL: validDatabaseUrl,
      NODE_ENV: "test",
    });
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseServerEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "https://example.com/database", NODE_ENV: "test" }),
    ).toThrow(/postgresql:\/\//);
  });

  it.each(["development", "test", "production"] as const)("accepts NODE_ENV=%s", (nodeEnv) => {
    expect(parseServerEnv({ DATABASE_URL: validDatabaseUrl, NODE_ENV: nodeEnv }).NODE_ENV).toBe(
      nodeEnv,
    );
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseServerEnv({ DATABASE_URL: validDatabaseUrl, NODE_ENV: "staging" })).toThrow(
      /NODE_ENV/,
    );
  });
});
