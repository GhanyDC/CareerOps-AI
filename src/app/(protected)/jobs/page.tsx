import Link from "next/link";

import { JobScoreBadge } from "@/components/job-score-badge";
import { StatusBadge } from "@/components/status-badge";
import { isJobFilterEvaluationFresh } from "@/modules/job-hard-filters/public.server";
import { isPreliminaryJobScoreFresh } from "@/modules/job-scoring/public.server";
import { listJobs } from "@/modules/jobs/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function scoreBound(value: string | undefined) {
  if (!value || !/^\d{1,3}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 100 ? parsed : undefined;
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
  const sort = one(query.sort);
  const direction = sort === "OLDEST" ? "asc" : "desc";
  const scoreSort = sort === "SCORE_DESC";
  const minimumScore = scoreBound(one(query.minimumScore));
  const maximumScore = scoreBound(one(query.maximumScore));
  const outcomes = ["PASS", "FAIL", "NEEDS_REVIEW", "STALE_OR_MISSING"] as const;
  const filterOutcome = outcomes.find((value) => value === one(query.filterOutcome));
  const consideration = one(query.view) === "CONSIDERATION";
  const includeDuplicateMembers = one(query.includeDuplicateMembers) === "1";
  const excludeHardFilterFails = one(query.excludeHardFilterFails) === "1";
  const { items, nextCursor, filterProfile, scoringProfile } = await listJobs(userId, {
    status,
    employmentType,
    workplaceArrangement,
    query: search,
    direction,
    cursor: one(query.cursor),
    filterOutcome,
    consideration: consideration && !includeDuplicateMembers,
    scoreSort,
    minimumScore,
    maximumScore,
    excludeHardFilterFails: consideration && excludeHardFilterFails,
  });
  const next = new URLSearchParams();
  next.set("status", status);
  if (employmentType) next.set("employmentType", employmentType);
  if (workplaceArrangement) next.set("workplaceArrangement", workplaceArrangement);
  if (search) next.set("query", search);
  if (scoreSort) next.set("sort", "SCORE_DESC");
  else if (direction === "asc") next.set("sort", "OLDEST");
  if (minimumScore !== undefined) next.set("minimumScore", String(minimumScore));
  if (maximumScore !== undefined) next.set("maximumScore", String(maximumScore));
  if (filterOutcome) next.set("filterOutcome", filterOutcome);
  if (consideration) next.set("view", "CONSIDERATION");
  if (includeDuplicateMembers) next.set("includeDuplicateMembers", "1");
  if (excludeHardFilterFails) next.set("excludeHardFilterFails", "1");
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
        <Link className="button secondary" href="/jobs/filters">
          Hard filter settings
        </Link>
        <Link className="button secondary" href="/jobs/scoring">
          Scoring settings
        </Link>
        <Link className="button secondary" href="/jobs/requirements">
          Requirement coverage
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
          name="filterOutcome"
          defaultValue={filterOutcome ?? ""}
          aria-label="Hard-filter result"
        >
          <option value="">All hard-filter results</option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="STALE_OR_MISSING">Stale or not evaluated</option>
        </select>
        <select
          name="view"
          defaultValue={consideration ? "CONSIDERATION" : "INVENTORY"}
          aria-label="Job view"
        >
          <option value="INVENTORY">Authoritative inventory</option>
          <option value="CONSIDERATION">Consideration view</option>
        </select>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="includeDuplicateMembers"
            value="1"
            defaultChecked={includeDuplicateMembers}
          />
          <span>Include duplicate members</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="excludeHardFilterFails"
            value="1"
            defaultChecked={excludeHardFilterFails}
          />
          <span>Exclude current Hard Filter FAILs in consideration view</span>
        </label>
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
          defaultValue={scoreSort ? "SCORE_DESC" : direction === "asc" ? "OLDEST" : "NEWEST"}
          aria-label="Job sort"
        >
          <option value="NEWEST">Newest confirmed</option>
          <option value="OLDEST">Oldest confirmed</option>
          <option value="SCORE_DESC">Highest preliminary score</option>
        </select>
        <input
          name="minimumScore"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={minimumScore}
          placeholder="Minimum score"
          aria-label="Minimum preliminary score"
        />
        <input
          name="maximumScore"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={maximumScore}
          placeholder="Maximum score"
          aria-label="Maximum preliminary score"
        />
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="notice">
        Preliminary score reflects Job preferences only. Hard Filter status remains a separate
        eligibility signal; qualification and evidence matching are evaluated separately.
      </div>
      <div className="record-list">
        {items.map((job) => (
          <Link className="record-card" href={`/jobs/${job.id}`} key={job.id}>
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">{job.companyName ?? "Company not provided"}</span>
                <h2>{job.title}</h2>
              </div>
              <StatusBadge value={job.status} />
              {job.status === "ARCHIVED" && job.preliminaryScore ? (
                <JobScoreBadge
                  score={job.preliminaryScore.score}
                  coverage={job.preliminaryScore.coverage}
                />
              ) : !scoringProfile ? (
                <StatusBadge value="SCORING_NOT_CONFIGURED" />
              ) : isPreliminaryJobScoreFresh(scoringProfile, job, job.preliminaryScore) ? (
                <JobScoreBadge
                  score={job.preliminaryScore!.score}
                  coverage={job.preliminaryScore!.coverage}
                />
              ) : job.preliminaryScore ? (
                <StatusBadge value="STALE_SCORE" />
              ) : (
                <StatusBadge value="NOT_SCORED" />
              )}
              {job.status === "ARCHIVED" && job.filterEvaluation ? (
                <StatusBadge value={job.filterEvaluation.outcome} />
              ) : !filterProfile ? (
                <StatusBadge value="FILTERS_NOT_CONFIGURED" />
              ) : isJobFilterEvaluationFresh(filterProfile, job, job.filterEvaluation) ? (
                <StatusBadge value={job.filterEvaluation!.outcome} />
              ) : job.filterEvaluation ? (
                <StatusBadge value="STALE" />
              ) : (
                <StatusBadge value="NOT_EVALUATED" />
              )}
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
