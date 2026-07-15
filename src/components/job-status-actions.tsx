"use client";

import { ConfirmSubmitButton, MutationForm } from "./form-controls";
import { transitionJobAction } from "@/modules/jobs/actions";

export function JobStatusActions({
  id,
  status,
  version,
}: {
  id: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
}) {
  const targetStatus = status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
  const label = status === "ACTIVE" ? "Archive Job" : "Restore Job";
  return (
    <MutationForm action={transitionJobAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="targetStatus" value={targetStatus} />
      <input type="hidden" name="expectedVersion" value={version} />
      {status === "ACTIVE" ? (
        <ConfirmSubmitButton confirmation="Archive this authoritative Job?">
          {label}
        </ConfirmSubmitButton>
      ) : (
        <button className="button primary" type="submit">
          {label}
        </button>
      )}
    </MutationForm>
  );
}
