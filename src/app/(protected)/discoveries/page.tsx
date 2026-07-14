import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { listDiscoveryInbox, listOwnedSourceLabels } from "@/modules/discovery/use-cases";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function DiscoveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const statusValue = one(query.status);
  const status = ["INBOX", "REJECTED", "ARCHIVED"].includes(statusValue ?? "")
    ? (statusValue as "INBOX" | "REJECTED" | "ARCHIVED")
    : statusValue === "ALL"
      ? undefined
      : "INBOX";
  const sourceLabel = one(query.sourceLabel)?.slice(0, 160) || undefined;
  const search = one(query.query)?.trim().slice(0, 200) || undefined;
  const [{ items, nextCursor }, sources] = await Promise.all([
    listDiscoveryInbox(userId, {
      status,
      sourceLabel,
      query: search,
      cursor: one(query.cursor),
    }),
    listOwnedSourceLabels(userId),
  ]);
  const next = new URLSearchParams();
  if (statusValue) next.set("status", statusValue);
  if (sourceLabel) next.set("sourceLabel", sourceLabel);
  if (search) next.set("query", search);
  if (nextCursor) next.set("cursor", nextCursor);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Discovery Inbox</p>
          <h1>Raw, unverified opportunities</h1>
        </div>
        <Link className="button primary" href="/discoveries/import">
          Import discoveries
        </Link>
      </div>
      {one(query.purged) ? (
        <div className="notice success">Import batch permanently purged.</div>
      ) : null}
      <form className="filter-bar discovery-filters" method="get">
        <select name="status" defaultValue={statusValue ?? "INBOX"} aria-label="Discovery status">
          <option value="INBOX">Inbox</option>
          <option value="REJECTED">Rejected</option>
          <option value="ARCHIVED">Archived</option>
          <option value="ALL">All statuses</option>
        </select>
        <select name="sourceLabel" defaultValue={sourceLabel ?? ""} aria-label="Opportunity source">
          <option value="">All sources</option>
          {sources.map(({ sourceLabel: source }) =>
            source ? (
              <option value={source} key={source}>
                {source}
              </option>
            ) : null,
          )}
        </select>
        <input
          name="query"
          type="search"
          defaultValue={search ?? ""}
          maxLength={200}
          placeholder="Hints, source, or raw text"
          aria-label="Discovery search"
        />
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="record-list">
        {items.map((discovery) => (
          <Link className="record-card" href={`/discoveries/${discovery.id}`} key={discovery.id}>
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">
                  {discovery.sourceLabel ?? discovery.batch.producerLabel}
                </span>
                <h2>{discovery.titleHint ?? "Untitled raw discovery"}</h2>
              </div>
              <StatusBadge value={discovery.status} />
            </div>
            <p>{discovery.companyHint ?? "No company hint"} · user-provided and unverified</p>
            <div className="record-meta">
              <span>{discovery.locationHint ?? "No location hint"}</span>
              <span>{discovery.createdAt.toLocaleString()}</span>
              <span>{discovery.batch.producerLabel}</span>
            </div>
          </Link>
        ))}
        {items.length === 0 ? (
          <div className="empty-state">
            No raw discoveries match this view. <Link href="/discoveries/import">Import one</Link>.
          </div>
        ) : null}
      </div>
      {nextCursor ? (
        <div className="button-row">
          <Link className="button secondary" href={`/discoveries?${next.toString()}`}>
            Next page
          </Link>
        </div>
      ) : null}
    </div>
  );
}
