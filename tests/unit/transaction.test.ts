import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { runSerializableTransaction } from "@/server/db/transaction";

vi.mock("@/server/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const transactionClient = {} as Prisma.TransactionClient;

function conflict() {
  return Object.assign(new Error("serialization conflict"), { code: "P2034" });
}

describe("serializable transaction retries", () => {
  it("replays full work after two conflicts and succeeds on the third attempt", async () => {
    let attempt = 0;
    const callback = vi.fn(async () => `completed-${attempt}`);
    const workByAttempt: string[][] = [];

    const result = await runSerializableTransaction(callback, async (operation) => {
      attempt += 1;
      const work = ["begin"];
      workByAttempt.push(work);
      const value = await operation(transactionClient);
      work.push("complete");
      if (attempt < 3) throw conflict();
      return value;
    });

    expect(result).toBe("completed-3");
    expect(callback).toHaveBeenCalledTimes(3);
    expect(workByAttempt).toEqual([
      ["begin", "complete"],
      ["begin", "complete"],
      ["begin", "complete"],
    ]);
  });

  it("propagates the third conflict without a fourth attempt", async () => {
    const callback = vi.fn(async () => undefined);
    const execute = vi.fn(
      async (operation: (tx: Prisma.TransactionClient) => Promise<undefined>) => {
        await operation(transactionClient);
        throw conflict();
      },
    );

    await expect(runSerializableTransaction(callback, execute)).rejects.toMatchObject({
      code: "P2034",
    });
    expect(callback).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-P2034 error immediately", async () => {
    const callback = vi.fn(async () => undefined);
    const failure = Object.assign(new Error("unique constraint"), { code: "P2002" });
    const execute = vi.fn(
      async (operation: (tx: Prisma.TransactionClient) => Promise<undefined>) => {
        await operation(transactionClient);
        throw failure;
      },
    );

    await expect(runSerializableTransaction(callback, execute)).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
