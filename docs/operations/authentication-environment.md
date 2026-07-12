# Authentication environment reference

All authentication configuration is server-only. Never prefix these variables with `NEXT_PUBLIC_`.

- `BETTER_AUTH_SECRET`: secret used by Better Auth; at least 32 characters and non-placeholder in production.
- `BETTER_AUTH_URL`: exact public origin. Production requires HTTPS and rejects loopback hosts.
- `AUTH_TRUSTED_ORIGINS`: comma-separated exact origins. It must include `BETTER_AUTH_URL`; paths, credentials, fragments, and wildcards are rejected.
- `GOOGLE_CLIENT_ID`: Google OAuth web-client identifier. Production requires the normal Google client-ID structure and rejects obvious placeholders.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret. Production requires a reasonable minimum length and rejects obvious placeholders.
- `DEVELOPMENT_SEED_ENABLED`: explicit local seed switch; production rejects `true`.
- `DEVELOPMENT_USER_KEY`: server-only stable local seed key. It is not an authentication credential.
- `DEVELOPMENT_IDENTITY_ENABLED`: retired authentication bypass; `true` is rejected.

Do not set `BETTER_AUTH_TRUSTED_ORIGINS`. Better Auth reads that variable independently, so CareerOps rejects every non-empty value and treats `AUTH_TRUSTED_ORIGINS` as the single authority. An explicitly empty process value is inert and may be used to neutralize a legacy local setting without widening the allowlist.

Configuration validation reports field names and rules only. It never includes the submitted credential value.
