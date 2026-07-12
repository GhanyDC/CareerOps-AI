"use client";

import { useActionState } from "react";

import { CheckboxField, Field } from "./field";
import { ActionFeedback, SubmitButton } from "./form-controls";
import { createExperienceAction, updateExperienceAction } from "@/modules/experiences/actions";
import { experienceTypes } from "@/modules/experiences/schemas";
import { initialActionState } from "@/modules/shared/action-state";
import { humanizeEnum } from "@/modules/shared/presentation";

export type ExperienceFormValues = Readonly<{
  id?: string;
  title: string;
  organization: string;
  experienceType: (typeof experienceTypes)[number];
  location: string;
  workSetup: string;
  startDate: string;
  endDate: string;
  currentlyActive: boolean;
  summary: string;
  responsibilities: string;
  technologies: string;
  skills: string;
  outcomes: string;
  sourceNotes: string;
}>;

export function ExperienceForm({
  mode,
  initial,
}: {
  mode: "create" | "update";
  initial: ExperienceFormValues;
}) {
  const action = mode === "create" ? createExperienceAction : updateExperienceAction;
  const [state, formAction] = useActionState(action, initialActionState);

  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="form-grid two-columns">
        <Field label="Title">
          <input name="title" defaultValue={initial.title} maxLength={200} required />
        </Field>
        <Field label="Organization">
          <input name="organization" defaultValue={initial.organization} maxLength={200} />
        </Field>
        <Field label="Experience type">
          <select name="experienceType" defaultValue={initial.experienceType} required>
            {experienceTypes.map((type) => (
              <option value={type} key={type}>
                {humanizeEnum(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input name="location" defaultValue={initial.location} maxLength={200} />
        </Field>
        <Field label="Work setup">
          <input
            name="workSetup"
            defaultValue={initial.workSetup}
            maxLength={80}
            placeholder="On-site, hybrid, remote"
          />
        </Field>
        <Field label="Start date">
          <input name="startDate" type="date" defaultValue={initial.startDate} />
        </Field>
        <Field label="End date">
          <input name="endDate" type="date" defaultValue={initial.endDate} />
        </Field>
      </div>
      <CheckboxField
        label="Currently active"
        name="currentlyActive"
        defaultChecked={initial.currentlyActive}
      />
      <Field label="Summary">
        <textarea name="summary" defaultValue={initial.summary} maxLength={5000} rows={5} />
      </Field>
      {(
        [
          ["responsibilities", "Responsibilities"],
          ["technologies", "Technologies"],
          ["skills", "Skills"],
          ["outcomes", "Outcomes"],
        ] as const
      ).map(([name, label]) => (
        <Field label={label} hint="Comma- or line-separated" key={name}>
          <textarea name={name} defaultValue={initial[name]} rows={3} />
        </Field>
      ))}
      <Field label="Source notes">
        <textarea name="sourceNotes" defaultValue={initial.sourceNotes} maxLength={3000} rows={3} />
      </Field>
      <div className="form-actions">
        <SubmitButton>{mode === "create" ? "Create experience" : "Save experience"}</SubmitButton>
      </div>
    </form>
  );
}
