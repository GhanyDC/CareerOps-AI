-- CreateEnum
CREATE TYPE "JobScoringEventType" AS ENUM ('PROFILE_CREATED', 'PROFILE_UPDATED', 'JOB_SCORED', 'JOB_RESCORED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'JOB_SCORING_PROFILE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_SCORING_PROFILE_UPDATED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'JOB_SCORING_PROFILE';

-- CreateTable
CREATE TABLE "JobScoringProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobScoringProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPreliminaryScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "coverage" INTEGER NOT NULL,
    "ruleSetVersion" INTEGER NOT NULL,
    "scoringProfileVersion" INTEGER NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "sourceJobVersion" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "explanationHash" CHAR(64) NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPreliminaryScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobScoringEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT,
    "eventType" "JobScoringEventType" NOT NULL,
    "actorUserId" TEXT,
    "previousScore" INTEGER,
    "newScore" INTEGER,
    "previousCoverage" INTEGER,
    "newCoverage" INTEGER,
    "scoringProfileVersion" INTEGER NOT NULL,
    "sourceJobVersion" INTEGER,
    "safeMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobScoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobScoringProfile_userId_key" ON "JobScoringProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobScoringProfile_id_userId_key" ON "JobScoringProfile"("id", "userId");

-- CreateIndex
CREATE INDEX "JobPreliminaryScore_userId_score_coverage_updatedAt_id_idx" ON "JobPreliminaryScore"("userId", "score", "coverage", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "JobPreliminaryScore_userId_scoringProfileVersion_score_idx" ON "JobPreliminaryScore"("userId", "scoringProfileVersion", "score");

-- CreateIndex
CREATE UNIQUE INDEX "JobPreliminaryScore_id_userId_key" ON "JobPreliminaryScore"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPreliminaryScore_jobId_userId_key" ON "JobPreliminaryScore"("jobId", "userId");

-- CreateIndex
CREATE INDEX "JobScoringEvent_userId_profileId_createdAt_idx" ON "JobScoringEvent"("userId", "profileId", "createdAt");

-- CreateIndex
CREATE INDEX "JobScoringEvent_userId_jobId_createdAt_idx" ON "JobScoringEvent"("userId", "jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobScoringProfile" ADD CONSTRAINT "JobScoringProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPreliminaryScore" ADD CONSTRAINT "JobPreliminaryScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPreliminaryScore" ADD CONSTRAINT "JobPreliminaryScore_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "JobScoringProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPreliminaryScore" ADD CONSTRAINT "JobPreliminaryScore_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScoringEvent" ADD CONSTRAINT "JobScoringEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScoringEvent" ADD CONSTRAINT "JobScoringEvent_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "JobScoringProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScoringEvent" ADD CONSTRAINT "JobScoringEvent_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "JobScoringProfile"
ADD CONSTRAINT "JobScoringProfile_version" CHECK ("version" >= 1),
ADD CONSTRAINT "JobScoringProfile_hash" CHECK ("configurationHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "JobScoringProfile_configuration" CHECK (
  jsonb_typeof("configuration") = 'object'
  AND "configuration"->>'schemaVersion' = '1'
  AND jsonb_typeof("configuration"->'components') = 'object'
  AND octet_length("configuration"::text) <= 32768
);

ALTER TABLE "JobPreliminaryScore"
ADD CONSTRAINT "JobPreliminaryScore_values" CHECK (
  "score" BETWEEN 0 AND 100
  AND "coverage" BETWEEN 0 AND 100
),
ADD CONSTRAINT "JobPreliminaryScore_versions" CHECK (
  "ruleSetVersion" >= 1
  AND "scoringProfileVersion" >= 1
  AND "sourceJobVersion" >= 1
),
ADD CONSTRAINT "JobPreliminaryScore_hashes" CHECK (
  "configurationHash" ~ '^[0-9a-f]{64}$'
  AND "explanationHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "JobPreliminaryScore_explanation" CHECK (
  jsonb_typeof("explanation") = 'object'
  AND "explanation"->>'schemaVersion' = '1'
  AND "explanation"->>'ruleSetVersion' = "ruleSetVersion"::text
  AND "explanation"->>'profileVersion' = "scoringProfileVersion"::text
  AND "explanation"->>'jobVersion' = "sourceJobVersion"::text
  AND "explanation"->>'finalScore' = "score"::text
  AND "explanation"->>'coverage' = "coverage"::text
  AND octet_length("explanation"::text) <= 32768
);

ALTER TABLE "JobScoringEvent"
ADD CONSTRAINT "JobScoringEvent_actor" CHECK (
  "actorUserId" IS NULL OR "actorUserId" = "userId"
),
ADD CONSTRAINT "JobScoringEvent_versions" CHECK (
  "scoringProfileVersion" >= 1
  AND ("sourceJobVersion" IS NULL OR "sourceJobVersion" >= 1)
),
ADD CONSTRAINT "JobScoringEvent_values" CHECK (
  ("previousScore" IS NULL OR "previousScore" BETWEEN 0 AND 100)
  AND ("newScore" IS NULL OR "newScore" BETWEEN 0 AND 100)
  AND ("previousCoverage" IS NULL OR "previousCoverage" BETWEEN 0 AND 100)
  AND ("newCoverage" IS NULL OR "newCoverage" BETWEEN 0 AND 100)
),
ADD CONSTRAINT "JobScoringEvent_metadata" CHECK (
  jsonb_typeof("safeMetadata") = 'object'
  AND "safeMetadata"->>'schemaVersion' = '1'
  AND octet_length("safeMetadata"::text) <= 32768
),
ADD CONSTRAINT "JobScoringEvent_shape" CHECK (
  (
    "eventType" IN ('PROFILE_CREATED', 'PROFILE_UPDATED')
    AND "jobId" IS NULL
    AND "sourceJobVersion" IS NULL
    AND "previousScore" IS NULL
    AND "newScore" IS NULL
    AND "previousCoverage" IS NULL
    AND "newCoverage" IS NULL
    AND "actorUserId" = "userId"
  ) OR (
    "eventType" = 'JOB_SCORED'
    AND "jobId" IS NOT NULL
    AND "sourceJobVersion" >= 1
    AND "previousScore" IS NULL
    AND "newScore" BETWEEN 0 AND 100
    AND "previousCoverage" IS NULL
    AND "newCoverage" BETWEEN 0 AND 100
  ) OR (
    "eventType" = 'JOB_RESCORED'
    AND "jobId" IS NOT NULL
    AND "sourceJobVersion" >= 1
    AND "previousScore" BETWEEN 0 AND 100
    AND "newScore" BETWEEN 0 AND 100
    AND "previousCoverage" BETWEEN 0 AND 100
    AND "newCoverage" BETWEEN 0 AND 100
  )
);
