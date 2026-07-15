"use client";

import { useActionState } from "react";

import { JobFields } from "./job-fields";
import { ActionFeedback, ConfirmSubmitButton, MutationForm, SubmitButton } from "./form-controls";
import {
  confirmJobParseDraftAction,
  rejectJobParseDraftAction,
  updateJobParseDraftAction,
} from "@/modules/job-parsing/actions";
import { initialActionState } from "@/modules/shared/action-state";
import { JOB_FIELD_NAMES, type JobValues } from "@/modules/jobs/schemas";

export function JobParseReviewForm({
  draftId,
  version,
  values,
  idempotencyKey,
  isReparse,
}: {
  draftId: string;
  version: number;
  values: JobValues;
  idempotencyKey: string;
  isReparse: boolean;
}) {
  const [state, saveAction] = useActionState(updateJobParseDraftAction, initialActionState);
  return (
    <div className="page-stack">
      <form className="panel form-stack" action={saveAction}>
        <ActionFeedback state={state} />
        <input type="hidden" name="id" value={draftId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <JobFields values={values} />
        <div className="form-actions">
          <SubmitButton>Save corrections</SubmitButton>
        </div>
      </form>

      <section className="panel form-stack">
        <div>
          <p className="eyebrow">Explicit confirmation</p>
          <h2>{isReparse ? "Choose fields to merge" : "Create the authoritative Job"}</h2>
          <p>
            {isReparse
              ? "Only checked fields will replace the current Job. Unchecked user edits remain unchanged."
              : "No authoritative Job exists until you confirm this reviewed representation."}
          </p>
        </div>
        <MutationForm action={confirmJobParseDraftAction} className="form-stack">
          <input type="hidden" name="id" value={draftId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {isReparse ? (
            <fieldset>
              <legend>Fields to apply</legend>
              <div className="checkbox-grid">
                {JOB_FIELD_NAMES.map((field) => (
                  <label className="checkbox-field" key={field}>
                    <input type="checkbox" name="selectedFields" value={field} />
                    <span>{field.replaceAll(/([A-Z])/g, " $1")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            JOB_FIELD_NAMES.map((field) => (
              <input type="hidden" name="selectedFields" value={field} key={field} />
            ))
          )}
          <label className="checkbox-field">
            <input type="checkbox" name="reviewed" required />
            <span>I reviewed this structured Job and want to make it authoritative.</span>
          </label>
          <SubmitButton>
            {isReparse ? "Confirm selected changes" : "Confirm authoritative Job"}
          </SubmitButton>
        </MutationForm>
        <MutationForm action={rejectJobParseDraftAction}>
          <input type="hidden" name="id" value={draftId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <ConfirmSubmitButton confirmation="Reject this parse draft?">
            Reject draft
          </ConfirmSubmitButton>
        </MutationForm>
      </section>
    </div>
  );
}
