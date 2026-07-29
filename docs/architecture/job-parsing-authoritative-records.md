# Job parsing and authoritative records

## Authority boundary

`JobDiscovery` remains raw, unverified input. A deterministic parser creates a reviewable
`JobParseDraft`; it never creates a `Job`. Only explicit confirmation through a trusted mutation
request creates or updates an authoritative `Job` and its append-only `JobSource` provenance.

```text
JobDiscovery -> deterministic JobParseDraft -> user corrections -> explicit confirmation
             -> Job + JobSource + JobParsingEvent + AuditLog (one serializable transaction)
```

The parser copies explicit Discovery hints and accepts a complete strict structured Job contract
v1 when the entire raw content matches it. It does not infer facts from prose, use heading/regex
extraction, call an LLM, fetch URLs, score candidates, or track applications. Missing and uncertain
values remain null or empty.

## Ownership and concurrency

Every Job, draft, source, and parsing event stores the trusted internal `User.id`. Compound
selectors and composite foreign keys prevent cross-user relationships. Reads resolve
`getRequestContext()`; mutations resolve `getMutationRequestContext()` and never accept a user ID.

Only one `READY_FOR_REVIEW` draft may exist for a discovery. Corrections, terminal transitions,
authoritative edits, and archive/restore use optimistic versions. Confirmation uses the existing
serializable retry helper. A per-user UUID idempotency key and server-derived confirmation hash make
exact replay safe, while a unique parse-draft source prevents concurrent duplicate Jobs.

## Corrections and reparsing

The immutable parsed payload is separate from a strict correction payload preserving raw and
normalized form values. Field provenance distinguishes extracted, omitted, user-entered,
user-corrected, and authoritative-edit values.

Reparsing creates a new historical draft tied to a trusted target Job and its base version. The
user selects fields to merge; unchecked fields and prior corrections are never overwritten. Every
confirmation adds another JobSource instead of erasing earlier provenance.

## Retention and privacy

Normal workflows retain confirmed, rejected, and superseded drafts. JobSource and parsing events
are append-only. Product audits contain versions, statuses, IDs, and changed field names only.

Whole-batch Discovery privacy purge deletes unconfirmed drafts. Confirmed drafts and sources are
first reduced to metadata-only tombstones: content-bearing JSON is replaced, live Discovery foreign
keys are cleared, and redaction timestamps, events, and audits are written. The separately confirmed
Job remains visible so the user can explicitly retain or clear its fields. A purged source cannot be
reparsed.

## Requirement authority after confirmation

Job confirmation and reparse do not create, replace, or delete atomic requirements. Confirmed
responsibility, qualification, preferred-qualification, and skill arrays may be shown as candidates
in the matching workflow, but each `JobRequirement` requires a separate explicit user submission.
A structured-field provenance classification must exactly match the current authoritative field.
Reparse preserves requirements and evidence links; only an explicit requirement edit changes the
requirement version and stales its review. See
[Requirement-to-Evidence Matching](requirement-evidence-matching.md).

## Deferred work

Parsing itself performs no scoring, ranking, hard filtering, candidate fit,
RAG, embeddings, resume or cover-letter generation, application tracking, scraping, URL fetching,
background parsing, n8n runtime workflow, or application submission. Separate reviewed Hard Filter
and Preliminary Job Scoring modules consume only confirmed authoritative fields. The separate
Requirement-to-Evidence Matching module consumes only explicitly confirmed requirements and owned
Candidate Evidence. The remaining capabilities stay deferred. Application submission remains
manual.
