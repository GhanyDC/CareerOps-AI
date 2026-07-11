import "server-only";

import { getExperience } from "./repository";

export function findOwnedExperienceSource(userId: string, id: string) {
  return getExperience(userId, id);
}
