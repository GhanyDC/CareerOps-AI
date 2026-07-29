# Grounded retrieval operations

## Development database

Compose and CI pin `pgvector/pgvector:0.8.5-pg17-bookworm`, which supplies PostgreSQL 17 and
pgvector. Start the loopback-only service and deploy migrations normally:

```powershell
docker compose up -d --wait postgres
npm run db:migrate:deploy
npm run db:migrate:status
npm run db:migrate:drift
```

Do not use `prisma db push`. An existing named volume created by the former plain PostgreSQL 17
image can be opened by the matching PostgreSQL major image; the additive migration installs the
extension in the application database.

Production deployment requires a PostgreSQL service that supports pgvector and a migration role
allowed to execute `CREATE EXTENSION IF NOT EXISTS vector`. Confirm that contract with the provider
before release. After migration, verify that `vector` is present in `pg_extension`, all migrations
are current, and Prisma drift is zero. If the managed database prohibits the extension, stop the
deployment; do not substitute a process-local or cross-tenant vector store.

## Provider configuration

Semantic retrieval is opt-in:

```text
CAREEROPS_EMBEDDING_PROVIDER=disabled
CAREEROPS_EMBEDDING_PROVIDER=openai
CAREEROPS_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=<server-only value>
```

`disabled` remains the safe default and supports lexical indexing/search. `OPENAI_API_KEY` is
validated only for the OpenAI mode and must remain server-side. Never use a `NEXT_PUBLIC_*`
variable, log the value, or store it in workflow exports. `deterministic-test` is rejected outside
`NODE_ENV=test`.

## Indexing and diagnostics

The protected `/retrieval` page indexes one Evidence record or a page of 5. The server rejects a
page over 10 and returns a cursor for continuation. `PENDING`, `STALE`, `FAILED`, and `DISABLED`
records are eligible; archived Evidence is skipped. A successful retry clears a prior bounded
error code.

If canonical chunking exceeds the 20-chunk bound, indexing fails with
`CHUNK_LIMIT_EXCEEDED`. The atomic replacement retains no partial or truncated chunks, records
zero current chunks, and leaves the Evidence eligible for manual retry. Reduce the authoritative
content or correct the chunking behavior before retrying; do not raise the bound as an operational
workaround without a reviewed schema and resource-bound increment.

Compact events are operational signals, not an audit of query content. They contain a
tenant-separated keyed HMAC of the normalized query, bounded counts, fixed codes, buckets, and
provider coordinates only. The key is derived server-side from `BETTER_AUTH_SECRET` under the
versioned retrieval-diagnostics domain; neither the key nor digest is returned to the browser.
Secret rotation intentionally prevents correlating new diagnostic digests with old ones. Diagnose
provider failures through the bounded error code and server infrastructure; do not add raw query,
Evidence, vector, request, response, key, or full connection-string logging.

## CI and release verification

CI uses the same pinned pgvector image and the release gate deploys migrations before drift,
integration, build, and browser checks. Playwright starts:

- port 3100 with the deterministic test-only provider for semantic/hybrid coverage;
- port 3101 with semantic retrieval disabled for lexical fallback coverage.

Neither server can call a live provider. Run `npm run eval:retrieval` separately; it calculates
Recall@k, MRR, and the other metrics in memory over synthetic returned-ID fixtures only. Those
numbers do not measure production retrieval quality. PostgreSQL integration tests exercise the
actual lexical and vector SQL paths. A future production-quality evaluation must use a separately
reviewed curated non-private dataset and the production embedding provider. The full local gate
remains `npm run verify:release`.
