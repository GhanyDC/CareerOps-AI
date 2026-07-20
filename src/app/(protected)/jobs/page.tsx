import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { listJobs } from "@/modules/jobs/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const statusValue = one(query.status);
  const status = statusValue === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
  const employmentTypes = [
    "FULL_TIME",
    "PART_TIME",
    "CONTRACT",
    "TEMPORARY",
    "INTERNSHIP",
    "APPRENTICESHIP",
    "VOLUNTEER",
    "OTHER",
  ] as const;
  const arrangements = ["ON_SITE", "HYBRID", "REMOTE", "FIELD_BASED", "OTHER"] as const;
  const employmentType = employmentTypes.find((value) => value === one(query.employmentType));
  const workplaceArrangement = arrangements.find(
    (value) => value === one(query.workplaceArrangement),
  );
  const search = one(query.query)?.trim().slice(0, 200) || undefined;
  const direction = one(query.sort) === "OLDEST" ? "asc" : "desc";
  const { items, nextCursor } = await listJobs(userId, {
    status,
    employmentType,
    workplaceArrangement,
    query: search,
    direction,
    cursor: one(query.cursor),
  });
  const next = new URLSearchParams();
  next.set("status", status);
  if (employmentType) next.set("employmentType", employmentType);
  if (workplaceArrangement) next.set("workplaceArrangement", workplaceArrangement);
  if (search) next.set("query", search);
  if (direction === "asc") next.set("sort", "OLDEST");
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Authoritative Jobs</p>
          <h1>Confirmed opportunities</h1>
        </div>
        <Link className="button secondary" href="/jobs/review">
          Parsing review queue
        </Link>
        <Link className="button secondary" href="/jobs/duplicates">
          Duplicate review
        </Link>
      </div>
      <form className="filter-bar" method="get">
        <select name="status" defaultValue={status} aria-label="Job status">
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select
          name="employmentType"
          defaultValue={employmentType ?? ""}
          aria-label="Employment type"
        >
          <option value="">All employment types</option>
          {employmentTypes.map((value) => (
            <option value={value} key={value}>
              {humanizeEnum(value)}
            </option>
          ))}
        </select>
        <select
          name="workplaceArrangement"
          defaultValue={workplaceArrangement ?? ""}
          aria-label="Workplace arrangement"
        >
          <option value="">All arrangements</option>
          {arrangements.map((value) => (
            <option value={value} key={value}>
              {humanizeEnum(value)}
            </option>
          ))}
        </select>
        <input
          name="query"
          type="search"
          maxLength={200}
          defaultValue={search ?? ""}
          placeholder="Title or company"
          aria-label="Job search"
        />
        <select
          name="sort"
          defaultValue={direction === "asc" ? "OLDEST" : "NEWEST"}
          aria-label="Confirmation order"
        >
          <option value="NEWEST">Newest confirmed</option>
          <option value="OLDEST">Oldest confirmed</option>
        </select>
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="record-list">
        {items.map((job) => (
          <Link className="record-card" href={`/jobs/${job.id}`} key={job.id}>
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">{job.companyName ?? "Company not provided"}</span>
                <h2>{job.title}</h2>
              </div>
              <StatusBadge value={job.status} />
            </div>
            <div className="record-meta">
              <span>{job.locationLabel ?? "Location not provided"}</span>
              <span>
                {job.employmentType ? humanizeEnum(job.employmentType) : "Employment type unknown"}
              </span>
              <span>{job._count.sources} source record(s)</span>
              {job.duplicateCandidatesAsA.length + job.duplicateCandidatesAsB.length > 0 ? (
                <span>Possible duplicate review</span>
              ) : null}
              {job.duplicateGroupMembership ? (
                <span>
                  {job.duplicateGroupMembership.group.primaryJobId === job.id
                    ? "Primary duplicate-group record"
                    : "Confirmed duplicate-group member"}
                </span>
              ) : null}
              <span>Confirmed {job.confirmedAt.toLocaleString()}</span>
            </div>
          </Link>
        ))}
        {items.length === 0 ? (
          <div className="empty-state">
            No authoritative Jobs match this view. Confirm a Discovery parse draft to create one.
          </div>
        ) : null}
      </div>
      {nextCursor ? (
        <Link className="button secondary" href={`/jobs?${next.toString()}`}>
          Next page
        </Link>
      ) : null}
    </div>
  );
}
