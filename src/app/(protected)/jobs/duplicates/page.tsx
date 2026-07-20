import Link from "next/link";

import { DuplicateScanForm } from "@/components/duplicate-scan-form";
import { StatusBadge } from "@/components/status-badge";
import { DUPLICATE_QUEUE_VIEWS, listDuplicateCandidates } from "@/modules/job-duplicates/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function DuplicateReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const requestedView = one(query.view);
  const view = DUPLICATE_QUEUE_VIEWS.find((item) => item === requestedView) ?? "PENDING";
  const { items, nextCursor } = await listDuplicateCandidates(userId, {
    view,
    cursor: one(query.cursor),
  });
  const next = new URLSearchParams({ view });
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Duplicate review</p>
          <h1>Possible duplicate Jobs</h1>
          <p>Deterministic candidates remain unconfirmed until you decide.</p>
        </div>
        <DuplicateScanForm cursor={one(query.scanCursor)} />
      </div>
      {one(query.scanned) ? (
        <div className="notice success">
          Scanned {one(query.scanned)} authoritative Job(s).
          {one(query.scanCursor)
            ? " Continue the bounded scan to process more."
            : " Scan complete."}
        </div>
      ) : null}
      <nav className="filter-bar" aria-label="Duplicate queue views">
        {DUPLICATE_QUEUE_VIEWS.map((item) => (
          <Link
            className={`button ${item === view ? "primary" : "secondary"}`}
            href={`/jobs/duplicates?view=${item}`}
            key={item}
          >
            {humanizeEnum(item)}
          </Link>
        ))}
      </nav>
      <div className="record-list">
        {items.map((candidate) => (
          <Link
            className="record-card"
            href={`/jobs/duplicates/${candidate.id}`}
            key={candidate.id}
          >
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">
                  {humanizeEnum(candidate.evidenceTier)} evidence
                </span>
                <h2>
                  {candidate.jobA.title} / {candidate.jobB.title}
                </h2>
              </div>
              <StatusBadge
                value={
                  candidate.decisionNeedsReview
                    ? "STALE"
                    : (candidate.decision ?? (candidate.activeCandidate ? "PENDING" : "HISTORY"))
                }
              />
            </div>
            <div className="record-meta">
              <span>{candidate.jobA.companyName ?? "Company A unknown"}</span>
              <span>{candidate.jobB.companyName ?? "Company B unknown"}</span>
              <span>Version {candidate.version}</span>
              <span>Evaluated {candidate.evaluatedAt.toLocaleString()}</span>
            </div>
          </Link>
        ))}
        {items.length === 0 ? (
          <div className="empty-state">
            No candidates match this view. Run the bounded scan after importing existing Jobs.
          </div>
        ) : null}
      </div>
      {nextCursor ? (
        <Link className="button secondary" href={`/jobs/duplicates?${next.toString()}`}>
          Next page
        </Link>
      ) : null}
    </div>
  );
}
