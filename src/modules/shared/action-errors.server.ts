import "server-only";

import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import type { ActionState } from "./action-state";
import { DomainError } from "./errors";
import { isSessionRequiredError } from "@/server/auth/errors";

type SafeErrorReport = Readonly<{
  category: "unexpected_server_error";
  operation: string;
  timestamp: string;
  correlationId: string;
}>;

export function reportUnexpectedServerError(
  operation: string,
  report: (message: string, details: SafeErrorReport) => void = console.error,
) {
  const details: SafeErrorReport = {
    category: "unexpected_server_error",
    operation,
    timestamp: new Date().toISOString(),
    correlationId: randomUUID(),
  };

  report("Unexpected server action failure", details);
  return details.correlationId;
}

export function toActionError(error: unknown, operation = "server_action"): ActionState {
  if (isSessionRequiredError(error)) {
    return {
      status: "error",
      code: "SESSION_REQUIRED",
      message: "Your session expired. Sign in again.",
    };
  }

  if (error instanceof ZodError) {
    const flattened = error.flatten();
    return {
      status: "error",
      message: "Review the highlighted values and try again.",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }

  if (error instanceof DomainError) {
    return { status: "error", message: error.message };
  }

  const correlationId = reportUnexpectedServerError(operation);
  return {
    status: "error",
    message: `The request could not be completed safely. Reference: ${correlationId}.`,
  };
}

export async function executeServerMutation(
  operation: string,
  mutation: () => Promise<void>,
): Promise<ActionState> {
  try {
    await mutation();
    return { status: "idle" };
  } catch (error) {
    return toActionError(error, operation);
  }
}
