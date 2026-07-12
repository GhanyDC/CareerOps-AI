# Production authentication architecture

## Boundary and identity

CareerOps uses Better Auth 1.6.23, Google OIDC, the Prisma adapter, and PostgreSQL database sessions inside the existing Next.js modular monolith. The internal `User.id` remains the authoritative relational and tenant identity.

```text
Google OIDC provider subject
  -> AuthAccount(providerId, accountId)
  -> internal User.id
  -> AuthSession
  -> trusted server request context
  -> user-scoped CareerOps operations
```

`AuthAccount(providerId, accountId)` is unique. Email and display name are nullable metadata. Better Auth implicit linking is disabled, so a matching email never attaches a new provider subject to an existing user. An explicit development-data link requires the stable provider subject and a local-only confirmation command.

## Provisioning transaction

The Better Auth 1.6.23 Prisma adapter runs with its supported `transaction: true` mode. First-time OAuth creation of the internal `User` and its `AuthAccount` therefore uses one PostgreSQL transaction. An `AuthAccount` insert trigger writes the required sanitized provisioning audits in that same transaction. If the account row, trigger, or audit insert fails, the internal user and every provisioning audit roll back, and a later login can retry from a clean state.

Better Auth database `after` hooks run after its adapter transaction and are not used for required success audits. This avoids overstating their atomicity.

## Sessions and cookies

Sessions are database-backed and validated on every protected request; the signed session-data cookie cache is disabled so revocation is immediate. Idle expiry is seven days, renewal occurs after 24 hours, and request context enforces an absolute 30-day reauthentication limit.

Production uses `__Host-careerops.session_token` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`. Development and tests use an HttpOnly loopback cookie without `Secure`. Logout deletes the database session and expires the cookie. Suspension, soft deletion, and administrative revocation remove every session for the user.

The earliest supported session-create hook rejects any user who is not `ACTIVE`. A PostgreSQL `BEFORE INSERT` trigger locks and rechecks the User row to close status-change races. A session success audit is inserted by an `AFTER INSERT` trigger in the session transaction, so `SIGN_IN_SUCCEEDED` cannot exist without its session and suspended or deleted users cannot receive it. Request context repeats the status check as defense in depth.

## Provider-token policy

CareerOps requests only `openid`, `email`, and `profile`, uses online access, and does not request offline access. Account create and update hooks replace access tokens, refresh tokens, ID tokens, token expirations, scopes, and passwords with null. A PostgreSQL check constraint rejects any direct attempt to persist those values.

Provider tokens may exist transiently in server memory during the OAuth callback. They are never exposed to client code, audit data, fixtures, or logs.

## Protection layers

- The protected App Router layout redirects missing sessions to sign-in.
- Product Server Components continue to resolve request context before reads.
- Server actions resolve mutation context, which validates both the session and exact Origin/Host.
- Route handlers must explicitly resolve request context unless they are the public auth protocol handler or health endpoint.
- Repositories and use cases retain trusted-user scoping and composite ownership constraints.
- Cross-user records remain unavailable rather than distinguishable.

`AUTH_TRUSTED_ORIGINS` is the only trusted-origin configuration. CareerOps rejects every non-empty value of Better Auth's separately read `BETTER_AUTH_TRUSTED_ORIGINS` variable, preventing an unvalidated secondary allowlist from widening authentication endpoints. An empty value contributes no origins.

## Audit and account lifecycle

Authentication audit records contain only internal user/account/session identifiers, an action, provider name, a bounded reason code, and a timestamp. They cannot contain tokens, cookies, provider subjects, emails, raw OAuth claims, payloads, or headers.

Provisioning, session creation, session success, and database session-revocation audits are transactionally coupled through PostgreSQL triggers. User-status events are coupled to their administrative transaction. The UI-level `SIGN_OUT` descriptor is written after the authoritative session deletion; if that secondary write fails, logout remains effective and the transactional `SESSION_REVOKED` event remains durable.

Users are `ACTIVE`, `SUSPENDED`, or `DELETED`. Deletion is soft and preserves authoritative Candidate Evidence. Better Auth hard user deletion is disabled. A provider-side deletion prevents future provider authentication but does not silently delete CareerOps data.

## RLS decision

PostgreSQL RLS is deferred to a dedicated hardening increment. Existing user-scoped repositories and composite ownership constraints remain authoritative. A future RLS increment must validate transaction-local tenant context, Prisma pooling, administrative roles, migrations, and multi-user negative tests before policies are enabled.

## Test seam

Tests use a separate Better Auth instance with the test-utils plugin. It is imported only from `tests/support`, registers no public routes, creates real database sessions, and produces Playwright-compatible cookies. CI and E2E do not call Google and use no development identity bypass.

The test helper rejects `NODE_ENV=production`. A separate production-semantics Playwright suite validates production environment and cookie policy without registering the helper or contacting Google.

## Known limitation

Deterministic automation verifies Better Auth's Google ID-token boundary with locally signed test tokens but does not prove the live Google consent screen, deployed callback registration, or production credential pairing. Complete the manual Google OAuth smoke checklist before merge.
