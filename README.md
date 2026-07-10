# CareerOps AI

CareerOps is an evidence-grounded career operating system designed to work alongside ChatGPT Work. This repository currently contains the engineering foundation: a small Next.js modular monolith, PostgreSQL persistence through Prisma, validated server configuration, and a complete local and CI test harness.

## Operating model

- ChatGPT Work discovers opportunities, performs contextual analysis, and drafts application materials.
- CareerOps validates, structures, versions, stores, and controls authoritative career and application data.
- PostgreSQL is the authoritative persistence layer.
- n8n may later orchestrate external workflows through authenticated CareerOps APIs.
- The user reviews and approves all application content and manually submits every application.

Automatic job-application submission is prohibited. CareerOps may prepare, review, and track applications, but it does not submit them.

Imported job descriptions and AI-generated output are untrusted input. They must be validated at system boundaries and must never be treated as executable instructions.

## Foundation architecture

The repository is a single Next.js App Router application backed by PostgreSQL:

```text
Browser and reviewed imports
            |
            v
Next.js modular monolith
  app routes and UI
  application modules (added by vertical slice)
  server-only infrastructure
            |
          Prisma
            |
        PostgreSQL
```

Product logic belongs in modules and use cases, not in React components or route handlers. Prisma access is server-only. Future user-owned records must be scoped using trusted, server-derived identity.

## Prerequisites

- Node.js 24 LTS
- npm 11 or later
- Docker with Docker Compose

The repository includes `.nvmrc`. With nvm installed:

```bash
nvm use
```

## Initial setup

Install dependencies and create local configuration:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
```

The values in `.env.example` are local-only placeholders. Never commit a real `.env` file or place secrets in variables prefixed with `NEXT_PUBLIC_`.

## PostgreSQL

Start the local PostgreSQL service:

```bash
docker compose up -d --wait postgres
```

Check its status or stop it without deleting its data:

```bash
docker compose ps
docker compose down
```

The Compose service binds only to `127.0.0.1`. Its named volume persists development data between container restarts.

Changing the bootstrap username, password, or database name does not update an already initialized volume. Recreating the volume deletes all local database data, so only use `docker compose down --volumes` when that loss is intentional.

## Prisma

The foundation schema intentionally contains no product models. The first real migration will be introduced with the candidate evidence domain.

```bash
npm run db:generate
npm run db:validate
npm run db:migrate:dev -- --name descriptive_migration_name
npm run db:migrate:deploy
npm run db:studio
```

Use Prisma migrations for schema changes. `prisma db push` is not the project migration workflow.

## Development

Start the application:

```bash
npm run dev
```

Then open `http://localhost:3000`. The liveness endpoint is available at `http://localhost:3000/api/health`; it deliberately does not test or expose database details.

## Quality checks

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run verify
```

`verify` runs the non-provisioning foundation gates in a sensible order. Integration tests still require PostgreSQL, and E2E tests require a production build.

## Tests

Unit tests do not require a database:

```bash
npm run test:unit
```

Integration tests require the healthy Compose database and perform a read-only connectivity smoke test:

```bash
docker compose up -d --wait postgres
npm run test:integration
```

End-to-end tests use Chromium and start the already-built production server:

```bash
npm run build
npx playwright install chromium
npm run test:e2e
```

## Production build

```bash
npm run build
npm run start
```

Formatting, linting, type checking, and tests are separate gates; a successful Next.js build does not replace them.

## Continuous integration

GitHub Actions runs on pushes to `main` and on pull requests. CI installs dependencies reproducibly, starts a PostgreSQL service, validates Prisma, runs formatting, linting, type checking, unit and integration tests, creates a production build, and runs the Chromium E2E suite. A Playwright report is uploaded when E2E fails.

## Troubleshooting

- **Wrong Node version:** ensure `node --version` reports `v24.x`, then run `npm ci` again.
- **The configured PostgreSQL port is occupied:** stop the conflicting local PostgreSQL instance or change `POSTGRES_PORT` and the port in `DATABASE_URL` together.
- **Prisma client cannot be imported:** run `npm run db:generate`.
- **Database authentication fails after editing `.env`:** the existing Docker volume still has its original bootstrap credentials. Restore the original values or intentionally recreate the local volume.
- **E2E cannot start:** run `npm run build` before `npm run test:e2e` and confirm the dedicated E2E port 3100 is available.

## Deferred product phases

This increment establishes the repository only. Authentication-provider integration, n8n runtime integration, scoring, tracking, RAG/vector retrieval, scraping, and agent workflows are deferred to later reviewed increments rather than rejected as permanent capabilities.

The next planned vertical slice is:

```text
Candidate Profile
→ Experiences
→ Projects
→ Evidence Items
→ Approved Claims Bank
```

That slice will introduce the first product-domain models and first real Prisma migration. It is intentionally not part of the repository foundation.
