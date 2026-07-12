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

## Development identity

Authentication-provider integration remains deferred. Local development and CI resolve a fixed identity from `DEVELOPMENT_USER_KEY` on the server. The user ID is looked up from PostgreSQL and is never accepted from forms, URLs, or request bodies.

`DEVELOPMENT_IDENTITY_ENABLED` must be explicitly enabled. Environment validation rejects it when `NODE_ENV=production`; this seam is not production authentication. A production provider will replace `getRequestContext()` without changing domain use cases.

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
npm run verify
```

Integration tests require the healthy Compose database. Test users are isolated and removed after the candidate-evidence suite. The production build runs with development identity disabled. E2E then uses Chromium against the development server on dedicated port 3100 because the development identity is intentionally prohibited in a production runtime. E2E marks every created record with a unique run identifier and removes only records carrying that marker in a `finally` cleanup.

GitHub Actions performs clean installation, migration deployment, seed, quality checks, unit/integration tests, production build, and the full Chromium evidence-to-approved-claim workflow.

## Troubleshooting

- **Wrong Node version:** ensure `node --version` reports `v24.x`, then run `npm ci` again.
- **Configured PostgreSQL port occupied:** change `POSTGRES_PORT` and the port in `DATABASE_URL` together.
- **Development identity missing:** run migrations and `npm run db:seed`, then verify the development identity environment values.
- **Prisma client unavailable:** run `npm run db:generate`.
- **Database authentication changed:** existing Docker volumes retain their bootstrap credentials. Recreate a local volume only when deleting its data is intentional.
- **E2E cannot start:** run `npm run build`, confirm port 3100 is available, and ensure the local development identity is enabled and seeded.

## Deferred product phases

This evidence system will later support job requirement matching, RAG retrieval, resume tailoring, interview preparation, and reviewed ChatGPT Work export packages. Those features, authentication-provider integration, n8n runtime integration, job discovery/parsing, scoring, application tracking, scraping, and agent workflows remain deferred to separately reviewed increments.

Automatic job-application submission remains prohibited.
