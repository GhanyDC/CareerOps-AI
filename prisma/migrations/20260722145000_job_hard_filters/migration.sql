-- CreateEnum
CREATE TYPE "JobFilterOutcome" AS ENUM ('PASS', 'FAIL', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "JobFilterEventType" AS ENUM ('PROFILE_CREATED', 'PROFILE_UPDATED', 'JOB_EVALUATED', 'JOB_REEVALUATED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'JOB_FILTER_PROFILE';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'JOB_FILTER_PROFILE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_FILTER_PROFILE_UPDATED';

-- CreateTable
CREATE TABLE "JobFilterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFilterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFilterEvaluation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "outcome" "JobFilterOutcome" NOT NULL,
    "ruleSetVersion" INTEGER NOT NULL,
    "filterProfileVersion" INTEGER NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "sourceJobVersion" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "explanationHash" CHAR(64) NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFilterEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFilterEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT,
    "eventType" "JobFilterEventType" NOT NULL,
    "actorUserId" TEXT,
    "previousOutcome" "JobFilterOutcome",
    "newOutcome" "JobFilterOutcome",
    "filterProfileVersion" INTEGER NOT NULL,
    "sourceJobVersion" INTEGER,
    "safeMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFilterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobFilterProfile_userId_key" ON "JobFilterProfile"("userId");
CREATE UNIQUE INDEX "JobFilterProfile_id_userId_key" ON "JobFilterProfile"("id", "userId");
CREATE UNIQUE INDEX "JobFilterEvaluation_id_userId_key" ON "JobFilterEvaluation"("id", "userId");
CREATE UNIQUE INDEX "JobFilterEvaluation_jobId_userId_key" ON "JobFilterEvaluation"("jobId", "userId");
CREATE INDEX "JobFilterEvaluation_userId_outcome_updatedAt_id_idx" ON "JobFilterEvaluation"("userId", "outcome", "updatedAt", "id");
CREATE INDEX "JobFilterEvaluation_userId_filterProfileVersion_outcome_idx" ON "JobFilterEvaluation"("userId", "filterProfileVersion", "outcome");
CREATE INDEX "JobFilterEvent_userId_profileId_createdAt_idx" ON "JobFilterEvent"("userId", "profileId", "createdAt");
CREATE INDEX "JobFilterEvent_userId_jobId_createdAt_idx" ON "JobFilterEvent"("userId", "jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobFilterProfile" ADD CONSTRAINT "JobFilterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvaluation" ADD CONSTRAINT "JobFilterEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvaluation" ADD CONSTRAINT "JobFilterEvaluation_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "JobFilterProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvaluation" ADD CONSTRAINT "JobFilterEvaluation_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvent" ADD CONSTRAINT "JobFilterEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvent" ADD CONSTRAINT "JobFilterEvent_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "JobFilterProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFilterEvent" ADD CONSTRAINT "JobFilterEvent_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "JobFilterProfile"
ADD CONSTRAINT "JobFilterProfile_version" CHECK ("version" >= 1),
ADD CONSTRAINT "JobFilterProfile_hash" CHECK ("configurationHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "JobFilterProfile_configuration" CHECK (
  jsonb_typeof("configuration") = 'object'
  AND "configuration"->>'schemaVersion' = '1'
  AND jsonb_typeof("configuration"->'rules') = 'object'
  AND octet_length("configuration"::text) <= 32768
);

ALTER TABLE "JobFilterEvaluation"
ADD CONSTRAINT "JobFilterEvaluation_versions" CHECK (
  "ruleSetVersion" >= 1
  AND "filterProfileVersion" >= 1
  AND "sourceJobVersion" >= 1
),
ADD CONSTRAINT "JobFilterEvaluation_hashes" CHECK (
  "configurationHash" ~ '^[0-9a-f]{64}$'
  AND "explanationHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "JobFilterEvaluation_explanation" CHECK (
  jsonb_typeof("explanation") = 'object'
  AND "explanation"->>'schemaVersion' = '1'
  AND "explanation"->>'ruleSetVersion' = "ruleSetVersion"::text
  AND "explanation"->>'profileVersion' = "filterProfileVersion"::text
  AND "explanation"->>'jobVersion' = "sourceJobVersion"::text
  AND "explanation"->>'overallOutcome' = "outcome"::text
  AND octet_length("explanation"::text) <= 32768
);

ALTER TABLE "JobFilterEvent"
ADD CONSTRAINT "JobFilterEvent_actor" CHECK (
  "actorUserId" IS NULL OR "actorUserId" = "userId"
),
ADD CONSTRAINT "JobFilterEvent_versions" CHECK (
  "filterProfileVersion" >= 1
  AND ("sourceJobVersion" IS NULL OR "sourceJobVersion" >= 1)
),
ADD CONSTRAINT "JobFilterEvent_metadata" CHECK (
  jsonb_typeof("safeMetadata") = 'object'
  AND "safeMetadata"->>'schemaVersion' = '1'
  AND octet_length("safeMetadata"::text) <= 32768
),
ADD CONSTRAINT "JobFilterEvent_shape" CHECK (
  (
    "eventType" IN ('PROFILE_CREATED', 'PROFILE_UPDATED')
    AND "jobId" IS NULL
    AND "sourceJobVersion" IS NULL
    AND "previousOutcome" IS NULL
    AND "newOutcome" IS NULL
    AND "actorUserId" = "userId"
  ) OR (
    "eventType" IN ('JOB_EVALUATED', 'JOB_REEVALUATED')
    AND "jobId" IS NOT NULL
    AND "sourceJobVersion" >= 1
    AND "newOutcome" IS NOT NULL
  )
);
