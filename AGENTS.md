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
- The first real migration is planned for the candidate evidence vertical slice.

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

## Foundation increment scope

Product-domain database models, candidate evidence models, job scoring, application tracking, RAG/vector retrieval, authentication-provider integration, n8n runtime integration, job scraping, and autonomous agent workflows are deferred from the repository-foundation increment. They are possible later CareerOps capabilities and are not permanently prohibited.

Do not begin a deferred capability without a separately reviewed increment. Preserve unrelated user changes and never commit real secrets, generated Prisma output, build output, test reports, or local environment files.
