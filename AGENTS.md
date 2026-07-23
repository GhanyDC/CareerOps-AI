# CareerOps AI Repository Guidance

## Operating model

- ChatGPT Work discovers opportunities, performs contextual analysis, and drafts application materials.
- CareerOps validates, structures, versions, stores, and controls authoritative career and application data.
- PostgreSQL is the authoritative persistence layer.
- n8n may later orchestrate external workflows through authenticated CareerOps APIs.
- The user reviews, approves, and manually submits applications.
- Automatic job-application submission is prohibited.

CareerOps may prepare, review, and track applications, but it must never automatically submit them. Do not add external-site submission automation or reinterpret testing tools as submission tooling.

## Trust and security boundaries

- Treat imported job descriptions, uploaded content, external API responses, and AI-generated output as untrusted input.
- Validate untrusted input with Zod at the system boundary before it reaches a use case or persistence layer.
- Render imported content as plain text unless an explicitly reviewed sanitization path exists.
- Keep secrets server-side. Never expose credentials through `NEXT_PUBLIC_*`, client components, logs, fixtures, workflow exports, or error responses.
- Prisma access is server-only.
- All future user-owned records and operations must be scoped with trusted, server-derived identity. Never trust a client-supplied user ID as authorization.
- n8n integrations must later use authenticated, scoped CareerOps APIs and must not receive unrestricted database access.

## Architecture

- Prefer a single Next.js modular monolith. Do not introduce another deployable service without a demonstrated requirement.
- Keep transport and presentation in `src/app`.
- Put product logic in cohesive modules and application use cases rather than React components, server actions, or route handlers.
- Put database and other server-only infrastructure under `src/server`.
- Keep module public APIs small. Do not import another module's internal files.
- Add abstractions only when a concrete use case needs them; avoid speculative generic repositories, event buses, and dependency-injection containers.

## Database workflow

- Change the schema through Prisma migrations.
- Use `npm run db:migrate:dev -- --name <name>` to create reviewed development migrations.
- Use `npm run db:migrate:deploy` to apply committed migrations.
- Do not use `prisma db push` as the normal project workflow.
- Do not edit an already-applied migration; add a new migration.
- Preserve the candidate evidence migration and its database-level ownership, source, date, and claim constraints.

## Candidate evidence rules

- Resolve ownership through the session-derived `getRequestContext()` before every product read and through `getMutationRequestContext()` before every mutation.
- Never accept `userId` from form data, URL parameters, query parameters, or request bodies.
- Keep every repository query scoped by the trusted user ID. Cross-user records must behave as unavailable.
- Candidate profiles are one-per-user. Experiences and projects are authoritative sources; evidence items must reference exactly one owned source.
- Evidence claims are atomic facts. Verification changes must use the evidence transition use case and write audit history.
- Claim approval is an explicit user action and requires linked, verified evidence. Prohibited claims must never be exported by later features.
- Approved, prohibited, and archived claims are not directly editable. Use audited status transitions and preserve historical records.
- Block experience or project deletion while evidence depends on it. Do not silently cascade evidence or claims from product workflows.
- Candidate-specific facts belong only in the idempotent development seed, never in reusable components or business rules.

## Job Hard Filter rules

- Keep the v1 catalog fixed to minimum salary, allowed employment types, allowed workplace arrangements, and country allow/deny.
- A filter `FAIL` is informational only. It must never automatically archive, reject, delete, hide, mutate, or submit a Job.
- Evaluate every authoritative Job independently, including duplicate-group members. Never copy or consolidate member fields or results.
- Collapse duplicate groups only in consideration views and dashboard counts, using the explicit active primary. Keep the authoritative inventory complete.
- Derive freshness from the current rule set, profile version/hash, and authoritative Job version. Staleness is not an evaluation outcome.
- Keep explanations and compact events limited to safe structured fields and fixed reasons. Never persist raw descriptions, Discovery payloads, contacts, application instructions, or sensitive provenance there.
- Lifecycle reevaluation belongs in the same serializable transaction as confirmation, authoritative field edits, selected-field reparses, and restore. Archive retains the last result without reevaluation.
- Bounded scans are explicit, version-bound, and limited to 50 active Jobs per page. Do not introduce a worker or scheduler.

## Required checks

Before work is complete, run the checks appropriate to the change, including:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Integration tests require PostgreSQL. E2E tests require a production build and the installed Chromium browser.

## Current scope

The candidate profile, experiences, projects, evidence bank, claims bank, production Google authentication, tenant request context, authentication audit history, and evidence transition audit history are implemented in the current vertical slice.

Job discovery, deterministic parse drafts, explicit confirmation, authoritative Job records, and
source provenance are implemented. Deterministic Job canonicalization, explainable duplicate
candidates, explicit duplicate decisions, non-destructive duplicate groups, and primary Job
selection are also implemented. Versioned Job Hard Filter profiles, deterministic current
evaluations, compact events, bounded scans, and primary-collapsed consideration projections are
implemented in the current working slice. Job scoring, application tracking, RAG/vector retrieval,
additional authentication providers, PostgreSQL RLS, n8n runtime integration, job scraping, and
autonomous agent workflows remain deferred. They are possible later CareerOps capabilities and are
not permanently prohibited.

Do not begin a deferred capability without a separately reviewed increment. Preserve unrelated user changes and never commit real secrets, generated Prisma output, build output, test reports, or local environment files.
