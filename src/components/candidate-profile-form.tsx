"use client";

import { useActionState } from "react";

import { Field } from "./field";
import { ActionFeedback, SubmitButton } from "./form-controls";
import { saveCandidateProfileAction } from "@/modules/candidate-profile/actions";
import { initialActionState } from "@/modules/shared/action-state";

export type CandidateProfileFormValues = Readonly<{
  fullName: string;
  professionalHeadline: string;
  careerSummary: string;
  preferredRoleFamilies: string;
  preferredLocations: string;
  acceptedWorkArrangements: string;
  acceptedEmploymentTypes: string;
  schedulePreferences: string;
  nightShiftAcceptance: "" | "true" | "false";
  relocationPreference: string;
  salaryCurrency: string;
  salaryMinimum: string;
  salaryNotes: string;
  careerGoals: string;
  dostReturnServiceNotes: string;
  applicationPreferences: string;
  hardExclusions: string;
}>;

export function CandidateProfileForm({ initial }: { initial: CandidateProfileFormValues }) {
  const [state, formAction] = useActionState(saveCandidateProfileAction, initialActionState);

  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      <div className="form-grid two-columns">
        <Field label="Full name">
          <input name="fullName" defaultValue={initial.fullName} maxLength={160} />
        </Field>
        <Field label="Professional headline">
          <input
            name="professionalHeadline"
            defaultValue={initial.professionalHeadline}
            maxLength={240}
          />
        </Field>
      </div>
      <Field label="Career summary">
        <textarea
          name="careerSummary"
          defaultValue={initial.careerSummary}
          maxLength={5000}
          rows={5}
        />
      </Field>
      <div className="form-grid two-columns">
        <Field label="Preferred role families" hint="Comma-separated">
          <textarea
            name="preferredRoleFamilies"
            defaultValue={initial.preferredRoleFamilies}
            rows={3}
          />
        </Field>
        <Field label="Preferred locations" hint="Comma-separated">
          <textarea name="preferredLocations" defaultValue={initial.preferredLocations} rows={3} />
        </Field>
        <Field label="Accepted work arrangements" hint="Comma-separated">
          <input name="acceptedWorkArrangements" defaultValue={initial.acceptedWorkArrangements} />
        </Field>
        <Field label="Accepted employment types" hint="Comma-separated">
          <input name="acceptedEmploymentTypes" defaultValue={initial.acceptedEmploymentTypes} />
        </Field>
        <Field label="Schedule preferences" hint="Comma-separated">
          <input name="schedulePreferences" defaultValue={initial.schedulePreferences} />
        </Field>
        <Field label="Night-shift acceptance">
          <select name="nightShiftAcceptance" defaultValue={initial.nightShiftAcceptance}>
            <option value="">Not specified</option>
            <option value="true">Accepted</option>
            <option value="false">Not accepted</option>
          </select>
        </Field>
        <Field label="Relocation preference">
          <input
            name="relocationPreference"
            defaultValue={initial.relocationPreference}
            maxLength={160}
          />
        </Field>
        <Field label="Salary currency">
          <input
            name="salaryCurrency"
            defaultValue={initial.salaryCurrency}
            maxLength={3}
            placeholder="PHP"
          />
        </Field>
        <Field label="Minimum salary">
          <input
            name="salaryMinimum"
            defaultValue={initial.salaryMinimum}
            type="number"
            min="0"
            step="0.01"
          />
        </Field>
      </div>
      <Field label="Salary notes">
        <textarea name="salaryNotes" defaultValue={initial.salaryNotes} maxLength={2000} rows={3} />
      </Field>
      <Field label="Career goals">
        <textarea name="careerGoals" defaultValue={initial.careerGoals} maxLength={5000} rows={4} />
      </Field>
      <Field label="DOST return-of-service notes">
        <textarea
          name="dostReturnServiceNotes"
          defaultValue={initial.dostReturnServiceNotes}
          maxLength={3000}
          rows={4}
        />
      </Field>
      <Field label="Application preferences">
        <textarea
          name="applicationPreferences"
          defaultValue={initial.applicationPreferences}
          maxLength={3000}
          rows={4}
        />
      </Field>
      <Field label="Hard exclusions" hint="Comma-separated">
        <textarea name="hardExclusions" defaultValue={initial.hardExclusions} rows={3} />
      </Field>
      <div className="form-actions">
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </form>
  );
}
