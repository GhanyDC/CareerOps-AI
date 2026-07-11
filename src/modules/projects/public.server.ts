import "server-only";

import { getProject } from "./repository";

export function findOwnedProjectSource(userId: string, id: string) {
  return getProject(userId, id);
}
