"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { createJobParseDraftAction } from "@/modules/job-parsing/actions";

export function CreateParseDraftForm({
  discoveryId,
  targetJobId,
  label = "Create structured job draft",
}: {
  discoveryId: string;
  targetJobId?: string;
  label?: string;
}) {
  return (
    <MutationForm action={createJobParseDraftAction}>
      <input type="hidden" name="discoveryId" value={discoveryId} />
      {targetJobId ? <input type="hidden" name="targetJobId" value={targetJobId} /> : null}
      <SubmitButton>{label}</SubmitButton>
    </MutationForm>
  );
}
