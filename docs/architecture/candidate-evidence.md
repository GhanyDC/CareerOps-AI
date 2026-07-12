# Candidate evidence architecture

## Purpose

The candidate evidence vertical slice is the authoritative source for facts that later CareerOps workflows and ChatGPT Work may retrieve and rephrase. It separates source records, atomic evidence, and explicitly reviewed external wording so generated content cannot silently invent experience or materially change verified meaning.

## Request and ownership boundary

Every page or server action resolves `getRequestContext()` before calling a use case. The current implementation looks up a fixed development identity key on the server. No form, URL, query string, or request body can choose a user ID.

Authentication-provider integration will replace this request-context function later. Domain use cases already accept the trusted `userId`, so repositories and product rules do not depend on an authentication vendor.

All repositories include the trusted user scope. Composite database foreign keys include `userId` for candidate-profile sources, evidence sources, and claim-to-evidence links. This provides defense in depth against cross-user relationships even if an application check regresses.

## Modules

```text
src/modules/candidate-profile  profile validation and one-per-user persistence
src/modules/experiences        experience validation, CRUD, conservative deletion
src/modules/projects           project validation, CRUD, conservative deletion
src/modules/evidence           source validation, filtering, verification transitions
src/modules/claims             draft editing and controlled claim transitions
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

## Deferred integrations

This system is designed to support job requirement matching, RAG retrieval, resume tailoring, interview preparation, and reviewed ChatGPT Work export packages. None are implemented in this increment. Automatic application submission is prohibited.
