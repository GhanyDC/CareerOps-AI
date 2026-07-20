# Job canonicalization and duplicate resolution

## Authority boundary

An authoritative `Job` remains the user-confirmed source of truth. A
`JobCanonicalRepresentation` is a latest-only, deterministic, versioned comparison projection; it
never replaces or edits the Job. Canonicalization uses Unicode NFKC, locale-independent lowercase
comparison text, conservative whitespace normalization, exact structured values, and SHA-256
content fingerprints. It does not translate, infer company identity, expand abbreviations, infer
location hierarchy, or fetch URLs.

URL canonicalization preserves HTTP versus HTTPS, paths, trailing slashes, retained query order,
and unreviewed job-board parameters. It removes fragments, default ports, and a narrow allowlist of
marketing parameters. Submitted URLs are never fetched and redirects are never followed.

## Candidate generation

Candidate generation compares only active Jobs owned by the trusted internal user. Indexed URL,
company/title, company/title/location, and live-source blocking avoid unbounded all-pairs scans.
Strong and moderate rule combinations create `JobDuplicateCandidate` rows; weak evidence only
supports an already-qualified pair. Evidence contains rule codes, field names, categories, and safe
hashes rather than full descriptions, contacts, or source payloads. Conflict evidence is visible
but never finalizes a decision.

Pair IDs are ordered so `jobAId < jobBId`. PostgreSQL checks and a per-user unique key reject
self-pairs, reversed pairs, and duplicate insertion. Composite ownership foreign keys make
cross-user candidates and groups impossible.

## User decisions and groups

The candidate decision is null until the user explicitly chooses `SAME_OPPORTUNITY`,
`DIFFERENT_OPPORTUNITIES`, or `DEFERRED`. Same-opportunity decisions preserve both Jobs and require
an explicit primary Job. `JobDuplicateGroup` and `JobDuplicateGroupMember` materialize the connected
same-decision graph without changing authoritative Job IDs, fields, sources, parse history, or
archive state.

Decision reversal recomputes affected graph components. A split that creates a multi-Job component
without the old primary requires another explicit primary selection. No field consolidation,
destructive merge, automatic primary selection, or Job deletion exists in this increment.

## Concurrency, audit, and privacy

Job mutations refresh canonical data and candidates inside the existing serializable transaction.
Candidate and group versions provide optimistic concurrency, while per-user event idempotency keys
and request hashes make exact replay safe. Duplicate-processing events contain metadata only;
explicit decisions and group changes also write compact product `AuditLog` records.

Relevant Job edits and evidence changes preserve prior decisions but mark them stale for review.
Archived Jobs stop generating active comparisons without losing decisions or membership. Restore
reevaluates the Job. Discovery privacy purge removes live-source evidence and reevaluates affected
pairs after JobSource redaction; authoritative Jobs remain subject to the existing explicit editing
policy. Old canonical representations and raw duplicate-evidence snapshots are not retained.

## Performance and deferred scope

Normal Job mutations evaluate at most 100 blocked matches. Existing or upgraded Jobs use an
explicit 50-Job paginated scan; no worker, scheduler, or external service is introduced.

Candidate-fit scoring, desirability ranking, hard filters, RAG, embeddings, tailoring, application
tracking, scraping, URL fetching, company enrichment, external APIs, n8n runtime workflows, and
application submission remain outside this increment. Application submission remains manual.
