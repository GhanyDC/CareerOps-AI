import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  prepareDiscoveryImport,
  serializeCanonicalDiscoveryPayload,
} from "@/modules/discovery/canonical-payload";

describe("discovery canonical payloads", () => {
  it("serializes manual properties exactly and preserves originals before presentation normalization", () => {
    const prepared = prepareDiscoveryImport({
      contractVersion: 1,
      importMethod: "MANUAL_ENTRY",
      sourceLabel: " LinkedIn  Jobs ",
      sourceUrl: "https://example.com/jobs/1?ref=manual",
      titleHint: " Backend  Developer ",
      rawText: "Line one\nLine two",
    });
    const expected =
      '{"contractVersion":1,"importMethod":"MANUAL_ENTRY","sourceLabel":" LinkedIn  Jobs ","sourceUrl":"https://example.com/jobs/1?ref=manual","titleHint":" Backend  Developer ","rawText":"Line one\\nLine two"}';
    expect(prepared.originalPayload).toBe(expected);
    expect(prepared.discoveries[0]).toMatchObject({
      sourceLabel: "LinkedIn Jobs",
      titleHint: "Backend Developer",
      submittedUrl: "https://example.com/jobs/1?ref=manual",
      rawContent: "Line one\nLine two",
    });
    expect(prepared.payloadHash).toBe(createHash("sha256").update(expected).digest("hex"));
  });

  it("serializes pasted and structured payloads in the approved order", () => {
    expect(
      serializeCanonicalDiscoveryPayload({
        contractVersion: 1,
        importMethod: "PASTED_TEXT",
        rawText: "Pasted record",
      }).originalPayload,
    ).toBe('{"contractVersion":1,"importMethod":"PASTED_TEXT","rawText":"Pasted record"}');

    const prepared = prepareDiscoveryImport({
      schemaVersion: 1,
      producerLabel: " ChatGPT  Work ",
      discoveredAt: "2026-07-13T08:00:00Z",
      discoveries: [
        {
          sourceLabel: "LinkedIn",
          sourceUrl: "https://example.com/job",
          companyHint: "Example",
          rawText: "Raw",
        },
      ],
    });
    expect(prepared.originalPayload).toBe(
      '{"schemaVersion":1,"producerLabel":" ChatGPT  Work ","discoveredAt":"2026-07-13T08:00:00Z","discoveries":[{"sourceLabel":"LinkedIn","sourceUrl":"https://example.com/job","companyHint":"Example","rawText":"Raw"}]}',
    );
    expect(prepared.producerLabel).toBe("ChatGPT Work");
    expect(prepared.discoveries[0]?.discoveredAt?.toISOString()).toBe("2026-07-13T08:00:00.000Z");
  });

  it("constructs strict summaries without user content", () => {
    const prepared = prepareDiscoveryImport({
      contractVersion: 1,
      importMethod: "MANUAL_ENTRY",
      sourceUrl: "https://secret-looking.example/token",
      titleHint: "Private title",
      rawText: "Private raw text",
    });
    expect(prepared.validationSummary).toEqual({
      validatorVersion: "discovery-import-v1",
      discoveryCount: 1,
      totalPayloadBytes: Buffer.byteLength(prepared.originalPayload),
    });
    expect(prepared.discoveries[0]?.validationSummary).toEqual({
      rawContentBytes: Buffer.byteLength("Private raw text"),
      urlValidated: true,
      controlCharacterCheck: "PASSED",
    });
    const summaries = JSON.stringify([
      prepared.validationSummary,
      prepared.discoveries[0]?.validationSummary,
    ]);
    expect(summaries).not.toContain("Private");
    expect(summaries).not.toContain("secret-looking");
  });
});
