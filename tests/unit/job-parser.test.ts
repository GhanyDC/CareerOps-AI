import { describe, expect, it } from "vitest";

import { hashDiscoveryParsingSource, parseJobDiscovery } from "@/modules/job-parsing/parser";
import { emptyJobValues } from "@/modules/jobs/schemas";

function source(rawContent = "Ordinary plain-text job description") {
  return {
    id: "discovery-1",
    batchId: "batch-1",
    status: "INBOX" as const,
    sourceLabel: "LinkedIn",
    submittedUrl: "https://example.com/job",
    titleHint: " Backend  Developer ",
    companyHint: " Example  Company ",
    locationHint: " Remote ",
    discoveredAt: new Date("2026-07-15T00:00:00.000Z"),
    rawContent,
    batch: { payloadHash: "a".repeat(64), contractVersion: 1, importMethod: "PASTED_TEXT" },
  };
}

describe("deterministic Job parser", () => {
  it("projects explicit hints but does not infer from plain text", () => {
    const parsed = parseJobDiscovery(source("Senior role with generous salary and hybrid work"));
    expect(parsed.parsedPayload.job).toMatchObject({
      title: "Backend Developer",
      companyName: "Example Company",
      locationLabel: "Remote",
      sourceUrl: "https://example.com/job",
      salaryMin: null,
      workplaceArrangement: null,
      experienceLevel: null,
      description: null,
    });
    expect(parsed.validationSummary.parserMode).toBe("SOURCE_HINTS_ONLY");
  });

  it("parses only a complete strict structured contract", () => {
    const rawContent = JSON.stringify({
      contractVersion: 1,
      job: { ...emptyJobValues(), title: "Structured title", skills: ["TypeScript"] },
    });
    const parsed = parseJobDiscovery(source(rawContent));
    expect(parsed.parsedPayload.job.title).toBe("Structured title");
    expect(parsed.parsedPayload.job.skills).toEqual(["TypeScript"]);
    expect(parsed.validationSummary.parserMode).toBe("STRUCTURED_JSON");
    expect(parsed.validationSummary.warningCodes).toContain("SOURCE_CONFLICT_title");
  });

  it("uses no fields from malformed structured JSON", () => {
    const parsed = parseJobDiscovery(source('{"contractVersion":1,"job":{"title":"Partial"}}'));
    expect(parsed.parsedPayload.job.title).toBe("Backend Developer");
    expect(parsed.validationSummary.warningCodes).toContain("STRUCTURED_CONTRACT_INVALID");
  });

  it("produces a stable source hash that changes with raw content", () => {
    expect(hashDiscoveryParsingSource(source())).toBe(hashDiscoveryParsingSource(source()));
    expect(hashDiscoveryParsingSource(source("A"))).not.toBe(
      hashDiscoveryParsingSource(source("B")),
    );
  });
});
