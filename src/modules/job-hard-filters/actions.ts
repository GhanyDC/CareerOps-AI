"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toActionError } from "@/modules/shared/action-errors.server";
import type { ActionState } from "@/modules/shared/action-state";
import { readString } from "@/modules/shared/validation";
import { getMutationRequestContext } from "@/server/request-context";

import { readJobFilterConfigurationForm } from "./form-input";
import {
  reevaluateJobHardFilters,
  saveJobFilterProfile,
  scanJobsWithHardFilters,
} from "./use-cases";

function revalidateFilterViews(jobId?: string) {
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/jobs/filters");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function saveJobFilterProfileAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let nextCursor: string | undefined;
  let processedJobs = 0;
  try {
    const { userId } = await getMutationRequestContext();
    const expectedVersionValue = readString(formData, "expectedVersion");
    const profile = await saveJobFilterProfile(userId, {
      expectedVersion: expectedVersionValue ? Number(expectedVersionValue) : undefined,
      configuration: readJobFilterConfigurationForm(formData),
    });
    const scan = await scanJobsWithHardFilters(userId, { pageSize: 50 }, profile.version);
    nextCursor = scan.nextCursor;
    processedJobs = scan.processedJobs;
    revalidateFilterViews();
  } catch (error) {
    return toActionError(error, "job_hard_filters.save");
  }
  const query = new URLSearchParams({ saved: "1", scanned: String(processedJobs) });
  if (nextCursor) query.set("scanCursor", nextCursor);
  redirect(`/jobs/filters?${query.toString()}`);
}

export async function scanJobHardFiltersAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let nextCursor: string | undefined;
  let processedJobs = 0;
  try {
    const { userId } = await getMutationRequestContext();
    const result = await scanJobsWithHardFilters(userId, {
      cursor: readString(formData, "cursor"),
      pageSize: 50,
    });
    nextCursor = result.nextCursor;
    processedJobs = result.processedJobs;
    revalidateFilterViews();
  } catch (error) {
    return toActionError(error, "job_hard_filters.scan");
  }
  const query = new URLSearchParams({ scanned: String(processedJobs) });
  if (nextCursor) query.set("scanCursor", nextCursor);
  redirect(`/jobs/filters?${query.toString()}`);
}

export async function reevaluateJobHardFiltersAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = readString(formData, "jobId");
  try {
    const { userId } = await getMutationRequestContext();
    if (!jobId) throw new Error("Missing Job identifier");
    await reevaluateJobHardFilters(userId, jobId);
    revalidateFilterViews(jobId);
  } catch (error) {
    return toActionError(error, "job_hard_filters.reevaluate");
  }
  redirect(`/jobs/${jobId}?filterEvaluated=1`);
}
