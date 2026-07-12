"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createExperience, deleteExperience, updateExperience } from "./use-cases";
import { executeServerMutation, toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readCheckbox, readList, readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

function readExperienceInput(formData: FormData) {
  return {
    title: readString(formData, "title"),
    organization: readString(formData, "organization"),
    experienceType: readString(formData, "experienceType"),
    location: readString(formData, "location"),
    workSetup: readString(formData, "workSetup"),
    startDate: readString(formData, "startDate"),
    endDate: readString(formData, "endDate"),
    currentlyActive: readCheckbox(formData, "currentlyActive"),
    summary: readString(formData, "summary"),
    responsibilities: readList(formData, "responsibilities"),
    technologies: readList(formData, "technologies"),
    skills: readList(formData, "skills"),
    outcomes: readList(formData, "outcomes"),
    sourceNotes: readString(formData, "sourceNotes"),
  };
}

export async function createExperienceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let experienceId: string;
  try {
    const { userId } = await getMutationRequestContext();
    const experience = await createExperience(userId, readExperienceInput(formData));
    experienceId = experience.id;
    revalidatePath("/");
    revalidatePath("/experiences");
  } catch (error) {
    return toActionError(error, "experience.create");
  }
  redirect(`/experiences/${experienceId}?saved=1`);
}

export async function updateExperienceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing experience identifier");
    await updateExperience(userId, id, readExperienceInput(formData));
    revalidatePath("/");
    revalidatePath("/experiences");
    revalidatePath(`/experiences/${id}`);
  } catch (error) {
    return toActionError(error, "experience.update");
  }
  redirect(`/experiences/${id}?saved=1`);
}

export async function deleteExperienceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const state = await executeServerMutation("experience.delete", async () => {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing experience identifier");
    await deleteExperience(userId, id);
    revalidatePath("/");
    revalidatePath("/experiences");
  });
  if (state.status === "error") return state;
  redirect("/experiences?deleted=1");
}
