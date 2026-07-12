import "server-only";

import {
  createExperienceRecord,
  deleteExperienceRecord,
  getExperience,
  listExperienceOptions,
  listExperiences,
} from "./repository";
import { experienceInputSchema } from "./schemas";
import { hasMaterialExperienceChange } from "./material-change";
import { findOwnedCandidateProfile } from "@/modules/candidate-profile/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";
export { listExperienceOptions, listExperiences };

export async function viewExperience(userId: string, id: string) {
  const experience = await getExperience(userId, id);
  if (!experience) throw new DomainError("Experience not found.");
  return experience;
}

export async function createExperience(userId: string, untrustedInput: unknown) {
  const input = experienceInputSchema.parse(untrustedInput);
  const profile = await findOwnedCandidateProfile(userId);
  if (!profile) throw new DomainError("Create the candidate profile before adding experiences.");
  return createExperienceRecord(userId, profile.id, input);
}

export async function updateExperience(userId: string, id: string, untrustedInput: unknown) {
  const input = experienceInputSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const experience = await tx.experience.findUnique({
      where: { id_userId: { id, userId } },
      include: {
        evidenceItems: {
          where: { verificationStatus: "VERIFIED" },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!experience) throw new DomainError("Experience not found.");
    if (experience.evidenceItems.length > 0 && hasMaterialExperienceChange(experience, input)) {
      throw new DomainError(
        "This experience supports verified evidence. Revoke verification on dependent evidence before changing authoritative source details.",
      );
    }

    return tx.experience.update({ where: { id_userId: { id, userId } }, data: input });
  });
}

export async function deleteExperience(userId: string, id: string) {
  const experience = await viewExperience(userId, id);
  if (experience._count.evidenceItems > 0) {
    throw new DomainError(
      "This experience has evidence items and cannot be deleted. Remove or re-home that evidence first.",
    );
  }
  return deleteExperienceRecord(userId, id);
}
