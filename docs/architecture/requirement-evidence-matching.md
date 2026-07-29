# Requirement-to-Evidence Matching

## Purpose and limits

Requirement-to-Evidence Matching records explicit, auditable relationships between one atomic,
authoritative Job requirement and owned Candidate Evidence. It answers which recorded evidence
supports a requirement, whether support is full or partial, whether review found no recorded
support, and whether the review coordinates are still current.

It does not recommend applying, predict qualification, create a fit score, prove that the candidate
has or lacks a capability, generate claims, tailor application materials, or submit an
application. `UNSUPPORTED` means only that no supporting Candidate Evidence is currently recorded
in CareerOps.

## Requirement authority

Existing `Job.responsibilities`, `qualifications`, `preferredQualifications`, and `skills` are
structured authoritative Job fields, but they are not atomic requirement records. Parser output
and imported prose never create `JobRequirement` rows automatically.

The protected Job-detail workflow requires an explicit user submission for every requirement.
`MANUAL` records user-authored wording. A requirement classified as a structured Job-field source
must exactly equal a current value from the corresponding authoritative array:

- `JOB_RESPONSIBILITY`
- `JOB_QUALIFICATION`
- `JOB_PREFERRED_QUALIFICATION`
- `JOB_SKILL`

The v1 category catalog is `SKILL`, `EXPERIENCE`, `EDUCATION`, `CERTIFICATION`,
`RESPONSIBILITY`, `DOMAIN_KNOWLEDGE`, and `OTHER`. Importance is `REQUIRED`, `PREFERRED`, or
`OTHER`. Statements are bounded plain text. Reparse preserves requirements and matches because the
requirement ledger is independent from parse candidates; only an explicit requirement edit changes
its meaning.

## Data model

`JobRequirement` belongs to one owned Job and stores the statement, category, importance, source,
position, active/archive state, semantic version, and match-set version.

`JobRequirementEvidenceLink` joins one owned requirement to one owned `EvidenceItem`. It stores
`FULL` or `PARTIAL`, a bounded optional user rationale, deterministic position, optimistic version,
and the evidence version used by the latest completed review. A requirement/evidence pair is
unique, link identity is immutable, and one requirement is bounded to 100 evidence links so every
review can carry the complete coordinate set. The authoritative evidence narrative remains on
`EvidenceItem` and is displayed through an authorized join.

`JobRequirementReview` is the latest completed review snapshot. It stores only a server-derived
status, requirement and match-set versions, schema version, deterministic link-set hash, optimistic
review version, and review time. `JobRequirementMatchEvent` is compact history containing IDs,
versions, support levels, fixed reason codes, hashes, and other safe structured metadata.

Composite foreign keys include `userId` for Job ownership, requirement ownership, and
requirement-to-evidence ownership. PostgreSQL rejects cross-tenant links even if application
validation regresses. Job and user deletion cascade matching records. Evidence deletion cascades
only its links; requirements and reviews remain so the prior assessment is visibly stale until
reviewed again.

## Match semantics

The browser never submits a final status. The server derives the current review result from the
link set:

1. No completed review is `NOT_REVIEWED`, even if no links exist.
2. A completed review with at least one `FULL` link is `SUPPORTED`.
3. A completed review with one or more `PARTIAL` links and no full link is
   `PARTIALLY_SUPPORTED`.
4. A completed review with no links is `UNSUPPORTED`.

PostgreSQL independently rejects a review whose status conflicts with its links or whose
requirement, match-set, schema, or evidence coordinates are already stale. A full link does not
convert the evidence statement into a generated claim; it records only the user's reviewed support
judgment. PostgreSQL and the application share one canonical UTF-8 link-set representation and
SHA-256 digest, so a well-formed but incorrect link hash is also rejected.

## Freshness

A review is current only when all coordinates still match:

- `JobRequirement.version`
- `JobRequirement.matchSetVersion`
- match schema version 1
- deterministic link-set hash
- every linked `EvidenceItem.version`

Statement, category, importance, or source edits advance the requirement version. Semantic link
creation, support/rationale edits, and link deletion advance the match-set version through a
database trigger. Review snapshots and presentation ordering do not. Every Candidate Evidence
mutation advances its evidence version; affected links remain and reviews become stale by
comparison.

