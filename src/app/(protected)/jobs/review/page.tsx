import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { listReviewDrafts } from "@/modules/job-parsing/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function JobReviewQueuePage() {
  const { userId } = await getRequestContext();
  const [ready, rejected, superseded] = await Promise.all([
    listReviewDrafts(userId, "READY_FOR_REVIEW"),
    listReviewDrafts(userId, "REJECTED"),
    listReviewDrafts(userId, "SUPERSEDED"),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Parsing review queue</p>
          <h1>Human review before authority</h1>
        </div>
        <Link className="button secondary" href="/discoveries">
          Discoveries awaiting parsing
        </Link>
      </div>
      <section className="panel page-stack">
        <h2>Awaiting review</h2>
        <div className="record-list">
          {ready.map((draft) => (
            <Link className="record-card" href={`/jobs/review/${draft.id}`} key={draft.id}>
              <div className="record-card-heading">
                <h3>
                  {draft.discovery?.titleHint ?? draft.targetJob?.title ?? "Untitled parse draft"}
                </h3>
                <StatusBadge value={draft.status} />
              </div>
              <span>
                {draft.targetJob ? "Reparse review" : "Initial Job review"} · updated{" "}
                {draft.updatedAt.toLocaleString()}
              </span>
            </Link>
          ))}
          {ready.length === 0 ? (
            <div className="empty-state">No parse drafts are waiting for review.</div>
          ) : null}
        </div>
      </section>
      <section className="panel page-stack">
        <h2>Rejected and superseded history</h2>
        {[...rejected, ...superseded].map((draft) => (
          <div className="record-card" key={draft.id}>
            <div className="record-card-heading">
              <span>
                {draft.discovery?.titleHint ?? draft.targetJob?.title ?? "Historical draft"}
              </span>
              <StatusBadge value={draft.status} />
            </div>
          </div>
        ))}
        {rejected.length + superseded.length === 0 ? (
          <div className="empty-state">No rejected or superseded drafts.</div>
        ) : null}
      </section>
    </div>
  );
}
