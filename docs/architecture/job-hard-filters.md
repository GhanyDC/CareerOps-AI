# Job Hard Filters

## Purpose and authority boundary

Job Hard Filters are user-controlled, deterministic eligibility constraints over structured fields
on an authoritative `Job`. The current evaluation answers whether a Job passes the configured hard
constraints; it does not score, rank, recommend, reject, archive, hide, delete, or submit anything.
PostgreSQL remains authoritative for the profile, current evaluations, and compact events.

All browser reads and mutations resolve the internal owner through the authenticated request
context. No filter form, URL, cursor, or request body may choose a `userId`. Repository operations
remain user-scoped, and composite foreign keys enforce that profiles, Jobs, evaluations, events,
and actors belong to the same user.

## Version 1 rule catalog

The configuration is a strict versioned document with four fixed rule IDs. Each code-defined rule
has version 1, an enabled flag, validated values, and either `NEEDS_REVIEW` or `FAIL` as its
missing-data policy.

1. `MINIMUM_SALARY` compares a configured decimal minimum, currency, and salary period to the
   authoritative salary fields. It performs no currency or salary-period conversion.
2. `ALLOWED_EMPLOYMENT_TYPES` accepts a non-empty allowlist from the authoritative Job enum.
3. `ALLOWED_WORKPLACE_ARRANGEMENTS` accepts a non-empty allowlist from the authoritative Job enum.
4. `COUNTRY_ALLOW_DENY` uses only the authoritative two-letter `countryCode`. Its optional allow
   and deny lists are disjoint, and at least one is non-empty when enabled. The denylist takes
   precedence.

No rule infers facts from a title, description, location label, city, region, qualifications,
responsibilities, or imported prose.

## Outcomes and missing data

Rule and overall outcomes are `PASS`, `FAIL`, and `NEEDS_REVIEW`. Overall precedence is any `FAIL`,
then any `NEEDS_REVIEW`, otherwise `PASS`. A configuration with zero enabled rules returns `PASS`
with the fixed explanation that no hard constraints are enabled.

Missing required data defaults to `NEEDS_REVIEW`. A user can instead configure a rule to return
`FAIL` when its data is missing. Staleness and “filters not configured” are UI states, not extra
outcomes.

## Salary range semantics

Salary comparison occurs only when the configured and authoritative currency and period match. A
known `salaryMin` at or above the threshold passes. A known `salaryMax` below the threshold fails.
A crossing range, a partly known range that cannot prove either condition, a unit mismatch, or an
unexpected legacy-invalid field shape needs review. Boundary equality passes. The evaluator does
not convert, normalize across periods, benchmark, or infer missing salary data.

## Configuration versioning and deterministic hashing

Every profile mutation canonicalizes and validates the complete configuration, sorts and
deduplicates lists, canonicalizes decimals, and hashes a stable object-key serialization with
SHA-256. The profile version advances under optimistic concurrency. Rule-set, profile, and Job
versions are copied to each current evaluation. Explanations use their own strict schema version
and deterministic SHA-256 hash; timestamps are outside the hashed document.

## Current evaluation and freshness

There is one current `JobFilterEvaluation` per owned Job. It stores the outcome, version and hash
coordinates, bounded structured explanation, and evaluation time. A result is derived as stale
when it is absent or any of these coordinates differs from current state:

- profile version or configuration hash;
- evaluator rule-set version; or
- authoritative Job version.

Stale rows remain available for transparency until reevaluated. A profile edit does not pretend
that old results are current.

## Lifecycle and transactions

Initial authoritative Job confirmation, authoritative field edits, selected-field reparses, and
restore synchronously reevaluate when a profile exists. The Job mutation, duplicate-canonicalization
refresh, and filter evaluation share the existing serializable transaction, so they commit or roll
back together. If no profile exists, no evaluation is created.

Archive preserves the last result and does not evaluate a synthetic archive outcome. Archived Jobs
are excluded from active views and counts. Repeated evaluation of unchanged coordinates is a
deterministic no-op. Profile updates use an expected version, and scan cursors bind to the expected
profile version so concurrent changes fail closed.

## Bounded scans

Profile creation and editing starts a synchronous scan of at most 50 active Jobs. A strict opaque
cursor contains only the last Job ID and expected profile version. The settings page offers an
explicit continuation action for another page. Each Job is evaluated in its own serializable
transaction; replay is safe and deterministic. There is no background worker, scheduler, or
automatic continuation.

## Duplicate groups

Every authoritative Job, including every confirmed duplicate-group member, is evaluated from its
own structured fields. Results are never copied, reconciled, merged, or consolidated. Duplicate
decisions and primary changes do not reevaluate Jobs because they do not change authoritative Job
fields.

The normal Jobs inventory continues to show all Jobs. Consideration views and dashboard counts
project standalone Jobs plus only the explicitly selected primary of each duplicate group. An
explicit include-members control restores secondary members to the consideration list. An archived
primary removes that group from active collapsed views until the user explicitly selects an active
primary; no member is promoted automatically.

## Explainability, events, and privacy

The explanation is a strict, bounded document with ordered rule results, fixed reason codes and
messages, canonical structured Job and configured values, and explicit missing/conflict field
names. Disabled results contain only their rule identity, version, and disabled state.

Explanations never contain descriptions, qualifications, responsibilities, Discovery payloads,
contact details, application instructions, or sensitive provenance. Discovery privacy purge does
not trigger reevaluation when authoritative Job fields are unchanged, and filter storage cannot
retain the purged source content.

Historical storage is compact `JobFilterEvent` data only, including transitions and safe reason
metadata; complete historical explanations are not retained. Profile creates and updates also use
the existing `AuditLog` convention. Database checks enforce known schema versions, valid hashes,
positive versions, bounded JSON, explanation/outcome agreement, and actor ownership.

## Explicit exclusions and separate scoring

The Hard Filter module adds no scoring, severity, weights, ranking, Candidate Evidence retrieval,
RAG, embeddings, vector search, LLM call, resume or cover-letter tailoring,
application tracking or submission, scraping, URL fetching, enrichment, salary benchmarking,
external API, n8n runtime, worker, scheduler, or autonomous workflow.

The separately documented [Preliminary Job Scoring](preliminary-job-scoring.md) module consumes
authoritative structured Job data but remains distinct from these binary/tri-state hard
constraints. A hard-filter result is never reinterpreted as a score or automatic Job mutation.
The separately documented
[Requirement-to-Evidence Matching](requirement-evidence-matching.md) module records factual support
for explicitly confirmed atomic requirements. A Hard Filter result never becomes a match status,
and a requirement match never changes Hard Filter eligibility.
