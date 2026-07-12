import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { evidenceStrengths, verificationStatuses } from "@/modules/evidence/schemas";
import { listEvidenceItems, type EvidenceFilters } from "@/modules/evidence/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const sourceTypeValue = one(query.sourceType);
  const verificationValue = one(query.verificationStatus);
  const strengthValue = one(query.evidenceStrength);
  const filters: EvidenceFilters = {
    sourceType:
      sourceTypeValue === "EXPERIENCE" || sourceTypeValue === "PROJECT"
        ? (sourceTypeValue as "EXPERIENCE" | "PROJECT")
        : undefined,
    verificationStatus: verificationStatuses.find((status) => status === verificationValue),
    evidenceStrength: evidenceStrengths.find((strength) => strength === strengthValue),
    query: one(query.query)?.trim() || undefined,
  };
  const evidenceItems = await listEvidenceItems(userId, filters);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Evidence Bank</p>
          <h1>Atomic, reusable evidence</h1>
        </div>
        <Link className="button primary" href="/evidence/new">
          Add evidence
        </Link>
      </div>
      <form className="filter-bar" method="get">
        <select name="sourceType" defaultValue={filters.sourceType ?? ""} aria-label="Source type">
          <option value="">All sources</option>
          <option value="EXPERIENCE">Experiences</option>
          <option value="PROJECT">Projects</option>
        </select>
        <select
          name="verificationStatus"
          defaultValue={filters.verificationStatus ?? ""}
          aria-label="Verification status"
        >
          <option value="">All verification statuses</option>
          {verificationStatuses.map((status) => (
            <option value={status} key={status}>
              {humanizeEnum(status)}
            </option>
          ))}
        </select>
        <select
          name="evidenceStrength"
          defaultValue={filters.evidenceStrength ?? ""}
          aria-label="Evidence strength"
        >
          <option value="">All strengths</option>
          {evidenceStrengths.map((strength) => (
            <option value={strength} key={strength}>
              {humanizeEnum(strength)}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="query"
          defaultValue={filters.query ?? ""}
          placeholder="Claim, exact skill, or role family"
          aria-label="Evidence search"
        />
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      <div className="record-list">
        {evidenceItems.map((evidence) => {
          const source = evidence.sourceExperience
            ? `${evidence.sourceExperience.title}${evidence.sourceExperience.organization ? ` · ${evidence.sourceExperience.organization}` : ""}`
            : evidence.sourceProject?.name;
          const allowed = [
            evidence.allowedForResume && "Resume",
            evidence.allowedForCoverLetters && "Cover letters",
            evidence.allowedForInterviews && "Interviews",
            evidence.allowedForRecruiterMessages && "Recruiter messages",
          ].filter(Boolean);
          return (
            <Link className="record-card" href={`/evidence/${evidence.id}`} key={evidence.id}>
              <div className="record-card-heading">
                <div>
                  <span className="record-kicker">{source}</span>
                  <h2>{evidence.claim}</h2>
                </div>
                <StatusBadge value={evidence.verificationStatus} />
              </div>
              <div className="record-meta">
                <span>{humanizeEnum(evidence.evidenceStrength)}</span>
                <span>{allowed.join(" · ") || "No external usage allowed"}</span>
                <span>{evidence._count.claims} linked claims</span>
              </div>
            </Link>
          );
        })}
        {evidenceItems.length === 0 ? (
          <div className="empty-state">No evidence matches these filters.</div>
        ) : null}
      </div>
    </div>
  );
}
