import type { CoverageByImportance } from "@/modules/requirement-matching/public";
import { humanizeEnum } from "@/modules/shared/presentation";

export function RequirementCoverage({
  coverage,
  includeOther = true,
}: {
  coverage: CoverageByImportance;
  includeOther?: boolean;
}) {
  const importances = includeOther
    ? (["REQUIRED", "PREFERRED", "OTHER"] as const)
    : (["REQUIRED", "PREFERRED"] as const);
  return (
    <div className="page-stack">
      {importances.map((importance) => {
        const counts = coverage[importance];
        if (importance === "OTHER" && counts.total === 0) return null;
        return (
          <section className="page-stack" key={importance}>
            <h3>{humanizeEnum(importance)} requirements</h3>
            <div
              className="summary-grid"
              role="region"
              aria-label={`${humanizeEnum(importance)} coverage`}
            >
              {[
                ["Supported", counts.supported],
                ["Partially supported", counts.partiallySupported],
                ["Unsupported", counts.unsupported],
                ["Not reviewed", counts.notReviewed],
                ["Stale", counts.stale],
                ["Total", counts.total],
              ].map(([label, value]) => (
                <div className="summary-card" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
