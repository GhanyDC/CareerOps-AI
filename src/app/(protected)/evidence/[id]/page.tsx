import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EvidenceForm,
  type EvidenceFormValues,
  type EvidenceSourceOption,
} from "@/components/evidence-form";
import { ConfirmSubmitButton, MutationForm } from "@/components/form-controls";
import { StatusBadge } from "@/components/status-badge";
import { listAuditHistory } from "@/modules/audit/public.server";
import { deleteEvidenceAction, transitionEvidenceAction } from "@/modules/evidence/actions";
import { viewEvidenceItem } from "@/modules/evidence/use-cases";
import { listExperienceOptions } from "@/modules/experiences/use-cases";
import { listProjectOptions } from "@/modules/projects/use-cases";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum, listInputValue } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({
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
  let evidence;
  try {
    evidence = await viewEvidenceItem(userId, id);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const [experiences, projects, auditHistory] = await Promise.all([
    listExperienceOptions(userId),
    listProjectOptions(userId),
    listAuditHistory(userId, "EVIDENCE", id),
  ]);
  const sources: EvidenceSourceOption[] = [
    ...experiences.map((item) => ({
      value: `EXPERIENCE:${item.id}`,
      label: `Experience · ${item.title}${item.organization ? ` · ${item.organization}` : ""}`,
    })),
    ...projects.map((item) => ({ value: `PROJECT:${item.id}`, label: `Project · ${item.name}` })),
  ];
  const initial: EvidenceFormValues = {
    id: evidence.id,
    sourceReference:
      evidence.sourceType === "EXPERIENCE"
        ? `EXPERIENCE:${evidence.sourceExperienceId}`
        : `PROJECT:${evidence.sourceProjectId}`,
    claim: evidence.claim,
    supportingContext: evidence.supportingContext ?? "",
    skillsDemonstrated: listInputValue(evidence.skillsDemonstrated),
    relevantRoleFamilies: listInputValue(evidence.relevantRoleFamilies),
    evidenceStrength: evidence.evidenceStrength,
    allowedForResume: evidence.allowedForResume,
    allowedForCoverLetters: evidence.allowedForCoverLetters,
    allowedForInterviews: evidence.allowedForInterviews,
    allowedForRecruiterMessages: evidence.allowedForRecruiterMessages,
    sourceNotes: evidence.sourceNotes ?? "",
  };

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Evidence item</p>
          <h1>{evidence.claim}</h1>
        </div>
        <StatusBadge value={evidence.verificationStatus} />
      </div>
      {query.saved ? <div className="notice success">Evidence item saved.</div> : null}
      {query.transitioned ? (
        <div className="notice success">Evidence status updated and audited.</div>
      ) : null}
      <div className="button-row">
        {evidence.verificationStatus !== "VERIFIED" ? (
          <MutationForm action={transitionEvidenceAction}>
            <input type="hidden" name="id" value={evidence.id} />
            <input type="hidden" name="targetStatus" value="VERIFIED" />
            <button className="button primary" type="submit">
              Verify evidence
            </button>
          </MutationForm>
        ) : (
          <Link className="button primary" href={`/claims/new?evidenceId=${evidence.id}`}>
            Create claim from evidence
          </Link>
        )}
        {evidence.verificationStatus !== "REJECTED" ? (
          <MutationForm action={transitionEvidenceAction}>
            <input type="hidden" name="id" value={evidence.id} />
            <input type="hidden" name="targetStatus" value="REJECTED" />
            <ConfirmSubmitButton
              confirmation={
                evidence.verificationStatus === "VERIFIED"
                  ? "Reject this evidence? Linked approved claims will require verification again."
                  : "Reject this evidence?"
              }
            >
              Reject evidence
            </ConfirmSubmitButton>
          </MutationForm>
        ) : null}
        {evidence.verificationStatus === "VERIFIED" ? (
          <MutationForm action={transitionEvidenceAction}>
            <input type="hidden" name="id" value={evidence.id} />
            <input type="hidden" name="targetStatus" value="REQUIRES_VERIFICATION" />
            <ConfirmSubmitButton
              confirmation="Revoke verification? Linked approved claims will require verification again."
              tone="secondary"
            >
              Revoke verification
            </ConfirmSubmitButton>
          </MutationForm>
        ) : null}
      </div>
      <section className="panel">
        {evidence.verificationStatus === "VERIFIED" ? (
          <div className="notice">
            Verified evidence is locked. Revoke verification before changing its statement, source,
            strength, supporting information, skills, role families, or permitted uses.
          </div>
        ) : (
          <EvidenceForm mode="update" initial={initial} sources={sources} />
        )}
      </section>
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
      <section className="panel danger-zone">
        <h2>Delete evidence</h2>
        {evidence._count.claims > 0 ? (
          <p>
            Deletion is blocked because {evidence._count.claims} claim(s) depend on this evidence
            item.
          </p>
        ) : (
          <MutationForm action={deleteEvidenceAction}>
            <input type="hidden" name="id" value={evidence.id} />
            <ConfirmSubmitButton confirmation="Delete this evidence item? This cannot be undone.">
              Delete evidence
            </ConfirmSubmitButton>
          </MutationForm>
        )}
      </section>
    </div>
  );
}
