import type { JobDiscoveryStatus, Prisma } from "@/generated/prisma/client";
import { DISCOVERY_VALIDATOR_VERSION } from "./schemas";

export function batchConfirmedMetadata(contractVersion: 1, discoveryCount: number) {
  return { contractVersion, discoveryCount } satisfies Prisma.InputJsonValue;
}

export function discoveryImportedMetadata() {
  return { validatorVersion: DISCOVERY_VALIDATOR_VERSION } satisfies Prisma.InputJsonValue;
}

export function transitionMetadata(versionFrom: number, versionTo: number) {
  return { versionFrom, versionTo } satisfies Prisma.InputJsonValue;
}

export function transitionEventType(from: JobDiscoveryStatus, to: JobDiscoveryStatus) {
  if (to === "REJECTED") return "DISCOVERY_REJECTED" as const;
  if (to === "ARCHIVED") return "DISCOVERY_ARCHIVED" as const;
  if (to === "INBOX" && (from === "REJECTED" || from === "ARCHIVED")) {
    return "DISCOVERY_RESTORED" as const;
  }
  throw new Error("Unsupported discovery transition event");
}
