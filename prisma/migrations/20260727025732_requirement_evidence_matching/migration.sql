-- CreateEnum
CREATE TYPE "JobRequirementCategory" AS ENUM ('SKILL', 'EXPERIENCE', 'EDUCATION', 'CERTIFICATION', 'RESPONSIBILITY', 'DOMAIN_KNOWLEDGE', 'OTHER');

-- CreateEnum
CREATE TYPE "JobRequirementImportance" AS ENUM ('REQUIRED', 'PREFERRED', 'OTHER');

-- CreateEnum
CREATE TYPE "JobRequirementSource" AS ENUM ('MANUAL', 'JOB_RESPONSIBILITY', 'JOB_QUALIFICATION', 'JOB_PREFERRED_QUALIFICATION', 'JOB_SKILL');

-- CreateEnum
CREATE TYPE "JobRequirementState" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobRequirementSupportLevel" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "JobRequirementMatchStatus" AS ENUM ('NOT_REVIEWED', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "JobRequirementMatchEventType" AS ENUM ('REQUIREMENT_CREATED', 'REQUIREMENT_UPDATED', 'REQUIREMENT_REORDERED', 'REQUIREMENT_ARCHIVED', 'REQUIREMENT_RESTORED', 'EVIDENCE_LINKED', 'EVIDENCE_LINK_UPDATED', 'EVIDENCE_UNLINKED', 'EVIDENCE_VERSION_CHANGED', 'REVIEW_COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_REORDERED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_EVIDENCE_LINKED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_EVIDENCE_LINK_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_EVIDENCE_UNLINKED';
ALTER TYPE "AuditAction" ADD VALUE 'JOB_REQUIREMENT_REVIEW_COMPLETED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'JOB_REQUIREMENT';

-- AlterTable
ALTER TABLE "EvidenceItem" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "JobRequirement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "statement" VARCHAR(1000) NOT NULL,
    "category" "JobRequirementCategory" NOT NULL,
    "importance" "JobRequirementImportance" NOT NULL,
    "position" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "matchSetVersion" INTEGER NOT NULL DEFAULT 1,
    "source" "JobRequirementSource" NOT NULL,
    "state" "JobRequirementState" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirementEvidenceLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "evidenceItemId" TEXT NOT NULL,
    "supportLevel" "JobRequirementSupportLevel" NOT NULL,
    "rationale" VARCHAR(500),
    "position" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedEvidenceVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequirementEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirementReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "status" "JobRequirementMatchStatus" NOT NULL,
    "reviewedRequirementVersion" INTEGER NOT NULL,
    "reviewedMatchSetVersion" INTEGER NOT NULL,
    "matchSchemaVersion" INTEGER NOT NULL,
    "linkSetHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequirementReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirementMatchEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "eventType" "JobRequirementMatchEventType" NOT NULL,
    "actorUserId" TEXT,
    "requirementVersion" INTEGER NOT NULL,
    "matchSetVersion" INTEGER NOT NULL,
    "evidenceItemId" TEXT,
    "evidenceVersion" INTEGER,
    "supportLevel" "JobRequirementSupportLevel",
    "reviewStatus" "JobRequirementMatchStatus",
    "safeMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRequirementMatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRequirement_userId_jobId_state_position_id_idx" ON "JobRequirement"("userId", "jobId", "state", "position", "id");

