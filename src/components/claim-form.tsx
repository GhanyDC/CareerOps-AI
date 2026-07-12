"use client";

import { useActionState } from "react";

import { CheckboxField, Field } from "./field";
import { ActionFeedback, SubmitButton } from "./form-controls";
import { createClaimAction, updateClaimAction } from "@/modules/claims/actions";
import { initialActionState } from "@/modules/shared/action-state";

export type ClaimEvidenceOption = Readonly<{ id: string; claim: string }>;

export type ClaimFormValues = Readonly<{
  id?: string;
  evidenceItemId: string;
  claimText: string;
  reviewerNotes: string;
  allowedForResume: boolean;
  allowedForCoverLetters: boolean;
  allowedForInterviews: boolean;
  allowedForRecruiterMessages: boolean;
}>;

export function ClaimForm({
  mode,
  initial,
  evidenceOptions,
}: {
  mode: "create" | "update";
  initial: ClaimFormValues;
  evidenceOptions: readonly ClaimEvidenceOption[];
}) {
  const action = mode === "create" ? createClaimAction : updateClaimAction;
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Field label="Verified evidence">
        <select name="evidenceItemId" defaultValue={initial.evidenceItemId} required>
          <option value="" disabled>
            Select verified evidence
          </option>
          {evidenceOptions.map((evidence) => (
            <option value={evidence.id} key={evidence.id}>
              {evidence.claim}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Claim text">
        <textarea
          name="claimText"
          defaultValue={initial.claimText}
          maxLength={1000}
          rows={4}
          required
        />
      </Field>
      <Field label="Reviewer notes">
        <textarea
          name="reviewerNotes"
          defaultValue={initial.reviewerNotes}
          maxLength={3000}
          rows={4}
        />
      </Field>
      <fieldset>
        <legend>Allowed usage contexts</legend>
        <div className="checkbox-grid">
          <CheckboxField
            label="Resume"
            name="allowedForResume"
            defaultChecked={initial.allowedForResume}
          />
          <CheckboxField
            label="Cover letters"
            name="allowedForCoverLetters"
            defaultChecked={initial.allowedForCoverLetters}
          />
          <CheckboxField
            label="Interviews"
            name="allowedForInterviews"
            defaultChecked={initial.allowedForInterviews}
          />
          <CheckboxField
            label="Recruiter messages"
            name="allowedForRecruiterMessages"
            defaultChecked={initial.allowedForRecruiterMessages}
          />
        </div>
      </fieldset>
      <div className="form-actions">
        <SubmitButton>{mode === "create" ? "Create draft claim" : "Save draft claim"}</SubmitButton>
      </div>
    </form>
  );
}
