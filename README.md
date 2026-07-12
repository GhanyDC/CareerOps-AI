# CareerOps AI

CareerOps is an evidence-grounded career operating system designed to work alongside ChatGPT Work. This repository contains a Next.js modular monolith and the first product vertical slice: authoritative candidate profiles, experiences, projects, atomic evidence, and controlled claims.

## Operating model

- ChatGPT Work discovers opportunities, performs contextual analysis, and drafts application materials.
- CareerOps validates, structures, versions, stores, and controls authoritative career and application data.
- PostgreSQL is the authoritative persistence layer.
- n8n may later orchestrate external workflows through authenticated CareerOps APIs.
- The user reviews and approves all application content and manually submits every application.

Automatic job-application submission is prohibited. Imported descriptions and AI-generated output are untrusted input and remain inert until validated.

## Architecture

```text
Browser and reviewed imports
            |
            v
Next.js modular monolith
  App Router pages and server actions
  candidate evidence modules and use cases
  server-only identity and Prisma infrastructure
            |
          Prisma
            |
        PostgreSQL
```

Product logic belongs in modules and use cases, not React components or route handlers. Prisma access is server-only. Every user-owned query is scoped using trusted, server-derived identity. See [candidate evidence architecture](docs/architecture/candidate-evidence.md).

## Prerequisites

- Node.js 24 LTS
- npm 11 or later
- Docker with Docker Compose

Use the pinned Node version with `nvm use`.

## Initial setup

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
docker compose up -d --wait postgres
npm run db:migrate:deploy
npm run db:seed
```

The `.env.example` values are local-only placeholders. Never commit `.env` or expose secrets through `NEXT_PUBLIC_*`.

## Production authentication

CareerOps uses Better Auth 1.6.23 with Google OIDC and PostgreSQL database sessions. Google accounts map to the existing internal `User.id` through a unique provider-and-subject record. Email is metadata, not an identity key, and implicit same-email account linking is disabled.

Every protected Server Component and server action resolves the internal user from an HttpOnly session cookie on the server. Mutation actions additionally validate the exact request origin. Repositories and use cases remain scoped by the trusted internal user ID; forms, URLs, query parameters, headers, request bodies, and Client Components cannot choose a user ID.

Provider access, refresh, and ID tokens are not retained. Authentication secrets and provider credentials are server-only and must never use `NEXT_PUBLIC_*`.

The candidate seed remains local-development data. `DEVELOPMENT_USER_KEY` identifies that seed but is not an authentication bypass. To use the seeded data through Google, link it explicitly by stable provider subject with `npm run auth:link-development-user`; never infer the link from email. Identical reruns are idempotent and conflicting mappings fail closed. See [production authentication architecture](docs/architecture/production-authentication.md).

`AUTH_TRUSTED_ORIGINS` is authoritative. Do not set `BETTER_AUTH_TRUSTED_ORIGINS`; CareerOps rejects that secondary Better Auth setting. See the [authentication environment reference](docs/operations/authentication-environment.md).

## PostgreSQL and Prisma

Start or stop the localhost-only PostgreSQL 17 service without deleting its named volume:

```bash
docker compose up -d --wait postgres
docker compose ps
docker compose down
```

Schema and data commands:

```bash
npm run db:generate
npm run db:validate
npm run db:migrate:dev -- --name descriptive_migration_name
npm run db:migrate:deploy
npm run db:seed
npm run db:studio
```

Use Prisma migrations, never `prisma db push`, for project schema changes. The development seed is idempotent and preserves edits by creating missing records without overwriting existing records. See [seed-data documentation](docs/seed-data.md).

## Candidate evidence concepts

- **Candidate profile:** one per user; optional facts, preferences, constraints, and goals.
- **Experience and project:** authoritative sources owned by the profile user.
- **Evidence item:** one atomic claim linked to exactly one owned experience or project.
- **Evidence verification:** `Draft`, `Requires verification`, `Verified`, or `Rejected`.
- **Evidence strength:** `Direct`, `Transferable`, `Supporting`, or `Weak`.
- **Claim-bank item:** controlled wording marked `Draft`, `Requires verification`, `Approved`, `Prohibited`, or `Archived`.

Only an explicit user action can approve a claim, and approval requires linked verified evidence. Prohibited claims remain visible in history and must never enter later export packages. Important evidence and claim transitions write compact audit entries containing only status-relevant values.

Verified evidence is locked until verification is explicitly revoked. Revocation or rejection transactionally moves linked approved claims back to requires verification and clears their approval timestamp. Material Experience or Project changes are blocked while verified evidence depends on that source. Experience source notes remain editable because they are non-material reviewer metadata. Ordered list fields retain user-authored priority, so reordering is treated as a material change.

## Deletion and archival behavior

- Experience and project deletion is blocked while evidence depends on the source.
- Evidence linked to claims is not silently deleted.
- Approved, prohibited, and archived claims cannot be edited directly.
- Claims are prohibited or archived through explicit, audited transitions rather than deleted.
- Approval revocation is recorded when an approved claim becomes restricted, prohibited, or archived.

## Development and verification

```bash
npm run dev
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run test:e2e:production
npm run verify
npm run verify:release
```

Integration tests require the healthy Compose database. Test users are isolated and removed after each suite. E2E uses Chromium against the production build on dedicated port 3100. A separate test-only Better Auth instance creates database sessions and injects HttpOnly cookies into Playwright; it exposes no HTTP bypass and makes no live Google calls. Each test creates uniquely identified users and removes only those users and their owned test data.

GitHub Actions performs clean installation, migration deployment, seed, quality checks, unit/integration tests, production build, and the full Chromium evidence-to-approved-claim workflow.

`npm run verify` is the practical source/build suite and does not require a running test database or browser. `npm run verify:release` is the deterministic release gate: it deploys and checks migrations, verifies schema drift, runs unit and PostgreSQL integration tests, builds the production application, runs normal and production-semantics Playwright suites, and checks Git whitespace. PostgreSQL and installed Chromium are required.

Automated tests do not contact Google. Complete the [manual Google OAuth smoke test](docs/operations/google-oauth-smoke-test.md) before merge.

## Troubleshooting

- **Wrong Node version:** ensure `node --version` reports `v24.x`, then run `npm ci` again.
- **Configured PostgreSQL port occupied:** change `POSTGRES_PORT` and the port in `DATABASE_URL` together.
- **Authentication configuration missing:** copy the server-only authentication placeholders from `.env.example`, replace them, and verify the Google callback URL is `${BETTER_AUTH_URL}/api/auth/callback/google`.
- **Seeded development user unavailable:** run `npm run db:seed`, then explicitly link the provider subject if that local data should be used through Google.
- **Prisma client unavailable:** run `npm run db:generate`.
- **Database authentication changed:** existing Docker volumes retain their bootstrap credentials. Recreate a local volume only when deleting its data is intentional.
- **E2E cannot start:** run `npm run build`, confirm port 3100 is available, and ensure Chromium is installed. E2E does not require live Google credentials.

## Deferred product phases

This evidence system will later support job requirement matching, RAG retrieval, resume tailoring, interview preparation, and reviewed ChatGPT Work export packages. Those features, additional authentication providers, n8n runtime integration, job discovery/parsing, scoring, application tracking, scraping, and agent workflows remain deferred to separately reviewed increments.

Automatic job-application submission remains prohibited.
