import "server-only";

import { createHmac } from "node:crypto";

import { env } from "@/config/env.server";

const RETRIEVAL_DIAGNOSTICS_KEY_DOMAIN = "careerops:retrieval-query-diagnostics:v1";
const invalidCoordinatesMessage = "Retrieval diagnostic coordinates are invalid.";

function derivedRetrievalDiagnosticsKey() {
  return createHmac("sha256", Buffer.from(env.BETTER_AUTH_SECRET, "utf8"))
    .update(RETRIEVAL_DIAGNOSTICS_KEY_DOMAIN, "utf8")
    .digest();
}

export function hashRetrievalDiagnosticQuery(userId: string, normalizedQuery: string) {
  if (!userId || userId.includes("\0") || !normalizedQuery || normalizedQuery.includes("\0")) {
    throw new Error(invalidCoordinatesMessage);
  }

  return createHmac("sha256", derivedRetrievalDiagnosticsKey())
    .update(userId, "utf8")
    .update("\0", "utf8")
    .update(normalizedQuery, "utf8")
    .digest("hex");
}
