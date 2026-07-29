import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateParseDraftForm } from "@/components/create-parse-draft-form";
import { JobForm } from "@/components/job-form";
import { JobScoringResult } from "@/components/job-scoring-result";
import { JobStatusActions } from "@/components/job-status-actions";
import { JobFilterResult } from "@/components/job-filter-result";
import { ReevaluateJobFilterForm } from "@/components/reevaluate-job-filter-form";
import { RequirementMatchingSection } from "@/components/requirement-matching-section";
import { RescoreJobForm } from "@/components/rescore-job-form";
import { StatusBadge } from "@/components/status-badge";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { persistedJobToValues } from "@/modules/jobs/schemas";
import { viewJob } from "@/modules/jobs/use-cases";
import {
  isJobFilterEvaluationFresh,
  viewJobFilterEvaluation,
} from "@/modules/job-hard-filters/public.server";
import {
  isPreliminaryJobScoreFresh,
  viewJobPreliminaryScore,
} from "@/modules/job-scoring/public.server";
import { viewJobRequirementMatching } from "@/modules/requirement-matching/public.server";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    confirmed?: string;
    saved?: string;
    transitioned?: string;
    filterEvaluated?: string;
    scored?: string;
    requirementCreated?: string;
    requirementTransitioned?: string;
    requirementMoved?: string;
  }>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let job;
  try {
    job = await viewJob(userId, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "JOB_NOT_FOUND") notFound();
    throw error;
  }
  // These projections share the process-wide PostgreSQL adapter. Read them sequentially so
  // server-action revalidation cannot overlap queries on one checked-out client.
  const filterState = await viewJobFilterEvaluation(userId, id);
  const scoringState = await viewJobPreliminaryScore(userId, id);
  const requirementMatching = await viewJobRequirementMatching(userId, id);
  const filterFresh = isJobFilterEvaluationFresh(filterState.profile, job, filterState.evaluation);
  const scoreFresh = isPreliminaryJobScoreFresh(scoringState.profile, job, scoringState.score);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Authoritative Job</p>
          <h1>{job.title}</h1>
          <p>{job.companyName ?? "Company not provided"}</p>
        </div>
        <div className="page-stack">
          <StatusBadge value={job.status} />
          {job.status === "ACTIVE" &&
          requirementMatching.requirements.some((requirement) => requirement.state === "ACTIVE") ? (
            <Link className="button secondary" href={`/retrieval?jobId=${job.id}`}>
              Retrieve for this Job
            </Link>
          ) : null}
        </div>
      </div>
      {query.confirmed ? (
        <div className="notice success">
          Parse draft confirmed and authoritative Job stored atomically.
        </div>
      ) : null}
      {query.saved ? <div className="notice success">Authoritative Job updated.</div> : null}
      {query.transitioned ? <div className="notice success">Job status updated.</div> : null}
      {query.filterEvaluated ? (
        <div className="notice success">Hard filters reevaluated against the current Job.</div>
      ) : null}
      {query.scored ? (
        <div className="notice success">Preliminary preferences rescored for this Job.</div>
      ) : null}
      {query.requirementCreated ? (
        <div className="notice success">Authoritative requirement created.</div>
      ) : null}
      {query.requirementTransitioned ? (
        <div className="notice success">Requirement state updated.</div>
      ) : null}
      {query.requirementMoved ? (
        <div className="notice success">Requirement order updated.</div>
      ) : null}
      {job.duplicateGroupMembership ? (
        <div className="notice">
          This Job is{" "}
          {job.duplicateGroupMembership.group.primaryJobId === job.id
            ? "the primary record in"
            : "a member of"}{" "}
          a confirmed duplicate group.{" "}
          <Link href={`/jobs/duplicate-groups/${job.duplicateGroupMembership.group.id}`}>
            Review duplicate group
          </Link>
          .
        </div>
      ) : null}
      {job.duplicateCandidatesAsA.length + job.duplicateCandidatesAsB.length > 0 ? (
        <div className="notice">
          Duplicate review history is available.{" "}
          <Link href="/jobs/duplicates">Open duplicate queue</Link>.
        </div>
      ) : null}
      <JobStatusActions id={job.id} status={job.status} version={job.version} />
      {!scoringState.profile ? (
        <div className="notice">
          Preliminary scoring is not configured.{" "}
          <Link href="/jobs/scoring">Configure Job Scoring</Link>.
        </div>
      ) : scoringState.score ? (
        <div className="page-stack">
          {job.status === "ARCHIVED" ? (
            <div className="notice">
              This archived Job retains its last preliminary score but is excluded from active
              ranking views and summaries.
            </div>
          ) : !scoreFresh ? (
            <div className="notice">
              This preliminary score is stale because the Job, scoring profile, or rule-set version
              changed.
            </div>
          ) : null}
          <JobScoringResult explanation={scoringState.score.explanation} />
          <p>Last scored {scoringState.score.scoredAt.toLocaleString()}</p>
          {job.status === "ACTIVE" ? <RescoreJobForm jobId={job.id} /> : null}
        </div>
      ) : (
        <div className="panel page-stack">
          <div className="record-card-heading">
            <h2>Preliminary preference score</h2>
            <StatusBadge value="NOT_SCORED" />
          </div>
          <p>This Job has not been scored against the current preference profile.</p>
          {job.status === "ACTIVE" ? <RescoreJobForm jobId={job.id} /> : null}
        </div>
      )}
      {!filterState.profile ? (
        <div className="notice">
          Filters not configured. <Link href="/jobs/filters">Configure Job Hard Filters</Link>.
        </div>
      ) : filterState.evaluation ? (
        <div className="page-stack">
          {job.status === "ARCHIVED" ? (
            <div className="notice">
              This archived Job retains its last result but is excluded from active filter views and
              counts.
            </div>
          ) : !filterFresh ? (
            <div className="notice">
              This result is stale because the Job, profile, or rule-set version changed.
            </div>
          ) : null}
          <JobFilterResult explanation={filterState.evaluation.explanation} />
          <p>Last evaluated {filterState.evaluation.evaluatedAt.toLocaleString()}</p>
          {job.status === "ACTIVE" ? <ReevaluateJobFilterForm jobId={job.id} /> : null}
        </div>
      ) : (
        <div className="panel page-stack">
          <div className="record-card-heading">
            <h2>Hard-filter result</h2>
            <StatusBadge value="NOT_EVALUATED" />
          </div>
          <p>This Job has not been evaluated against the current filter profile.</p>
          {job.status === "ACTIVE" ? <ReevaluateJobFilterForm jobId={job.id} /> : null}
        </div>
      )}
      <RequirementMatchingSection job={requirementMatching} />
      <section className="panel">
        <h2>Confirmation summary</h2>
        <dl className="details-list">
          <div>
            <dt>Company</dt>
            <dd>{job.companyName ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{job.locationLabel ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Employment</dt>
            <dd>{job.employmentType ? humanizeEnum(job.employmentType) : "Not provided"}</dd>
          </div>
          <div>
            <dt>Workplace</dt>
            <dd>
              {job.workplaceArrangement ? humanizeEnum(job.workplaceArrangement) : "Not provided"}
            </dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd>{job.confirmedAt.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{job.version}</dd>
          </div>
        </dl>
        {job.description ? <pre className="raw-content">{job.description}</pre> : null}
      </section>
      <section className="panel page-stack">
        <h2>Source provenance</h2>
        {job.sources.map((source) => (
          <article className="preview-card" key={source.id}>
            <div className="record-card-heading">
              <strong>{humanizeEnum(source.purpose)}</strong>
              <span>{source.confirmedAt.toLocaleString()}</span>
            </div>
            <div className="record-meta">
              <span>Parser {source.parserVersion}</span>
              <span>Contract {source.contractVersion}</span>
              <span>{source.appliedFields.length} applied field(s)</span>
            </div>
            {source.discovery ? (
              <div className="button-row">
                <Link className="button secondary" href={`/discoveries/${source.discovery.id}`}>
                  View raw discovery
                </Link>
                {job.status === "ACTIVE" && source.discovery.status === "INBOX" ? (
                  <CreateParseDraftForm
                    discoveryId={source.discovery.id}
                    targetJobId={job.id}
                    label="Reparse source"
                  />
                ) : null}
              </div>
            ) : (
              <div className="notice">
                Raw source was privacy-purged. Metadata-only provenance remains.
              </div>
            )}
          </article>
        ))}
      </section>
      {job.status === "ACTIVE" ? (
        <section className="page-stack">
          <div>
            <p className="eyebrow">User-approved corrections</p>
            <h2>Edit authoritative fields</h2>
          </div>
          <JobForm id={job.id} version={job.version} values={persistedJobToValues(job)} />
        </section>
      ) : null}
    </div>
  );
}
