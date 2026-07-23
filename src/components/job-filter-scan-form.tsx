"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { scanJobHardFiltersAction } from "@/modules/job-hard-filters/actions";

export function JobFilterScanForm({ cursor }: { cursor: string }) {
  return (
    <MutationForm action={scanJobHardFiltersAction}>
      <input type="hidden" name="cursor" value={cursor} />
      <SubmitButton>Continue bounded reevaluation</SubmitButton>
    </MutationForm>
  );
}
