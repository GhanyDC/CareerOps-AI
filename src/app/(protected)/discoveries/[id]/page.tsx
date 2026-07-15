import Link from "next/link";
import { notFound } from "next/navigation";

import { DiscoveryStatusActions } from "@/components/discovery-status-actions";
import { CreateParseDraftForm } from "@/components/create-parse-draft-form";
import { StatusBadge } from "@/components/status-badge";
import { DiscoveryError } from "@/modules/discovery/errors";
import { viewJobDiscovery } from "@/modules/discovery/use-cases";
import { humanizeEnum } from "@/modules/shared/presentation";
import { getRequestContext } from "@/server/request-context";

export const dynamic = "force-dynamic";

export default async function DiscoveryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ transitioned?: string }>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([
    params,
    searchParams,
    getRequestContext(),
  ]);
  let discovery;
  try {
    discovery = await viewJobDiscovery(userId, id);
  } catch (error) {
    if (error instanceof DiscoveryError && error.code === "DISCOVERY_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Raw discovery — not parsed or verified</p>
          <h1>{discovery.titleHint ?? "Untitled raw discovery"}</h1>
        </div>
        <StatusBadge value={discovery.status} />
      </div>
      {query.transitioned ? <div className="notice success">Discovery status updated.</div> : null}
      <DiscoveryStatusActions
        id={discovery.id}
        status={discovery.status}
        version={discovery.version}
      />
      {discovery.status === "INBOX" ? (
        <section className="panel">
          <p className="eyebrow">Structured review</p>
          <h2>Create a non-authoritative parse draft</h2>
          <p>
            CareerOps copies only explicit hints or a strict structured JSON contract. You must
            review and confirm every authoritative value.
          </p>
          <CreateParseDraftForm discoveryId={discovery.id} />
        </section>
      ) : null}
      <section className="panel">
        <h2>Provenance</h2>
        <dl className="details-list">
          <div>
            <dt>Title hint</dt>
            <dd>{discovery.titleHint ?? "Not provided"} (unverified)</dd>
          </div>
          <div>
            <dt>Company hint</dt>
            <dd>{discovery.companyHint ?? "Not provided"} (unverified)</dd>
          </div>
          <div>
            <dt>Location hint</dt>
            <dd>{discovery.locationHint ?? "Not provided"} (unverified)</dd>
          </div>
          <div>
            <dt>Opportunity source</dt>
            <dd>{discovery.sourceLabel ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Producer</dt>
            <dd>{discovery.batch.producerLabel}</dd>
          </div>
          <div>
            <dt>Import method</dt>
            <dd>{humanizeEnum(discovery.batch.importMethod)}</dd>
          </div>
          <div>
            <dt>Discovered at</dt>
            <dd>{discovery.discoveredAt?.toLocaleString() ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Imported at</dt>
            <dd>{discovery.createdAt.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Batch</dt>
            <dd>
              <Link href={`/discoveries/batches/${discovery.batchId}`}>{discovery.batchId}</Link>
            </dd>
          </div>
          <div>
            <dt>Submitted URL</dt>
            <dd>
              {discovery.submittedUrl ? (
                <a
                  href={discovery.submittedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Open submitted URL
                </a>
              ) : (
                "Not provided"
              )}
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Exact raw content</h2>
        <pre className="raw-content">{discovery.rawContent}</pre>
      </section>
      <section className="panel">
        <h2>Processing-event timeline</h2>
        <div className="audit-list">
          {discovery.processingEvents.map((event) => (
            <div key={event.id}>
              <strong>{humanizeEnum(event.eventType)}</strong>
              <span>{event.createdAt.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
