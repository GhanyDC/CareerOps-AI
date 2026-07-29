import Link from "next/link";

import { RequirementCoverage } from "@/components/requirement-coverage";
import { getActiveRequirementCoverageSummary } from "@/modules/requirement-matching/public.server";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ActiveRequirementCoveragePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const includeDuplicateMembers = one(query.includeDuplicateMembers) === "1";
  const coverage = await getActiveRequirementCoverageSummary(userId, includeDuplicateMembers);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Requirement-to-Evidence Matching</p>
          <h1>Active requirement coverage</h1>
        </div>
        <Link className="button secondary" href="/jobs">
          Back to Jobs
        </Link>
      </div>
      <div className="notice">
        These are factual review counts, not a qualification or fit score. Matches show which
        Candidate Evidence records support a Job requirement; they do not guarantee application
        success.
      </div>
      <form className="filter-bar" method="get">
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="includeDuplicateMembers"
            value="1"
            defaultChecked={includeDuplicateMembers}
          />
          <span>Include duplicate members</span>
        </label>
        <button className="button secondary" type="submit">
          Update coverage
        </button>
      </form>
      <p>
        {includeDuplicateMembers
          ? "Every active authoritative Job is counted independently."
          : "Duplicate groups are collapsed to their explicit active primary for this consideration summary."}
      </p>
      <RequirementCoverage coverage={coverage} />
    </div>
  );
}
