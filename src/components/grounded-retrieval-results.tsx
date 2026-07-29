import Link from "next/link";

import { StatusBadge } from "./status-badge";
import type {
  GroundedEvidenceResult,
  GroundedRetrievalPacket,
} from "@/modules/retrieval/public.server";
import { humanizeEnum } from "@/modules/shared/presentation";

function EvidenceResultCard({ result }: { result: GroundedEvidenceResult }) {
  return (
    <article className="record-card retrieval-result-card">
      <div className="record-card-heading">
        <div>
          <span className="record-kicker">
            Rank {result.finalRank} · {result.displayLabel}
          </span>
          <h3>
            <Link href={result.navigationTarget}>{result.snippet}</Link>
          </h3>
        </div>
        <StatusBadge value={result.indexFreshness} />
      </div>
      <div className="tag-row">
        {result.retrievalReasons.map((reason) => (
          <span className="tag" key={reason}>
            {humanizeEnum(reason)}
          </span>
        ))}
      </div>
      <div className="record-meta">
        <span>Evidence version {result.evidenceVersion}</span>
        <span>{humanizeEnum(result.evidenceType)}</span>
        <span>{humanizeEnum(result.verificationStatus)}</span>
        <span>{humanizeEnum(result.evidenceStrength)}</span>
        {result.bestChunkIndex === null ? (
          <span>Authoritative-record citation</span>
        ) : (
          <span>Chunk {result.bestChunkIndex + 1}</span>
        )}
        {result.lexicalRank ? <span>Lexical rank {result.lexicalRank}</span> : null}
        {result.semanticRank ? <span>Semantic rank {result.semanticRank}</span> : null}
        {result.hybridRank ? <span>Hybrid rank {result.hybridRank}</span> : null}
      </div>
      <p className="citation-coordinate">
        Citation: Evidence {result.evidenceItemId} · version {result.evidenceVersion}
        {result.chunkHash ? ` · chunk ${result.chunkHash.slice(0, 12)}` : ""}
      </p>
    </article>
  );
}

export function GroundedRetrievalResults({ packet }: { packet: GroundedRetrievalPacket }) {
  return (
    <div className="page-stack retrieval-results">
      <div className="record-meta">
        <span>Mode: {humanizeEnum(packet.mode)}</span>
        <span>Top K: {packet.topK}</span>
        <span>
          Semantic channel: {packet.semanticAvailable ? "available" : "unavailable; lexical only"}
        </span>
      </div>
      {packet.explicitResults.length > 0 ? (
        <section aria-label="Explicit Evidence links" className="page-stack">
          <div>
            <h2>Explicit FULL and PARTIAL links</h2>
            <p>
              These are user-confirmed Requirement-to-Evidence relationships, not semantic
              discoveries.
            </p>
          </div>
          <div className="record-list">
            {packet.explicitResults.map((result) => (
              <EvidenceResultCard result={result} key={result.evidenceItemId} />
            ))}
          </div>
        </section>
      ) : null}
      <section aria-label="Retrieved Candidate Evidence" className="page-stack">
        <div>
          <h2>Retrieved Candidate Evidence</h2>
          <p>Results are deduplicated by Evidence record and cite an exact authorized version.</p>
        </div>
        <div className="record-list">
          {packet.retrievedResults.map((result) => (
            <EvidenceResultCard result={result} key={result.evidenceItemId} />
          ))}
          {packet.retrievedResults.length === 0 ? (
            <div className="empty-state">
              No current indexed match was found. This does not mean the candidate lacks the
              capability.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
