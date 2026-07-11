"use client";

import { useActionState } from "react";

import { Field } from "./field";
import { ActionFeedback, SubmitButton } from "./form-controls";
import { createProjectAction, updateProjectAction } from "@/modules/projects/actions";
import { initialActionState } from "@/modules/shared/action-state";

export type ProjectFormValues = Readonly<{
  id?: string;
  name: string;
  shortDescription: string;
  problemAddressed: string;
  candidateRole: string;
  responsibilities: string;
  technologies: string;
  skills: string;
  challenges: string;
  actionsTaken: string;
  outcomes: string;
  quantifiedResults: string;
  relevantRoleFamilies: string;
  projectUrl: string;
  repositoryUrl: string;
  startDate: string;
  endDate: string;
}>;

export function ProjectForm({
  mode,
  initial,
}: {
  mode: "create" | "update";
  initial: ProjectFormValues;
}) {
  const action = mode === "create" ? createProjectAction : updateProjectAction;
  const [state, formAction] = useActionState(action, initialActionState);
  const listFields = [
    ["responsibilities", "Responsibilities"],
    ["technologies", "Technologies"],
    ["skills", "Skills"],
    ["challenges", "Challenges"],
    ["actionsTaken", "Actions taken"],
    ["outcomes", "Outcomes"],
    ["quantifiedResults", "Quantified results"],
    ["relevantRoleFamilies", "Relevant role families"],
  ] as const;

  return (
    <form className="form-stack" action={formAction}>
      <ActionFeedback state={state} />
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="form-grid two-columns">
        <Field label="Project name">
          <input name="name" defaultValue={initial.name} maxLength={200} required />
        </Field>
        <Field label="Candidate role">
          <input name="candidateRole" defaultValue={initial.candidateRole} maxLength={200} />
        </Field>
      </div>
      <Field label="Short description">
        <input name="shortDescription" defaultValue={initial.shortDescription} maxLength={500} />
      </Field>
      <Field label="Problem addressed">
        <textarea
          name="problemAddressed"
          defaultValue={initial.problemAddressed}
          maxLength={5000}
          rows={4}
        />
      </Field>
      {listFields.map(([name, label]) => (
        <Field label={label} hint="Comma- or line-separated" key={name}>
          <textarea name={name} defaultValue={initial[name]} rows={3} />
        </Field>
      ))}
      <div className="form-grid two-columns">
        <Field label="Project URL">
          <input name="projectUrl" defaultValue={initial.projectUrl} type="url" maxLength={2048} />
        </Field>
        <Field label="Repository URL">
          <input
            name="repositoryUrl"
            defaultValue={initial.repositoryUrl}
            type="url"
            maxLength={2048}
          />
        </Field>
        <Field label="Start date">
          <input name="startDate" defaultValue={initial.startDate} type="date" />
        </Field>
        <Field label="End date">
          <input name="endDate" defaultValue={initial.endDate} type="date" />
        </Field>
      </div>
      <div className="form-actions">
        <SubmitButton>{mode === "create" ? "Create project" : "Save project"}</SubmitButton>
      </div>
    </form>
  );
}
