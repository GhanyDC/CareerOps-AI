# Grounded RAG Retrieval Layer

## Purpose and Stage 10 boundary

Stage 9 retrieves relevant, user-owned Candidate Evidence and returns structured citations. It
answers what was retrieved, why it ranked, which authoritative Evidence record and version supplied
the snippet, and whether the index coordinates are current.

It does not call a chat model or generate an answer. Retrieval is not a qualification decision,
fit score, evidence-gap conclusion, application claim, resume sentence, cover-letter sentence, or
recommendation to apply. Stage 10 may consume the packet for grounded fit explanations and factual
gap analysis, but it must preserve the citations, explicit-link semantics, authorization boundary,
and freshness coordinates. It must not treat a retrieved item as proof merely because it ranked.

## Authoritative corpus and canonical document

`EvidenceItem` is the only retrieval corpus. `EvidenceRetrievalIndex` and
`EvidenceRetrievalChunk` are replaceable derivatives and never become authoritative career facts.
Canonical schema version 1 uses this stable order:

1. Evidence statement (`claim`)
2. Evidence source type
3. Evidence strength
4. Verification status
5. Supporting context, when present
6. Skills demonstrated, in user-authored order
7. Relevant role families, in user-authored order

Each section has an explicit label. Text is NFC-normalized, CRLF is normalized to LF, unsafe
control and bidirectional-control characters are removed, horizontal whitespace is collapsed, and
blank lines are bounded. The document contains no timestamp and its SHA-256 hash covers only the
canonical content. Evidence ID and version are coordinates outside the content hash.

The 12,000-character total cap is below the aggregate bounds of the selected Evidence fields and
prevents accidental growth. It is also comfortably below the configured batching design. The
builder deliberately excludes source notes, permission flags, URLs, contact data, Experience and
Project private/source metadata, imported or parser payloads, provenance, authentication
identifiers, audit fields, operational IDs, timestamps, and deleted narrative. Source title and
organization may be an authorized display label but do not enter the canonical content because
their current lifecycle does not advance `EvidenceItem.version`.

## Deterministic chunking

Chunking schema version 1 follows canonical sections first, then paragraph boundaries, then
sentence boundaries. Only an overlong sentence or paragraph uses hard character splitting.

- Maximum canonical size: 12,000 Unicode code points
- Maximum chunk size: 1,200 code points
- Maximum chunks per Evidence record: 20
- Hard-split overlap: 80 code points

Normal section and sentence chunks have no overlap. The 80-character overlap exists only for hard
fallback so a boundary does not erase the immediate local context. Chunk order, zero-based index,
section, ID, and SHA-256 hash are deterministic. A chunk hash covers chunking schema, Evidence ID
and version, index, section, and text. Full Evidence content is not duplicated into every chunk.
If deterministic chunking would produce more than 20 chunks, indexing fails explicitly with the
safe bounded code `CHUNK_LIMIT_EXCEEDED`; it never truncates the document. Atomic replacement
removes any prior derived chunks, records zero chunks in `FAILED` state, exposes neither lexical
nor semantic results for that Evidence, and permits a normal manual retry after the authoritative
content is reduced or the chunking implementation is corrected.

## Persistence and PostgreSQL requirements

Migration `20260729120000_grounded_rag_retrieval` is the single additive Stage 9 migration. It:

- enables the `vector` extension;
- adds explicit active/archive lifecycle fields to Candidate Evidence;
- creates one `EvidenceRetrievalIndex` per owned Evidence record;
- creates versioned `EvidenceRetrievalChunk` rows with optional 1,536-dimensional vectors;
- creates compact `EvidenceRetrievalEvent` rows;
- enforces composite Evidence/user ownership and bounded shape checks;
- creates a GIN full-text expression index and a cosine HNSW expression index;
- creates Evidence lifecycle triggers that initialize state, remove obsolete derived narrative,
  and mark the index stale; and
- prevents a completed requirement review from using archived Evidence.

