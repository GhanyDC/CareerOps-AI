import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { claimStatuses } from "@/modules/claims/schemas";
import { listClaims } from "@/modules/claims/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const status = claimStatuses.find((candidate) => candidate === query.status);
  const claims = await listClaims(userId, status);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Claims Bank</p>
          <h1>Controlled external representations</h1>
        </div>
        <Link className="button primary" href="/claims/new">
          Draft claim
        </Link>
      </div>
      <form className="filter-bar" method="get">
        <select name="status" defaultValue={status ?? ""} aria-label="Claim status">
          <option value="">All claim statuses</option>
          {claimStatuses.map((claimStatus) => (
            <option value={claimStatus} key={claimStatus}>
              {humanizeEnum(claimStatus)}
            </option>
          ))}
        </select>
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="record-list">
        {claims.map((claim) => (
          <Link
            className={`record-card claim-${claim.status.toLowerCase()}`}
            href={`/claims/${claim.id}`}
            key={claim.id}
          >
            <div className="record-card-heading">
              <div>
                <span className="record-kicker">
                  {claim.evidenceItem ? "Linked evidence" : "Unlinked draft"}
                </span>
                <h2>{claim.claimText}</h2>
              </div>
              <StatusBadge value={claim.status} />
            </div>
            <p>{claim.reviewerNotes ?? "No reviewer notes."}</p>
            <div className="record-meta">
              <span>
                {claim.evidenceItem
                  ? `Evidence: ${humanizeEnum(claim.evidenceItem.verificationStatus)}`
                  : "Approval unavailable until verified evidence is linked"}
              </span>
            </div>
          </Link>
        ))}
        {claims.length === 0 ? (
          <div className="empty-state">No claims match this status.</div>
        ) : null}
      </div>
    </div>
  );
}
