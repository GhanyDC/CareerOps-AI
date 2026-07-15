-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobEmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'APPRENTICESHIP', 'VOLUNTEER', 'OTHER');

-- CreateEnum
CREATE TYPE "JobWorkplaceArrangement" AS ENUM ('ON_SITE', 'HYBRID', 'REMOTE', 'FIELD_BASED', 'OTHER');

-- CreateEnum
CREATE TYPE "JobExperienceLevel" AS ENUM ('INTERNSHIP', 'ENTRY_LEVEL', 'MID_LEVEL', 'SENIOR', 'LEAD', 'MANAGER', 'DIRECTOR', 'EXECUTIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "JobSalaryPeriod" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "JobParseDraftStatus" AS ENUM ('READY_FOR_REVIEW', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "JobSourcePurpose" AS ENUM ('INITIAL_CONFIRMATION', 'REPARSE_MERGE');

-- CreateEnum
CREATE TYPE "JobParsingEventType" AS ENUM ('PARSE_DRAFT_CREATED', 'PARSE_DRAFT_CORRECTED', 'PARSE_DRAFT_REJECTED', 'PARSE_DRAFT_SUPERSEDED', 'PARSE_DRAFT_CONFIRMED', 'JOB_CREATED_FROM_DISCOVERY', 'JOB_UPDATED_FROM_PARSE', 'PARSE_SOURCE_PRIVACY_REDACTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'JOB_CREATED_FROM_DISCOVERY';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_UPDATED_FROM_PARSE';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_SOURCE_PRIVACY_REDACTED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'JOB';

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "companyName" VARCHAR(200),
    "employmentType" "JobEmploymentType",
    "workplaceArrangement" "JobWorkplaceArrangement",
    "experienceLevel" "JobExperienceLevel",
    "countryCode" VARCHAR(2),
    "region" VARCHAR(160),
    "city" VARCHAR(160),
    "locationLabel" VARCHAR(300),
    "salaryMin" DECIMAL(14,2),
    "salaryMax" DECIMAL(14,2),
    "salaryCurrency" VARCHAR(3),
    "salaryPeriod" "JobSalaryPeriod",
    "postedAt" DATE,
    "closesAt" DATE,
    "sourceUrl" VARCHAR(2048),
    "description" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredQualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicationInstructions" TEXT,
    "contactDetails" TEXT,
    "notes" TEXT,
    "fieldProvenance" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobParseDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discoveryId" TEXT,
    "batchId" TEXT,
    "sourceDiscoveryRef" VARCHAR(100) NOT NULL,
    "sourceBatchRef" VARCHAR(100) NOT NULL,
    "targetJobId" TEXT,
    "baseJobVersion" INTEGER,
    "parserVersion" VARCHAR(64) NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "sourcePayloadHash" CHAR(64) NOT NULL,
    "parsedPayload" JSONB NOT NULL,
    "validationSummary" JSONB NOT NULL,
    "fieldProvenance" JSONB NOT NULL,
    "status" "JobParseDraftStatus" NOT NULL DEFAULT 'READY_FOR_REVIEW',
    "userCorrections" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "contentPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobParseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "discoveryId" TEXT,
    "batchId" TEXT,
    "sourceDiscoveryRef" VARCHAR(100) NOT NULL,
    "sourceBatchRef" VARCHAR(100) NOT NULL,
    "parseDraftId" TEXT NOT NULL,
    "purpose" "JobSourcePurpose" NOT NULL,
    "sourcePayloadHash" CHAR(64) NOT NULL,
    "parserVersion" VARCHAR(64) NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "appliedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedByUserId" TEXT NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "confirmationHash" CHAR(64) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcePurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobParsingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parseDraftId" TEXT NOT NULL,
    "jobId" TEXT,
    "eventType" "JobParsingEventType" NOT NULL,
    "previousStatus" "JobParseDraftStatus",
    "newStatus" "JobParseDraftStatus",
    "safeMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobParsingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_userId_status_confirmedAt_id_idx" ON "Job"("userId", "status", "confirmedAt", "id");

-- CreateIndex
CREATE INDEX "Job_userId_employmentType_confirmedAt_id_idx" ON "Job"("userId", "employmentType", "confirmedAt", "id");

-- CreateIndex
CREATE INDEX "Job_userId_workplaceArrangement_confirmedAt_id_idx" ON "Job"("userId", "workplaceArrangement", "confirmedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_id_userId_key" ON "Job"("id", "userId");

-- CreateIndex
CREATE INDEX "JobParseDraft_userId_discoveryId_status_idx" ON "JobParseDraft"("userId", "discoveryId", "status");

-- CreateIndex
CREATE INDEX "JobParseDraft_userId_status_updatedAt_id_idx" ON "JobParseDraft"("userId", "status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "JobParseDraft_userId_targetJobId_status_idx" ON "JobParseDraft"("userId", "targetJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobParseDraft_id_userId_key" ON "JobParseDraft"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobParseDraft_id_sourceDiscoveryRef_sourceBatchRef_userId_key" ON "JobParseDraft"("id", "sourceDiscoveryRef", "sourceBatchRef", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_parseDraftId_key" ON "JobSource"("parseDraftId");

-- CreateIndex
CREATE INDEX "JobSource_userId_jobId_confirmedAt_idx" ON "JobSource"("userId", "jobId", "confirmedAt");

-- CreateIndex
CREATE INDEX "JobSource_userId_discoveryId_confirmedAt_idx" ON "JobSource"("userId", "discoveryId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_id_userId_key" ON "JobSource"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_userId_idempotencyKey_key" ON "JobSource"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_parseDraftId_sourceDiscoveryRef_sourceBatchRef_us_key" ON "JobSource"("parseDraftId", "sourceDiscoveryRef", "sourceBatchRef", "userId");

-- CreateIndex
CREATE INDEX "JobParsingEvent_userId_parseDraftId_createdAt_idx" ON "JobParsingEvent"("userId", "parseDraftId", "createdAt");

-- CreateIndex
CREATE INDEX "JobParsingEvent_userId_jobId_createdAt_idx" ON "JobParsingEvent"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobParsingEvent_userId_eventType_createdAt_idx" ON "JobParsingEvent"("userId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParseDraft" ADD CONSTRAINT "JobParseDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParseDraft" ADD CONSTRAINT "JobParseDraft_discoveryId_batchId_userId_fkey" FOREIGN KEY ("discoveryId", "batchId", "userId") REFERENCES "JobDiscovery"("id", "batchId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParseDraft" ADD CONSTRAINT "JobParseDraft_targetJobId_userId_fkey" FOREIGN KEY ("targetJobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_discoveryId_batchId_userId_fkey" FOREIGN KEY ("discoveryId", "batchId", "userId") REFERENCES "JobDiscovery"("id", "batchId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_parseDraftId_sourceDiscoveryRef_sourceBatchRef_u_fkey" FOREIGN KEY ("parseDraftId", "sourceDiscoveryRef", "sourceBatchRef", "userId") REFERENCES "JobParseDraft"("id", "sourceDiscoveryRef", "sourceBatchRef", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParsingEvent" ADD CONSTRAINT "JobParsingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParsingEvent" ADD CONSTRAINT "JobParsingEvent_parseDraftId_userId_fkey" FOREIGN KEY ("parseDraftId", "userId") REFERENCES "JobParseDraft"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobParsingEvent" ADD CONSTRAINT "JobParsingEvent_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "Job"
ADD CONSTRAINT "Job_title_nonempty" CHECK (length(btrim("title")) > 0),
ADD CONSTRAINT "Job_company_nonempty" CHECK ("companyName" IS NULL OR length(btrim("companyName")) > 0),
ADD CONSTRAINT "Job_location_values_nonempty" CHECK (
  ("region" IS NULL OR length(btrim("region")) > 0)
  AND ("city" IS NULL OR length(btrim("city")) > 0)
  AND ("locationLabel" IS NULL OR length(btrim("locationLabel")) > 0)
),
ADD CONSTRAINT "Job_version_positive" CHECK ("version" >= 1),
ADD CONSTRAINT "Job_salary_nonnegative" CHECK (
  ("salaryMin" IS NULL OR "salaryMin" >= 0)
  AND ("salaryMax" IS NULL OR "salaryMax" >= 0)
),
ADD CONSTRAINT "Job_salary_order" CHECK (
  "salaryMin" IS NULL OR "salaryMax" IS NULL OR "salaryMax" >= "salaryMin"
),
ADD CONSTRAINT "Job_salary_shape" CHECK (
  (
    "salaryMin" IS NULL AND "salaryMax" IS NULL
    AND "salaryCurrency" IS NULL AND "salaryPeriod" IS NULL
  ) OR (
    ("salaryMin" IS NOT NULL OR "salaryMax" IS NOT NULL)
    AND "salaryCurrency" IS NOT NULL AND "salaryPeriod" IS NOT NULL
  )
),
ADD CONSTRAINT "Job_country_code" CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
ADD CONSTRAINT "Job_salary_currency" CHECK ("salaryCurrency" IS NULL OR "salaryCurrency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "Job_date_order" CHECK ("postedAt" IS NULL OR "closesAt" IS NULL OR "closesAt" >= "postedAt"),
ADD CONSTRAINT "Job_url_shape" CHECK (
  "sourceUrl" IS NULL OR ("sourceUrl" = btrim("sourceUrl") AND "sourceUrl" ~* '^https?://')
),
ADD CONSTRAINT "Job_array_sizes" CHECK (
  cardinality("responsibilities") <= 100
  AND cardinality("qualifications") <= 100
  AND cardinality("preferredQualifications") <= 100
  AND cardinality("benefits") <= 100
  AND cardinality("skills") <= 100
),
ADD CONSTRAINT "Job_field_provenance" CHECK (
  jsonb_typeof("fieldProvenance") = 'object'
  AND "fieldProvenance"->>'schemaVersion' = '1'
  AND octet_length("fieldProvenance"::text) <= 262144
),
ADD CONSTRAINT "Job_status_timestamp" CHECK (
  ("status" = 'ACTIVE' AND "archivedAt" IS NULL)
  OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
);

ALTER TABLE "JobParseDraft"
ADD CONSTRAINT "JobParseDraft_contract_version" CHECK ("contractVersion" = 1),
ADD CONSTRAINT "JobParseDraft_parser_version" CHECK (length(btrim("parserVersion")) > 0),
ADD CONSTRAINT "JobParseDraft_hash" CHECK ("sourcePayloadHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "JobParseDraft_version_positive" CHECK ("version" >= 1),
ADD CONSTRAINT "JobParseDraft_source_refs" CHECK (
  length(btrim("sourceDiscoveryRef")) > 0
  AND length(btrim("sourceBatchRef")) > 0
),
ADD CONSTRAINT "JobParseDraft_live_source" CHECK (
  (
    "discoveryId" IS NOT NULL AND "batchId" IS NOT NULL
    AND "discoveryId" = "sourceDiscoveryRef"
    AND "batchId" = "sourceBatchRef"
  ) OR (
    "discoveryId" IS NULL AND "batchId" IS NULL AND "contentPurgedAt" IS NOT NULL
  )
),
ADD CONSTRAINT "JobParseDraft_target_shape" CHECK (
  ("targetJobId" IS NULL AND "baseJobVersion" IS NULL)
  OR ("targetJobId" IS NOT NULL AND "baseJobVersion" >= 1)
),
ADD CONSTRAINT "JobParseDraft_status_timestamps" CHECK (
  (
    "status" = 'READY_FOR_REVIEW'
    AND "confirmedAt" IS NULL AND "rejectedAt" IS NULL AND "supersededAt" IS NULL
  ) OR (
    "status" = 'CONFIRMED'
    AND "confirmedAt" IS NOT NULL AND "rejectedAt" IS NULL AND "supersededAt" IS NULL
  ) OR (
    "status" = 'REJECTED'
    AND "confirmedAt" IS NULL AND "rejectedAt" IS NOT NULL AND "supersededAt" IS NULL
  ) OR (
    "status" = 'SUPERSEDED'
    AND "confirmedAt" IS NULL AND "rejectedAt" IS NULL AND "supersededAt" IS NOT NULL
  )
),
ADD CONSTRAINT "JobParseDraft_json_shapes" CHECK (
  jsonb_typeof("parsedPayload") = 'object'
  AND jsonb_typeof("validationSummary") = 'object'
  AND jsonb_typeof("fieldProvenance") = 'object'
  AND jsonb_typeof("userCorrections") = 'object'
  AND "validationSummary"->>'schemaVersion' = '1'
  AND octet_length("parsedPayload"::text) <= 262144
  AND octet_length("validationSummary"::text) <= 32768
  AND octet_length("fieldProvenance"::text) <= 262144
  AND octet_length("userCorrections"::text) <= 262144
);

CREATE UNIQUE INDEX "JobParseDraft_one_active_per_discovery"
ON "JobParseDraft" ("userId", "discoveryId")
WHERE "status" = 'READY_FOR_REVIEW' AND "discoveryId" IS NOT NULL;

ALTER TABLE "JobSource"
ADD CONSTRAINT "JobSource_contract_version" CHECK ("contractVersion" = 1),
ADD CONSTRAINT "JobSource_hashes" CHECK (
  "sourcePayloadHash" ~ '^[0-9a-f]{64}$'
  AND "confirmationHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "JobSource_parser_version" CHECK (length(btrim("parserVersion")) > 0),
ADD CONSTRAINT "JobSource_actor_is_owner" CHECK ("confirmedByUserId" = "userId"),
ADD CONSTRAINT "JobSource_applied_fields" CHECK (cardinality("appliedFields") BETWEEN 1 AND 25),
ADD CONSTRAINT "JobSource_source_refs" CHECK (
  length(btrim("sourceDiscoveryRef")) > 0
  AND length(btrim("sourceBatchRef")) > 0
),
ADD CONSTRAINT "JobSource_live_source" CHECK (
  (
    "discoveryId" IS NOT NULL AND "batchId" IS NOT NULL
    AND "discoveryId" = "sourceDiscoveryRef"
    AND "batchId" = "sourceBatchRef"
    AND "sourcePurgedAt" IS NULL
  ) OR (
    "discoveryId" IS NULL AND "batchId" IS NULL AND "sourcePurgedAt" IS NOT NULL
  )
);

ALTER TABLE "JobParsingEvent"
ADD CONSTRAINT "JobParsingEvent_metadata" CHECK (
  jsonb_typeof("safeMetadata") = 'object'
  AND octet_length("safeMetadata"::text) <= 32768
),
ADD CONSTRAINT "JobParsingEvent_shape" CHECK (
  (
    "eventType" = 'PARSE_DRAFT_CREATED'
    AND "previousStatus" IS NULL AND "newStatus" = 'READY_FOR_REVIEW' AND "jobId" IS NULL
  ) OR (
    "eventType" = 'PARSE_DRAFT_CORRECTED'
    AND "previousStatus" = 'READY_FOR_REVIEW' AND "newStatus" = 'READY_FOR_REVIEW' AND "jobId" IS NULL
  ) OR (
    "eventType" = 'PARSE_DRAFT_REJECTED'
    AND "previousStatus" = 'READY_FOR_REVIEW' AND "newStatus" = 'REJECTED' AND "jobId" IS NULL
  ) OR (
    "eventType" = 'PARSE_DRAFT_SUPERSEDED'
    AND "previousStatus" = 'READY_FOR_REVIEW' AND "newStatus" = 'SUPERSEDED' AND "jobId" IS NULL
  ) OR (
    "eventType" = 'PARSE_DRAFT_CONFIRMED'
    AND "previousStatus" = 'READY_FOR_REVIEW' AND "newStatus" = 'CONFIRMED' AND "jobId" IS NOT NULL
  ) OR (
    "eventType" IN ('JOB_CREATED_FROM_DISCOVERY', 'JOB_UPDATED_FROM_PARSE')
    AND "previousStatus" IS NULL AND "newStatus" IS NULL AND "jobId" IS NOT NULL
  ) OR (
    "eventType" = 'PARSE_SOURCE_PRIVACY_REDACTED'
    AND "previousStatus" IS NULL AND "newStatus" IS NULL
  )
);

-- A Job may be inserted before its source inside the confirmation transaction, but it must
-- never be committed without at least one source. The delete trigger also protects the last source.
CREATE FUNCTION "careerops_require_job_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  checked_job_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Job' THEN
    checked_job_id := NEW."id";
  ELSE
    checked_job_id := OLD."jobId";
  END IF;

  IF EXISTS (SELECT 1 FROM "Job" WHERE "id" = checked_job_id)
    AND NOT EXISTS (SELECT 1 FROM "JobSource" WHERE "jobId" = checked_job_id)
  THEN
    RAISE EXCEPTION 'An authoritative Job requires provenance';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "Job_requires_source"
AFTER INSERT ON "Job"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "careerops_require_job_source"();

CREATE CONSTRAINT TRIGGER "JobSource_preserve_last_source"
AFTER DELETE ON "JobSource"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "careerops_require_job_source"();
