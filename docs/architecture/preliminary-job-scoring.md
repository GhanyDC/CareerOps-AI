# Preliminary Job Scoring

## Purpose and authority boundary

Preliminary Job Scoring is a user-controlled, deterministic desirability ranking over structured
fields on an authoritative `Job`. It answers how attractive a Job is under the user's current soft
preferences. It does not decide whether a Job satisfies hard constraints, whether the candidate is
qualified, whether Candidate Evidence supports a requirement, whether the user should apply, or
whether an application should be submitted.

Hard Filters remain the eligibility authority and are displayed as a separate signal. A Hard Filter
`FAIL` never becomes a scoring penalty. A failing Job can retain a score and remains visible in the
authoritative inventory. An explicit consideration-view option may omit current `FAIL` results; it
does not archive, reject, delete, hide globally, or mutate a Job.

All product reads and mutations derive ownership from the authenticated request context. Forms,
URLs, cursors, and request bodies cannot choose a `userId`. Repositories scope every profile,
score, event, query, aggregate, and cursor by the trusted owner, while composite foreign keys
enforce same-tenant relationships in PostgreSQL.

## Version 1 component catalog

The fixed v1 catalog uses only authoritative structured Job fields:

1. `SALARY` compares exact currency and salary-period units. It uses the known salary floor when a
   minimum is present and otherwise uses the lone known maximum. It performs no currency conversion
   or benchmarking. A value at or above the target scores 100, a value from the preferred minimum
   up to the target scores 60, and a value below the preferred minimum scores 0.
2. `EMPLOYMENT_TYPE` scores authoritative enum values by user-assigned tiers: most preferred 100,
   acceptable 70, less preferred 40, and known unlisted values 0.
3. `WORKPLACE_ARRANGEMENT` uses the same 100/70/40/0 tiers for `REMOTE`, `HYBRID`, `ON_SITE`,
   `FIELD_BASED`, and `OTHER`. It does not infer onsite frequency.
4. `COUNTRY` uses the same tiers and only the authoritative two-letter `countryCode`. It does not
   infer country from city, region, location labels, or prose.

Title, company, industry, experience requirements, schedule, travel, authorization, description,
qualifications, responsibilities, skills, and other prose are not scored.

## Configuration and numeric contract

There is one active `JobScoringProfile` per user. Every component has a code-defined version,
enabled flag, non-negative integer weight, and strict preferences. Enabled weights must be positive
and total exactly 100. Disabled weights must be zero. This is both the normalization contract and
the upper bound for coverage.

Each available component produces an integer raw score from 0 through 100. Its exact
`weightedContribution` is `rawScore * weight`. The final score is:

```text
round-half-up(sum(weightedContribution) / sum(available component weights))
```

The evaluator uses integer arithmetic throughout. The result is a whole number from 0 through 100
and is repeatable across runs.

## Missing data and coverage

Missing or incomparable data is excluded from the denominator. It is never silently treated as a
preference mismatch. Salary data is incomparable when currency or period differs because v1 does
not convert units.

Coverage is the sum of weights for available components. Because enabled weights total 100,
coverage is also a percentage from 0 through 100. If no component is available, the stored score
is explicitly 0 with 0% coverage and the fixed `NO_COVERED_COMPONENTS` explanation. The UI always
shows coverage beside a current numeric score so this convention is not mistaken for a known poor
match.

## Determinism and explainability

Configuration is strictly validated, tier lists are deduplicated and sorted, and decimals use a
canonical string representation before stable object-key serialization and SHA-256 hashing.
Explanations use a fixed component order and contain:

- schema, rule-set, profile, and Job versions;
- final score, coverage, covered weight, and enabled total weight;
- component weight, availability, raw score, and exact weighted contribution;
- fixed reason code and fixed reason message;
- safe configured values, safe authoritative Job values, and explicit missing fields.

Explanations and compact events never contain descriptions, qualifications, responsibilities,
Discovery payloads, contacts, application instructions, or sensitive provenance. PostgreSQL
checks enforce supported schema versions, positive versions, score and coverage bounds, hashes,
JSON size limits, explanation-column agreement, event shapes, and actor ownership.

## Current scores and freshness

`JobPreliminaryScore` stores one current score per owned Job. A score is derived as stale when it is
absent or when any of these coordinates differs from current state:

- scoring profile version;
- scoring rule-set version; or
- authoritative Job version.

Staleness is not a numeric score. Stale rows remain visible for transparency until refreshed, and
ranked queries place stale or missing scores after current numeric scores.

## Lifecycle and transactions

Initial Job confirmation, authoritative Job edits, selected-field reparses, and restore refresh the
score synchronously when a scoring profile exists. The Job mutation, duplicate canonicalization,
Hard Filter evaluation, and scoring refresh share the existing serializable transaction, so they
commit or roll back together.

Archive preserves the last score without producing an archive-specific score. Archived Jobs are
excluded from active rankings and summaries. Discovery privacy purge does not rescore when
authoritative scoring fields do not change and cannot copy purged content into scoring storage.
Repeated refresh of unchanged version coordinates is a deterministic no-op.

Profile updates use an expected version and logically stale existing scores. The settings workflow
then scores at most 50 active Jobs in its first synchronous page. A strict opaque cursor binds the
last Job ID to the expected profile version. Every continuation page is also limited to 50 Jobs,
and a concurrent profile change invalidates the old cursor. There is no worker, scheduler, or
automatic continuation.

## Duplicate and ranking policy

Every authoritative Job is scored independently, including every member of a confirmed duplicate
group. Scores and fields are never copied, merged, reconciled, or consolidated between members.
Changing the explicit primary affects projections only and does not rescore any Job.

The normal authoritative inventory continues to show every Job. Ranked consideration views and
dashboard summaries project standalone Jobs plus only the explicit active primary of each duplicate
group. The include-members option restores secondary members. An archived primary removes the
group from active collapsed projections; another member is never promoted automatically.

## Audit and retention

Profile creation and update write compact `AuditLog` records. `JobScoringEvent` retains profile
changes and score transitions with version coordinates, prior/current score and coverage, safe
reason codes, and hashes rather than full historical explanations. Hard deletion of an owning user
or Job cascades current scoring storage. Product soft deletion preserves authoritative history.

## Scope exclusions and future evidence matching

This slice adds no Candidate Evidence retrieval, requirement-to-evidence matching, qualification or
skill assessment, RAG, embeddings, vector search, LLM call, resume or cover-letter tailoring,
company enrichment, salary benchmarking, currency conversion, external API, scraping, URL fetch,
application tracking, application submission, worker, scheduler, n8n runtime behavior, autonomous
workflow, or automatic Job mutation.

A future reviewed increment may compare Job requirements with Candidate Evidence. That later
evidence-grounded assessment must remain distinct from both soft preference scoring and Hard Filter
eligibility.
