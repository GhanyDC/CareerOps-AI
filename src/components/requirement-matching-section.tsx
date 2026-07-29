import Link from "next/link";

import { ConfirmSubmitButton, MutationForm, SubmitButton } from "./form-controls";
import { RequirementCoverage } from "./requirement-coverage";
import { StatusBadge } from "./status-badge";
import {
  createJobRequirementAction,
  moveJobRequirementAction,
  transitionJobRequirementAction,
} from "@/modules/requirement-matching/actions";
import {
  requirementCategories,
  requirementImportances,
  requirementSources,
} from "@/modules/requirement-matching/public";
import { humanizeEnum } from "@/modules/shared/presentation";

type RequirementView = Readonly<{
  id: string;
  statement: string;
  category: (typeof requirementCategories)[number];
  importance: (typeof requirementImportances)[number];
  source: (typeof requirementSources)[number];
  state: "ACTIVE" | "ARCHIVED";
  version: number;
  position: number;
  evidenceLinks: readonly unknown[];
  assessment: Readonly<{
    freshness: "NOT_REVIEWED" | "CURRENT" | "STALE";
    status: "NOT_REVIEWED" | "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED";
    staleReasons: readonly string[];
  }>;
}>;

export function RequirementMatchingSection({
  job,
}: {
  job: Readonly<{
    id: string;
    status: "ACTIVE" | "ARCHIVED";
    responsibilities: string[];
    qualifications: string[];
    preferredQualifications: string[];
    skills: string[];
    requirements: readonly RequirementView[];
    coverage: Parameters<typeof RequirementCoverage>[0]["coverage"];
    orderHash: string;
  }>;
}) {
  const active = job.requirements.filter((requirement) => requirement.state === "ACTIVE");
  const archived = job.requirements.filter((requirement) => requirement.state === "ARCHIVED");
  const candidates = [
    ...job.responsibilities.map((statement) => ({ source: "JOB_RESPONSIBILITY", statement })),
    ...job.qualifications.map((statement) => ({ source: "JOB_QUALIFICATION", statement })),
    ...job.preferredQualifications.map((statement) => ({
      source: "JOB_PREFERRED_QUALIFICATION",
      statement,
    })),
    ...job.skills.map((statement) => ({ source: "JOB_SKILL", statement })),
  ] as const;

  return (
    <section className="panel page-stack" id="requirement-matching">
      <div className="record-card-heading">
        <div>
          <p className="eyebrow">Requirement-to-Evidence Matching</p>
          <h2>Authoritative atomic requirements</h2>
        </div>
        <Link className="button secondary" href="/jobs/requirements">
          Active coverage summary
        </Link>
      </div>
      <div className="notice">
        Matches show which Candidate Evidence records support a Job requirement. They do not
        independently prove qualification or guarantee application success.
      </div>
      {job.status === "ARCHIVED" ? (
        <div className="notice">
          Requirements and matches are preserved while this Job is archived. Restore the Job to edit
          or re-review them; archived Jobs are excluded from active coverage summaries.
        </div>
      ) : null}
      <RequirementCoverage coverage={job.coverage} />
      <div className="record-list">
        {active.map((requirement, index) => {
          const badge =
            requirement.assessment.freshness === "STALE" ? "STALE" : requirement.assessment.status;
          return (
            <article className="record-card" key={requirement.id}>
              <div className="record-card-heading">
                <div>
                  <span className="record-kicker">
                    {humanizeEnum(requirement.importance)} · {humanizeEnum(requirement.category)}
                  </span>
                  <h3>{requirement.statement}</h3>
                </div>
                <StatusBadge value={badge} />
              </div>
              <div className="record-meta">
                <span>{requirement.evidenceLinks.length} evidence link(s)</span>
                <span>Source: {humanizeEnum(requirement.source)}</span>
                <span>Requirement version {requirement.version}</span>
                {requirement.assessment.freshness === "STALE" ? (
                  <span>{requirement.assessment.staleReasons.length} stale reason(s)</span>
                ) : null}
              </div>
              <div className="button-row">
                <Link
                  className="button primary"
                  href={`/jobs/${job.id}/requirements/${requirement.id}`}
                >
                  Review evidence
                </Link>
                {job.status === "ACTIVE" && index > 0 ? (
                  <MutationForm action={moveJobRequirementAction}>
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="direction" value="UP" />
                    <input type="hidden" name="expectedOrderHash" value={job.orderHash} />
                    <button className="button secondary" type="submit">
                      Move up
                    </button>
                  </MutationForm>
                ) : null}
                {job.status === "ACTIVE" && index < active.length - 1 ? (
                  <MutationForm action={moveJobRequirementAction}>
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="direction" value="DOWN" />
                    <input type="hidden" name="expectedOrderHash" value={job.orderHash} />
                    <button className="button secondary" type="submit">
                      Move down
                    </button>
                  </MutationForm>
                ) : null}
                {job.status === "ACTIVE" ? (
                  <MutationForm action={transitionJobRequirementAction}>
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="targetState" value="ARCHIVED" />
                    <input type="hidden" name="expectedVersion" value={requirement.version} />
                    <ConfirmSubmitButton confirmation="Archive this requirement and preserve its match history?">
                      Archive requirement
                    </ConfirmSubmitButton>
                  </MutationForm>
                ) : null}
              </div>
            </article>
          );
        })}
        {active.length === 0 ? (
          <div className="empty-state">No active authoritative requirements have been added.</div>
        ) : null}
      </div>
      {job.status === "ACTIVE" ? (
        <section className="page-stack">
          <div>
            <h3>Add an authoritative requirement</h3>
            <p>
              Each statement becomes authoritative only when this form is submitted. Choosing a
              Job-field source requires an exact match to the structured field shown below.
            </p>
          </div>
          {candidates.length > 0 ? (
            <details>
              <summary>View structured Job-field candidates</summary>
              <ul>
                {candidates.map((candidate, index) => (
                  <li key={`${candidate.source}-${index}`}>
                    <strong>{humanizeEnum(candidate.source)}:</strong> {candidate.statement}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <MutationForm action={createJobRequirementAction} className="form-stack">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="field">
              <span>Atomic requirement statement</span>
              <textarea name="statement" maxLength={1000} rows={3} required />
            </label>
            <div className="form-grid three-columns">
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue="SKILL" required>
                  {requirementCategories.map((category) => (
                    <option value={category} key={category}>
                      {humanizeEnum(category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Importance</span>
                <select name="importance" defaultValue="REQUIRED" required>
                  {requirementImportances.map((importance) => (
                    <option value={importance} key={importance}>
                      {humanizeEnum(importance)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Source classification</span>
                <select name="source" defaultValue="MANUAL" required>
                  {requirementSources.map((source) => (
                    <option value={source} key={source}>
                      {humanizeEnum(source)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SubmitButton>Create authoritative requirement</SubmitButton>
          </MutationForm>
        </section>
      ) : null}
      {archived.length > 0 ? (
        <details>
          <summary>Archived requirements ({archived.length})</summary>
          <div className="record-list">
            {archived.map((requirement) => (
              <article className="record-card" key={requirement.id}>
                <div className="record-card-heading">
                  <h3>{requirement.statement}</h3>
                  <StatusBadge value="ARCHIVED" />
                </div>
                {job.status === "ACTIVE" ? (
                  <MutationForm action={transitionJobRequirementAction}>
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="targetState" value="ACTIVE" />
                    <input type="hidden" name="expectedVersion" value={requirement.version} />
                    <button className="button secondary" type="submit">
                      Restore requirement
                    </button>
                  </MutationForm>
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
