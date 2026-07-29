-- Stage 9: additive Grounded RAG Retrieval Layer.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "EvidenceState" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "EvidenceRetrievalIndexStatus" AS ENUM (
  'PENDING',
  'CURRENT',
  'STALE',
  'FAILED',
  'DISABLED'
);
CREATE TYPE "EvidenceRetrievalMode" AS ENUM ('REQUIREMENT', 'JOB', 'USER_QUERY');
CREATE TYPE "EvidenceRetrievalDurationBucket" AS ENUM (
  'LT_100_MS',
  'LT_500_MS',
  'LT_2_S',
  'GTE_2_S'
);
CREATE TYPE "EvidenceRetrievalResultCode" AS ENUM (
  'RESULTS',
  'EMPTY',
  'SEMANTIC_UNAVAILABLE'
);

ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'EVIDENCE_RESTORED';

ALTER TABLE "EvidenceItem"
ADD COLUMN "state" "EvidenceState" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "EvidenceItem"
ADD CONSTRAINT "EvidenceItem_archive_shape" CHECK (
  ("state" = 'ACTIVE' AND "archivedAt" IS NULL)
  OR ("state" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
);

CREATE INDEX "EvidenceItem_userId_state_updatedAt_id_idx"
ON "EvidenceItem"("userId", "state", "updatedAt", "id");

CREATE TABLE "EvidenceRetrievalIndex" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "evidenceItemId" TEXT NOT NULL,
  "indexedEvidenceVersion" INTEGER,
  "canonicalContentHash" CHAR(64),
  "chunkingSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "retrievalSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "embeddingProvider" VARCHAR(80),
  "embeddingModel" VARCHAR(160),
  "embeddingDimensions" INTEGER,
  "lexicalCurrent" BOOLEAN NOT NULL DEFAULT false,
  "semanticCurrent" BOOLEAN NOT NULL DEFAULT false,
  "status" "EvidenceRetrievalIndexStatus" NOT NULL DEFAULT 'PENDING',
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "lastIndexedAt" TIMESTAMP(3),
  "errorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EvidenceRetrievalIndex_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceRetrievalChunk" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "evidenceItemId" TEXT NOT NULL,
  "evidenceVersion" INTEGER NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "section" VARCHAR(80) NOT NULL,
  "chunkText" VARCHAR(2000) NOT NULL,
  "chunkHash" CHAR(64) NOT NULL,
  "characterCount" INTEGER NOT NULL,
  "embeddingDimensions" INTEGER,
  "embedding" vector,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EvidenceRetrievalChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceRetrievalEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "queryHash" CHAR(64) NOT NULL,
  "mode" "EvidenceRetrievalMode" NOT NULL,
  "requestedTopK" INTEGER NOT NULL,
  "returnedCount" INTEGER NOT NULL,
  "currentIndexCount" INTEGER NOT NULL,
  "staleIndexCount" INTEGER NOT NULL,
  "durationBucket" "EvidenceRetrievalDurationBucket" NOT NULL,
  "resultCode" "EvidenceRetrievalResultCode" NOT NULL,
  "embeddingProvider" VARCHAR(80),
  "embeddingModel" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvidenceRetrievalEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvidenceRetrievalIndex"
ADD CONSTRAINT "EvidenceRetrievalIndex_coordinates" CHECK (
  ("indexedEvidenceVersion" IS NULL OR "indexedEvidenceVersion" >= 1)
  AND "chunkingSchemaVersion" = 1
  AND "retrievalSchemaVersion" = 1
  AND ("embeddingDimensions" IS NULL OR "embeddingDimensions" = 1536)
  AND ("canonicalContentHash" IS NULL OR "canonicalContentHash" ~ '^[0-9a-f]{64}$')
),
ADD CONSTRAINT "EvidenceRetrievalIndex_counts" CHECK ("chunkCount" BETWEEN 0 AND 20),
ADD CONSTRAINT "EvidenceRetrievalIndex_provider_shape" CHECK (
  (
    "semanticCurrent"
    AND "embeddingProvider" IS NOT NULL
    AND "embeddingModel" IS NOT NULL
    AND "embeddingDimensions" = 1536
  )
  OR NOT "semanticCurrent"
),
ADD CONSTRAINT "EvidenceRetrievalIndex_current_shape" CHECK (
  (
    "status" = 'CURRENT'
    AND "lexicalCurrent"
    AND "semanticCurrent"
    AND "errorCode" IS NULL
    AND "lastIndexedAt" IS NOT NULL
  )
  OR (
    "status" IN ('FAILED', 'DISABLED')
    AND "lexicalCurrent"
    AND NOT "semanticCurrent"
    AND "errorCode" IS NOT NULL
    AND "lastIndexedAt" IS NOT NULL
  )
  OR (
    "status" IN ('PENDING', 'STALE')
    AND NOT "lexicalCurrent"
    AND NOT "semanticCurrent"
  )
);

ALTER TABLE "EvidenceRetrievalChunk"
ADD CONSTRAINT "EvidenceRetrievalChunk_coordinates" CHECK (
  "evidenceVersion" >= 1
  AND "chunkIndex" BETWEEN 0 AND 19
  AND "characterCount" BETWEEN 1 AND 2000
  AND "characterCount" = char_length("chunkText")
),
ADD CONSTRAINT "EvidenceRetrievalChunk_text" CHECK (
  length(btrim("chunkText")) BETWEEN 1 AND 2000
  AND length(btrim("section")) BETWEEN 1 AND 80
),
ADD CONSTRAINT "EvidenceRetrievalChunk_hash" CHECK (
  "chunkHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "EvidenceRetrievalChunk_embedding" CHECK (
  (
    "embedding" IS NULL
    AND "embeddingDimensions" IS NULL
  )
  OR (
    "embedding" IS NOT NULL
    AND "embeddingDimensions" = 1536
    AND vector_dims("embedding") = "embeddingDimensions"
  )
);

ALTER TABLE "EvidenceRetrievalEvent"
ADD CONSTRAINT "EvidenceRetrievalEvent_query_hash" CHECK (
  "queryHash" ~ '^[0-9a-f]{64}$'
),
ADD CONSTRAINT "EvidenceRetrievalEvent_counts" CHECK (
  "requestedTopK" BETWEEN 1 AND 10
  AND "returnedCount" BETWEEN 0 AND "requestedTopK"
  AND "currentIndexCount" >= 0
  AND "staleIndexCount" >= 0
);

CREATE UNIQUE INDEX "EvidenceRetrievalIndex_evidenceItemId_userId_key"
ON "EvidenceRetrievalIndex"("evidenceItemId", "userId");
CREATE UNIQUE INDEX "EvidenceRetrievalIndex_id_userId_key"
ON "EvidenceRetrievalIndex"("id", "userId");
CREATE INDEX "EvidenceRetrievalIndex_userId_status_updatedAt_evidenceItem_idx"
ON "EvidenceRetrievalIndex"("userId", "status", "updatedAt", "evidenceItemId");
CREATE INDEX "EvidenceRetrievalIndex_userId_lexicalCurrent_updatedAt_evid_idx"
ON "EvidenceRetrievalIndex"("userId", "lexicalCurrent", "updatedAt", "evidenceItemId");
CREATE INDEX "EvidenceRetrievalIndex_userId_semanticCurrent_embeddingProv_idx"
ON "EvidenceRetrievalIndex"(
  "userId",
  "semanticCurrent",
  "embeddingProvider",
  "embeddingModel",
  "embeddingDimensions"
);

CREATE UNIQUE INDEX "EvidenceRetrievalChunk_evidenceItemId_evidenceVersion_chunk_key"
ON "EvidenceRetrievalChunk"("evidenceItemId", "evidenceVersion", "chunkIndex");
CREATE UNIQUE INDEX "EvidenceRetrievalChunk_id_userId_key"
ON "EvidenceRetrievalChunk"("id", "userId");
CREATE INDEX "EvidenceRetrievalChunk_userId_evidenceItemId_evidenceVersio_idx"
ON "EvidenceRetrievalChunk"("userId", "evidenceItemId", "evidenceVersion", "chunkIndex");
CREATE INDEX "EvidenceRetrievalChunk_userId_embeddingDimensions_evidenceI_idx"
ON "EvidenceRetrievalChunk"("userId", "embeddingDimensions", "evidenceItemId");
CREATE INDEX "EvidenceRetrievalChunk_fts_idx"
ON "EvidenceRetrievalChunk"
USING GIN (to_tsvector('english', "chunkText"));
CREATE INDEX "EvidenceRetrievalChunk_embedding_cosine_hnsw_idx"
ON "EvidenceRetrievalChunk"
USING hnsw (("embedding"::vector(1536)) vector_cosine_ops)
WHERE "embedding" IS NOT NULL AND "embeddingDimensions" = 1536;

CREATE INDEX "EvidenceRetrievalEvent_userId_createdAt_id_idx"
ON "EvidenceRetrievalEvent"("userId", "createdAt", "id");
CREATE INDEX "EvidenceRetrievalEvent_userId_mode_resultCode_createdAt_idx"
ON "EvidenceRetrievalEvent"("userId", "mode", "resultCode", "createdAt");

ALTER TABLE "EvidenceRetrievalIndex"
ADD CONSTRAINT "EvidenceRetrievalIndex_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "EvidenceRetrievalIndex_evidenceItemId_userId_fkey"
FOREIGN KEY ("evidenceItemId", "userId")
REFERENCES "EvidenceItem"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceRetrievalChunk"
ADD CONSTRAINT "EvidenceRetrievalChunk_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "EvidenceRetrievalChunk_evidenceItemId_userId_fkey"
FOREIGN KEY ("evidenceItemId", "userId")
REFERENCES "EvidenceItem"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceRetrievalEvent"
ADD CONSTRAINT "EvidenceRetrievalEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every Evidence record has exactly one retrieval state, including records
-- created by seed, test, or future server-side workflows.
CREATE FUNCTION "careerops_create_evidence_retrieval_index"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "EvidenceRetrievalIndex" (
    "id",
    "userId",
    "evidenceItemId",
    "status",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    'eri_' || encode(gen_random_bytes(16), 'hex'),
    NEW."userId",
    NEW."id",
    'PENDING',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceItem_create_retrieval_index"
AFTER INSERT ON "EvidenceItem"
FOR EACH ROW
EXECUTE FUNCTION "careerops_create_evidence_retrieval_index"();

-- Backfill existing evidence deterministically without changing authority.
INSERT INTO "EvidenceRetrievalIndex" (
  "id",
  "userId",
  "evidenceItemId",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'eri_' || encode(digest(evidence."id" || ':' || evidence."userId", 'sha256'), 'hex'),
  evidence."userId",
  evidence."id",
  'PENDING',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "EvidenceItem" evidence;

-- Any authoritative Evidence version change immediately invalidates and
-- removes derived narrative. External embedding calls never occur here.
CREATE FUNCTION "careerops_stale_evidence_retrieval_index"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."version" <> OLD."version" THEN
    DELETE FROM "EvidenceRetrievalChunk"
    WHERE "evidenceItemId" = NEW."id"
      AND "userId" = NEW."userId";

    UPDATE "EvidenceRetrievalIndex"
    SET
      "indexedEvidenceVersion" = NULL,
      "canonicalContentHash" = NULL,
      "embeddingProvider" = NULL,
      "embeddingModel" = NULL,
      "embeddingDimensions" = NULL,
      "lexicalCurrent" = false,
      "semanticCurrent" = false,
      "status" = 'STALE',
      "chunkCount" = 0,
      "lastIndexedAt" = NULL,
      "errorCode" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "evidenceItemId" = NEW."id"
      AND "userId" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "EvidenceItem_stale_retrieval_index"
AFTER UPDATE ON "EvidenceItem"
FOR EACH ROW
EXECUTE FUNCTION "careerops_stale_evidence_retrieval_index"();

-- A completed active requirement review cannot rely on archived Evidence.
CREATE FUNCTION "careerops_validate_requirement_review_active_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "JobRequirementEvidenceLink" link
    INNER JOIN "EvidenceItem" evidence
      ON evidence."id" = link."evidenceItemId"
      AND evidence."userId" = link."userId"
    WHERE link."requirementId" = NEW."requirementId"
      AND link."userId" = NEW."userId"
      AND evidence."state" <> 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Requirement review uses archived Candidate Evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "JobRequirementReview_validate_active_evidence"
BEFORE INSERT OR UPDATE ON "JobRequirementReview"
FOR EACH ROW
EXECUTE FUNCTION "careerops_validate_requirement_review_active_evidence"();
