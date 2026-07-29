import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmSubmitButton, MutationForm, SubmitButton } from "@/components/form-controls";
import { StatusBadge } from "@/components/status-badge";
import {
  completeRequirementReviewAction,
  createRequirementEvidenceLinkAction,
  deleteRequirementEvidenceLinkAction,
  transitionJobRequirementAction,
  updateJobRequirementAction,
  updateRequirementEvidenceLinkAction,
} from "@/modules/requirement-matching/actions";
import {
  requirementCategories,
  requirementImportances,
  requirementSources,
  requirementSupportLevels,
} from "@/modules/requirement-matching/public";
import { viewRequirementMatch } from "@/modules/requirement-matching/public.server";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function RequirementMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; requirementId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id: jobId, requirementId }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let view;
  try {
    view = await viewRequirementMatch(userId, requirementId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "REQUIREMENT_NOT_FOUND") notFound();
    throw error;
  }
  const { requirement, evidenceOptions, events } = view;
  if (requirement.jobId !== jobId) notFound();
  const readOnly = requirement.job.status === "ARCHIVED" || requirement.state === "ARCHIVED";
  const badge =
    requirement.assessment.freshness === "STALE" ? "STALE" : requirement.assessment.status;
  const evidenceCoordinates = JSON.stringify(
    requirement.evidenceLinks.map((link) => ({
      evidenceItemId: link.evidenceItemId,
      evidenceVersion: link.evidence.version,
    })),
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Requirement evidence review</p>
          <h1>{requirement.statement}</h1>
          <p>
            <Link href={`/jobs/${jobId}`}>{requirement.job.title}</Link>
            {requirement.job.companyName ? ` · ${requirement.job.companyName}` : ""}
          </p>
        </div>
        <StatusBadge value={badge} />
      </div>
      <div className="notice">
        Matches show which Candidate Evidence records support a Job requirement. They do not
        independently prove qualification or guarantee application success.
      </div>
      {!readOnly ? (
        <div className="button-row">
          <Link className="button primary" href={`/retrieval?requirementId=${requirement.id}`}>
            Find grounded Candidate Evidence
          </Link>
        </div>
      ) : null}
      {query.saved ? <div className="notice success">Requirement updated.</div> : null}
      {query.linked ? <div className="notice success">Candidate Evidence linked.</div> : null}
      {query.linkUpdated ? <div className="notice success">Evidence link updated.</div> : null}
      {query.unlinked ? <div className="notice success">Evidence link removed.</div> : null}
      {query.reviewed ? (
        <div className="notice success">Requirement evidence review completed and audited.</div>
      ) : null}
      {readOnly ? (
        <div className="notice">
          This requirement is read-only while the Job or requirement is archived. Existing links,
          review state, and freshness coordinates remain preserved.
        </div>
      ) : null}
      {requirement.assessment.freshness === "STALE" ? (
        <div className="notice">
          <strong>This review is stale.</strong>
          <ul>
            {requirement.assessment.staleReasons.map((reason) => (
              <li key={reason}>{humanizeEnum(reason)}</li>
            ))}
          </ul>
          Re-check the current requirement and linked Candidate Evidence, then complete review
          again.
        </div>
      ) : null}

      <section className="panel page-stack">
        <div className="record-card-heading">
          <div>
            <h2>Requirement definition</h2>
            <p>
              Version {requirement.version} · Match-set version {requirement.matchSetVersion}
            </p>
          </div>
          <StatusBadge value={requirement.state} />
        </div>
        {readOnly ? (
          <dl className="details-list">
            <div>
              <dt>Category</dt>
              <dd>{humanizeEnum(requirement.category)}</dd>
            </div>
            <div>
              <dt>Importance</dt>
              <dd>{humanizeEnum(requirement.importance)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{humanizeEnum(requirement.source)}</dd>
            </div>
          </dl>
        ) : (
          <MutationForm action={updateJobRequirementAction} className="form-stack">
            <input type="hidden" name="requirementId" value={requirement.id} />
            <input type="hidden" name="expectedVersion" value={requirement.version} />
            <label className="field">
              <span>Atomic requirement statement</span>
              <textarea
                name="statement"
                defaultValue={requirement.statement}
                maxLength={1000}
                rows={3}
                required
              />
            </label>
            <div className="form-grid three-columns">
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue={requirement.category} required>
                  {requirementCategories.map((category) => (
                    <option value={category} key={category}>
                      {humanizeEnum(category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Importance</span>
                <select name="importance" defaultValue={requirement.importance} required>
                  {requirementImportances.map((importance) => (
                    <option value={importance} key={importance}>
                      {humanizeEnum(importance)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Source classification</span>
                <select name="source" defaultValue={requirement.source} required>
                  {requirementSources.map((source) => (
                    <option value={source} key={source}>
                      {humanizeEnum(source)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SubmitButton>Save requirement</SubmitButton>
          </MutationForm>
        )}
      </section>

      <section className="panel page-stack">
        <div className="record-card-heading">
          <div>
            <h2>Linked Candidate Evidence</h2>
            <p>
              Full support means the linked record directly supports the complete requirement.
              Partial support means it supports only part of it.
            </p>
          </div>
          <span>{requirement.evidenceLinks.length} link(s)</span>
        </div>
        <div className="record-list">
          {requirement.evidenceLinks.map((link) => {
            const source = link.evidence.sourceExperience
              ? `${link.evidence.sourceExperience.title}${
                  link.evidence.sourceExperience.organization
                    ? ` · ${link.evidence.sourceExperience.organization}`
                    : ""
                }`
              : link.evidence.sourceProject?.name;
            return (
              <article className="record-card" key={link.id}>
                <div className="record-card-heading">
                  <div>
                    <span className="record-kicker">{source}</span>
                    <h3>{link.evidence.claim}</h3>
                  </div>
                  <StatusBadge value={link.supportLevel} />
                </div>
                <div className="record-meta">
                  <span>{humanizeEnum(link.evidence.verificationStatus)}</span>
                  <span>{humanizeEnum(link.evidence.evidenceStrength)}</span>
                  <span>Evidence version {link.evidence.version}</span>
                  <span>Reviewed version {link.reviewedEvidenceVersion ?? "not yet reviewed"}</span>
                </div>
                {readOnly ? (
                  link.rationale ? (
                    <p>{link.rationale}</p>
                  ) : null
                ) : (
                  <MutationForm action={updateRequirementEvidenceLinkAction} className="form-stack">
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="linkId" value={link.id} />
                    <input type="hidden" name="expectedLinkVersion" value={link.version} />
                    <input
                      type="hidden"
                      name="expectedRequirementVersion"
                      value={requirement.version}
                    />
                    <input
                      type="hidden"
                      name="expectedMatchSetVersion"
                      value={requirement.matchSetVersion}
                    />
                    <div className="form-grid two-columns">
                      <label className="field">
                        <span>Support level</span>
                        <select name="supportLevel" defaultValue={link.supportLevel} required>
                          {requirementSupportLevels.map((level) => (
                            <option value={level} key={level}>
                              {humanizeEnum(level)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Short rationale</span>
                        <input
                          name="rationale"
                          defaultValue={link.rationale ?? ""}
                          maxLength={500}
                        />
                      </label>
                    </div>
                    <SubmitButton>Update evidence link</SubmitButton>
                  </MutationForm>
                )}
                {!readOnly ? (
                  <MutationForm action={deleteRequirementEvidenceLinkAction}>
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="linkId" value={link.id} />
                    <input type="hidden" name="expectedLinkVersion" value={link.version} />
                    <input
                      type="hidden"
                      name="expectedRequirementVersion"
                      value={requirement.version}
                    />
                    <input
                      type="hidden"
                      name="expectedMatchSetVersion"
                      value={requirement.matchSetVersion}
                    />
                    <ConfirmSubmitButton confirmation="Remove this evidence link? The existing review will become stale until reviewed again.">
                      Remove evidence link
                    </ConfirmSubmitButton>
                  </MutationForm>
                ) : null}
              </article>
            );
          })}
          {requirement.evidenceLinks.length === 0 ? (
            <div className="empty-state">
              No Candidate Evidence is currently linked. This remains not reviewed until the user
              explicitly completes review with no recorded evidence.
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <MutationForm action={completeRequirementReviewAction} className="form-stack">
            <input type="hidden" name="requirementId" value={requirement.id} />
            <input type="hidden" name="expectedRequirementVersion" value={requirement.version} />
            <input
              type="hidden"
              name="expectedMatchSetVersion"
              value={requirement.matchSetVersion}
            />
            <input
              type="hidden"
              name="expectedReviewVersion"
              value={requirement.review?.version ?? 0}
            />
            <input type="hidden" name="evidenceCoordinates" value={evidenceCoordinates} />
            {requirement.evidenceLinks.length === 0 ? (
              <ConfirmSubmitButton
                confirmation="Confirm that no supporting Candidate Evidence is currently recorded? This records Unsupported, not that the candidate lacks the capability."
                tone="primary"
              >
                Complete review: no recorded evidence
              </ConfirmSubmitButton>
            ) : (
              <ConfirmSubmitButton
                confirmation="Complete this review using the current requirement and linked Candidate Evidence versions?"
                tone="primary"
              >
                Complete evidence review
              </ConfirmSubmitButton>
            )}
          </MutationForm>
        ) : null}
      </section>

      {!readOnly ? (
        <section className="panel page-stack">
          <div>
            <h2>Browse Candidate Evidence</h2>
            <p>
              Up to 50 recently updated unlinked records are shown. CareerOps does not infer,
              suggest, or automatically create matches.
            </p>
          </div>
          <div className="record-list">
            {evidenceOptions.map((evidence) => {
              const source = evidence.sourceExperience
                ? `${evidence.sourceExperience.title}${
                    evidence.sourceExperience.organization
                      ? ` · ${evidence.sourceExperience.organization}`
                      : ""
                  }`
                : evidence.sourceProject?.name;
              return (
                <article className="record-card" key={evidence.id}>
                  <div className="record-card-heading">
                    <div>
                      <span className="record-kicker">{source}</span>
                      <h3>{evidence.claim}</h3>
                    </div>
                    <StatusBadge value={evidence.verificationStatus} />
                  </div>
                  <div className="record-meta">
                    <span>{humanizeEnum(evidence.evidenceStrength)}</span>
                    <span>Evidence version {evidence.version}</span>
                  </div>
                  <MutationForm action={createRequirementEvidenceLinkAction} className="form-stack">
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <input type="hidden" name="evidenceItemId" value={evidence.id} />
                    <input type="hidden" name="expectedEvidenceVersion" value={evidence.version} />
                    <input
                      type="hidden"
                      name="expectedRequirementVersion"
                      value={requirement.version}
                    />
                    <input
                      type="hidden"
                      name="expectedMatchSetVersion"
                      value={requirement.matchSetVersion}
                    />
                    <div className="form-grid two-columns">
                      <label className="field">
                        <span>Support level</span>
                        <select name="supportLevel" defaultValue="FULL" required>
                          {requirementSupportLevels.map((level) => (
                            <option value={level} key={level}>
                              {humanizeEnum(level)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Optional short rationale</span>
                        <input name="rationale" maxLength={500} />
                      </label>
                    </div>
                    <SubmitButton>Link this evidence</SubmitButton>
                  </MutationForm>
                </article>
              );
            })}
            {evidenceOptions.length === 0 ? (
              <div className="empty-state">No unlinked Candidate Evidence matches this view.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="panel page-stack">
        <h2>Compact match events</h2>
        <div className="audit-list">
          {events.map((event) => (
            <div key={event.id}>
              <strong>{humanizeEnum(event.eventType)}</strong>
              <span>{event.createdAt.toLocaleString()}</span>
            </div>
          ))}
          {events.length === 0 ? <p>No matching events recorded yet.</p> : null}
        </div>
      </section>
      {!readOnly ? (
        <section className="panel danger-zone">
          <h2>Archive requirement</h2>
          <p>
            Archiving preserves evidence links, review history, events, and freshness coordinates.
          </p>
          <MutationForm action={transitionJobRequirementAction}>
            <input type="hidden" name="requirementId" value={requirement.id} />
            <input type="hidden" name="targetState" value="ARCHIVED" />
            <input type="hidden" name="expectedVersion" value={requirement.version} />
            <ConfirmSubmitButton confirmation="Archive this requirement and preserve its match history?">
              Archive requirement
            </ConfirmSubmitButton>
          </MutationForm>
        </section>
      ) : null}
    </div>
  );
}
