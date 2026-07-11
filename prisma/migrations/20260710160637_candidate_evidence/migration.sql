-- CreateEnum
CREATE TYPE "ExperienceType" AS ENUM ('EMPLOYMENT', 'INTERNSHIP', 'FREELANCE', 'VOLUNTEER', 'STUDENT_LEADERSHIP', 'ACADEMIC', 'INDEPENDENT_WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'REQUIRES_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('EXPERIENCE', 'PROJECT');

-- CreateEnum
CREATE TYPE "EvidenceStrength" AS ENUM ('DIRECT', 'TRANSFERABLE', 'SUPPORTING', 'WEAK');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'REQUIRES_VERIFICATION', 'APPROVED', 'PROHIBITED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('EVIDENCE', 'CLAIM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('EVIDENCE_VERIFIED', 'EVIDENCE_REJECTED', 'EVIDENCE_REQUIRES_VERIFICATION', 'EVIDENCE_VERIFICATION_REVOKED', 'CLAIM_APPROVED', 'CLAIM_REQUIRES_VERIFICATION', 'CLAIM_PROHIBITED', 'CLAIM_ARCHIVED', 'CLAIM_APPROVAL_REVOKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "developmentKey" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" VARCHAR(160),
    "professionalHeadline" VARCHAR(240),
    "careerSummary" TEXT,
    "preferredRoleFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedWorkArrangements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedEmploymentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedulePreferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nightShiftAcceptance" BOOLEAN,
    "relocationPreference" VARCHAR(160),
    "salaryCurrency" VARCHAR(3),
    "salaryMinimum" DECIMAL(12,2),
    "salaryNotes" TEXT,
    "careerGoals" TEXT,
    "dostReturnServiceNotes" TEXT,
    "applicationPreferences" TEXT,
    "hardExclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "organization" VARCHAR(200),
    "experienceType" "ExperienceType" NOT NULL,
    "location" VARCHAR(200),
    "workSetup" VARCHAR(80),
    "startDate" DATE,
    "endDate" DATE,
    "currentlyActive" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceNotes" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "shortDescription" VARCHAR(500),
    "problemAddressed" TEXT,
    "candidateRole" VARCHAR(200),
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "challenges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actionsTaken" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantifiedResults" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relevantRoleFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectUrl" VARCHAR(2048),
    "repositoryUrl" VARCHAR(2048),
    "startDate" DATE,
    "endDate" DATE,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceExperienceId" TEXT,
    "sourceProjectId" TEXT,
    "claim" VARCHAR(1000) NOT NULL,
    "supportingContext" TEXT,
    "skillsDemonstrated" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relevantRoleFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceStrength" "EvidenceStrength" NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "allowedForResume" BOOLEAN NOT NULL DEFAULT false,
    "allowedForCoverLetters" BOOLEAN NOT NULL DEFAULT false,
    "allowedForInterviews" BOOLEAN NOT NULL DEFAULT false,
    "allowedForRecruiterMessages" BOOLEAN NOT NULL DEFAULT false,
    "sourceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidenceItemId" TEXT,
    "claimText" VARCHAR(1000) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewerNotes" TEXT,
    "allowedForResume" BOOLEAN NOT NULL DEFAULT false,
    "allowedForCoverLetters" BOOLEAN NOT NULL DEFAULT false,
    "allowedForInterviews" BOOLEAN NOT NULL DEFAULT false,
    "allowedForRecruiterMessages" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "previousState" JSONB,
    "newState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Domain invariants that Prisma cannot currently express in the schema.
ALTER TABLE "User"
ADD CONSTRAINT "User_developmentKey_nonempty" CHECK (length(btrim("developmentKey")) > 0);

ALTER TABLE "CandidateProfile"
ADD CONSTRAINT "CandidateProfile_salaryMinimum_nonnegative" CHECK ("salaryMinimum" IS NULL OR "salaryMinimum" >= 0);

ALTER TABLE "Experience"
ADD CONSTRAINT "Experience_date_order" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate"),
ADD CONSTRAINT "Experience_active_without_end" CHECK (NOT "currentlyActive" OR "endDate" IS NULL);

ALTER TABLE "Project"
ADD CONSTRAINT "Project_date_order" CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE "EvidenceItem"
ADD CONSTRAINT "EvidenceItem_claim_nonempty" CHECK (length(btrim("claim")) > 0),
ADD CONSTRAINT "EvidenceItem_exact_source" CHECK (
    ("sourceType" = 'EXPERIENCE' AND "sourceExperienceId" IS NOT NULL AND "sourceProjectId" IS NULL)
    OR
    ("sourceType" = 'PROJECT' AND "sourceProjectId" IS NOT NULL AND "sourceExperienceId" IS NULL)
);

ALTER TABLE "Claim"
ADD CONSTRAINT "Claim_claimText_nonempty" CHECK (length(btrim("claimText")) > 0),
ADD CONSTRAINT "Claim_approved_timestamp_consistency" CHECK (
    ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL)
    OR
    ("status" <> 'APPROVED' AND "approvedAt" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "User_developmentKey_key" ON "User"("developmentKey");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_id_userId_key" ON "CandidateProfile"("id", "userId");

-- CreateIndex
CREATE INDEX "Experience_userId_experienceType_idx" ON "Experience"("userId", "experienceType");

-- CreateIndex
CREATE INDEX "Experience_userId_verificationStatus_idx" ON "Experience"("userId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Experience_candidateProfileId_idx" ON "Experience"("candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Experience_id_userId_key" ON "Experience"("id", "userId");

-- CreateIndex
CREATE INDEX "Project_userId_verificationStatus_idx" ON "Project"("userId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Project_candidateProfileId_idx" ON "Project"("candidateProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_userId_key" ON "Project"("id", "userId");

-- CreateIndex
CREATE INDEX "EvidenceItem_userId_verificationStatus_idx" ON "EvidenceItem"("userId", "verificationStatus");

-- CreateIndex
CREATE INDEX "EvidenceItem_userId_evidenceStrength_idx" ON "EvidenceItem"("userId", "evidenceStrength");

-- CreateIndex
CREATE INDEX "EvidenceItem_sourceExperienceId_idx" ON "EvidenceItem"("sourceExperienceId");

-- CreateIndex
CREATE INDEX "EvidenceItem_sourceProjectId_idx" ON "EvidenceItem"("sourceProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_id_userId_key" ON "EvidenceItem"("id", "userId");

-- CreateIndex
CREATE INDEX "Claim_userId_status_idx" ON "Claim"("userId", "status");

-- CreateIndex
CREATE INDEX "Claim_evidenceItemId_idx" ON "Claim"("evidenceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_id_userId_key" ON "Claim"("id", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_entityType_entityId_createdAt_idx" ON "AuditLog"("userId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_candidateProfileId_userId_fkey" FOREIGN KEY ("candidateProfileId", "userId") REFERENCES "CandidateProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_candidateProfileId_userId_fkey" FOREIGN KEY ("candidateProfileId", "userId") REFERENCES "CandidateProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_sourceExperienceId_userId_fkey" FOREIGN KEY ("sourceExperienceId", "userId") REFERENCES "Experience"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_sourceProjectId_userId_fkey" FOREIGN KEY ("sourceProjectId", "userId") REFERENCES "Project"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_evidenceItemId_userId_fkey" FOREIGN KEY ("evidenceItemId", "userId") REFERENCES "EvidenceItem"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
