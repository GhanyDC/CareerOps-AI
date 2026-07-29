import { createHash } from "node:crypto";

import type { RequirementImportance, RequirementSupportLevel } from "./schemas";
import { REQUIREMENT_MATCH_SCHEMA_VERSION } from "./schemas";

export type RequirementMatchStatus =
  "NOT_REVIEWED" | "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED";

export type RequirementFreshness = "NOT_REVIEWED" | "CURRENT" | "STALE";

export type RequirementStaleReason =
  | "REQUIREMENT_VERSION_CHANGED"
  | "MATCH_SCHEMA_VERSION_CHANGED"
  | "LINK_SET_VERSION_CHANGED"
  | "LINK_SET_HASH_CHANGED"
  | "EVIDENCE_VERSION_CHANGED";

type LinkForStatus = Readonly<{ supportLevel: RequirementSupportLevel }>;

type LinkForHash = Readonly<{
  evidenceItemId: string;
  supportLevel: RequirementSupportLevel;
  rationale: string | null;
}>;

type LinkForFreshness = LinkForHash &
  Readonly<{
    reviewedEvidenceVersion: number | null;
    evidence: Readonly<{ version: number }>;
  }>;

export type RequirementAssessmentInput = Readonly<{
  version: number;
  matchSetVersion: number;
  evidenceLinks: readonly LinkForFreshness[];
  review: Readonly<{
    status: Exclude<RequirementMatchStatus, "NOT_REVIEWED">;
    reviewedRequirementVersion: number;
    reviewedMatchSetVersion: number;
    matchSchemaVersion: number;
    linkSetHash: string;
  }> | null;
}>;

export type RequirementAssessment = Readonly<{
  freshness: RequirementFreshness;
  status: RequirementMatchStatus;
  staleReasons: readonly RequirementStaleReason[];
}>;

export function deriveRequirementStatus(
  reviewCompleted: boolean,
  links: readonly LinkForStatus[],
): RequirementMatchStatus {
  if (!reviewCompleted) return "NOT_REVIEWED";
  if (links.some((link) => link.supportLevel === "FULL")) return "SUPPORTED";
  if (links.some((link) => link.supportLevel === "PARTIAL")) return "PARTIALLY_SUPPORTED";
  return "UNSUPPORTED";
}

export function assertRequirementStatusConsistent(
  status: Exclude<RequirementMatchStatus, "NOT_REVIEWED">,
  links: readonly LinkForStatus[],
) {
  const derived = deriveRequirementStatus(true, links);
  if (status !== derived) {
    throw new Error(`Requirement review status ${status} is inconsistent with ${derived}.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function hashRequirementLinkSet(links: readonly LinkForHash[]) {
  const canonical = [...links]
    .sort((left, right) =>
      left.evidenceItemId < right.evidenceItemId
        ? -1
        : left.evidenceItemId > right.evidenceItemId
          ? 1
          : 0,
    )
    .map((link) => {
      const evidenceItemId = `${Buffer.byteLength(link.evidenceItemId, "utf8")}:${
        link.evidenceItemId
      }`;
      const supportLevel = link.supportLevel === "FULL" ? "F" : "P";
      const rationale =
        link.rationale === null
          ? "-1:"
          : `${Buffer.byteLength(link.rationale, "utf8")}:${link.rationale}`;
      return `${evidenceItemId}${supportLevel}${rationale}`;
    })
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function hashRequirementOrder(
  requirements: readonly Readonly<{ id: string; position: number }>[],
) {
  return sha256(
    [...requirements]
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map(({ id, position }) => ({ id, position })),
  );
}

export function assessRequirement(input: RequirementAssessmentInput): RequirementAssessment {
  if (!input.review) {
    return { freshness: "NOT_REVIEWED", status: "NOT_REVIEWED", staleReasons: [] };
  }

  const reasons: RequirementStaleReason[] = [];
  if (input.review.reviewedRequirementVersion !== input.version) {
    reasons.push("REQUIREMENT_VERSION_CHANGED");
  }
  if (input.review.matchSchemaVersion !== REQUIREMENT_MATCH_SCHEMA_VERSION) {
    reasons.push("MATCH_SCHEMA_VERSION_CHANGED");
  }
  if (input.review.reviewedMatchSetVersion !== input.matchSetVersion) {
    reasons.push("LINK_SET_VERSION_CHANGED");
  }
  if (input.review.linkSetHash !== hashRequirementLinkSet(input.evidenceLinks)) {
    reasons.push("LINK_SET_HASH_CHANGED");
  }
  if (
    input.evidenceLinks.some(
      (link) =>
        link.reviewedEvidenceVersion === null ||
        link.reviewedEvidenceVersion !== link.evidence.version,
    )
  ) {
    reasons.push("EVIDENCE_VERSION_CHANGED");
  }

  return {
    freshness: reasons.length === 0 ? "CURRENT" : "STALE",
    status: input.review.status,
    staleReasons: reasons,
  };
}

export type CoverageCounts = Readonly<{
  supported: number;
  partiallySupported: number;
  unsupported: number;
  notReviewed: number;
  stale: number;
  total: number;
}>;

export type CoverageByImportance = Readonly<Record<RequirementImportance, CoverageCounts>>;

export function emptyCoverageCounts(): CoverageCounts {
  return {
    supported: 0,
    partiallySupported: 0,
    unsupported: 0,
    notReviewed: 0,
    stale: 0,
    total: 0,
  };
}

export function summarizeRequirementCoverage(
  requirements: readonly Readonly<{
    importance: RequirementImportance;
    assessment: RequirementAssessment;
  }>[],
): CoverageByImportance {
  const mutable: Record<RequirementImportance, ReturnType<typeof emptyCoverageCounts>> = {
    REQUIRED: emptyCoverageCounts(),
    PREFERRED: emptyCoverageCounts(),
    OTHER: emptyCoverageCounts(),
  };

  for (const requirement of requirements) {
    const current = mutable[requirement.importance];
    const next = { ...current, total: current.total + 1 };
    if (requirement.assessment.freshness === "STALE") next.stale += 1;
    else if (requirement.assessment.status === "SUPPORTED") next.supported += 1;
    else if (requirement.assessment.status === "PARTIALLY_SUPPORTED") next.partiallySupported += 1;
    else if (requirement.assessment.status === "UNSUPPORTED") next.unsupported += 1;
    else next.notReviewed += 1;
    mutable[requirement.importance] = next;
  }

  return mutable;
}
