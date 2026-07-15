import "server-only";

import { createHash } from "node:crypto";

import {
  JOB_CONTRACT_VERSION,
  JOB_FIELD_NAMES,
  JOB_PARSER_VERSION,
  JOB_SOURCE_SERIALIZER_VERSION,
  emptyJobValues,
  normalizeJobSingleLine,
  structuredJobContractSchema,
  type JobFieldName,
  type JobValues,
} from "@/modules/jobs/schemas";

export type DiscoveryParsingSource = Readonly<{
  id: string;
  batchId: string;
  status: "INBOX" | "REJECTED" | "ARCHIVED";
  sourceLabel: string | null;
  submittedUrl: string | null;
  titleHint: string | null;
  companyHint: string | null;
  locationHint: string | null;
  discoveredAt: Date | null;
  rawContent: string;
  batch: Readonly<{ payloadHash: string; contractVersion: number; importMethod: string }>;
}>;

type ProvenanceEntry = Readonly<{
  origin: "EXTRACTED" | "OMITTED";
  sourceKind: "DISCOVERY_FIELD" | "STRUCTURED_KEY" | "NONE";
  sourceRef?: string;
  normalizations?: readonly string[];
  userModified: false;
  reason?: "ABSENT_OR_UNCERTAIN";
}>;

function canonicalSource(source: DiscoveryParsingSource) {
  return JSON.stringify({
    serializerVersion: JOB_SOURCE_SERIALIZER_VERSION,
    discoveryId: source.id,
    batchId: source.batchId,
    batchPayloadHash: source.batch.payloadHash,
    sourceLabel: source.sourceLabel,
    submittedUrl: source.submittedUrl,
    titleHint: source.titleHint,
    companyHint: source.companyHint,
    locationHint: source.locationHint,
    discoveredAt: source.discoveredAt?.toISOString() ?? null,
    rawContent: source.rawContent,
  });
}

export function hashDiscoveryParsingSource(source: DiscoveryParsingSource) {
  return createHash("sha256").update(canonicalSource(source), "utf8").digest("hex");
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hintValue(value: string | null) {
  return value ? normalizeJobSingleLine(value) : null;
}

export function parseJobDiscovery(source: DiscoveryParsingSource) {
  const warnings: string[] = [];
  let parserMode: "SOURCE_HINTS_ONLY" | "STRUCTURED_JSON" = "SOURCE_HINTS_ONLY";
  let values = emptyJobValues();
  const structuredSources = new Set<JobFieldName>();

  if (source.rawContent.trimStart().startsWith("{")) {
    try {
      const candidate = structuredJobContractSchema.safeParse(JSON.parse(source.rawContent));
      if (candidate.success) {
        values = candidate.data.job;
        parserMode = "STRUCTURED_JSON";
        for (const field of JOB_FIELD_NAMES) {
          if (
            values[field] !== null &&
            (!Array.isArray(values[field]) || values[field].length > 0)
          ) {
            structuredSources.add(field);
          }
        }
      } else {
        warnings.push("STRUCTURED_CONTRACT_INVALID");
      }
    } catch {
      warnings.push("STRUCTURED_JSON_INVALID");
    }
  }

  const hints: Partial<Record<JobFieldName, string | null>> = {
    title: hintValue(source.titleHint),
    companyName: hintValue(source.companyHint),
    locationLabel: hintValue(source.locationHint),
    sourceUrl: source.submittedUrl,
  };
  const hintSources: Partial<Record<JobFieldName, string>> = {
    title: "titleHint",
    companyName: "companyHint",
    locationLabel: "locationHint",
    sourceUrl: "submittedUrl",
  };

  for (const field of Object.keys(hints) as JobFieldName[]) {
    const hint = hints[field] ?? null;
    if (hint === null) continue;
    const current = values[field];
    if (current === null) {
      values = { ...values, [field]: hint };
    } else if (!sameValue(current, hint)) {
      warnings.push(`SOURCE_CONFLICT_${field}`);
    }
  }

  const fields: Record<string, ProvenanceEntry> = {};
  for (const field of JOB_FIELD_NAMES) {
    const value = values[field];
    const populated = value !== null && (!Array.isArray(value) || value.length > 0);
    if (!populated) {
      fields[field] = {
        origin: "OMITTED",
        sourceKind: "NONE",
        userModified: false,
        reason: "ABSENT_OR_UNCERTAIN",
      };
    } else if (structuredSources.has(field)) {
      fields[field] = {
        origin: "EXTRACTED",
        sourceKind: "STRUCTURED_KEY",
        sourceRef: `job.${field}`,
        userModified: false,
      };
    } else {
      fields[field] = {
        origin: "EXTRACTED",
        sourceKind: "DISCOVERY_FIELD",
        sourceRef: hintSources[field],
        normalizations:
          field === "title" || field === "companyName" || field === "locationLabel"
            ? ["TRIM", "COLLAPSE_WHITESPACE"]
            : [],
        userModified: false,
      };
    }
  }

  const populatedFields = JOB_FIELD_NAMES.filter((field) => {
    const value = values[field];
    return value !== null && (!Array.isArray(value) || value.length > 0);
  });

  return {
    sourcePayloadHash: hashDiscoveryParsingSource(source),
    parsedPayload: {
      contractVersion: JOB_CONTRACT_VERSION,
      parserVersion: JOB_PARSER_VERSION,
      job: values,
    },
    validationSummary: {
      schemaVersion: 1,
      parserVersion: JOB_PARSER_VERSION,
      sourceSerializerVersion: JOB_SOURCE_SERIALIZER_VERSION,
      parserMode,
      warningCodes: [...new Set(warnings)],
      populatedFields,
    },
    fieldProvenance: { schemaVersion: 1, fields },
    initialCorrections: { schemaVersion: 1, rawInput: {}, values },
  } as const;
}

export function buildCorrectedProvenance(
  parsed: JobValues,
  corrected: JobValues,
  existingProvenance: unknown,
) {
  const existing = existingProvenance as { fields?: Record<string, unknown> };
  const fields: Record<string, unknown> = {};
  for (const field of JOB_FIELD_NAMES) {
    if (sameValue(parsed[field], corrected[field])) {
      fields[field] = existing.fields?.[field] ?? {
        origin: "OMITTED",
        sourceKind: "NONE",
        userModified: false,
        reason: "ABSENT_OR_UNCERTAIN",
      };
    } else {
      fields[field] = {
        origin:
          parsed[field] === null || (Array.isArray(parsed[field]) && parsed[field].length === 0)
            ? "USER_ENTERED"
            : "USER_CORRECTED",
        sourceKind: "CORRECTION",
        sourceRef: `userCorrections.${field}`,
        userModified: true,
      };
    }
  }
  return { schemaVersion: 1, fields };
}
