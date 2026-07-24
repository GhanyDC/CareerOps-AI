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
    ["Filter: pass", summary.jobFilters.pass, "/jobs?view=CONSIDERATION&filterOutcome=PASS"],
    ["Filter: fail", summary.jobFilters.fail, "/jobs?view=CONSIDERATION&filterOutcome=FAIL"],
    [
      "Filter: needs review",
      summary.jobFilters.needsReview,
      "/jobs?view=CONSIDERATION&filterOutcome=NEEDS_REVIEW",
    ],
    [
      "Filter: stale or missing",
      summary.jobFilters.staleOrMissing,
      "/jobs?view=CONSIDERATION&filterOutcome=STALE_OR_MISSING",
    ],
    [
      "Score: 80–100",
      summary.jobScoring.high,
      "/jobs?view=CONSIDERATION&sort=SCORE_DESC&minimumScore=80",
    ],
    [
      "Score: 60–79",
      summary.jobScoring.medium,
      "/jobs?view=CONSIDERATION&sort=SCORE_DESC&minimumScore=60&maximumScore=79",
    ],
    [
      "Score: 0–59",
      summary.jobScoring.low,
      "/jobs?view=CONSIDERATION&sort=SCORE_DESC&maximumScore=59",
    ],
    [
      "Score: stale or missing",
      summary.jobScoring.staleOrMissing,
      "/jobs?view=CONSIDERATION&sort=SCORE_DESC",
    ],
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
      {!summary.jobFilters.configured ? (
        <section className="notice">
          Job Hard Filters are not configured. <Link href="/jobs/filters">Configure filters</Link>.
        </section>
      ) : null}
      {!summary.jobScoring.configured ? (
        <section className="notice">
          Preliminary Job Scoring is not configured.{" "}
          <Link href="/jobs/scoring">Configure scoring</Link>.
        </section>
      ) : (
        <section className="notice">
          Average covered preliminary score: {summary.jobScoring.averageScore}/100. Scores reflect
          preferences only, not qualification.
        </section>
      )}
    </div>
  );
}
