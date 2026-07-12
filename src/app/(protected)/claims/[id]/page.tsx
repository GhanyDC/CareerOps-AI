import { notFound } from "next/navigation";

import { ClaimForm, type ClaimFormValues } from "@/components/claim-form";
import { ConfirmSubmitButton, MutationForm } from "@/components/form-controls";
import { StatusBadge } from "@/components/status-badge";
import { listAuditHistory } from "@/modules/audit/public.server";
import { transitionClaimAction } from "@/modules/claims/actions";
import { viewClaim } from "@/modules/claims/use-cases";
import { listVerifiedEvidenceOptions } from "@/modules/evidence/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function TransitionForm({
  id,
  targetStatus,
  label,
  confirmation,
  tone,
}: {
  id: string;
  targetStatus: string;
  label: string;
  confirmation?: string;
  tone: "primary" | "secondary" | "danger";
}) {
  return (
    <MutationForm action={transitionClaimAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="targetStatus" value={targetStatus} />
      {confirmation ? (
        <ConfirmSubmitButton confirmation={confirmation} tone={tone}>
          {label}
        </ConfirmSubmitButton>
      ) : (
        <button className={`button ${tone}`} type="submit">
          {label}
        </button>
      )}
    </MutationForm>
  );
}

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; transitioned?: string }>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let claim;
  try {
    claim = await viewClaim(userId, id);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const [verifiedEvidence, auditHistory] = await Promise.all([
    listVerifiedEvidenceOptions(userId),
    listAuditHistory(userId, "CLAIM", id),
  ]);
  const editable = claim.status === "DRAFT" || claim.status === "REQUIRES_VERIFICATION";
  const initial: ClaimFormValues = {
    id: claim.id,
    evidenceItemId: claim.evidenceItemId ?? "",
    claimText: claim.claimText,
    reviewerNotes: claim.reviewerNotes ?? "",
    allowedForResume: claim.allowedForResume,
    allowedForCoverLetters: claim.allowedForCoverLetters,
    allowedForInterviews: claim.allowedForInterviews,
    allowedForRecruiterMessages: claim.allowedForRecruiterMessages,
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Claims Bank item</p>
          <h1>{claim.claimText}</h1>
        </div>
        <StatusBadge value={claim.status} />
      </div>
      {query.saved ? <div className="notice success">Draft claim saved.</div> : null}
      {query.transitioned ? (
        <div className="notice success">Claim status updated and audited.</div>
      ) : null}
      <div className="button-row">
        {editable && claim.evidenceItem?.verificationStatus === "VERIFIED" ? (
          <TransitionForm
            id={claim.id}
            targetStatus="APPROVED"
            label="Approve claim"
            tone="primary"
            confirmation="Approve this exact claim for its selected usage contexts?"
          />
        ) : null}
        {claim.status !== "REQUIRES_VERIFICATION" &&
        claim.status !== "ARCHIVED" &&
        claim.status !== "PROHIBITED" ? (
          <TransitionForm
            id={claim.id}
            targetStatus="REQUIRES_VERIFICATION"
            label="Require verification"
            tone="secondary"
          />
        ) : null}
        {claim.status !== "PROHIBITED" && claim.status !== "ARCHIVED" ? (
          <TransitionForm
            id={claim.id}
            targetStatus="PROHIBITED"
            label="Prohibit claim"
            tone="danger"
            confirmation="Prohibit this claim? It will be excluded from all later export packages."
          />
        ) : null}
        {claim.status !== "ARCHIVED" ? (
          <TransitionForm
            id={claim.id}
            targetStatus="ARCHIVED"
            label="Archive claim"
            tone="secondary"
            confirmation="Archive this claim while preserving its audit history?"
          />
        ) : null}
      </div>
      {editable ? (
        <section className="panel">
          <ClaimForm mode="update" initial={initial} evidenceOptions={verifiedEvidence} />
        </section>
      ) : (
        <section className={`panel claim-${claim.status.toLowerCase()}`}>
          <h2>Immutable reviewed representation</h2>
          <p>{claim.claimText}</p>
          <dl className="details-list">
            <div>
              <dt>Linked evidence</dt>
              <dd>{claim.evidenceItem?.claim ?? "None"}</dd>
            </div>
            <div>
              <dt>Reviewer notes</dt>
              <dd>{claim.reviewerNotes ?? "None"}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{claim.approvedAt?.toLocaleString() ?? "Not approved"}</dd>
            </div>
          </dl>
        </section>
      )}
      <section className="panel">
        <h2>Audit history</h2>
        <div className="audit-list">
          {auditHistory.map((entry) => (
            <div key={entry.id}>
              <strong>{humanizeEnum(entry.action)}</strong>
              <span>{entry.createdAt.toLocaleString()}</span>
            </div>
          ))}
          {auditHistory.length === 0 ? <p>No status transitions recorded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
