import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

const secretState = vi.hoisted(() => ({
  value: "synthetic-retrieval-diagnostics-secret-a",
}));

vi.mock("@/config/env.server", () => ({
  env: {
    get BETTER_AUTH_SECRET() {
      return secretState.value;
    },
  },
}));

import { hashRetrievalDiagnosticQuery } from "@/modules/retrieval/diagnostic-query-hmac.server";
import { retrievalQuerySchema } from "@/modules/retrieval/schemas";

describe("retrieval diagnostic query HMAC", () => {
  it("is deterministic, normalized, tenant-separated, keyed, and lowercase hex", () => {
    secretState.value = "synthetic-retrieval-diagnostics-secret-a";
    const firstNormalized = retrievalQuerySchema.parse("  Odoo\t automation  ");
    const secondNormalized = retrievalQuerySchema.parse("Odoo automation");
    const first = hashRetrievalDiagnosticQuery("user-a", firstNormalized);
    const second = hashRetrievalDiagnosticQuery("user-a", secondNormalized);

    expect(firstNormalized).toBe(secondNormalized);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashRetrievalDiagnosticQuery("user-b", secondNormalized)).not.toBe(first);
    expect(hashRetrievalDiagnosticQuery("user-a", "Odoo implementation")).not.toBe(first);
    expect(first).not.toBe(createHash("sha256").update(secondNormalized, "utf8").digest("hex"));
  });

  it("changes when the server secret rotates", () => {
    secretState.value = "synthetic-retrieval-diagnostics-secret-a";
    const beforeRotation = hashRetrievalDiagnosticQuery("user-a", "normalized query");
    secretState.value = "synthetic-retrieval-diagnostics-secret-b";
    const afterRotation = hashRetrievalDiagnosticQuery("user-a", "normalized query");

    expect(afterRotation).not.toBe(beforeRotation);
  });

  it("rejects invalid coordinates without reflecting sensitive input", () => {
    secretState.value = "synthetic-retrieval-diagnostics-secret-a";
    expect(() => hashRetrievalDiagnosticQuery("", "private query")).toThrow(
      "Retrieval diagnostic coordinates are invalid.",
    );
    expect(() => hashRetrievalDiagnosticQuery("user-a", "private\0query")).toThrow(
      "Retrieval diagnostic coordinates are invalid.",
    );
  });

  it("is explicitly server-only", () => {
    const source = readFileSync(
      new URL("../../src/modules/retrieval/diagnostic-query-hmac.server.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import "server-only";');
  });
});
