-- CreateEnum
CREATE TYPE "JobDuplicateDecision" AS ENUM ('SAME_OPPORTUNITY', 'DIFFERENT_OPPORTUNITIES', 'DEFERRED');

-- CreateEnum
CREATE TYPE "JobDuplicateEvidenceTier" AS ENUM ('STRONG', 'MODERATE');

-- CreateEnum
CREATE TYPE "JobDuplicateEventType" AS ENUM ('CANDIDATE_CREATED', 'CANDIDATE_REEVALUATED', 'DUPLICATE_DECISION_RECORDED', 'DUPLICATE_DECISION_MARKED_STALE', 'DUPLICATE_GROUP_CHANGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'JOB_DUPLICATE_DECISION_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_DUPLICATE_GROUP_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'JOB_DUPLICATE_CANDIDATE';
ALTER TYPE "AuditEntityType" ADD VALUE 'JOB_DUPLICATE_GROUP';

-- CreateTable
CREATE TABLE "JobCanonicalRepresentation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "urlCanonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceJobVersion" INTEGER NOT NULL,
    "canonicalTitle" VARCHAR(200) NOT NULL,
    "canonicalCompanyName" VARCHAR(200),
    "employmentType" "JobEmploymentType",
    "workplaceArrangement" "JobWorkplaceArrangement",
    "experienceLevel" "JobExperienceLevel",
    "countryCode" VARCHAR(2),
    "canonicalRegion" VARCHAR(160),
    "canonicalCity" VARCHAR(160),
    "canonicalLocationLabel" VARCHAR(300),
    "salaryMin" DECIMAL(14,2),
    "salaryMax" DECIMAL(14,2),
    "salaryCurrency" VARCHAR(3),
    "salaryPeriod" "JobSalaryPeriod",
    "postedAt" DATE,
    "closesAt" DATE,
    "canonicalSourceUrl" VARCHAR(2048),
    "canonicalSourceUrlHash" CHAR(64),
    "companyTitleHash" CHAR(64),
    "companyTitleLocationHash" CHAR(64),
    "descriptionFingerprint" CHAR(64),
    "responsibilitiesFingerprint" CHAR(64),
    "qualificationsFingerprint" CHAR(64),
    "skillsFingerprint" CHAR(64),
    "structuredContentFingerprint" CHAR(64),
    "comparisonHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCanonicalRepresentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobAId" TEXT NOT NULL,
    "jobBId" TEXT NOT NULL,
    "activeCandidate" BOOLEAN NOT NULL DEFAULT true,
    "evidenceTier" "JobDuplicateEvidenceTier",
    "ruleSetVersion" INTEGER NOT NULL DEFAULT 1,
    "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "jobARepresentationHash" CHAR(64) NOT NULL,
    "jobBRepresentationHash" CHAR(64) NOT NULL,
    "evidence" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,
    "decision" "JobDuplicateDecision",
    "decisionActorUserId" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionRuleSetVersion" INTEGER,
    "decisionCanonicalizationVersion" INTEGER,
    "decisionJobAVersion" INTEGER,
    "decisionJobBVersion" INTEGER,
    "decisionNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "decisionStaleAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDuplicateGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryJobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDuplicateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDuplicateGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDuplicateGroupMember_pkey" PRIMARY KEY ("groupId","jobId")
);

-- CreateTable
CREATE TABLE "JobDuplicateEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT,
    "eventType" "JobDuplicateEventType" NOT NULL,
    "actorUserId" TEXT,
    "idempotencyKey" UUID,
    "requestHash" CHAR(64),
    "previousDecision" "JobDuplicateDecision",
    "newDecision" "JobDuplicateDecision",
    "safeMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDuplicateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobCanonicalRepresentation_userId_canonicalSourceUrlHash_idx" ON "JobCanonicalRepresentation"("userId", "canonicalSourceUrlHash");

