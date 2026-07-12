# Development seed data

Run the idempotent development seed with:

```bash
npm run db:seed
```

The seed requires `DEVELOPMENT_SEED_ENABLED=true`, is rejected in production, and uses the server-only `DEVELOPMENT_USER_KEY`. It creates missing records with stable IDs derived from that key and uses no-op updates, so rerunning it does not duplicate records or overwrite user edits.

The key is not an authentication credential. The seeded user remains local-only unless it is explicitly linked to a Google provider subject with the guarded development-linking command. Email matching never transfers or links the seed data. Repeating the identical provider, subject, and seeded-user mapping succeeds without creating another account or audit; every conflicting subject, user, or email owner is rejected.

## Included facts

- Ghanymede Dela Cruz and the established target-role families
- Philippine-based preferences and DOST return-of-service context
- Odoo internship data-flow, validation, UAT, migration, and measured time reductions
- CEMS technologies, deployment, election controls, and approximately 5,000 supported students
- PawSense technologies, AI-assisted detection/guidance, and thesis recognition
- LocalOps stack and implemented operational workflows
- Magna Cum Laude, Batch Valedictorian, Best Undergraduate Thesis, Best Presenter, and ICT Uniwide 2026 2nd Runner-Up recognition

Evidence items are seeded as verified established facts. Corresponding claim-bank wording is seeded as `Requires verification`, not approved, so external usage still requires explicit user review.

## Explicit exclusions

The seed does not claim guaranteed or mathematically proven CEMS uptime. It does not claim LocalOps revenue, paying customers, or production scale. It contains no credentials, private tokens, or imported execution history.

All seeded profile, source, evidence, and draft-claim data remains editable through normal product workflows.
