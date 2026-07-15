import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";

import { JobParseReviewForm } from "@/components/job-parse-review-form";
import { StatusBadge } from "@/components/status-badge";
import { JobParsingError } from "@/modules/job-parsing/errors";
import { viewParseDraft } from "@/modules/job-parsing/use-cases";
import { correctionPayloadSchema } from "@/modules/job-parsing/schemas";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function JobParseReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ draftId }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let draft;
  try {
    draft = await viewParseDraft(userId, draftId);
  } catch (error) {
    if (error instanceof JobParsingError && error.code === "PARSE_DRAFT_NOT_FOUND") notFound();
    throw error;
  }
  if (draft.status !== "READY_FOR_REVIEW" || !draft.discovery) notFound();
  const correction = correctionPayloadSchema.parse(draft.userCorrections);
  const validation = draft.validationSummary as { warningCodes?: string[]; parserMode?: string };
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Non-authoritative parse draft</p>
          <h1>{draft.targetJobId ? "Review reparse changes" : "Review structured Job"}</h1>
        </div>
        <StatusBadge value={draft.status} />
      </div>
      {query.saved ? (
        <div className="notice success">
          Corrections saved. Review the current representation before confirming.
        </div>
      ) : null}
      <div className="parse-review-grid">
        <aside className="panel page-stack">
          <div>
            <h2>Raw source</h2>
            <p>
              Parser mode: {validation.parserMode ?? "Unknown"}. Raw content remains unverified.
            </p>
          </div>
          {(validation.warningCodes?.length ?? 0) > 0 ? (
            <div className="notice">Review warnings: {validation.warningCodes?.join(", ")}</div>
          ) : null}
          <dl className="details-list">
            <div>
              <dt>Title hint</dt>
              <dd>{draft.discovery.titleHint ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Company hint</dt>
              <dd>{draft.discovery.companyHint ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Location hint</dt>
              <dd>{draft.discovery.locationHint ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Parser</dt>
              <dd>{draft.parserVersion}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>Version {draft.contractVersion}</dd>
            </div>
          </dl>
          <pre className="raw-content">{draft.discovery.rawContent}</pre>
        </aside>
        <JobParseReviewForm
          draftId={draft.id}
          version={draft.version}
          values={correction.values}
          idempotencyKey={randomUUID()}
          isReparse={Boolean(draft.targetJobId)}
        />
      </div>
    </div>
  );
}
