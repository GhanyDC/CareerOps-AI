-- CreateEnum
CREATE TYPE "DiscoveryImportMethod" AS ENUM ('MANUAL_ENTRY', 'PASTED_TEXT', 'STRUCTURED_JSON');

-- CreateEnum
CREATE TYPE "JobDiscoveryStatus" AS ENUM ('INBOX', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DiscoveryProcessingEventType" AS ENUM ('BATCH_CONFIRMED', 'DISCOVERY_IMPORTED', 'DISCOVERY_REJECTED', 'DISCOVERY_RESTORED', 'DISCOVERY_ARCHIVED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DISCOVERY_IMPORT_BATCH_PURGED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'DISCOVERY_IMPORT_BATCH';

-- CreateTable
CREATE TABLE "DiscoveryImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importMethod" "DiscoveryImportMethod" NOT NULL,
    "producerLabel" VARCHAR(160) NOT NULL,
    "contractVersion" INTEGER NOT NULL DEFAULT 1,
    "originalPayload" TEXT NOT NULL,
    "validationSummary" JSONB NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDiscovery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "JobDiscoveryStatus" NOT NULL DEFAULT 'INBOX',
    "sourceLabel" VARCHAR(160),
    "submittedUrl" VARCHAR(2048),
    "titleHint" VARCHAR(200),
    "companyHint" VARCHAR(200),
    "locationHint" VARCHAR(200),
    "discoveredAt" TIMESTAMP(3),
    "rawContent" TEXT NOT NULL,
    "validationSummary" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rejectedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryProcessingEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "discoveryId" TEXT,
    "eventType" "DiscoveryProcessingEventType" NOT NULL,
    "previousStatus" "JobDiscoveryStatus",
    "newStatus" "JobDiscoveryStatus",
    "safeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryProcessingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryImportBatch_userId_confirmedAt_id_idx" ON "DiscoveryImportBatch"("userId", "confirmedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryImportBatch_id_userId_key" ON "DiscoveryImportBatch"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryImportBatch_userId_idempotencyKey_key" ON "DiscoveryImportBatch"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "JobDiscovery_batchId_userId_idx" ON "JobDiscovery"("batchId", "userId");

-- CreateIndex
CREATE INDEX "JobDiscovery_userId_createdAt_id_idx" ON "JobDiscovery"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "JobDiscovery_userId_status_createdAt_id_idx" ON "JobDiscovery"("userId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "JobDiscovery_userId_sourceLabel_createdAt_id_idx" ON "JobDiscovery"("userId", "sourceLabel", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JobDiscovery_id_userId_key" ON "JobDiscovery"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDiscovery_id_batchId_userId_key" ON "JobDiscovery"("id", "batchId", "userId");

-- CreateIndex
CREATE INDEX "DiscoveryProcessingEvent_userId_batchId_createdAt_idx" ON "DiscoveryProcessingEvent"("userId", "batchId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryProcessingEvent_userId_discoveryId_createdAt_idx" ON "DiscoveryProcessingEvent"("userId", "discoveryId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscoveryImportBatch" ADD CONSTRAINT "DiscoveryImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDiscovery" ADD CONSTRAINT "JobDiscovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDiscovery" ADD CONSTRAINT "JobDiscovery_batchId_userId_fkey" FOREIGN KEY ("batchId", "userId") REFERENCES "DiscoveryImportBatch"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProcessingEvent" ADD CONSTRAINT "DiscoveryProcessingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProcessingEvent" ADD CONSTRAINT "DiscoveryProcessingEvent_batchId_userId_fkey" FOREIGN KEY ("batchId", "userId") REFERENCES "DiscoveryImportBatch"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProcessingEvent" ADD CONSTRAINT "DiscoveryProcessingEvent_discoveryId_batchId_userId_fkey" FOREIGN KEY ("discoveryId", "batchId", "userId") REFERENCES "JobDiscovery"("id", "batchId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
