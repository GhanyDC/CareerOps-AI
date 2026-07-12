import "server-only";

import { getCandidateProfile } from "./repository";

export function findOwnedCandidateProfile(userId: string) {
  return getCandidateProfile(userId);
}
