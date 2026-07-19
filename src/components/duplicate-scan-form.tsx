"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { scanJobsForDuplicatesAction } from "@/modules/job-duplicates/actions";

export function DuplicateScanForm({ cursor }: { cursor?: string }) {
  return (
    <MutationForm action={scanJobsForDuplicatesAction}>
      {cursor ? <input type="hidden" name="cursor" value={cursor} /> : null}
      <SubmitButton>{cursor ? "Continue duplicate scan" : "Scan authoritative Jobs"}</SubmitButton>
    </MutationForm>
  );
}
