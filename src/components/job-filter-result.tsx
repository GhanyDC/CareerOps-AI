import { StatusBadge } from "./status-badge";
import { humanizeEnum } from "@/modules/shared/presentation";
import type { JobFilterExplanation } from "@/modules/job-hard-filters/public";

function displayValue(value: unknown) {
  if (value === null) return "Not provided";
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "None";
  return String(value);
}

export function JobFilterResult({ explanation }: { explanation: JobFilterExplanation }) {
  return (
    <section className="panel page-stack">
      <div className="record-card-heading">
        <div>
          <p className="eyebrow">Hard-filter result</p>
          <h2>Rule-by-rule explanation</h2>
        </div>
        <StatusBadge value={explanation.overallOutcome} />
      </div>
      <p>{explanation.summaryReason}</p>
      {explanation.ruleResults.map((rule) => (
        <article className="preview-card" key={rule.ruleId}>
          <div className="record-card-heading">
            <strong>{humanizeEnum(rule.ruleId)}</strong>
            <StatusBadge value={rule.enabled ? rule.outcome : "DISABLED"} />
          </div>
          {rule.enabled ? (
            <>
              <p>{rule.reason}</p>
              <dl className="details-list">
                {Object.entries(rule.jobValue).map(([field, value]) => (
                  <div key={`job-${field}`}>
                    <dt>Job {humanizeEnum(field)}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
                {Object.entries(rule.configuredValue).map(([field, value]) => (
                  <div key={`configured-${field}`}>
                    <dt>Configured {humanizeEnum(field)}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Reason code</dt>
                  <dd>{rule.reasonCode}</dd>
                </div>
              </dl>
              {rule.missingFields.length > 0 ? (
                <p>Missing fields: {rule.missingFields.map(humanizeEnum).join(", ")}</p>
              ) : null}
              {rule.conflictFields.length > 0 ? (
                <p>Conflict fields: {rule.conflictFields.map(humanizeEnum).join(", ")}</p>
              ) : null}
            </>
          ) : (
            <p>This rule is disabled and does not affect the overall result.</p>
          )}
        </article>
      ))}
    </section>
  );
}
