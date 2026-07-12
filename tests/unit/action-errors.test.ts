import { describe, expect, it, vi } from "vitest";

import {
  executeServerMutation,
  reportUnexpectedServerError,
  toActionError,
} from "@/modules/shared/action-errors.server";
import { DomainError } from "@/modules/shared/errors";
import { UnauthenticatedError } from "@/server/auth/errors";

describe("server action error reporting", () => {
  it("returns a stable session-required response without logging", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(toActionError(new UnauthenticatedError(), "evidence.update")).toEqual({
      status: "error",
      code: "SESSION_REQUIRED",
      message: "Your session expired. Sign in again.",
    });
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });

  it("reports only safe operational metadata", () => {
    const report = vi.fn();
    const correlationId = reportUnexpectedServerError("evidence.update", report);

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      "Unexpected server action failure",
      expect.objectContaining({
        category: "unexpected_server_error",
        operation: "evidence.update",
        correlationId,
        timestamp: expect.any(String),
      }),
    );
  });

  it("does not log raw unexpected errors or expose them to the client", () => {
    const secret = "postgresql://user:password@example.invalid/private";
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = toActionError(new Error(secret), "claim.update");

    expect(response.status).toBe("error");
    expect(response.message).toMatch(/^The request could not be completed safely\. Reference: /);

    const serializedLog = JSON.stringify(logger.mock.calls);
    expect(serializedLog).not.toContain(secret);
    expect(serializedLog).not.toContain("password");
    expect(serializedLog).toContain("claim.update");
    logger.mockRestore();
  });

  it("preserves understandable domain errors without logging them", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(toActionError(new DomainError("Revoke verification before editing."))).toEqual({
      status: "error",
      message: "Revoke verification before editing.",
    });
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });

  it.each(["evidence.transition", "evidence.delete", "claim.transition", "experience.delete"])(
    "redacts unexpected metadata for the %s mutation boundary",
    async (operation) => {
      const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const prismaLikeError = Object.assign(new Error("raw SQL and submitted values"), {
        code: "P2002",
        meta: { target: ["secret-token"] },
        clientVersion: "7.8.0",
      });

      const result = await executeServerMutation(operation, async () => {
        throw prismaLikeError;
      });

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("raw SQL");
      expect(result.message).not.toContain("secret-token");
      const serializedLog = JSON.stringify(logger.mock.calls);
      expect(serializedLog).toContain(operation);
      expect(serializedLog).not.toContain("raw SQL");
      expect(serializedLog).not.toContain("secret-token");
      expect(serializedLog).not.toContain("P2002");
      logger.mockRestore();
    },
  );
});
