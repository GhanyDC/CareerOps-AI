import { describe, expect, it } from "vitest";

import {
  manualDiscoveryDraftSchema,
  pastedDiscoveryDraftSchema,
  structuredDiscoveryImportSchema,
} from "@/modules/discovery/schemas";

const manual = {
  contractVersion: 1,
  importMethod: "MANUAL_ENTRY",
  sourceLabel: "LinkedIn",
  sourceUrl: "https://example.com/jobs/1",
  titleHint: "Backend Developer",
  companyHint: "Example Company",
  locationHint: "Remote",
  discoveredAt: "2026-07-13T08:00:00Z",
  rawText: "Original raw description",
} as const;

describe("discovery import contracts", () => {
  it("accepts strict manual and pasted single-record contracts", () => {
    expect(manualDiscoveryDraftSchema.parse(manual)).toEqual(manual);
    expect(
      pastedDiscoveryDraftSchema.parse({
        ...manual,
        importMethod: "PASTED_TEXT",
        sourceLabel: "",
      }),
    ).toMatchObject({ importMethod: "PASTED_TEXT", sourceLabel: undefined });
  });

  it("rejects unknown fields, null optionals, and unsupported versions", () => {
    expect(() => manualDiscoveryDraftSchema.parse({ ...manual, unknown: true })).toThrow();
    expect(() => manualDiscoveryDraftSchema.parse({ ...manual, sourceLabel: null })).toThrow();
    expect(() => manualDiscoveryDraftSchema.parse({ ...manual, contractVersion: 2 })).toThrow();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:password@example.com/job",
    " https://example.com/job",
    "https://example.com/job ",
  ])("rejects unsafe or rewritten URL %s", (sourceUrl) => {
    expect(() => manualDiscoveryDraftSchema.parse({ ...manual, sourceUrl })).toThrow();
  });

  it("preserves accepted URL and raw text exactly", () => {
    const rawText = "<script>alert('inert')</script>\r\n\tDescription";
    const parsed = manualDiscoveryDraftSchema.parse({ ...manual, rawText });
    expect(parsed.sourceUrl).toBe(manual.sourceUrl);
    expect(parsed.rawText).toBe(rawText);
  });

  it("rejects prohibited controls, bidi overrides, and whitespace-only raw text", () => {
    expect(() => manualDiscoveryDraftSchema.parse({ ...manual, rawText: " \n\t " })).toThrow();
    expect(() =>
      manualDiscoveryDraftSchema.parse({ ...manual, rawText: "unsafe\u0000" }),
    ).toThrow();
    expect(() =>
      manualDiscoveryDraftSchema.parse({ ...manual, rawText: "unsafe\u202E" }),
    ).toThrow();
  });

  it("accepts 20 structured discoveries, applies a top-level timestamp, and rejects 21", () => {
    const discovery = { sourceLabel: "JobStreet", rawText: "Raw discovery" };
    const input = {
      schemaVersion: 1,
      producerLabel: "ChatGPT Work",
      discoveredAt: "2026-07-13T08:00:00+08:00",
      discoveries: Array.from({ length: 20 }, () => discovery),
    } as const;
    expect(structuredDiscoveryImportSchema.parse(input).discoveries).toHaveLength(20);
    expect(() =>
      structuredDiscoveryImportSchema.parse({
        ...input,
        discoveries: [...input.discoveries, discovery],
      }),
    ).toThrow();
  });

  it("retains identical structured entries without deduplication", () => {
    const discovery = { rawText: "Same raw discovery" };
    const parsed = structuredDiscoveryImportSchema.parse({
      schemaVersion: 1,
      discoveries: [discovery, discovery],
    });
    expect(parsed.discoveries).toHaveLength(2);
  });
});
