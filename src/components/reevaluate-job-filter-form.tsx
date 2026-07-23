"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { reevaluateJobHardFiltersAction } from "@/modules/job-hard-filters/actions";

export function ReevaluateJobFilterForm({ jobId }: { jobId: string }) {
  return (
    <MutationForm action={reevaluateJobHardFiltersAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton>Reevaluate hard filters</SubmitButton>
    </MutationForm>
  );
}
