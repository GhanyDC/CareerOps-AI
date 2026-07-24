import type { JobScoringExplanation } from "@/modules/job-scoring/public";
import { humanizeEnum } from "@/modules/shared/presentation";

import { JobScoreBadge } from "./job-score-badge";
import { StatusBadge } from "./status-badge";

function displayValue(value: unknown) {
  if (value === null) return "Not provided";
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "None";
  return String(value);
}

export function JobScoringResult({ explanation }: { explanation: JobScoringExplanation }) {
  return (
    <section className="panel page-stack">
      <div className="record-card-heading">
        <div>
          <p className="eyebrow">Preliminary preference score</p>
          <h2>Component explanation</h2>
        </div>
        <JobScoreBadge score={explanation.finalScore} coverage={explanation.coverage} />
      </div>
      <p>{explanation.summaryReason}</p>
      <p>
        Preliminary score reflects Job preferences only. Candidate qualification and evidence
        matching are evaluated separately.
      </p>
      {explanation.componentResults.map((component) => (
        <article className="preview-card" key={component.componentId}>
          <div className="record-card-heading">
            <strong>{humanizeEnum(component.componentId)}</strong>
            <StatusBadge value={component.enabled ? component.availability : "DISABLED"} />
          </div>
          {component.enabled ? (
            <>
              <p>{component.reason}</p>
              <dl className="details-list">
                <div>
                  <dt>Weight</dt>
                  <dd>{component.weight}</dd>
                </div>
                <div>
                  <dt>Raw score</dt>
                  <dd>{component.rawScore ?? "Excluded"}</dd>
                </div>
                <div>
                  <dt>Weighted contribution</dt>
                  <dd>{component.weightedContribution}</dd>
                </div>
                {Object.entries(component.jobValue).map(([field, value]) => (
                  <div key={`job-${field}`}>
                    <dt>Job {humanizeEnum(field)}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
                {Object.entries(component.configuredValue).map(([field, value]) => (
                  <div key={`configured-${field}`}>
                    <dt>Configured {humanizeEnum(field)}</dt>
                    <dd>
                      {typeof value === "object" && value !== null
                        ? Object.entries(value)
                            .map(
                              ([tier, entries]) =>
                                `${humanizeEnum(tier)}: ${displayValue(entries)}`,
                            )
                            .join("; ")
                        : displayValue(value)}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt>Reason code</dt>
                  <dd>{component.reasonCode}</dd>
                </div>
              </dl>
              {component.missingFields.length > 0 ? (
                <p>Missing fields: {component.missingFields.map(humanizeEnum).join(", ")}</p>
              ) : null}
            </>
          ) : (
            <p>This component is disabled and does not affect score or coverage.</p>
          )}
        </article>
      ))}
    </section>
  );
}
