"use client";

import { MutationForm, SubmitButton } from "./form-controls";
import { selectDuplicateGroupPrimaryAction } from "@/modules/job-duplicates/actions";

export function DuplicatePrimaryForm({
  groupId,
  version,
  primaryJobId,
  idempotencyKey,
  jobs,
}: {
  groupId: string;
  version: number;
  primaryJobId: string;
  idempotencyKey: string;
  jobs: readonly { id: string; title: string; companyName: string | null }[];
}) {
  return (
    <MutationForm action={selectDuplicateGroupPrimaryAction} className="panel page-stack">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="choice-list">
        <legend>Primary authoritative Job</legend>
        {jobs.map((job) => (
          <label key={job.id}>
            <input
              type="radio"
              name="primaryJobId"
              value={job.id}
              defaultChecked={job.id === primaryJobId}
              required
            />
            <span>
              {job.title} — {job.companyName ?? "Company not provided"}
            </span>
          </label>
        ))}
      </fieldset>
      <SubmitButton>Save primary Job</SubmitButton>
    </MutationForm>
  );
}
