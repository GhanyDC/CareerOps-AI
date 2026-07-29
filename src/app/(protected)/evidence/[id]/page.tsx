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
import {
  deleteEvidenceAction,
  transitionEvidenceAction,
  transitionEvidenceStateAction,
} from "@/modules/evidence/actions";
import { viewEvidenceItem } from "@/modules/evidence/use-cases";
import { indexEvidenceAction } from "@/modules/retrieval/actions";
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
  searchParams: Promise<{
    saved?: string;
    transitioned?: string;
    stateChanged?: string;
    indexed?: string;
    citationVersion?: string;
  }>;
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
        <div className="tag-row">
          <StatusBadge value={evidence.state} />
          <StatusBadge value={evidence.verificationStatus} />
        </div>
      </div>
      {query.saved ? <div className="notice success">Evidence item saved.</div> : null}
      {query.transitioned ? (
        <div className="notice success">Evidence status updated and audited.</div>
      ) : null}
      {query.stateChanged ? (
        <div className="notice success">Evidence archive state updated and audited.</div>
      ) : null}
      {query.indexed ? (
        <div className="notice success">
          Retrieval indexing completed with state {humanizeEnum(query.indexed)}.
        </div>
      ) : null}
      {query.citationVersion ? (
        Number(query.citationVersion) === evidence.version ? (
          <div className="notice success">
            Citation resolved to this authorized Evidence record at current version{" "}
            {evidence.version}.
          </div>
        ) : (
          <div className="notice">
            The citation requested Evidence version {query.citationVersion}; this record is now
            version {evidence.version}. The older retrieval citation is no longer current.
          </div>
        )
      ) : null}
      {evidence.state === "ARCHIVED" ? (
        <div className="notice">
          Archived Evidence is preserved but excluded from active retrieval and is read-only until
          restored.
        </div>
      ) : null}
      <div className="button-row">
        {evidence.state === "ACTIVE" ? (
          evidence.verificationStatus !== "VERIFIED" ? (
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
          )
        ) : null}
        {evidence.state === "ACTIVE" && evidence.verificationStatus !== "REJECTED" ? (
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
        {evidence.state === "ACTIVE" && evidence.verificationStatus === "VERIFIED" ? (
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
        {evidence.state === "ARCHIVED" ? (
          <dl className="details-list">
            <div>
              <dt>Evidence statement</dt>
              <dd>{evidence.claim}</dd>
            </div>
            <div>
              <dt>Supporting context</dt>
              <dd>{evidence.supportingContext ?? "Not provided"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{evidence.version}</dd>
            </div>
          </dl>
        ) : evidence.verificationStatus === "VERIFIED" ? (
          <div className="notice">
            Verified evidence is locked. Revoke verification before changing its statement, source,
            strength, supporting information, skills, role families, or permitted uses.
          </div>
        ) : (
          <EvidenceForm mode="update" initial={initial} sources={sources} />
        )}
      </section>
      <section className="panel page-stack">
        <div className="record-card-heading">
          <div>
            <h2>Grounded retrieval index</h2>
            <p>
              Canonical retrieval uses the Evidence statement, supporting context, safe
              classifications, skills, and role families. Source notes and operational metadata are
              excluded.
            </p>
          </div>
          <StatusBadge value={evidence.retrievalIndex?.status ?? "NOT_INDEXED"} />
        </div>
        {evidence.retrievalIndex ? (
          <div className="record-meta">
            <span>
              Lexical{" "}
              {evidence.retrievalIndex.lexicalCurrent && evidence.retrievalIndex.chunkCount > 0
                ? "current"
                : "not current"}
            </span>
            <span>
              Stored semantic {evidence.retrievalIndex.semanticCurrent ? "current" : "not current"}
            </span>
            <span>{evidence.retrievalIndex.chunkCount} chunk(s)</span>
            {evidence.retrievalIndex.errorCode ? (
              <span>{humanizeEnum(evidence.retrievalIndex.errorCode)}</span>
            ) : null}
          </div>
        ) : null}
        {evidence.state === "ACTIVE" ? (
          <MutationForm action={indexEvidenceAction}>
            <input type="hidden" name="evidenceItemId" value={evidence.id} />
            <input type="hidden" name="returnTo" value="evidence" />
            <button className="button primary" type="submit">
              {evidence.retrievalIndex?.status === "FAILED"
                ? "Retry retrieval indexing"
                : "Index or reindex Evidence"}
            </button>
          </MutationForm>
        ) : null}
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
      <section className="panel">
        <h2>{evidence.state === "ACTIVE" ? "Archive Evidence" : "Restore Evidence"}</h2>
        <p>
          {evidence.state === "ACTIVE"
            ? "Archiving preserves the authoritative record, claims, requirement links, and audits while removing derived retrieval chunks."
            : "Restoring preserves authority and marks the retrieval index stale until explicitly reindexed."}
        </p>
        <MutationForm action={transitionEvidenceStateAction}>
          <input type="hidden" name="id" value={evidence.id} />
          <input
            type="hidden"
            name="targetState"
            value={evidence.state === "ACTIVE" ? "ARCHIVED" : "ACTIVE"}
          />
          <input type="hidden" name="expectedVersion" value={evidence.version} />
          <ConfirmSubmitButton
            confirmation={
              evidence.state === "ACTIVE"
                ? "Archive this Evidence and remove its derived retrieval chunks?"
                : "Restore this Evidence? It must be reindexed before retrieval."
            }
            tone={evidence.state === "ACTIVE" ? "danger" : "primary"}
          >
            {evidence.state === "ACTIVE" ? "Archive Evidence" : "Restore Evidence"}
          </ConfirmSubmitButton>
        </MutationForm>
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
