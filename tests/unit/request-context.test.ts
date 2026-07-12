import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountUnavailableError,
  SessionExpiredError,
  UnauthenticatedError,
} from "@/server/auth/errors";
import { resolveRequestContext } from "@/server/request-context";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUser: vi.fn(),
  deleteSessions: vi.fn(),
}));

vi.mock("@/server/auth/config", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/server/db/client", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    authSession: { deleteMany: mocks.deleteSessions },
  },
}));
vi.mock("@/config/env.server", () => ({
  env: { AUTH_TRUSTED_ORIGINS: ["https://careerops.example"] },
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

function authenticated(createdAt = new Date("2026-07-01T00:00:00.000Z")) {
  return {
    session: { id: "session-id", userId: "user-id", createdAt },
    user: { id: "user-id" },
  };
}

describe("session-derived request context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(authenticated());
    mocks.findUser.mockResolvedValue({ id: "user-id", status: "ACTIVE" });
    mocks.deleteSessions.mockResolvedValue({ count: 1 });
  });

  it("returns only the internal user and session identifiers", async () => {
    await expect(
      resolveRequestContext(new Headers(), new Date("2026-07-02T00:00:00.000Z")),
    ).resolves.toEqual({
      userId: "user-id",
      sessionId: "session-id",
      identityMode: "authenticated",
    });
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true },
    });
  });

  it("rejects a missing or invalid session before resolving a user", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(resolveRequestContext(new Headers())).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("revokes and rejects a session at the absolute age limit", async () => {
    mocks.getSession.mockResolvedValue(authenticated(new Date("2026-06-01T00:00:00.000Z")));
    await expect(
      resolveRequestContext(new Headers(), new Date("2026-07-01T00:00:00.000Z")),
    ).rejects.toBeInstanceOf(SessionExpiredError);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { id: "session-id" } });
  });

  it.each([null, { id: "user-id", status: "SUSPENDED" }, { id: "user-id", status: "DELETED" }])(
    "rejects a missing or unavailable internal user",
    async (user) => {
      mocks.findUser.mockResolvedValue(user);
      await expect(
        resolveRequestContext(new Headers(), new Date("2026-07-02T00:00:00.000Z")),
      ).rejects.toBeInstanceOf(AccountUnavailableError);
      if (user) expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { userId: "user-id" } });
    },
  );
});
