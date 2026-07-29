-- Hash requirement link sets identically in PostgreSQL and the application so
-- review snapshots cannot trust an arbitrary client- or caller-provided digest.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION "careerops_requirement_link_set_hash"(
  target_requirement_id TEXT,
  target_user_id TEXT
)
RETURNS CHAR(64)
LANGUAGE sql
STABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        COALESCE(
          string_agg(
            octet_length(convert_to(link."evidenceItemId", 'UTF8'))::text
              || ':' || link."evidenceItemId"
              || CASE link."supportLevel" WHEN 'FULL' THEN 'F' ELSE 'P' END
              || CASE
                WHEN link."rationale" IS NULL THEN '-1:'
                ELSE octet_length(convert_to(link."rationale", 'UTF8'))::text
                  || ':' || link."rationale"
              END,
            E'\n' ORDER BY link."evidenceItemId" COLLATE "C"
          ),
          ''
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )::CHAR(64)
  FROM "JobRequirementEvidenceLink" link
  WHERE link."requirementId" = target_requirement_id
    AND link."userId" = target_user_id;
$$;

CREATE FUNCTION "careerops_validate_requirement_review_link_hash"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."linkSetHash" <> "careerops_requirement_link_set_hash"(
    NEW."requirementId",
    NEW."userId"
  ) THEN
    RAISE EXCEPTION 'Requirement review link-set hash is inconsistent with evidence links';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "JobRequirementReview_validate_link_hash"
BEFORE INSERT OR UPDATE ON "JobRequirementReview"
FOR EACH ROW
EXECUTE FUNCTION "careerops_validate_requirement_review_link_hash"();

-- Link ownership and evidence identity are immutable. Semantic edits use the
-- support/rationale path, which advances the owning requirement match-set.
CREATE FUNCTION "careerops_protect_requirement_evidence_link_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."requirementId" IS DISTINCT FROM OLD."requirementId"
    OR NEW."evidenceItemId" IS DISTINCT FROM OLD."evidenceItemId"
  THEN
    RAISE EXCEPTION 'Requirement evidence link identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "JobRequirementEvidenceLink_protect_identity"
BEFORE UPDATE OF "userId", "requirementId", "evidenceItemId"
ON "JobRequirementEvidenceLink"
FOR EACH ROW
EXECUTE FUNCTION "careerops_protect_requirement_evidence_link_identity"();
