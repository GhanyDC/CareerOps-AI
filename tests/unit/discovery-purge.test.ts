import { describe, expect, it } from "vitest";

import { expectedPurgeConfirmation, shortBatchId } from "@/modules/discovery/purge";

describe("discovery privacy purge confirmation", () => {
  it("derives an exact case-sensitive phrase from the last eight batch-id characters", () => {
    const id = "cm1234567890abcdefgh";
    expect(shortBatchId(id)).toBe("abcdefgh");
    expect(expectedPurgeConfirmation(id)).toBe("DELETE IMPORT abcdefgh");
    expect(expectedPurgeConfirmation(id)).not.toBe("delete import abcdefgh");
  });
});
