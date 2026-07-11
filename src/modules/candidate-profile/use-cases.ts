import "server-only";

import { getCandidateProfile, saveCandidateProfile } from "./repository";
import { candidateProfileInputSchema } from "./schemas";

export function viewCandidateProfile(userId: string) {
  return getCandidateProfile(userId);
}

export function updateCandidateProfile(userId: string, untrustedInput: unknown) {
  const input = candidateProfileInputSchema.parse(untrustedInput);
  return saveCandidateProfile(userId, input);
}
