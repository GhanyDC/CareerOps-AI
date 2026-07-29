import Link from "next/link";

import { GroundedRetrievalResults } from "@/components/grounded-retrieval-results";
import { MutationForm, SubmitButton } from "@/components/form-controls";
import { RetrievalSearchForm } from "@/components/retrieval-search-form";
import { StatusBadge } from "@/components/status-badge";
import { indexEvidenceAction, reindexEvidencePageAction } from "@/modules/retrieval/actions";
import {
  listRetrievalDiagnostics,
  retrieveForJob,
  retrieveForRequirement,
  type GroundedRetrievalPacket,
} from "@/modules/retrieval/public.server";
import { DomainError } from "@/modules/shared/errors";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function RetrievalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ userId }, query] = await Promise.all([getRequestContext(), searchParams]);
  const cursor = one(query.cursor);
  const diagnostics = await listRetrievalDiagnostics(userId, {
    ...(cursor ? { cursor } : {}),
    limit: 10,
  });
  let packet: GroundedRetrievalPacket | null = null;
  let retrievalError: string | null = null;
  try {
    const requirementId = one(query.requirementId);
    const jobId = one(query.jobId);
    if (requirementId) {
      packet = await retrieveForRequirement(userId, requirementId, one(query.topK));
    } else if (jobId) {
      packet = await retrieveForJob(userId, jobId, one(query.topK));
    }
  } catch (error) {
    if (error instanceof DomainError) retrievalError = error.message;
    else throw error;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Stage 9 · Grounded RAG substrate</p>
          <h1>Grounded Retrieval</h1>
        </div>
      </div>
      <div className="notice">
        Grounded retrieval finds relevant Candidate Evidence and cites its source. Retrieval does
        not independently prove qualification or generate application claims.
      </div>
      {query.indexed ? (
        <div className="notice success">
          Evidence indexing completed with state {humanizeEnum(one(query.indexed) ?? "")}.
        </div>
      ) : null}
      {query.batchIndexed ? (
        <div className="notice success">
          Bounded indexing processed {one(query.batchIndexed)} Evidence record(s).
        </div>
      ) : null}
      {retrievalError ? <div className="notice error">{retrievalError}</div> : null}

      {packet ? (
        <section className="panel page-stack">
          <div>
            <h2>{packet.queryLabel}</h2>
            <p>
              This query was derived only from the selected active authoritative requirement or
              active Job requirements.
            </p>
          </div>
          <GroundedRetrievalResults packet={packet} />
        </section>
      ) : null}

      <RetrievalSearchForm />

      <section className="panel page-stack" aria-label="Retrieval index diagnostics">
        <div className="record-card-heading">
          <div>
            <h2>Index diagnostics</h2>
            <p>
              Indexing is synchronous and bounded. Provider failure never changes authoritative
              Candidate Evidence; current lexical chunks remain available without semantic search.
            </p>
          </div>
          <div className="tag-row">
            <span className="tag">Current {diagnostics.counts.current}</span>
            <span className="tag">Pending {diagnostics.counts.pending}</span>
            <span className="tag">Stale {diagnostics.counts.stale}</span>
            <span className="tag">Failed {diagnostics.counts.failed}</span>
            <span className="tag">Disabled {diagnostics.counts.disabled}</span>
          </div>
        </div>
        <MutationForm action={reindexEvidencePageAction} className="form-stack">
          {cursor ? <input type="hidden" name="cursor" value={cursor} /> : null}
          <input type="hidden" name="limit" value="5" />
          <SubmitButton>Index next bounded page</SubmitButton>
        </MutationForm>
        <div className="record-list">
          {diagnostics.items.map((index) => (
            <article className="record-card" key={index.id}>
              <div className="record-card-heading">
                <div>
                  <span className="record-kicker">
                    {humanizeEnum(index.evidenceItem.sourceType)} · Evidence version{" "}
                    {index.evidenceItem.version}
                  </span>
                  <h3>
                    <Link href={`/evidence/${index.evidenceItemId}`}>
                      {index.evidenceItem.claim}
                    </Link>
                  </h3>
                </div>
                <StatusBadge value={index.status} />
              </div>
              <div className="record-meta">
                <span>
                  Lexical {index.lexicalCurrent && index.chunkCount > 0 ? "current" : "not current"}
                </span>
                <span>Stored semantic {index.semanticCurrent ? "current" : "not current"}</span>
                <span>{index.chunkCount} chunk(s)</span>
                {index.embeddingProvider ? (
                  <span>
                    {index.embeddingProvider} · {index.embeddingModel}
                  </span>
                ) : null}
                {index.errorCode ? <span>{humanizeEnum(index.errorCode)}</span> : null}
              </div>
              {index.evidenceItem.state === "ACTIVE" ? (
                <MutationForm action={indexEvidenceAction}>
                  <input type="hidden" name="evidenceItemId" value={index.evidenceItemId} />
                  <SubmitButton>
                    {index.status === "FAILED" ? "Retry indexing" : "Index or reindex"}
                  </SubmitButton>
                </MutationForm>
              ) : (
                <p>Archived Evidence is excluded from active retrieval.</p>
              )}
            </article>
          ))}
        </div>
        <div className="button-row">
          {cursor ? (
            <Link className="button secondary" href="/retrieval">
              First diagnostics page
            </Link>
          ) : null}
          {diagnostics.nextCursor ? (
            <Link
              className="button secondary"
              href={`/retrieval?cursor=${encodeURIComponent(diagnostics.nextCursor)}`}
            >
              Next diagnostics page
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <h2>Compact retrieval events</h2>
        <p>
          Events store query hashes, bounded counts, fixed codes, duration buckets, and provider
          coordinates only. They never store query text, Evidence narrative, snippets, or vectors.
        </p>
        <div className="audit-list">
          {diagnostics.events.map((event) => (
            <div key={event.id}>
              <strong>
                {humanizeEnum(event.mode)} · {humanizeEnum(event.resultCode)}
              </strong>
              <span>
                {event.returnedCount}/{event.requestedTopK} · {humanizeEnum(event.durationBucket)} ·{" "}
                {event.createdAt.toLocaleString()}
              </span>
            </div>
          ))}
          {diagnostics.events.length === 0 ? <p>No retrieval diagnostics recorded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
