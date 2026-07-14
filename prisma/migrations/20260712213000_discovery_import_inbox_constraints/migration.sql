-- Defense-in-depth invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "DiscoveryImportBatch"
ADD CONSTRAINT "DiscoveryImportBatch_contract_version" CHECK ("contractVersion" = 1),
ADD CONSTRAINT "DiscoveryImportBatch_producer_nonempty" CHECK (length(btrim("producerLabel")) > 0),
ADD CONSTRAINT "DiscoveryImportBatch_payload_size" CHECK (octet_length("originalPayload") <= 262144),
ADD CONSTRAINT "DiscoveryImportBatch_payload_json" CHECK (jsonb_typeof("originalPayload"::jsonb) = 'object'),
ADD CONSTRAINT "DiscoveryImportBatch_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "DiscoveryImportBatch_validation_summary" CHECK (
    jsonb_typeof("validationSummary") = 'object'
    AND "validationSummary" ?& ARRAY['validatorVersion', 'discoveryCount', 'totalPayloadBytes']
    AND "validationSummary"->>'validatorVersion' = 'discovery-import-v1'
    AND ("validationSummary"->>'discoveryCount')::integer BETWEEN 1 AND 20
    AND ("validationSummary"->>'totalPayloadBytes')::integer = octet_length("originalPayload")
);

ALTER TABLE "JobDiscovery"
ADD CONSTRAINT "JobDiscovery_raw_content" CHECK (
    octet_length("rawContent") BETWEEN 1 AND 50000
    AND length(btrim("rawContent", E' \t\n\r\f\v')) > 0
),
ADD CONSTRAINT "JobDiscovery_version_positive" CHECK ("version" >= 1),
ADD CONSTRAINT "JobDiscovery_status_timestamps" CHECK (
    ("status" = 'INBOX' AND "rejectedAt" IS NULL AND "archivedAt" IS NULL)
    OR ("status" = 'REJECTED' AND "rejectedAt" IS NOT NULL AND "archivedAt" IS NULL)
    OR ("status" = 'ARCHIVED' AND "rejectedAt" IS NULL AND "archivedAt" IS NOT NULL)
),
ADD CONSTRAINT "JobDiscovery_source_nonempty" CHECK ("sourceLabel" IS NULL OR length(btrim("sourceLabel")) > 0),
ADD CONSTRAINT "JobDiscovery_title_nonempty" CHECK ("titleHint" IS NULL OR length(btrim("titleHint")) > 0),
ADD CONSTRAINT "JobDiscovery_company_nonempty" CHECK ("companyHint" IS NULL OR length(btrim("companyHint")) > 0),
ADD CONSTRAINT "JobDiscovery_location_nonempty" CHECK ("locationHint" IS NULL OR length(btrim("locationHint")) > 0),
ADD CONSTRAINT "JobDiscovery_url_shape" CHECK (
    "submittedUrl" IS NULL
    OR (
        "submittedUrl" = btrim("submittedUrl")
        AND "submittedUrl" ~* '^https?://'
    )
),
ADD CONSTRAINT "JobDiscovery_validation_summary" CHECK (
    jsonb_typeof("validationSummary") = 'object'
    AND "validationSummary" ?& ARRAY['rawContentBytes', 'urlValidated', 'controlCharacterCheck']
    AND ("validationSummary"->>'rawContentBytes')::integer = octet_length("rawContent")
    AND jsonb_typeof("validationSummary"->'urlValidated') = 'boolean'
    AND "validationSummary"->>'controlCharacterCheck' = 'PASSED'
);

ALTER TABLE "DiscoveryProcessingEvent"
ADD CONSTRAINT "DiscoveryProcessingEvent_metadata_object" CHECK (
    "safeMetadata" IS NOT NULL AND jsonb_typeof("safeMetadata") = 'object'
),
ADD CONSTRAINT "DiscoveryProcessingEvent_shape" CHECK (
    (
        "eventType" = 'BATCH_CONFIRMED'
        AND "discoveryId" IS NULL
        AND "previousStatus" IS NULL
        AND "newStatus" IS NULL
    )
    OR (
        "eventType" = 'DISCOVERY_IMPORTED'
        AND "discoveryId" IS NOT NULL
        AND "previousStatus" IS NULL
        AND "newStatus" = 'INBOX'
    )
    OR (
        "eventType" = 'DISCOVERY_REJECTED'
        AND "discoveryId" IS NOT NULL
        AND "previousStatus" = 'INBOX'
        AND "newStatus" = 'REJECTED'
    )
    OR (
        "eventType" = 'DISCOVERY_RESTORED'
        AND "discoveryId" IS NOT NULL
        AND "previousStatus" IN ('REJECTED', 'ARCHIVED')
        AND "newStatus" = 'INBOX'
    )
    OR (
        "eventType" = 'DISCOVERY_ARCHIVED'
        AND "discoveryId" IS NOT NULL
        AND "previousStatus" IN ('INBOX', 'REJECTED')
        AND "newStatus" = 'ARCHIVED'
    )
);
