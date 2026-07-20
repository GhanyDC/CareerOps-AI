"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import {
  recordDuplicateDecision,
  scanJobsForDuplicates,
  selectDuplicateGroupPrimary,
} from "./use-cases";

function revalidateDuplicateViews(candidateId?: string, groupId?: string) {
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/jobs/duplicates");
  if (candidateId) revalidatePath(`/jobs/duplicates/${candidateId}`);
  if (groupId) revalidatePath(`/jobs/duplicate-groups/${groupId}`);
}

export async function scanJobsForDuplicatesAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let nextCursor: string | undefined;
  let processedJobs = 0;
  try {
    const { userId } = await getMutationRequestContext();
    const result = await scanJobsForDuplicates(userId, {
      cursor: readString(formData, "cursor"),
      pageSize: 50,
    });
    nextCursor = result.nextCursor;
    processedJobs = result.processedJobs;
    revalidateDuplicateViews();
  } catch (error) {
    return toActionError(error, "job_duplicates.scan");
  }
  const query = new URLSearchParams({ scanned: String(processedJobs) });
  if (nextCursor) query.set("scanCursor", nextCursor);
  redirect(`/jobs/duplicates?${query.toString()}`);
}

export async function recordDuplicateDecisionAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const candidateId = readString(formData, "candidateId");
  try {
    const { userId } = await getMutationRequestContext();
    if (!candidateId) throw new Error("Missing duplicate candidate identifier");
    await recordDuplicateDecision(userId, candidateId, {
      expectedVersion: readString(formData, "expectedVersion"),
      decision: readString(formData, "decision"),
      primaryJobId: readString(formData, "primaryJobId"),
      splitPrimaryJobIds: formData
        .getAll("splitPrimaryJobIds")
        .filter((value): value is string => typeof value === "string"),
      idempotencyKey: readString(formData, "idempotencyKey"),
    });
    revalidateDuplicateViews(candidateId);
  } catch (error) {
    return toActionError(error, "job_duplicates.decision");
  }
  redirect(`/jobs/duplicates/${candidateId}?decided=1`);
}

export async function selectDuplicateGroupPrimaryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const groupId = readString(formData, "groupId");
  try {
    const { userId } = await getMutationRequestContext();
    if (!groupId) throw new Error("Missing duplicate group identifier");
    await selectDuplicateGroupPrimary(userId, groupId, {
      expectedVersion: readString(formData, "expectedVersion"),
      primaryJobId: readString(formData, "primaryJobId"),
      idempotencyKey: readString(formData, "idempotencyKey"),
    });
    revalidateDuplicateViews(undefined, groupId);
  } catch (error) {
    return toActionError(error, "job_duplicates.primary");
  }
  redirect(`/jobs/duplicate-groups/${groupId}?primaryChanged=1`);
}
