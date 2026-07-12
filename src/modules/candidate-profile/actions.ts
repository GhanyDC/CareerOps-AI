"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateCandidateProfile } from "./use-cases";
import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readList, readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

export async function saveCandidateProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { userId } = await getMutationRequestContext();
    const nightShiftValue = readString(formData, "nightShiftAcceptance");

    await updateCandidateProfile(userId, {
      fullName: readString(formData, "fullName"),
      professionalHeadline: readString(formData, "professionalHeadline"),
      careerSummary: readString(formData, "careerSummary"),
      preferredRoleFamilies: readList(formData, "preferredRoleFamilies"),
      preferredLocations: readList(formData, "preferredLocations"),
      acceptedWorkArrangements: readList(formData, "acceptedWorkArrangements"),
      acceptedEmploymentTypes: readList(formData, "acceptedEmploymentTypes"),
      schedulePreferences: readList(formData, "schedulePreferences"),
      nightShiftAcceptance:
        nightShiftValue === "true" ? true : nightShiftValue === "false" ? false : null,
      relocationPreference: readString(formData, "relocationPreference"),
      salaryCurrency: readString(formData, "salaryCurrency"),
      salaryMinimum: readString(formData, "salaryMinimum"),
      salaryNotes: readString(formData, "salaryNotes"),
      careerGoals: readString(formData, "careerGoals"),
      dostReturnServiceNotes: readString(formData, "dostReturnServiceNotes"),
      applicationPreferences: readString(formData, "applicationPreferences"),
      hardExclusions: readList(formData, "hardExclusions"),
    });

    revalidatePath("/");
    revalidatePath("/candidate-profile");
  } catch (error) {
    return toActionError(error, "candidate_profile.update");
  }

  redirect("/candidate-profile?saved=1");
}