-- CreateIndex
CREATE INDEX "JobCanonicalRepresentation_userId_companyTitleHash_idx" ON "JobCanonicalRepresentation"("userId", "companyTitleHash");

-- CreateIndex
CREATE INDEX "JobCanonicalRepresentation_userId_companyTitleLocationHash_idx" ON "JobCanonicalRepresentation"("userId", "companyTitleLocationHash");

-- CreateIndex
CREATE INDEX "JobCanonicalRepresentation_userId_sourceJobVersion_idx" ON "JobCanonicalRepresentation"("userId", "sourceJobVersion");

-- CreateIndex
CREATE UNIQUE INDEX "JobCanonicalRepresentation_jobId_userId_key" ON "JobCanonicalRepresentation"("jobId", "userId");

-- CreateIndex
CREATE INDEX "JobDuplicateCandidate_userId_activeCandidate_decisionNeedsR_idx" ON "JobDuplicateCandidate"("userId", "activeCandidate", "decisionNeedsReview", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "JobDuplicateCandidate_userId_decision_updatedAt_id_idx" ON "JobDuplicateCandidate"("userId", "decision", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "JobDuplicateCandidate_userId_jobAId_idx" ON "JobDuplicateCandidate"("userId", "jobAId");

-- CreateIndex
CREATE INDEX "JobDuplicateCandidate_userId_jobBId_idx" ON "JobDuplicateCandidate"("userId", "jobBId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateCandidate_id_userId_key" ON "JobDuplicateCandidate"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateCandidate_userId_jobAId_jobBId_key" ON "JobDuplicateCandidate"("userId", "jobAId", "jobBId");

-- CreateIndex
CREATE INDEX "JobDuplicateGroup_userId_updatedAt_id_idx" ON "JobDuplicateGroup"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "JobDuplicateGroup_userId_primaryJobId_idx" ON "JobDuplicateGroup"("userId", "primaryJobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateGroup_id_userId_key" ON "JobDuplicateGroup"("id", "userId");

-- CreateIndex
CREATE INDEX "JobDuplicateGroupMember_userId_groupId_idx" ON "JobDuplicateGroupMember"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateGroupMember_groupId_jobId_userId_key" ON "JobDuplicateGroupMember"("groupId", "jobId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateGroupMember_jobId_userId_key" ON "JobDuplicateGroupMember"("jobId", "userId");

-- CreateIndex
CREATE INDEX "JobDuplicateEvent_userId_candidateId_createdAt_idx" ON "JobDuplicateEvent"("userId", "candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "JobDuplicateEvent_userId_eventType_createdAt_idx" ON "JobDuplicateEvent"("userId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobDuplicateEvent_userId_idempotencyKey_key" ON "JobDuplicateEvent"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "JobCanonicalRepresentation" ADD CONSTRAINT "JobCanonicalRepresentation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCanonicalRepresentation" ADD CONSTRAINT "JobCanonicalRepresentation_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateCandidate" ADD CONSTRAINT "JobDuplicateCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateCandidate" ADD CONSTRAINT "JobDuplicateCandidate_jobAId_userId_fkey" FOREIGN KEY ("jobAId", "userId") REFERENCES "Job"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateCandidate" ADD CONSTRAINT "JobDuplicateCandidate_jobBId_userId_fkey" FOREIGN KEY ("jobBId", "userId") REFERENCES "Job"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateGroup" ADD CONSTRAINT "JobDuplicateGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateGroup" ADD CONSTRAINT "JobDuplicateGroup_primaryJobId_userId_fkey" FOREIGN KEY ("primaryJobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateGroupMember" ADD CONSTRAINT "JobDuplicateGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateGroupMember" ADD CONSTRAINT "JobDuplicateGroupMember_groupId_userId_fkey" FOREIGN KEY ("groupId", "userId") REFERENCES "JobDuplicateGroup"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateGroupMember" ADD CONSTRAINT "JobDuplicateGroupMember_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateEvent" ADD CONSTRAINT "JobDuplicateEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDuplicateEvent" ADD CONSTRAINT "JobDuplicateEvent_candidateId_userId_fkey" FOREIGN KEY ("candidateId", "userId") REFERENCES "JobDuplicateCandidate"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense-in-depth invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "JobCanonicalRepresentation"
ADD CONSTRAINT "JobCanonicalRepresentation_versions" CHECK (
  "canonicalizationVersion" = 1
  AND "urlCanonicalizationVersion" = 1
  AND "sourceJobVersion" >= 1
),
ADD CONSTRAINT "JobCanonicalRepresentation_title" CHECK (
  length(btrim("canonicalTitle")) > 0
),
ADD CONSTRAINT "JobCanonicalRepresentation_optional_text" CHECK (
  ("canonicalCompanyName" IS NULL OR length(btrim("canonicalCompanyName")) > 0)
  AND ("canonicalRegion" IS NULL OR length(btrim("canonicalRegion")) > 0)
  AND ("canonicalCity" IS NULL OR length(btrim("canonicalCity")) > 0)
  AND ("canonicalLocationLabel" IS NULL OR length(btrim("canonicalLocationLabel")) > 0)
),
ADD CONSTRAINT "JobCanonicalRepresentation_country" CHECK (
  "countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'
),
ADD CONSTRAINT "JobCanonicalRepresentation_salary" CHECK (
  ("salaryMin" IS NULL OR "salaryMin" >= 0)
  AND ("salaryMax" IS NULL OR "salaryMax" >= 0)
  AND ("salaryMin" IS NULL OR "salaryMax" IS NULL OR "salaryMax" >= "salaryMin")
  AND (
    (
      "salaryMin" IS NULL AND "salaryMax" IS NULL
      AND "salaryCurrency" IS NULL AND "salaryPeriod" IS NULL
    ) OR (
      ("salaryMin" IS NOT NULL OR "salaryMax" IS NOT NULL)
      AND "salaryCurrency" ~ '^[A-Z]{3}$'
      AND "salaryPeriod" IS NOT NULL
    )
  )
),
ADD CONSTRAINT "JobCanonicalRepresentation_dates" CHECK (
  "postedAt" IS NULL OR "closesAt" IS NULL OR "closesAt" >= "postedAt"
),
ADD CONSTRAINT "JobCanonicalRepresentation_url" CHECK (
  "canonicalSourceUrl" IS NULL
  OR (
    "canonicalSourceUrl" = btrim("canonicalSourceUrl")
    AND "canonicalSourceUrl" ~* '^https?://'
  )
),
ADD CONSTRAINT "JobCanonicalRepresentation_hashes" CHECK (
  "comparisonHash" ~ '^[0-9a-f]{64}$'
  AND ("canonicalSourceUrlHash" IS NULL OR "canonicalSourceUrlHash" ~ '^[0-9a-f]{64}$')
  AND ("companyTitleHash" IS NULL OR "companyTitleHash" ~ '^[0-9a-f]{64}$')
  AND ("companyTitleLocationHash" IS NULL OR "companyTitleLocationHash" ~ '^[0-9a-f]{64}$')
  AND ("descriptionFingerprint" IS NULL OR "descriptionFingerprint" ~ '^[0-9a-f]{64}$')
  AND ("responsibilitiesFingerprint" IS NULL OR "responsibilitiesFingerprint" ~ '^[0-9a-f]{64}$')
  AND ("qualificationsFingerprint" IS NULL OR "qualificationsFingerprint" ~ '^[0-9a-f]{64}$')
  AND ("skillsFingerprint" IS NULL OR "skillsFingerprint" ~ '^[0-9a-f]{64}$')
  AND ("structuredContentFingerprint" IS NULL OR "structuredContentFingerprint" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "JobDuplicateCandidate"
ALTER COLUMN "evidenceTier" SET NOT NULL,
ADD CONSTRAINT "JobDuplicateCandidate_pair_order" CHECK ("jobAId" < "jobBId"),
ADD CONSTRAINT "JobDuplicateCandidate_versions" CHECK (
  "ruleSetVersion" = 1
  AND "canonicalizationVersion" = 1
  AND "version" >= 1
),
ADD CONSTRAINT "JobDuplicateCandidate_hashes" CHECK (
  "jobARepresentationHash" ~ '^[0-9a-f]{64}$'
  AND "jobBRepresentationHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "JobDuplicateCandidate_evidence" CHECK (
  jsonb_typeof("evidence") = 'object'
  AND "evidence"->>'schemaVersion' = '1'
  AND octet_length("evidence"::text) <= 32768
  AND jsonb_typeof("conflicts") = 'object'
  AND "conflicts"->>'schemaVersion' = '1'
  AND octet_length("conflicts"::text) <= 32768
),
ADD CONSTRAINT "JobDuplicateCandidate_decision_actor" CHECK (
  "decisionActorUserId" IS NULL OR "decisionActorUserId" = "userId"
),
ADD CONSTRAINT "JobDuplicateCandidate_decision_shape" CHECK (
  (
    "decision" IS NULL
    AND "decisionActorUserId" IS NULL
    AND "decisionAt" IS NULL
    AND "decisionRuleSetVersion" IS NULL
    AND "decisionCanonicalizationVersion" IS NULL
    AND "decisionJobAVersion" IS NULL
    AND "decisionJobBVersion" IS NULL
    AND "decisionNeedsReview" = false
    AND "decisionStaleAt" IS NULL
  ) OR (
    "decision" IS NOT NULL
    AND "decisionActorUserId" IS NOT NULL
    AND "decisionAt" IS NOT NULL
    AND "decisionRuleSetVersion" >= 1
    AND "decisionCanonicalizationVersion" >= 1
    AND "decisionJobAVersion" >= 1
    AND "decisionJobBVersion" >= 1
    AND (
      ("decisionNeedsReview" = false AND "decisionStaleAt" IS NULL)
      OR ("decisionNeedsReview" = true AND "decisionStaleAt" IS NOT NULL)
    )
  )
);

ALTER TABLE "JobDuplicateGroup"
ADD CONSTRAINT "JobDuplicateGroup_version" CHECK ("version" >= 1);

ALTER TABLE "JobDuplicateGroup"
ADD CONSTRAINT "JobDuplicateGroup_id_primaryJobId_userId_fkey"
FOREIGN KEY ("id", "primaryJobId", "userId")
REFERENCES "JobDuplicateGroupMember"("groupId", "jobId", "userId")
ON DELETE NO ACTION ON UPDATE CASCADE
DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "JobDuplicateEvent"
ADD CONSTRAINT "JobDuplicateEvent_actor" CHECK (
  "actorUserId" IS NULL OR "actorUserId" = "userId"
),
ADD CONSTRAINT "JobDuplicateEvent_idempotency" CHECK (
  ("idempotencyKey" IS NULL AND "requestHash" IS NULL)
  OR (
    "idempotencyKey" IS NOT NULL
    AND "requestHash" ~ '^[0-9a-f]{64}$'
    AND "actorUserId" = "userId"
  )
),
ADD CONSTRAINT "JobDuplicateEvent_metadata" CHECK (
  jsonb_typeof("safeMetadata") = 'object'
  AND "safeMetadata"->>'schemaVersion' = '1'
  AND octet_length("safeMetadata"::text) <= 32768
),
ADD CONSTRAINT "JobDuplicateEvent_candidate_shape" CHECK (
  "candidateId" IS NOT NULL OR "eventType" = 'DUPLICATE_GROUP_CHANGED'
);

-- Model the composite primary-membership relation in Prisma without weakening
-- the database invariant added by the preceding constraints migration.
CREATE UNIQUE INDEX "JobDuplicateGroup_id_primaryJobId_userId_key"
ON "JobDuplicateGroup"("id", "primaryJobId", "userId");
