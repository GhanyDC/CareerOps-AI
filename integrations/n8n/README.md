# n8n integrations

n8n may later orchestrate external workflows through authenticated CareerOps APIs. Runtime integration is intentionally deferred from the repository-foundation increment.

## Workflow location

Store the sanitized parser export at:

```text
integrations/n8n/workflows/job-description-parser.workflow.json
```

The export is not present in this repository and must not be fabricated.

## Export and sanitization

Before committing an exported workflow:

1. Export it from the reviewed n8n environment without execution history.
2. Remove credentials, credential IDs, access tokens, webhook secrets, instance URLs, personal data, sample career data, and environment-specific identifiers.
3. Inspect node parameters and pinned data for embedded secrets or sensitive content.
4. Give the sanitized file the expected filename and review its Git diff.
5. Record the export date, compatible n8n version, expected inputs and outputs, and any manual import steps in this document.

After import, reconnect credentials inside the destination n8n instance. Credentials must never be stored in the workflow JSON or repository.

## Integration boundary

Future workflows must call authenticated, narrowly scoped CareerOps APIs. They must validate payloads, use idempotency controls where side effects are possible, and preserve the user's review and manual-submission requirement.

n8n must never receive unrestricted PostgreSQL access. Automatic job-application submission remains prohibited.
