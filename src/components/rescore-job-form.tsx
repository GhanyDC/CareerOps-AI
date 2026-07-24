"use client";

import { rescoreJobAction } from "@/modules/job-scoring/actions";

import { MutationForm, SubmitButton } from "./form-controls";

export function RescoreJobForm({ jobId }: { jobId: string }) {
  return (
    <MutationForm action={rescoreJobAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton>Rescore preferences</SubmitButton>
    </MutationForm>
  );
}
