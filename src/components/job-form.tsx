"use client";

import { JobFields } from "./job-fields";
import { MutationForm, SubmitButton } from "./form-controls";
import { updateJobAction } from "@/modules/jobs/actions";
import type { JobValues } from "@/modules/jobs/schemas";

export function JobForm({
  id,
  version,
  values,
}: {
  id: string;
  version: number;
  values: JobValues;
}) {
  return (
    <MutationForm action={updateJobAction} className="panel form-stack">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectedVersion" value={version} />
      <JobFields values={values} />
      <SubmitButton>Save authoritative Job</SubmitButton>
    </MutationForm>
  );
}
