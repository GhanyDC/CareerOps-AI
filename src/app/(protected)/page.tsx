import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { viewCandidateProfile } from "@/modules/candidate-profile/use-cases";
import { getDashboardSummary } from "@/modules/dashboard/queries";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { userId } = await getRequestContext();
  const [profile, summary] = await Promise.all([
    viewCandidateProfile(userId),
    getDashboardSummary(userId),
  ]);

  const cards = [
    ["Experiences", summary.experiences, "/experiences"],
    ["Projects", summary.projects, "/projects"],
    ["Evidence items", summary.evidenceItems, "/evidence"],
    ["Verified evidence", summary.verifiedEvidence, "/evidence?verificationStatus=VERIFIED"],
    ["Approved claims", summary.approvedClaims, "/claims?status=APPROVED"],
    ["Requires verification", summary.requiresVerification, "/claims?status=REQUIRES_VERIFICATION"],
    ["Prohibited claims", summary.prohibitedClaims, "/claims?status=PROHIBITED"],
    ["Inbox discoveries", summary.inboxDiscoveries, "/discoveries"],
    ["Active Jobs", summary.activeJobs, "/jobs"],
    ["Duplicate reviews", summary.pendingDuplicateReviews, "/jobs/duplicates"],
  ] as const;

  return (
    <div className="page-stack">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Authoritative candidate evidence</p>
          <h1>Candidate evidence dashboard</h1>
          <p>
            {profile?.fullName ?? "The development candidate"}&apos;s facts, evidence, and approved
            language remain structured, reviewable, and under human control.
          </p>
        </div>
        <StatusBadge value="DEVELOPMENT_ONLY" />
      </section>

      <section className="summary-grid" aria-label="Candidate evidence summary">
        {cards.map(([label, value, href]) => (
          <Link className="summary-card" href={href} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </Link>
        ))}
      </section>

      <section className="panel split-panel">
        <div>
          <p className="eyebrow">Evidence policy</p>
          <h2>Only approved, verified language is externally reusable</h2>
          <p>
            Draft and verification-required claims stay visibly restricted. Prohibited claims remain
            in audit history and must never enter later Work export packages.
          </p>
        </div>
        <div className="button-row">
          <Link className="button primary" href="/evidence/new">
            Add evidence
          </Link>
          <Link className="button secondary" href="/claims/new">
            Draft a claim
          </Link>
        </div>
      </section>
    </div>
  );
}
