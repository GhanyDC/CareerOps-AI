"use client";

import { useActionState } from "react";

import { CheckboxField, Field } from "./field";
import { ActionFeedback, SubmitButton } from "./form-controls";
import { createEvidenceAction, updateEvidenceAction } from "@/modules/evidence/actions";
import { evidenceStrengths } from "@/modules/evidence/schemas";
import { initialActionState } from "@/modules/shared/action-state";
import { humanizeEnum } from "@/modules/shared/presentation";

export type EvidenceSourceOption = Readonly<{
  value: string;
  label: string;
}>;

export type EvidenceFormValues = Readonly<{
  id?: string;
  sourceReference: string;
  claim: string;
  supportingContext: string;
  skillsDemonstrated: string;
  relevantRoleFamilies: string;
  evidenceStrength: (typeof evidenceStrengths)[number];
  allowedForResume: boolean;
  allowedForCoverLetters: boolean;
  allowedForInterviews: boolean;
  allowedForRecruiterMessages: boolean;
  sourceNotes: string;
}>;

export function EvidenceForm({
  mode,
  initial,
  sources,
}: {
  mode: "create" | "update";
  initial: EvidenceFormValues;
  sources: readonly EvidenceSourceOption[];
}) {
  const action = mode === "create" ? createEvidenceAction : updateEvidenceAction;
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Field label="Evidence source">
        <select name="sourceReference" defaultValue={initial.sourceReference} required>
          <option value="" disabled>
            Select an owned experience or project
          </option>
          {sources.map((source) => (
            <option value={source.value} key={source.value}>
              {source.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Atomic claim">
        <textarea name="claim" defaultValue={initial.claim} maxLength={1000} rows={4} required />
      </Field>
      <Field label="Supporting context">
        <textarea
          name="supportingContext"
          defaultValue={initial.supportingContext}
          maxLength={5000}
          rows={4}
        />
      </Field>
      <div className="form-grid two-columns">
        <Field label="Evidence strength">
          <select name="evidenceStrength" defaultValue={initial.evidenceStrength} required>
            {evidenceStrengths.map((strength) => (
              <option value={strength} key={strength}>
                {humanizeEnum(strength)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skills demonstrated" hint="Comma-separated">
          <input name="skillsDemonstrated" defaultValue={initial.skillsDemonstrated} />
        </Field>
      </div>
      <Field label="Relevant role families" hint="Comma-separated">
        <input name="relevantRoleFamilies" defaultValue={initial.relevantRoleFamilies} />
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
      <Field label="Source notes">
        <textarea name="sourceNotes" defaultValue={initial.sourceNotes} maxLength={3000} rows={3} />
      </Field>
      <div className="form-actions">
        <SubmitButton>{mode === "create" ? "Create evidence" : "Save evidence"}</SubmitButton>
      </div>
    </form>
  );
}
