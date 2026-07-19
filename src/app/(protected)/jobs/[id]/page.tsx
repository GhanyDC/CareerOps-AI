import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateParseDraftForm } from "@/components/create-parse-draft-form";
import { JobForm } from "@/components/job-form";
import { JobStatusActions } from "@/components/job-status-actions";
import { StatusBadge } from "@/components/status-badge";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { persistedJobToValues } from "@/modules/jobs/schemas";
import { viewJob } from "@/modules/jobs/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmed?: string; saved?: string; transitioned?: string }>;
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
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Authoritative Job</p>
          <h1>{job.title}</h1>
          <p>{job.companyName ?? "Company not provided"}</p>
        </div>
        <StatusBadge value={job.status} />
      </div>
      {query.confirmed ? (
        <div className="notice success">
          Parse draft confirmed and authoritative Job stored atomically.
        </div>
      ) : null}
      {query.saved ? <div className="notice success">Authoritative Job updated.</div> : null}
      {query.transitioned ? <div className="notice success">Job status updated.</div> : null}
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
