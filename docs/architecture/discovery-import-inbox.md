# Discovery import and inbox architecture

## Purpose and scope

The discovery slice stores user-confirmed raw opportunity material before any parsing or
normalization exists. A `JobDiscovery` is untrusted, unverified input and is not an authoritative
Job. CareerOps never fetches submitted URLs and never submits applications.

Supported v1 inputs are manual single-entry, one-record pasted text, and strict structured JSON v1
with at most 20 discoveries. CSV, delimiter splitting, AI parsing, duplicate detection, scoring,
matching, scraping, and application tracking are excluded.

## Preview and confirmation

Preview validation creates no database records. The server canonicalizes the validated contract,
creates a server-only idempotency UUID, and signs a 15-minute preview envelope with a
domain-separated HMAC key derived from the server authentication secret. The envelope is bound to
the trusted internal user and a one-way binding of the current database session.

Confirmation obtains a fresh mutation request context, verifies the signature and binding, then
strictly revalidates and canonicalizes the signed payload. A serializable transaction creates the
batch, every discovery, and all initial processing events. Per-user idempotency prevents replay and
concurrent confirmation from duplicating records; identical content under another idempotency key
remains a separate import.

## Ownership and persistence

`DiscoveryImportBatch`, `JobDiscovery`, and `DiscoveryProcessingEvent` all have a non-null internal
`User.id`. Composite foreign keys include `userId`; event-to-discovery ownership additionally
includes `batchId`. Every repository operation remains scoped by trusted identity.

Canonical payloads are stable UTF-8 JSON stored as text. Raw descriptions are stored unchanged and
rendered only as escaped plain text. Presentation hints may be whitespace-normalized, while their
accepted originals remain in the canonical payload. Validation summaries and processing events are
strict metadata-only objects and never contain imported content.

## Workflow and retention

Discoveries can move among `INBOX`, `REJECTED`, and `ARCHIVED` only through explicit, versioned,
audited processing-event transitions. Status timestamps use PostgreSQL `CURRENT_TIMESTAMP` in the
same serializable transaction as their events.

Confirmed content is immutable. Rejected and archived records remain stored and can be restored.
Accidentally pasted sensitive information can be removed only by a whole-batch privacy purge using
the exact typed phrase shown on the owned batch page. Purge transactionally writes one compact
`DISCOVERY_IMPORT_BATCH_PURGED` product audit, then removes the batch, discoveries, and processing
events. The surviving audit contains only the batch identifier, user identifier, discovery count,
reason code, action, and timestamp.

When a discovery has confirmed Job provenance, the same transaction first removes unconfirmed
parse drafts and converts confirmed parse drafts and Job sources into metadata-only privacy
tombstones. Raw and corrected parse content is removed, while source identifiers, hashes, parser
versions, confirmation timestamps, and safe events remain. The separately user-confirmed Job is not
silently deleted; its fields remain explicitly editable.