Development and CI use the pinned `pgvector/pgvector:0.8.5-pg17-bookworm` image. A production
PostgreSQL target is compatible only when its service/version supports pgvector and the migration
role may run `CREATE EXTENSION IF NOT EXISTS vector`. Verify this before deployment with extension
catalog and migration checks; there is no non-vector production mode for this schema. The
[pgvector project documentation](https://github.com/pgvector/pgvector) is the primary reference
for extension installation, cosine distance, HNSW, and supported PostgreSQL versions.

The HNSW index is present for production-compatible vector storage and future scale work. Stage 9
semantic queries first materialize the authorized tenant's current chunks, then perform exact
cosine ranking inside that set. This deliberately favors tenant isolation and deterministic recall
over a global approximate scan. A future performance increment may use partitioning or a reviewed
filtered approximate plan, but must prove that tenant filtering occurs before candidate ranking.

## Embedding-provider boundary

The server-only `EmbeddingProvider` reports provider, model, dimensions, and maximum batch size and
supports separate document and query embedding methods. It returns only vectors and typed bounded
failure codes. The indexing use case calls the provider before starting the short atomic chunk-set
replacement transaction.

The production adapter uses the official `openai` SDK. It defaults to configurable
`text-embedding-3-small` with an explicit 1,536-dimensional response, batches at most 32 inputs,
uses a 20-second request timeout, and permits at most two SDK retries. Current parameter and model
limits come from the official
[embeddings API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create),
[embeddings guide](https://developers.openai.com/api/docs/guides/embeddings), and
[OpenAI Node SDK](https://github.com/openai/openai-node). Provider/model selection and the API key
are server-only. Configuration is validated only when semantic retrieval is enabled.

`deterministic-test` is a token-hash test double available only when `NODE_ENV=test`. It proves
dimensions, plumbing, ranking, and isolation; it is not a production semantic model and no
automated test calls OpenAI.

## Retrieval channels and fusion

All input crosses Zod boundaries. User queries are plain text, at most 500 characters, and never
stored. Diagnostics retain only a tenant-separated keyed digest of the normalized query. The
server derives a retrieval-diagnostics key with HMAC-SHA-256 over
`careerops:retrieval-query-diagnostics:v1` using `BETTER_AUTH_SECRET`, then computes HMAC-SHA-256
over `userId`, a NUL delimiter, and the normalized query. The lowercase 64-character digest is
written only to the server-side compact event and is not returned to the browser. Rotating
`BETTER_AUTH_SECRET` intentionally breaks correlation with diagnostics created under the previous
secret. Requirement mode uses one active authoritative requirement statement. Job mode
concatenates only active authoritative requirements with `Required`, `Preferred`, or `Other`
labels, preserves their deterministic order, and stops at the same 500-character bound. Raw Job
descriptions and parse payloads are not queried.

Lexical search uses `plainto_tsquery('english', ...)`, `to_tsvector`, and `ts_rank_cd`. SQL values
are parameterized. Semantic search uses cosine distance (`<=>`) over exactly 1,536-dimensional
vectors. Both channels require:

- the trusted user ID;
- active Evidence;
- the current Evidence version and chunk version;
- matching canonical, chunking, and retrieval coordinates;
- a current channel flag; and
- a maximum of 50 chunk candidates.

Semantic search additionally requires the configured provider, model, and dimension coordinates
and a `CURRENT` semantic index. Results are deduplicated by Evidence. The best chunk is selected by
channel rank, chunk index, and code-unit ID ordering.

Hybrid ranking uses reciprocal-rank fusion with `k = 60`:

```text
RRF(evidence) =
  (lexical rank exists ? 1 / (60 + lexical rank) : 0)
  + (semantic rank exists ? 1 / (60 + semantic rank) : 0)
```

Ties resolve by lexical rank, semantic rank, then code-unit Evidence ID. Default `topK` is 5,
maximum `topK` is 10, and the final list is truncated only after fusion and Evidence
deduplication. There is no LLM reranker.

## Explicit links and citation packet

Requirement retrieval places active user-confirmed `FULL` and `PARTIAL` links in a separate,
deterministic list before suggestions. Reasons are exactly:

- `EXPLICIT_FULL_LINK`
- `EXPLICIT_PARTIAL_LINK`
- `LEXICAL`
- `SEMANTIC`
- `HYBRID`

Explicit records are removed from the suggestion list, remain full or partial, and are never
described as semantic discoveries. Retrieval never creates or mutates a requirement link.

Each result carries Evidence ID/version, safe label and type, state, verification and strength,
reasons, explicit support level, best chunk coordinates and bounded snippet, chunk and canonical
hashes, freshness, channel ranks, final rank, and an authorized navigation target. A citation means
only: “this snippet came from this exact authorized Candidate Evidence record and version.” It
does not verify the statement, establish full support, prove qualification, or authorize use in an
application. Citation navigation compares the cited version to the current authorized record and
shows when it has become stale.

## Freshness and lifecycle

Lexical currentness requires matching Evidence version, canonical hash, chunking schema, retrieval
schema, and current chunks. Semantic currentness additionally requires the active configured
provider, model, and 1,536 dimensions. A stored semantic index with different runtime coordinates
is excluded and presented as lexical-only. Staleness is not a retrieval result or a career
judgment.

- **Create:** the authoritative transaction succeeds and a database trigger creates `PENDING`
  index state. No provider call occurs in that transaction.
- **Edit or verification transition:** the established Evidence version advances; a trigger
  deletes prior derived chunks and marks the index `STALE`.
- **Archive:** an explicit audited action preserves the authoritative Evidence, claims, links,
  and audits, advances the Evidence version, removes chunks, and excludes it from active retrieval.
- **Restore:** an explicit audited action advances the version and leaves the index `STALE` until
  manually reindexed.
- **Delete:** existing dependency rules still apply. Once allowed, cascading composite foreign
  keys remove index and chunks; diagnostics never retain deleted narrative.
- **Provider disabled/failure:** canonical chunks are atomically stored as current lexical chunks
  with `DISABLED` or `FAILED`; no partial vector set is exposed. A successful retry replaces the
  whole set and clears the error.
- **Chunk limit exceeded:** no truncated or partial chunk set is retained. The index records
  `FAILED` with `CHUNK_LIMIT_EXCEEDED` and zero chunks; the UI offers a manual retry.

One-record index/reindex and a cursor-based page are synchronous. The absolute page cap is 10; the
UI processes 5 at a time. External calls happen outside PostgreSQL transactions. Serializable
replacement locks and rechecks the Evidence version, deletes/reinserts the derived set, and updates
index state atomically. There is no queue, worker, scheduler, or unbounded corpus operation.

## Authorization, privacy, and diagnostics

Protected reads derive identity with `getRequestContext()` and mutations with
`getMutationRequestContext()`. Browser input never supplies `userId`. Application predicates,
composite foreign keys, and the tenant-materialized vector query all enforce ownership. Citation
resolution repeats normal authorized Evidence lookup.

Evidence and query text are inert retrieval data, not instructions. Stage 9 has no prompt template
or answer-generation call. React renders text without raw HTML. Application diagnostics do not log
queries, Evidence narrative, snippets, vectors, provider payloads, keys, or database URLs.
`EvidenceRetrievalEvent` stores only the tenant-separated keyed query digest, mode, bounded counts,
duration bucket, fixed result code, provider/model coordinates, and time. Neither the derived key
nor the digest is exposed through the retrieval packet or browser UI.

## Evaluation

`npm run eval:retrieval` runs synthetic, deterministic cases and reports:

- Recall@k
- mean reciprocal rank
- explicit-link inclusion
- tenant-isolation failures
- stale-index failures
- citation correctness

This command performs in-memory metric calculation over synthetic returned-ID fixtures. It does not
exercise PostgreSQL search or an embedding model, and its Recall@k and MRR values are not evidence
of production retrieval quality. PostgreSQL integration tests separately exercise the actual
lexical and vector query paths with the deterministic test provider.

Add cases with invented IDs and narratives only. Never copy private user data, raw provider
responses, or live credentials into evaluation fixtures. Unit and PostgreSQL tests use the
deterministic provider for algorithm correctness. Any future production-quality evaluation must be
a separately reviewed increment using a curated non-private dataset and the production embedding
provider under explicit server-side configuration, with no CI or live-user traffic. Synthetic
metric fixtures and fake embeddings must not be used to claim production semantic quality.

## Explicit exclusions

Stage 9 adds no chat completion, generated fit explanation, evidence-gap conclusion, qualification
decision, fit scoring, automatic claim, application-material tailoring, application tracking or
submission, scraping, URL fetching, enrichment, LLM reranking, agent loop, background worker,
scheduler, n8n runtime, or automatic Job/Evidence mutation.
