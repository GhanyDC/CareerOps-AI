import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "./client";

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isRetryableTransactionConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && (error as { code?: unknown }).code === "P2034") return true;

  // Driver adapters can surface PostgreSQL serialization/deadlock failures before
  // Prisma normalizes them to P2034. Keep the retry boundary provider-neutral.
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: { kind?: unknown; message?: unknown };
    meta?: { code?: unknown };
  };
  return (
    (candidate.code === "P2010" &&
      (candidate.meta?.code === "40001" || candidate.meta?.code === "40P01")) ||
    candidate.cause?.kind === "TransactionWriteConflict" ||
    [candidate.message, candidate.cause?.message].some(
      (message) =>
        typeof message === "string" &&
        (message.includes("TransactionWriteConflict") ||
          message.includes("write conflict or a deadlock")),
    )
  );
}

export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  execute: (operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> = (
    transaction,
  ) => prisma.$transaction(transaction, { isolationLevel: "Serializable" }),
) {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await execute(operation);
    } catch (error) {
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS || !isRetryableTransactionConflict(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 5));
    }
  }

  throw new Error("Serializable transaction retry limit reached.");
}
