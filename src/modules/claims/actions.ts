"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createDraftClaim, transitionClaimStatus, updateDraftClaim } from "./use-cases";
import { executeServerMutation, toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readCheckbox, readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

function readClaimInput(formData: FormData) {
  return {
    evidenceItemId: readString(formData, "evidenceItemId"),
    claimText: readString(formData, "claimText"),
    reviewerNotes: readString(formData, "reviewerNotes"),
    allowedForResume: readCheckbox(formData, "allowedForResume"),
    allowedForCoverLetters: readCheckbox(formData, "allowedForCoverLetters"),
    allowedForInterviews: readCheckbox(formData, "allowedForInterviews"),
    allowedForRecruiterMessages: readCheckbox(formData, "allowedForRecruiterMessages"),
  };
}

export async function createClaimAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let claimId: string;
  try {
    const { userId } = await getMutationRequestContext();
    const claim = await createDraftClaim(userId, readClaimInput(formData));
    claimId = claim.id;
    revalidatePath("/");
    revalidatePath("/claims");
  } catch (error) {
    return toActionError(error, "claim.create");
  }
  redirect(`/claims/${claimId}?saved=1`);
}

export async function updateClaimAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    if (!id) throw new Error("Missing claim identifier");
    const { userId } = await getMutationRequestContext();
    await updateDraftClaim(userId, id, readClaimInput(formData));
    revalidatePath("/");
    revalidatePath("/claims");
    revalidatePath(`/claims/${id}`);
  } catch (error) {
    return toActionError(error, "claim.update");
  }
  redirect(`/claims/${id}?saved=1`);
}

export async function transitionClaimAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const state = await executeServerMutation("claim.transition", async () => {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing claim identifier");
    await transitionClaimStatus(userId, id, {
      targetStatus: readString(formData, "targetStatus"),
    });
    revalidatePath("/");
    revalidatePath("/claims");
    revalidatePath(`/claims/${id}`);
  });
  if (state.status === "error") return state;
  redirect(`/claims/${id}?transitioned=1`);
}
