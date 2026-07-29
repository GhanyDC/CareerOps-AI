"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import { readJobCorrectionForm } from "./form-input";
import { transitionJob, updateJob } from "./use-cases";

export async function updateJobAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing Job identifier");
    await updateJob(
      userId,
      id,
      Number(readString(formData, "expectedVersion")),
      readJobCorrectionForm(formData).values,
    );
    revalidatePath("/");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${id}`);
  } catch (error) {
    return toActionError(error, "jobs.update");
  }
  redirect(`/jobs/${id}?saved=1`);
}

export async function transitionJobAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  const targetStatus = readString(formData, "targetStatus");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing Job identifier");
    await transitionJob(userId, id, {
      expectedVersion: readString(formData, "expectedVersion"),
      targetStatus,
    });
    revalidatePath("/");
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${id}`);
  } catch (error) {
    return toActionError(error, "jobs.transition");
  }
  redirect(`/jobs/${id}?transitioned=${targetStatus}`);
}
