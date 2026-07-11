import "server-only";

import {
  createProjectRecord,
  deleteProjectRecord,
  getProject,
  listProjectOptions,
  listProjects,
} from "./repository";
import { projectInputSchema } from "./schemas";
import { hasMaterialProjectChange } from "./material-change";
import { findOwnedCandidateProfile } from "@/modules/candidate-profile/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";
export { listProjectOptions, listProjects };

export async function viewProject(userId: string, id: string) {
  const project = await getProject(userId, id);
  if (!project) throw new DomainError("Project not found.");
  return project;
}

export async function createProject(userId: string, untrustedInput: unknown) {
  const input = projectInputSchema.parse(untrustedInput);
  const profile = await findOwnedCandidateProfile(userId);
  if (!profile) throw new DomainError("Create the candidate profile before adding projects.");
  return createProjectRecord(userId, profile.id, input);
}

export async function updateProject(userId: string, id: string, untrustedInput: unknown) {
  const input = projectInputSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id_userId: { id, userId } },
      include: {
        evidenceItems: {
          where: { verificationStatus: "VERIFIED" },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!project) throw new DomainError("Project not found.");
    if (project.evidenceItems.length > 0 && hasMaterialProjectChange(project, input)) {
      throw new DomainError(
        "This project supports verified evidence. Revoke verification on dependent evidence before changing authoritative source details.",
      );
    }

    return tx.project.update({ where: { id_userId: { id, userId } }, data: input });
  });
}

export async function deleteProject(userId: string, id: string) {
  const project = await viewProject(userId, id);
  if (project._count.evidenceItems > 0) {
    throw new DomainError(
      "This project has evidence items and cannot be deleted. Remove or re-home that evidence first.",
    );
  }
  return deleteProjectRecord(userId, id);
}
