import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env.server", () => ({
  env: { BETTER_AUTH_SECRET: "unit-test-discovery-secret-0123456789" },
}));

import {
  createDiscoveryPreviewToken,
  discoverySessionBinding,
  verifyDiscoveryPreviewToken,
} from "@/modules/discovery/preview-token.server";
import { DiscoveryError } from "@/modules/discovery/errors";

const context = {
  userId: "trusted-user",
  sessionId: "trusted-session",
  identityMode: "authenticated",
} as const;
const draft = {
  contractVersion: 1,
  importMethod: "MANUAL_ENTRY",
  rawText: "Raw preview content",
} as const;
const issued = new Date("2026-07-13T00:00:00.000Z");

describe("discovery preview tokens", () => {
  it("uses two base64url segments and verifies a strict signed payload", () => {
    const token = createDiscoveryPreviewToken(context, draft, issued);
    const segments = token.split(".");
    expect(segments).toHaveLength(2);
    expect(segments[1]).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyDiscoveryPreviewToken(context, token, issued)).toMatchObject({ draft });
    expect(discoverySessionBinding(context.sessionId)).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(context.sessionId);
  });

  it("rejects mutation, another user, and another session with one safe code", () => {
    const token = createDiscoveryPreviewToken(context, draft, issued);
    const [payload, signature] = token.split(".");
    const mutated = `${payload}A.${signature}`;
    for (const [candidateContext, candidateToken] of [
      [context, mutated],
      [{ ...context, userId: "other-user" }, token],
      [{ ...context, sessionId: "other-session" }, token],
    ] as const) {
      expect(() =>
        verifyDiscoveryPreviewToken(candidateContext, candidateToken, issued),
      ).toThrowError(expect.objectContaining({ code: "INVALID_PREVIEW_TOKEN" }));
    }
  });

  it("rejects expiry and unreasonable future issuance", () => {
    const token = createDiscoveryPreviewToken(context, draft, issued);
    expect(() =>
      verifyDiscoveryPreviewToken(context, token, new Date("2026-07-13T00:15:01.000Z")),
    ).toThrowError(expect.objectContaining({ code: "PREVIEW_EXPIRED" }));

    const future = createDiscoveryPreviewToken(
      context,
      draft,
      new Date("2026-07-13T00:02:00.000Z"),
    );
    expect(() => verifyDiscoveryPreviewToken(context, future, issued)).toThrow(DiscoveryError);
  });
});
