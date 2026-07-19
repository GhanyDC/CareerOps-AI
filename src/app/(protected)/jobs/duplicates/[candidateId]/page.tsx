import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DuplicateDecisionForms } from "@/components/duplicate-decision-form";
import { StatusBadge } from "@/components/status-badge";
import {
  duplicateConflictsSchema,
  duplicateEvidenceSchema,
} from "@/modules/job-duplicates/schemas";
import { viewDuplicateCandidate } from "@/modules/job-duplicates/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

type Candidate = Awaited<ReturnType<typeof viewDuplicateCandidate>>;
type ComparedJob = Candidate["jobA"];

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.length > 0 ? value.join("; ") : "Not provided";
  return String(value);
}

function salary(job: ComparedJob) {
  if (job.salaryMin === null && job.salaryMax === null) return "Not provided";
  const range = [job.salaryMin?.toFixed(2), job.salaryMax?.toFixed(2)].filter(Boolean).join(" – ");
  return `${job.salaryCurrency ?? ""} ${range} ${job.salaryPeriod ? `/${humanizeEnum(job.salaryPeriod)}` : ""}`.trim();
}

function JobComparisonCard({ label, job }: { label: string; job: ComparedJob }) {
  const provenance = job.fieldProvenance as { fields?: Record<string, { origin?: string }> };
  return (
    <article className="panel page-stack">
      <div className="record-card-heading">
        <div>
          <p className="eyebrow">{label}</p>
          <h2>{job.title}</h2>
          <p>{job.companyName ?? "Company not provided"}</p>
        </div>
        <StatusBadge value={job.status} />
      </div>
      <dl className="details-list">
        {(
          [
            ["Location", job.locationLabel],
            ["Country", job.countryCode],
            ["Region", job.region],
            ["City", job.city],
            ["Employment", job.employmentType && humanizeEnum(job.employmentType)],
            ["Workplace", job.workplaceArrangement && humanizeEnum(job.workplaceArrangement)],
            ["Experience", job.experienceLevel && humanizeEnum(job.experienceLevel)],
            ["Salary", salary(job)],
            ["Posted", job.postedAt],
            ["Closing", job.closesAt],
          ] satisfies readonly (readonly [string, unknown])[]
        ).map(([term, value]) => (
          <div key={String(term)}>
            <dt>{term}</dt>
            <dd>{display(value)}</dd>
          </div>
        ))}
      </dl>
      <div>
        <strong>Source URL</strong>
        <p className="break-anywhere">
          {job.sourceUrl ? (
            <a href={job.sourceUrl} target="_blank" rel="noreferrer noopener">
              {job.sourceUrl}
            </a>
          ) : (
            "Not provided"
          )}
        </p>
      </div>
      {job.description ? (
        <details>
          <summary>Description</summary>
          <pre className="raw-content">{job.description}</pre>
        </details>
      ) : null}
      {[
        ["Responsibilities", job.responsibilities],
        ["Qualifications", job.qualifications],
        ["Skills", job.skills],
      ].map(([heading, values]) => (
        <div key={String(heading)}>
          <strong>{heading}</strong>
          <p>{display(values)}</p>
        </div>
      ))}
      <div>
        <strong>Field provenance</strong>
        <ul className="compact-list">
          {Object.entries(provenance.fields ?? {}).map(([field, metadata]) => (
            <li key={field}>
              {field}: {metadata.origin ? humanizeEnum(metadata.origin) : "Recorded"}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <strong>JobSource provenance</strong>
        {job.sources.map((source) => (
          <p key={source.id}>
            {humanizeEnum(source.purpose)} · {source.parserVersion} ·{" "}
            {source.sourcePurgedAt ? "Privacy-redacted metadata" : "Live source"}
          </p>
        ))}
      </div>
      <Link className="button secondary" href={`/jobs/${job.id}`}>
        Open authoritative Job
      </Link>
    </article>
  );
}

export default async function DuplicateCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ decided?: string }>;
}) {
  const [{ candidateId }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let candidate: Candidate;
  try {
    candidate = await viewDuplicateCandidate(userId, candidateId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "DUPLICATE_CANDIDATE_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  const evidence = duplicateEvidenceSchema.parse(candidate.evidence);
  const conflicts = duplicateConflictsSchema.parse(candidate.conflicts);
  const groupMembers = new Map<string, { id: string; title: string; companyName: string | null }>();
  for (const job of [candidate.jobA, candidate.jobB]) {
    groupMembers.set(job.id, job);
    for (const member of job.duplicateGroupMembership?.group.members ?? []) {
      groupMembers.set(member.job.id, member.job);
    }
  }
  const group =
    candidate.jobA.duplicateGroupMembership?.group ??
    candidate.jobB.duplicateGroupMembership?.group;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Explainable duplicate candidate</p>
          <h1>Compare authoritative Jobs</h1>
        </div>
        <StatusBadge
          value={
            candidate.decisionNeedsReview
              ? "STALE"
              : (candidate.decision ?? (candidate.activeCandidate ? "PENDING" : "HISTORY"))
          }
        />
      </div>
      {query.decided ? (
        <div className="notice success">Duplicate decision recorded atomically.</div>
      ) : null}
      {candidate.decisionNeedsReview ? (
        <div className="notice error" role="alert">
          A compared Job or its evidence changed. Review the current values before reaffirming or
          changing the decision.
        </div>
      ) : null}
      {!candidate.activeCandidate ? (
        <div className="notice">
          This historical pair no longer satisfies candidate-generation rules.
        </div>
      ) : null}
      {group ? (
        <div className="notice">
          These records participate in a confirmed duplicate group.{" "}
          <Link href={`/jobs/duplicate-groups/${group.id}`}>Review group and primary Job</Link>.
        </div>
      ) : null}

      <section className="panel page-stack" aria-labelledby="matching-evidence">
        <div>
          <p className="eyebrow">{humanizeEnum(candidate.evidenceTier)} evidence</p>
          <h2 id="matching-evidence">Why this pair was generated</h2>
        </div>
        {evidence.qualifyingRules.map((item) => (
          <div className="evidence-row evidence-match" key={item.code}>
            <strong>{humanizeEnum(item.code)}</strong>
            <span>{item.fields.map(humanizeEnum).join(", ")}</span>
          </div>
        ))}
        {evidence.supportingRules.map((item) => (
          <div className="evidence-row" key={item.code}>
            <strong>{humanizeEnum(item.code)}</strong>
            <span>Supporting: {item.fields.map(humanizeEnum).join(", ")}</span>
          </div>
        ))}
        {conflicts.items.length > 0 ? <h3>Conflict evidence</h3> : null}
        {conflicts.items.map((item) => (
          <div className="evidence-row evidence-conflict" key={item.code}>
            <strong>{humanizeEnum(item.code)}</strong>
            <span>
              {item.fields.map(humanizeEnum).join(", ")}
              {item.leftCategory && item.rightCategory
                ? `: ${humanizeEnum(item.leftCategory)} / ${humanizeEnum(item.rightCategory)}`
                : ""}
            </span>
          </div>
        ))}
      </section>

      <div className="duplicate-comparison-grid">
        <JobComparisonCard label="Job A" job={candidate.jobA} />
        <JobComparisonCard label="Job B" job={candidate.jobB} />
      </div>

      {candidate.activeCandidate || candidate.decisionNeedsReview ? (
        <section className="page-stack">
          <div>
            <p className="eyebrow">Explicit user control</p>
            <h2>Record your decision</h2>
          </div>
          <DuplicateDecisionForms
            candidateId={candidate.id}
            version={candidate.version}
            jobs={[candidate.jobA, candidate.jobB]}
            groupMembers={[...groupMembers.values()]}
            idempotencyKeys={{
              same: randomUUID(),
              different: randomUUID(),
              deferred: randomUUID(),
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