Stale reasons are fixed structured codes. Stale is a freshness state, not a match status. It never
silently becomes unsupported or not reviewed. Re-review uses the current requirement, complete
link set, and exact evidence versions under optimistic and serializable concurrency checks.

Requirement reordering does not change meaning and therefore does not stale a review. Unrelated Job
field edits and Job archive/restore do not change requirement versions. An archived Job retains its
requirements, links, latest review, events, and freshness coordinates.

Archiving a requirement preserves its last position. Restoring it appends it to the current active
order, preventing a position reused while archived from colliding with another active requirement.
This presentation-only change does not stale the review.

## Transactions and concurrency

Requirement creation and edits, link mutations, review completion, lifecycle event creation, and
product audit writes use the shared serializable transaction helper. Requirement, match-set, link,
review, and evidence versions prevent lost updates. Review completion also checks the exact
evidence ID/version list rendered to the user. Concurrent duplicate link creation is rejected by
both the current match-set coordinate and the database unique key.

Database triggers ensure that direct or cascaded evidence/link changes still advance their relevant
versions. Review validation triggers reject arbitrary or out-of-date snapshots and recompute the
canonical link-set hash. Audit and event records commit or roll back with the authoritative
mutation.

## Coverage counts and duplicate behavior

Coverage is factual, mutually exclusive counting by importance:

- supported
- partially supported
- unsupported
- not reviewed
- stale
- total

Stale requirements occupy only the stale bucket until re-reviewed. Required, preferred, and other
counts remain separate. No percentage is described as a qualification or fit score.

Every authoritative Job and duplicate-group member owns independent requirements, links, and
reviews. Nothing is copied from a primary, consolidated, or inferred across members. Normal Job
detail preserves every member. Active consideration and dashboard summaries default to standalone
Jobs plus only the explicit active primary; the user can include duplicate members. No member is
automatically promoted.

## Candidate Evidence lifecycle

Evidence edits and verification transitions preserve links and advance `EvidenceItem.version`,
making affected reviews stale. Evidence deletion follows the established Candidate Evidence
contract: claims still block deletion; otherwise matching links are removed transactionally,
match-set versions advance before compact unlink events and audits preserve only safe IDs,
post-mutation versions, support levels, and a fixed deletion reason.

Full evidence content, source notes, private narratives, and provenance are never copied into links,
reviews, events, audits, coverage JSON, or cursors.

## Job lifecycle

Initial confirmation does not create requirements. Structured Job-field values are shown only as
candidate text until the user explicitly creates an authoritative requirement. Reparse and
authoritative Job edits preserve the ledger and never remove matches. Requirement edits are
separate, explicit mutations.

Archive preserves matching state and excludes the Job from active summaries. Restore exposes the
same records and recalculates freshness through current coordinate comparison without creating
links. Job deletion cascades the ledger. Discovery privacy purge cannot place description,
contacts, application instructions, or provenance content into matching storage.

## Authorization, presentation, and privacy

Protected reads resolve `getRequestContext()` and mutations resolve
`getMutationRequestContext()`. Forms, URLs, query strings, and request bodies cannot choose an
authoritative user ID. Every repository operation is scoped by the trusted internal owner.

Requirement statements, rationales, and evidence claims are rendered as React text only. Match
events and audits omit statements, evidence narratives, descriptions, contacts, application
instructions, Discovery/parser payloads, and provenance blobs. User-directed Candidate Evidence
browsing shows a bounded recent list and does not perform matching or suggestion.

## Explicit exclusions and future relationship

This increment adds no RAG, embedding, vector search, fuzzy or semantic matching, synonym or keyword
suggestion engine, LLM call, automatic claim, qualification prediction, fit score, tailoring,
application tracking, submission, scraping, URL fetching, enrichment, external API, worker,
scheduler, or n8n runtime behavior. Hard Filter results and Preliminary Job Scores remain separate
signals and are displayed independently.

A later Grounded RAG and Fit Explanation increment may retrieve these reviewed links as structured
grounding. It must preserve requirement authority, evidence authorization, review freshness, and
the distinction between recorded support and qualification.
