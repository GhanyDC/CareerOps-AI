import "server-only";

import { getEvidenceItem } from "./repository";

export function findOwnedEvidence(userId: string, id: string) {
  return getEvidenceItem(userId, id);
}
