import Link from "next/link";
import { notFound } from "next/navigation";

import { DiscoveryPurgeForm } from "@/components/discovery-purge-form";
import { StatusBadge } from "@/components/status-badge";
import { DiscoveryError } from "@/modules/discovery/errors";
import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
import { viewDiscoveryImportBatch } from "@/modules/discovery/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function DiscoveryBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let batch;
  try {
    batch = await viewDiscoveryImportBatch(userId, id);
  } catch (error) {
    if (error instanceof DiscoveryError && error.code === "BATCH_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Confirmed discovery import</p>
          <h1>{batch.producerLabel}</h1>
        </div>
      </div>
      {query.confirmed ? (
        <div className="notice success">Import confirmed and stored atomically.</div>
      ) : null}
      <section className="panel">
        <h2>Batch provenance</h2>
        <dl className="details-list">
          <div>
            <dt>Method</dt>
            <dd>{humanizeEnum(batch.importMethod)}</dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>Version {batch.contractVersion}</dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd>{batch.confirmedAt.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Discoveries</dt>
            <dd>{batch.discoveries.length}</dd>
          </div>
          <div>
            <dt>Batch ID</dt>
            <dd>{batch.id}</dd>
          </div>
        </dl>
        <details>
          <summary>View canonical original payload</summary>
          <pre className="raw-content">{batch.originalPayload}</pre>
        </details>
      </section>
      <section className="panel">
        <h2>Raw discoveries</h2>
        <div className="record-list">
          {batch.discoveries.map((discovery) => (
            <Link className="record-card" href={`/discoveries/${discovery.id}`} key={discovery.id}>
              <div className="record-card-heading">
                <h3>{discovery.titleHint ?? "Untitled raw discovery"}</h3>
                <StatusBadge value={discovery.status} />
              </div>
              <span>{discovery.sourceLabel ?? "No opportunity source"}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Batch processing events</h2>
        <div className="audit-list">
          {batch.processingEvents.map((event) => (
            <div key={event.id}>
              <strong>{humanizeEnum(event.eventType)}</strong>
              <span>{event.createdAt.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel danger-zone">
        <h2>Privacy purge</h2>
        <DiscoveryPurgeForm
          batchId={batch.id}
          expectedPhrase={expectedPurgeConfirmation(batch.id)}
        />
      </section>
    </div>
  );
}
