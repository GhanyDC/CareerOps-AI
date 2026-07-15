import "server-only";

import { createHash } from "node:crypto";

import { DiscoveryError } from "./errors";
import {
  DISCOVERY_VALIDATOR_VERSION,
  MAX_CANONICAL_PAYLOAD_BYTES,
  type DiscoveryBatchValidationSummaryV1,
  type DiscoveryDraftV1,
  type DiscoveryValidationSummaryV1,
  type ManualDiscoveryDraftV1,
  normalizePresentationValue,
  type PastedDiscoveryDraftV1,
  type StructuredDiscoveryImportV1,
} from "./schemas";

function put(object: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) object[key] = value;
}

function canonicalSingle(draft: ManualDiscoveryDraftV1 | PastedDiscoveryDraftV1) {
  const value: Record<string, unknown> = {
    contractVersion: draft.contractVersion,
    importMethod: draft.importMethod,
  };
  put(value, "sourceLabel", draft.sourceLabel);
  put(value, "sourceUrl", draft.sourceUrl);
  put(value, "titleHint", draft.titleHint);
  put(value, "companyHint", draft.companyHint);
  put(value, "locationHint", draft.locationHint);
  put(value, "discoveredAt", draft.discoveredAt);
  value.rawText = draft.rawText;
  return value;
}

function canonicalStructured(draft: StructuredDiscoveryImportV1) {
  const value: Record<string, unknown> = { schemaVersion: draft.schemaVersion };
  put(value, "producerLabel", draft.producerLabel);
  put(value, "discoveredAt", draft.discoveredAt);
  value.discoveries = draft.discoveries.map((discovery) => {
    const item: Record<string, unknown> = {};
    put(item, "sourceLabel", discovery.sourceLabel);
    put(item, "sourceUrl", discovery.sourceUrl);
    put(item, "titleHint", discovery.titleHint);
    put(item, "companyHint", discovery.companyHint);
    put(item, "locationHint", discovery.locationHint);
    item.rawText = discovery.rawText;
    return item;
  });
  return value;
}

export function serializeCanonicalDiscoveryPayload(draft: DiscoveryDraftV1) {
  const canonical = "importMethod" in draft ? canonicalSingle(draft) : canonicalStructured(draft);
  const originalPayload = JSON.stringify(canonical);
  const totalPayloadBytes = Buffer.byteLength(originalPayload, "utf8");
  if (totalPayloadBytes > MAX_CANONICAL_PAYLOAD_BYTES) {
    throw new DiscoveryError("PAYLOAD_TOO_LARGE", "The import payload is too large.");
  }
  return {
    originalPayload,
    totalPayloadBytes,
    payloadHash: createHash("sha256").update(originalPayload, "utf8").digest("hex"),
  };
}

type PreparedDiscovery = Readonly<{
  sourceLabel?: string;
  submittedUrl?: string;
  titleHint?: string;
  companyHint?: string;
  locationHint?: string;
  discoveredAt?: Date;
  rawContent: string;
  validationSummary: DiscoveryValidationSummaryV1;
}>;

export type PreparedDiscoveryImport = Readonly<{
  importMethod: "MANUAL_ENTRY" | "PASTED_TEXT" | "STRUCTURED_JSON";
  producerLabel: string;
  contractVersion: 1;
  originalPayload: string;
  payloadHash: string;
  validationSummary: DiscoveryBatchValidationSummaryV1;
  discoveries: readonly PreparedDiscovery[];
}>;

function prepareDiscovery(
  value: {
    sourceLabel?: string;
    sourceUrl?: string;
    titleHint?: string;
    companyHint?: string;
    locationHint?: string;
    rawText: string;
  },
  discoveredAt?: string,
): PreparedDiscovery {
  return {
    sourceLabel: normalizePresentationValue(value.sourceLabel),
    submittedUrl: value.sourceUrl,
    titleHint: normalizePresentationValue(value.titleHint),
    companyHint: normalizePresentationValue(value.companyHint),
    locationHint: normalizePresentationValue(value.locationHint),
    discoveredAt: discoveredAt ? new Date(discoveredAt) : undefined,
    rawContent: value.rawText,
    validationSummary: {
      rawContentBytes: Buffer.byteLength(value.rawText, "utf8"),
      urlValidated: value.sourceUrl !== undefined,
      controlCharacterCheck: "PASSED",
    },
  };
}

export function prepareDiscoveryImport(draft: DiscoveryDraftV1): PreparedDiscoveryImport {
  const serialized = serializeCanonicalDiscoveryPayload(draft);
  const structured = !("importMethod" in draft);
  const discoveries = structured
    ? draft.discoveries.map((discovery) => prepareDiscovery(discovery, draft.discoveredAt))
    : [prepareDiscovery(draft, draft.discoveredAt)];

  return {
    importMethod: structured ? "STRUCTURED_JSON" : draft.importMethod,
    producerLabel: structured
      ? (normalizePresentationValue(draft.producerLabel) ?? "Imported JSON")
      : draft.importMethod === "MANUAL_ENTRY"
        ? "Manual Entry"
        : "Pasted Text",
    contractVersion: 1,
    originalPayload: serialized.originalPayload,
    payloadHash: serialized.payloadHash,
    validationSummary: {
      validatorVersion: DISCOVERY_VALIDATOR_VERSION,
      discoveryCount: discoveries.length,
      totalPayloadBytes: serialized.totalPayloadBytes,
    },
    discoveries,
  };
}
