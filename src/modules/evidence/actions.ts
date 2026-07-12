"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createEvidenceItem,
  deleteEvidenceItem,
  transitionEvidenceStatus,
  updateEvidenceItem,
} from "./use-cases";
import { executeServerMutation, toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readCheckbox, readList, readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

function readEvidenceInput(formData: FormData) {
  const sourceReference = readString(formData, "sourceReference") ?? "";
  const [sourceType, sourceId] = sourceReference.split(":", 2);

  return {
    sourceType,
    sourceExperienceId: sourceType === "EXPERIENCE" ? sourceId : undefined,
    sourceProjectId: sourceType === "PROJECT" ? sourceId : undefined,
    claim: readString(formData, "claim"),
    supportingContext: readString(formData, "supportingContext"),
    skillsDemonstrated: readList(formData, "skillsDemonstrated"),
    relevantRoleFamilies: readList(formData, "relevantRoleFamilies"),
    evidenceStrength: readString(formData, "evidenceStrength"),
    allowedForResume: readCheckbox(formData, "allowedForResume"),
    allowedForCoverLetters: readCheckbox(formData, "allowedForCoverLetters"),
    allowedForInterviews: readCheckbox(formData, "allowedForInterviews"),
    allowedForRecruiterMessages: readCheckbox(formData, "allowedForRecruiterMessages"),
    sourceNotes: readString(formData, "sourceNotes"),
  };
}

export async function createEvidenceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let evidenceId: string;
  try {
    const { userId } = await getMutationRequestContext();
    const evidence = await createEvidenceItem(userId, readEvidenceInput(formData));
    evidenceId = evidence.id;
    revalidatePath("/");
    revalidatePath("/evidence");
  } catch (error) {
    return toActionError(error, "evidence.create");
  }
  redirect(`/evidence/${evidenceId}?saved=1`);
}

export async function updateEvidenceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    if (!id) throw new Error("Missing evidence identifier");
    const { userId } = await getMutationRequestContext();
    await updateEvidenceItem(userId, id, readEvidenceInput(formData));
    revalidatePath("/");
    revalidatePath("/evidence");
    revalidatePath(`/evidence/${id}`);
  } catch (error) {
    return toActionError(error, "evidence.update");
  }
  redirect(`/evidence/${id}?saved=1`);
}

export async function transitionEvidenceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const state = await executeServerMutation("evidence.transition", async () => {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing evidence identifier");
    await transitionEvidenceStatus(userId, id, {
      targetStatus: readString(formData, "targetStatus"),
    });
    revalidatePath("/");
    revalidatePath("/evidence");
    revalidatePath(`/evidence/${id}`);
  });
  if (state.status === "error") return state;
  redirect(`/evidence/${id}?transitioned=1`);
}

export async function deleteEvidenceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const state = await executeServerMutation("evidence.delete", async () => {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing evidence identifier");
    await deleteEvidenceItem(userId, id);
    revalidatePath("/");
    revalidatePath("/evidence");
  });
  if (state.status === "error") return state;
  redirect("/evidence?deleted=1");
}
