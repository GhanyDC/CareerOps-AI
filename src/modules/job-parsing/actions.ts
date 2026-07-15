"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { readJobCorrectionForm } from "@/modules/jobs/form-input";
import { getMutationRequestContext } from "@/server/request-context";

import {
  confirmJobParseDraft,
  createJobParseDraft,
  rejectJobParseDraft,
  updateJobParseDraft,
} from "./use-cases";

export async function createJobParseDraftAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let draftId: string;
  try {
    const { userId } = await getMutationRequestContext();
    const discoveryId = readString(formData, "discoveryId");
    if (!discoveryId) throw new Error("Missing discovery identifier");
    const draft = await createJobParseDraft(
      userId,
      discoveryId,
      readString(formData, "targetJobId"),
    );
    draftId = draft.id;
    revalidatePath("/discoveries");
    revalidatePath("/jobs/review");
  } catch (error) {
    return toActionError(error, "jobParsing.createDraft");
  }
  redirect(`/jobs/review/${draftId}`);
}

export async function updateJobParseDraftAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing parse draft identifier");
    await updateJobParseDraft(userId, id, {
      expectedVersion: readString(formData, "expectedVersion"),
      correction: readJobCorrectionForm(formData),
    });
    revalidatePath(`/jobs/review/${id}`);
    revalidatePath("/jobs/review");
  } catch (error) {
    return toActionError(error, "jobParsing.updateDraft");
  }
  redirect(`/jobs/review/${id}?saved=1`);
}

export async function rejectJobParseDraftAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = readString(formData, "id");
  try {
    const { userId } = await getMutationRequestContext();
    if (!id) throw new Error("Missing parse draft identifier");
    await rejectJobParseDraft(userId, id, {
      expectedVersion: readString(formData, "expectedVersion"),
    });
    revalidatePath("/jobs/review");
  } catch (error) {
    return toActionError(error, "jobParsing.rejectDraft");
  }
  redirect("/jobs/review?rejected=1");
}

export async function confirmJobParseDraftAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let jobId: string;
  try {
    const { userId } = await getMutationRequestContext();
    const id = readString(formData, "id");
    if (!id) throw new Error("Missing parse draft identifier");
    const job = await confirmJobParseDraft(userId, id, {
      expectedVersion: readString(formData, "expectedVersion"),
      idempotencyKey: readString(formData, "idempotencyKey"),
      reviewed: formData.get("reviewed") === "on",
      selectedFields: formData
        .getAll("selectedFields")
        .filter((value): value is string => typeof value === "string"),
    });
    jobId = job.id;
    revalidatePath("/");
    revalidatePath("/jobs");
    revalidatePath("/jobs/review");
    revalidatePath(`/jobs/${job.id}`);
  } catch (error) {
    return toActionError(error, "jobParsing.confirmDraft");
  }
  redirect(`/jobs/${jobId}?confirmed=1`);
}