-- CreateIndex
CREATE INDEX "JobRequirement_userId_importance_state_updatedAt_id_idx" ON "JobRequirement"("userId", "importance", "state", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirement_id_userId_key" ON "JobRequirement"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirement_id_jobId_userId_key" ON "JobRequirement"("id", "jobId", "userId");

-- CreateIndex
CREATE INDEX "JobRequirementEvidenceLink_userId_requirementId_position_id_idx" ON "JobRequirementEvidenceLink"("userId", "requirementId", "position", "id");

-- CreateIndex
CREATE INDEX "JobRequirementEvidenceLink_userId_evidenceItemId_requiremen_idx" ON "JobRequirementEvidenceLink"("userId", "evidenceItemId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementEvidenceLink_id_userId_key" ON "JobRequirementEvidenceLink"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementEvidenceLink_requirementId_evidenceItemId_key" ON "JobRequirementEvidenceLink"("requirementId", "evidenceItemId");

-- CreateIndex
CREATE INDEX "JobRequirementReview_userId_status_reviewedAt_id_idx" ON "JobRequirementReview"("userId", "status", "reviewedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementReview_id_userId_key" ON "JobRequirementReview"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementReview_requirementId_userId_key" ON "JobRequirementReview"("requirementId", "userId");

-- CreateIndex
CREATE INDEX "JobRequirementMatchEvent_userId_jobId_createdAt_idx" ON "JobRequirementMatchEvent"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRequirementMatchEvent_userId_requirementId_createdAt_idx" ON "JobRequirementMatchEvent"("userId", "requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRequirementMatchEvent_userId_eventType_createdAt_idx" ON "JobRequirementMatchEvent"("userId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "JobRequirement" ADD CONSTRAINT "JobRequirement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirement" ADD CONSTRAINT "JobRequirement_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementEvidenceLink" ADD CONSTRAINT "JobRequirementEvidenceLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementEvidenceLink" ADD CONSTRAINT "JobRequirementEvidenceLink_requirementId_userId_fkey" FOREIGN KEY ("requirementId", "userId") REFERENCES "JobRequirement"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementEvidenceLink" ADD CONSTRAINT "JobRequirementEvidenceLink_evidenceItemId_userId_fkey" FOREIGN KEY ("evidenceItemId", "userId") REFERENCES "EvidenceItem"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementReview" ADD CONSTRAINT "JobRequirementReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementReview" ADD CONSTRAINT "JobRequirementReview_requirementId_userId_fkey" FOREIGN KEY ("requirementId", "userId") REFERENCES "JobRequirement"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatchEvent" ADD CONSTRAINT "JobRequirementMatchEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatchEvent" ADD CONSTRAINT "JobRequirementMatchEvent_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "Job"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatchEvent" ADD CONSTRAINT "JobRequirementMatchEvent_requirementId_jobId_userId_fkey" FOREIGN KEY ("requirementId", "jobId", "userId") REFERENCES "JobRequirement"("id", "jobId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth invariants that Prisma cannot express in schema.prisma.
ALTER TABLE "EvidenceItem"
ADD CONSTRAINT "EvidenceItem_version_positive" CHECK ("version" >= 1);

ALTER TABLE "JobRequirement"
ADD CONSTRAINT "JobRequirement_statement" CHECK (
  length(btrim("statement")) BETWEEN 1 AND 1000
),
ADD CONSTRAINT "JobRequirement_position" CHECK ("position" >= 0),
ADD CONSTRAINT "JobRequirement_versions" CHECK (
  "version" >= 1 AND "matchSetVersion" >= 1
),
ADD CONSTRAINT "JobRequirement_archive_shape" CHECK (
  ("state" = 'ACTIVE' AND "archivedAt" IS NULL)
  OR ("state" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
);

ALTER TABLE "JobRequirementEvidenceLink"
ADD CONSTRAINT "JobRequirementEvidenceLink_position" CHECK ("position" >= 0),
ADD CONSTRAINT "JobRequirementEvidenceLink_versions" CHECK (
  "version" >= 1
  AND ("reviewedEvidenceVersion" IS NULL OR "reviewedEvidenceVersion" >= 1)
),
ADD CONSTRAINT "JobRequirementEvidenceLink_rationale" CHECK (
  "rationale" IS NULL OR length(btrim("rationale")) BETWEEN 1 AND 500
);

ALTER TABLE "JobRequirementReview"
ADD CONSTRAINT "JobRequirementReview_status" CHECK ("status" <> 'NOT_REVIEWED'),
ADD CONSTRAINT "JobRequirementReview_versions" CHECK (
  "reviewedRequirementVersion" >= 1
  AND "reviewedMatchSetVersion" >= 1
  AND "matchSchemaVersion" = 1
  AND "version" >= 1
),
ADD CONSTRAINT "JobRequirementReview_hash" CHECK (
  "linkSetHash" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "JobRequirementMatchEvent"
ADD CONSTRAINT "JobRequirementMatchEvent_actor" CHECK (
  "actorUserId" IS NULL OR "actorUserId" = "userId"
),
ADD CONSTRAINT "JobRequirementMatchEvent_versions" CHECK (
  "requirementVersion" >= 1
  AND "matchSetVersion" >= 1
  AND ("evidenceVersion" IS NULL OR "evidenceVersion" >= 1)
),
ADD CONSTRAINT "JobRequirementMatchEvent_metadata" CHECK (
  jsonb_typeof("safeMetadata") = 'object'
  AND "safeMetadata"->>'schemaVersion' = '1'
  AND octet_length("safeMetadata"::text) <= 32768
),
ADD CONSTRAINT "JobRequirementMatchEvent_review_shape" CHECK (
  (
    "eventType" = 'REVIEW_COMPLETED'
    AND "reviewStatus" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED')
  )
  OR (
    "eventType" <> 'REVIEW_COMPLETED'
    AND "reviewStatus" IS NULL
  )
);

-- Every Candidate Evidence mutation advances exactly one optimistic version.
-- Existing application updates that explicitly increment the version remain valid;
-- direct updates that omit it receive the same safe increment.
CREATE FUNCTION "careerops_advance_evidence_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."version" = OLD."version" THEN
    NEW."version" := OLD."version" + 1;
  ELSIF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'EvidenceItem version must advance by exactly one';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceItem_advance_version"
BEFORE UPDATE ON "EvidenceItem"
FOR EACH ROW
EXECUTE FUNCTION "careerops_advance_evidence_version"();

-- Link-set versions advance for semantic link changes and cascaded link removal.
-- Review-only evidence-version snapshots and presentation ordering do not stale a review.
CREATE FUNCTION "careerops_advance_requirement_match_set"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_requirement_id TEXT;
  target_user_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."supportLevel" IS NOT DISTINCT FROM OLD."supportLevel"
    AND NEW."rationale" IS NOT DISTINCT FROM OLD."rationale"
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_requirement_id := OLD."requirementId";
    target_user_id := OLD."userId";
  ELSE
    target_requirement_id := NEW."requirementId";
    target_user_id := NEW."userId";
  END IF;

  UPDATE "JobRequirement"
  SET "matchSetVersion" = "matchSetVersion" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = target_requirement_id
    AND "userId" = target_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "JobRequirementEvidenceLink_advance_match_set"
AFTER INSERT OR DELETE OR UPDATE OF "supportLevel", "rationale"
ON "JobRequirementEvidenceLink"
FOR EACH ROW
EXECUTE FUNCTION "careerops_advance_requirement_match_set"();

-- Reviews store a server-derived snapshot only. PostgreSQL independently rejects
-- arbitrary status values or completion against outdated requirement, link-set,
-- or evidence versions.
CREATE FUNCTION "careerops_validate_requirement_review"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_requirement_version INTEGER;
  current_match_set_version INTEGER;
  full_link_count INTEGER;
  partial_link_count INTEGER;
  stale_evidence_count INTEGER;
BEGIN
  SELECT "version", "matchSetVersion"
  INTO current_requirement_version, current_match_set_version
  FROM "JobRequirement"
  WHERE "id" = NEW."requirementId"
    AND "userId" = NEW."userId";

  IF current_requirement_version IS NULL
    OR NEW."reviewedRequirementVersion" <> current_requirement_version
    OR NEW."reviewedMatchSetVersion" <> current_match_set_version
    OR NEW."matchSchemaVersion" <> 1
  THEN
    RAISE EXCEPTION 'Requirement review coordinates are stale';
  END IF;

  SELECT
    count(*) FILTER (WHERE link."supportLevel" = 'FULL'),
    count(*) FILTER (WHERE link."supportLevel" = 'PARTIAL'),
    count(*) FILTER (
      WHERE link."reviewedEvidenceVersion" IS NULL
        OR link."reviewedEvidenceVersion" <> evidence."version"
    )
  INTO full_link_count, partial_link_count, stale_evidence_count
  FROM "JobRequirementEvidenceLink" link
  INNER JOIN "EvidenceItem" evidence
    ON evidence."id" = link."evidenceItemId"
    AND evidence."userId" = link."userId"
  WHERE link."requirementId" = NEW."requirementId"
    AND link."userId" = NEW."userId";

  IF stale_evidence_count > 0 THEN
    RAISE EXCEPTION 'Requirement review uses stale evidence coordinates';
  END IF;

  IF (NEW."status" = 'SUPPORTED' AND full_link_count = 0)
    OR (
      NEW."status" = 'PARTIALLY_SUPPORTED'
      AND (full_link_count > 0 OR partial_link_count = 0)
    )
    OR (
      NEW."status" = 'UNSUPPORTED'
      AND (full_link_count > 0 OR partial_link_count > 0)
    )
    OR NEW."status" = 'NOT_REVIEWED'
  THEN
    RAISE EXCEPTION 'Requirement review status is inconsistent with evidence links';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "JobRequirementReview_validate_snapshot"
BEFORE INSERT OR UPDATE ON "JobRequirementReview"
FOR EACH ROW
EXECUTE FUNCTION "careerops_validate_requirement_review"();
