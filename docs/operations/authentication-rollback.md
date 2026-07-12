# Authentication rollback

The production-authentication migrations are additive. They preserve existing `User.id` values and every Candidate Evidence relationship while making `developmentKey` nullable, adding authentication tables and metadata, and adding authentication enforcement/audit triggers.

## Before production sign-in is enabled

Application code may be rolled back and the new schema may remain unused. Keep the trigger functions with the authentication tables unless a reviewed forward repair replaces them. A reviewed reverse migration could remove triggers, functions, authentication tables, and columns only after confirming that every user still has a development key and no production authentication data must be retained.

## After production users exist

Do not restore `developmentKey NOT NULL`, delete production users, or remove authentication tables. Production users legitimately have no development key, and destructive rollback could remove authoritative Candidate Evidence.

Operational rollback is:

1. Disable the authentication entry point at the deployment boundary.
2. Revoke all active `AuthSession` rows.
3. Roll back the application deployment.
4. Leave additive authentication schema and user metadata intact.
5. Repair forward with a new reviewed Prisma migration.

Do not drop only the audit or status triggers while leaving authentication enabled: that would weaken the transaction guarantees. Trigger removal must occur only after the authentication entry point is disabled and active sessions are revoked.

Never edit the applied migration and never use `prisma db push`. Migration repair, if required, must use a new migration and preserve all internal user IDs.
