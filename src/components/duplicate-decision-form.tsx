"use client";

import { ConfirmSubmitButton, MutationForm, SubmitButton } from "./form-controls";
import { recordDuplicateDecisionAction } from "@/modules/job-duplicates/actions";

type JobChoice = Readonly<{ id: string; title: string; companyName: string | null }>;

function HiddenFields({
  candidateId,
  version,
  decision,
  idempotencyKey,
}: {
  candidateId: string;
  version: number;
  decision: "SAME_OPPORTUNITY" | "DIFFERENT_OPPORTUNITIES" | "DEFERRED";
  idempotencyKey: string;
}) {
  return (
    <>
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    </>
  );
}

function label(job: JobChoice) {
  return `${job.title} — ${job.companyName ?? "Company not provided"}`;
}

export function DuplicateDecisionForms({
  candidateId,
  version,
  jobs,
  groupMembers,
  idempotencyKeys,
}: {
  candidateId: string;
  version: number;
  jobs: readonly [JobChoice, JobChoice];
  groupMembers: readonly JobChoice[];
  idempotencyKeys: Readonly<{ same: string; different: string; deferred: string }>;
}) {
  const primaryChoices = groupMembers.length > 0 ? groupMembers : jobs;
  return (
    <div className="decision-grid">
      <MutationForm action={recordDuplicateDecisionAction} className="panel page-stack">
        <HiddenFields
          candidateId={candidateId}
          version={version}
          decision="SAME_OPPORTUNITY"
          idempotencyKey={idempotencyKeys.same}
        />
        <div>
          <h3>Same opportunity</h3>
          <p>Both authoritative Jobs remain stored. Choose the preferred primary record.</p>
        </div>
        <fieldset className="choice-list">
          <legend>Primary Job</legend>
          {primaryChoices.map((job) => (
            <label key={job.id}>
              <input type="radio" name="primaryJobId" value={job.id} required />
              <span>{label(job)}</span>
            </label>
          ))}
        </fieldset>
        <ConfirmSubmitButton
          confirmation="Confirm these Jobs represent the same opportunity and preserve both records?"
          tone="primary"
        >
          Confirm same opportunity
        </ConfirmSubmitButton>
      </MutationForm>

      <MutationForm action={recordDuplicateDecisionAction} className="panel page-stack">
        <HiddenFields
          candidateId={candidateId}
          version={version}
          decision="DIFFERENT_OPPORTUNITIES"
          idempotencyKey={idempotencyKeys.different}
        />
        <div>
          <h3>Different opportunities</h3>
          <p>Keep both Jobs separate and suppress this pair from ordinary pending review.</p>
        </div>
        {groupMembers.length > 2 ? (
          <fieldset className="choice-list">
            <legend>Possible primaries if the current group splits</legend>
            <p className="field-help">Select preferred records for any resulting groups.</p>
            {groupMembers.map((job) => (
              <label key={job.id}>
                <input type="checkbox" name="splitPrimaryJobIds" value={job.id} />
                <span>{label(job)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <ConfirmSubmitButton confirmation="Confirm these are different opportunities?">
          Confirm different opportunities
        </ConfirmSubmitButton>
      </MutationForm>

      <MutationForm action={recordDuplicateDecisionAction} className="panel page-stack">
        <HiddenFields
          candidateId={candidateId}
          version={version}
          decision="DEFERRED"
          idempotencyKey={idempotencyKeys.deferred}
        />
        <div>
          <h3>Defer review</h3>
          <p>Make no same-or-different decision and keep the pair in the deferred queue.</p>
        </div>
        {groupMembers.length > 2 ? (
          <fieldset className="choice-list">
            <legend>Possible primaries if a previous same decision is removed</legend>
            {groupMembers.map((job) => (
              <label key={job.id}>
                <input type="checkbox" name="splitPrimaryJobIds" value={job.id} />
                <span>{label(job)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <SubmitButton>Defer review</SubmitButton>
      </MutationForm>
    </div>
  );
}
