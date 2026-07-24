import { JobScoringScanForm } from "@/components/job-scoring-scan-form";
import { JobScoringSettingsForm } from "@/components/job-scoring-settings-form";
import { StatusBadge } from "@/components/status-badge";
import { defaultJobScoringConfiguration } from "@/modules/job-scoring/public";
import { viewJobScoringSettings } from "@/modules/job-scoring/public.server";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function JobScoringSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const { profile, summary, events } = await viewJobScoringSettings(userId);
  const scanCursor = one(query.scanCursor);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">User-controlled soft preferences</p>
          <h1>Preliminary Job Scoring</h1>
          <p>
            Rank authoritative Jobs by structured preferences without assessing qualification or
            changing Hard Filter outcomes.
          </p>
        </div>
        <StatusBadge value={profile ? `PROFILE_V${profile.version}` : "NOT_CONFIGURED"} />
      </div>
      {one(query.saved) ? <div className="notice success">Scoring profile saved.</div> : null}
      {one(query.scanned) ? (
        <div className="notice success">
          Scored {one(query.scanned)} active authoritative Job(s).
        </div>
      ) : null}
      <section className="summary-grid" aria-label="Preliminary score summary">
        {[
          ["Score 80–100", summary.high],
          ["Score 60–79", summary.medium],
          ["Score 0–59", summary.low],
          ["No covered data", summary.noCoverage],
          ["Stale or not scored", summary.staleOrMissing],
          ["Average covered score", summary.averageScore],
        ].map(([label, count]) => (
          <div className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </section>
      {scanCursor ? (
        <section className="panel page-stack">
          <h2>More active Jobs remain</h2>
          <p>Continue the version-bound scan in another page of at most 50 Jobs.</p>
          <JobScoringScanForm cursor={scanCursor} />
        </section>
      ) : null}
      <JobScoringSettingsForm
        configuration={profile?.configuration ?? defaultJobScoringConfiguration()}
        version={profile?.version}
      />
      {events.length > 0 ? (
        <section className="panel page-stack">
          <h2>Compact scoring history</h2>
          <div className="audit-list">
            {events.map((event) => (
              <div key={event.id}>
                <span>{event.createdAt.toLocaleString()}</span>
                <strong>{humanizeEnum(event.eventType)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
