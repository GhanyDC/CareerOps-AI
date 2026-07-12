# Manual Google OAuth smoke test

Run this checklist in the production-like deployment before merge. Do not record credentials, tokens, cookies, provider payloads, or OAuth claims in the test report.

1. Confirm the registered callback is `${BETTER_AUTH_URL}/api/auth/callback/google`.
2. Open `/sign-in`.
3. Complete Google consent.
4. Confirm first sign-in reaches the protected dashboard.
5. Sign out, sign in again, and confirm the same internal `User.id` resolves.
6. Confirm Candidate Evidence remains owned by that intended internal User.
7. Inspect the session cookie and confirm `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`.
8. Sign out and confirm the database session is invalid immediately.
9. Suspend the account and confirm a new login is rejected before any usable session row or cookie exists.
10. Confirm the browser receives only the generic authentication error.
11. Confirm no provider token or secret appears in browser storage, HTML, server logs, authentication audits, or reports.

Automated verification does not complete or replace this checklist.
