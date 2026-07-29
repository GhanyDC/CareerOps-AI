# Candidate evidence architecture

## Purpose

The candidate evidence vertical slice is the authoritative source for facts that later CareerOps workflows and ChatGPT Work may retrieve and rephrase. It separates source records, atomic evidence, and explicitly reviewed external wording so generated content cannot silently invent experience or materially change verified meaning.

## Request and ownership boundary

Every protected page resolves `getRequestContext()` and every server action resolves `getMutationRequestContext()` before calling a use case. The current implementation validates a PostgreSQL-backed Better Auth session, resolves the active internal `User`, and returns only the trusted internal user and session IDs. Mutation context also validates the exact request Origin and Host. No form, URL, query string, header, Client Component, or request body can choose a user ID.

Google's stable provider subject maps through `AuthAccount` to the existing internal `User.id`. Domain use cases continue to accept only that trusted `userId`, so repositories and product rules do not depend on provider metadata.

All repositories include the trusted user scope. Composite database foreign keys include `userId` for candidate-profile sources, evidence sources, and claim-to-evidence links. This provides defense in depth against cross-user relationships even if an application check regresses.

## Modules

```text
src/modules/candidate-profile  profile validation and one-per-user persistence
src/modules/experiences        experience validation, CRUD, conservative deletion
src/modules/projects           project validation, CRUD, conservative deletion
src/modules/evidence           source validation, filtering, verification transitions
src/modules/claims             draft editing and controlled claim transitions
src/modules/retrieval          canonical derivatives, indexing, hybrid retrieval, citations
src/modules/audit              compact transition-history persistence
src/modules/dashboard          user-scoped aggregate counts
```

Route pages read through use cases. Server actions select known form fields, resolve trusted identity, validate through Zod, call a use case, and return safe errors. Prisma is never imported by client components.

## Evidence and claims

Evidence must reference exactly one experience or project owned by the same user. Application and database constraints reject missing, mismatched, dual, cross-user, and whitespace-only sources or claims.

Evidence verification transitions are explicit and audited. Verified evidence is locked against edits until verification is explicitly revoked. When verified evidence becomes rejected or requires verification, every linked approved claim is preserved, moved to requires verification, and has its approval timestamp cleared in the same serializable transaction. Claims can be edited only while draft or requiring verification. Approval requires linked verified evidence and explicit confirmation. Prohibition and archival preserve the claim and audit history. If an approved claim leaves the approved state, approval revocation is recorded separately.

Experience and project fields are authoritative source facts. Material source edits are blocked while dependent verified evidence exists; the user must first revoke that evidence verification. Experience source notes are reviewer metadata and may be updated without changing source meaning. Optional null, undefined, and empty values compare equivalently, dates compare by ISO value, and array order is meaningful because authored ordering communicates priority and presentation intent.

Claim approval and evidence transitions use serializable PostgreSQL transactions. Recognized Prisma `P2034` serialization conflicts replay the complete transaction up to two times after the initial attempt; other errors are not retried.

Later export code must select only approved claims and must always exclude prohibited and archived claims.

## Referential behavior

The product prevents deletion of an experience or project with active evidence. Database foreign keys additionally restrict source deletion. Claims are not deleted through the UI; prohibition and archival preserve review history. User cleanup is an administrative concern outside this slice.

All server mutation actions use the shared safe error boundary. Known validation and domain messages remain actionable. Unexpected errors are represented by a generic message and correlation ID; raw errors, form values, Prisma metadata, connection details, and request secrets are not logged by the application boundary.

## Requirement matching lifecycle

Requirement-to-Evidence Matching links authorized `EvidenceItem` records without copying their
claims, supporting context, source notes, or source provenance. Every evidence edit and verification
transition advances `EvidenceItem.version`, so a completed requirement review that used an earlier
version becomes visibly stale while preserving the link.

Evidence deletion remains blocked while claims depend on it. When deletion is otherwise allowed,
requirement links are removed before compact deletion events are written in the same serializable
transaction. Requirements and their last review remain, the link-set coordinate advances, and
compact events/audits retain only IDs, post-mutation versions, support level, and the fixed
evidence-deleted reason. See
[Requirement-to-Evidence Matching](requirement-evidence-matching.md).

## Retrieval lifecycle

Every Evidence record has one derived retrieval-index state. Creation is independent of provider
availability and starts `PENDING`. Every authoritative Evidence mutation advances the existing
version; a database trigger deletes the obsolete derived chunks and makes the index `STALE`.
Manual indexing builds a deterministic safe document and replaces the current chunk set
atomically after any external embedding call has completed.

Evidence now has an explicit audited `ACTIVE`/`ARCHIVED` lifecycle. Archive preserves the
authoritative record, claims, requirement links, reviews, and audits, makes it read-only, removes
derived chunks through version staleness, and excludes it from active retrieval. Restore preserves
the same authority and remains stale until reindexed. Existing claim dependencies continue to
block deletion; when deletion is allowed, composite cascading foreign keys remove all vectors and
index state. See [Grounded RAG Retrieval](grounded-rag.md).

## Deferred integrations

This system now supports explicit Job requirement matching and grounded retrieval. Fit explanation,
evidence-gap analysis, resume tailoring, interview preparation, and reviewed ChatGPT Work export
packages remain deferred. Automatic application submission is prohibited.
