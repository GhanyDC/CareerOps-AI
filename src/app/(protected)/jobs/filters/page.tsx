import { JobFilterScanForm } from "@/components/job-filter-scan-form";
import { JobFilterSettingsForm } from "@/components/job-filter-settings-form";
import { StatusBadge } from "@/components/status-badge";
import { defaultJobFilterConfiguration } from "@/modules/job-hard-filters/public";
import { viewJobFilterSettings } from "@/modules/job-hard-filters/public.server";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function JobFilterSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const { profile, counts, events } = await viewJobFilterSettings(userId);
  const scanCursor = one(query.scanCursor);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">User-controlled eligibility constraints</p>
          <h1>Job Hard Filters</h1>
          <p>
            Deterministic filters answer whether a Job remains eligible, not how good its fit is.
          </p>
        </div>
        <StatusBadge value={profile ? `PROFILE_V${profile.version}` : "NOT_CONFIGURED"} />
      </div>
      {one(query.saved) ? <div className="notice success">Filter settings saved.</div> : null}
      {one(query.scanned) ? (
        <div className="notice success">
          Reevaluated {one(query.scanned)} active authoritative Job(s).
        </div>
      ) : null}
      <section className="summary-grid" aria-label="Job filter summary">
        {[
          ["Pass", counts.pass],
          ["Fail", counts.fail],
          ["Needs review", counts.needsReview],
          ["Stale or not evaluated", counts.staleOrMissing],
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
          <JobFilterScanForm cursor={scanCursor} />
        </section>
      ) : null}
      <JobFilterSettingsForm
        configuration={profile?.configuration ?? defaultJobFilterConfiguration()}
        version={profile?.version}
      />
      {events.length > 0 ? (
        <section className="panel page-stack">
          <h2>Compact filter history</h2>
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
