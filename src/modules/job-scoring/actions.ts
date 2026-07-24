"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import { readJobScoringConfigurationForm } from "./form-input";
import { rescoreJob, saveJobScoringProfile, scanJobsWithPreliminaryScoring } from "./use-cases";

function revalidateScoringViews(jobId?: string) {
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/jobs/scoring");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function saveJobScoringProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let nextCursor: string | undefined;
  let processedJobs = 0;
  try {
    const { userId } = await getMutationRequestContext();
    const expectedVersionValue = readString(formData, "expectedVersion");
    const profile = await saveJobScoringProfile(userId, {
      expectedVersion: expectedVersionValue ? Number(expectedVersionValue) : undefined,
      configuration: readJobScoringConfigurationForm(formData),
    });
    const scan = await scanJobsWithPreliminaryScoring(userId, { pageSize: 50 }, profile.version);
    nextCursor = scan.nextCursor;
    processedJobs = scan.processedJobs;
    revalidateScoringViews();
  } catch (error) {
    return toActionError(error, "job_scoring.save");
  }
  const query = new URLSearchParams({ saved: "1", scanned: String(processedJobs) });
  if (nextCursor) query.set("scanCursor", nextCursor);
  redirect(`/jobs/scoring?${query.toString()}`);
}

export async function scanJobScoringAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let nextCursor: string | undefined;
  let processedJobs = 0;
  try {
    const { userId } = await getMutationRequestContext();
    const result = await scanJobsWithPreliminaryScoring(userId, {
      cursor: readString(formData, "cursor"),
      pageSize: 50,
    });
    nextCursor = result.nextCursor;
    processedJobs = result.processedJobs;
    revalidateScoringViews();
  } catch (error) {
    return toActionError(error, "job_scoring.scan");
  }
  const query = new URLSearchParams({ scanned: String(processedJobs) });
  if (nextCursor) query.set("scanCursor", nextCursor);
  redirect(`/jobs/scoring?${query.toString()}`);
}

export async function rescoreJobAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = readString(formData, "jobId");
  try {
    const { userId } = await getMutationRequestContext();
    if (!jobId) throw new Error("Missing Job identifier");
    await rescoreJob(userId, jobId);
    revalidateScoringViews(jobId);
  } catch (error) {
    return toActionError(error, "job_scoring.rescore");
  }
  redirect(`/jobs/${jobId}?scored=1`);
}
