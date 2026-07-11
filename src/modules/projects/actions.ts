"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProject, deleteProject, updateProject } from "./use-cases";
import { executeServerMutation, toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readList, readString } from "@/modules/shared/validation";
import { getRequestContext } from "@/server/request-context";

function readProjectInput(formData: FormData) {
  return {
    name: readString(formData, "name"),
    shortDescription: readString(formData, "shortDescription"),
    problemAddressed: readString(formData, "problemAddressed"),
    candidateRole: readString(formData, "candidateRole"),
    responsibilities: readList(formData, "responsibilities"),
    technologies: readList(formData, "technologies"),
    skills: readList(formData, "skills"),
    challenges: readList(formData, "challenges"),
    actionsTaken: readList(formData, "actionsTaken"),
    outcomes: readList(formData, "outcomes"),
    quantifiedResults: readList(formData, "quantifiedResults"),
    relevantRoleFamilies: readList(formData, "relevantRoleFamilies"),
    projectUrl: readString(formData, "projectUrl"),
    repositoryUrl: readString(formData, "repositoryUrl"),
    startDate: readString(formData, "startDate"),
    endDate: readString(formData, "endDate"),
  };
}

export async function createProjectAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let projectId: string;
  try {
    const { userId } = await getRequestContext();
    const project = await createProject(userId, readProjectInput(formData));
    projectId = project.id;
    revalidatePath("/");
    revalidatePath("/projects");
  } catch (error) {
    return toActionError(error, "project.create");
  }
  redirect(`/projects/${projectId}?saved=1`);
}

export async function updateProjectAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    if (!id) throw new Error("Missing project identifier");
    const { userId } = await getRequestContext();
    await updateProject(userId, id, readProjectInput(formData));
    revalidatePath("/");
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  } catch (error) {
    return toActionError(error, "project.update");
  }
  redirect(`/projects/${id}?saved=1`);
}

export async function deleteProjectAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const state = await executeServerMutation("project.delete", async () => {
    const { userId } = await getRequestContext();
    if (!id) throw new Error("Missing project identifier");
    await deleteProject(userId, id);
    revalidatePath("/");
    revalidatePath("/projects");
  });
  if (state.status === "error") return state;
  redirect("/projects?deleted=1");
}
