import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "./client";

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isRetryableTransactionConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2034"
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
    }
  }

  throw new Error("Serializable transaction retry limit reached.");
}
