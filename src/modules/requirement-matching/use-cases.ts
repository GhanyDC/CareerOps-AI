import "server-only";

import type { JobRequirement, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import {
  assessRequirement,
  assertRequirementStatusConsistent,
  deriveRequirementStatus,
  emptyCoverageCounts,
  hashRequirementLinkSet,
  hashRequirementOrder,
  summarizeRequirementCoverage,
  type RequirementAssessmentInput,
} from "./matching";
import {
  getRequirementMatchingJobRecord,
  getRequirementRecord,
  listEvidenceForRequirement,
  listRequirementMatchEvents,
  summarizeActiveRequirementCoverageRecords,
} from "./repository";
import {
  MAX_REQUIREMENT_EVIDENCE_LINKS,
  REQUIREMENT_MATCH_SCHEMA_VERSION,
  evidenceLinkCreateSchema,
  evidenceLinkDeleteSchema,
  evidenceLinkUpdateSchema,
  requirementCreateSchema,
  requirementMoveSchema,
  requirementReviewCompletionSchema,
  requirementStateTransitionSchema,
  requirementUpdateSchema,
  type RequirementValues,
} from "./schemas";

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function requirementNotFound() {
  return new DomainError("Job requirement not found.", "REQUIREMENT_NOT_FOUND");
}

function linkNotFound() {
  return new DomainError("Requirement evidence link not found.", "REQUIREMENT_LINK_NOT_FOUND");
}

function assertActiveJob(job: { status: "ACTIVE" | "ARCHIVED" }) {
  if (job.status !== "ACTIVE") {
    throw new DomainError(
      "Restore this Job before changing requirement matches.",
      "INVALID_JOB_TRANSITION",
    );
  }
}

function assertActiveRequirement(requirement: {
  state: "ACTIVE" | "ARCHIVED";
  job: { status: "ACTIVE" | "ARCHIVED" };
}) {
  assertActiveJob(requirement.job);
  if (requirement.state !== "ACTIVE") {
    throw new DomainError("Restore this requirement before changing its matches.", "CONFLICT");
  }
}

type SourceJob = Readonly<{
  responsibilities: string[];
  qualifications: string[];
  preferredQualifications: string[];
  skills: string[];
}>;

function assertRequirementSource(values: RequirementValues, job: SourceJob) {
  const sourceValues = {
    JOB_RESPONSIBILITY: job.responsibilities,
    JOB_QUALIFICATION: job.qualifications,
    JOB_PREFERRED_QUALIFICATION: job.preferredQualifications,
    JOB_SKILL: job.skills,
  } as const;
  if (values.source === "MANUAL") return;
  if (!sourceValues[values.source].includes(values.statement)) {
    throw new DomainError(
      "A Job-field requirement must exactly match the selected authoritative structured field. Choose Manual for user-authored wording.",
      "INVALID_INPUT",
    );
  }
}

function requirementEvent(
  tx: Prisma.TransactionClient,
  requirement: Pick<JobRequirement, "id" | "userId" | "jobId" | "version" | "matchSetVersion">,
  data: Omit<
    Prisma.JobRequirementMatchEventUncheckedCreateInput,
    "userId" | "jobId" | "requirementId" | "requirementVersion" | "matchSetVersion" | "safeMetadata"
  > & { safeMetadata?: Record<string, unknown> },
) {
  const { safeMetadata, ...eventData } = data;
  return tx.jobRequirementMatchEvent.create({
    data: {
      userId: requirement.userId,
      jobId: requirement.jobId,
      requirementId: requirement.id,
      requirementVersion: requirement.version,
      matchSetVersion: requirement.matchSetVersion,
      safeMetadata: json({ schemaVersion: 1, ...(safeMetadata ?? {}) }),
      ...eventData,
    },
  });
}

function assessmentInput(requirement: {
  version: number;
  matchSetVersion: number;
  review: {
    status: "NOT_REVIEWED" | "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED";
    reviewedRequirementVersion: number;
    reviewedMatchSetVersion: number;
    matchSchemaVersion: number;
    linkSetHash: string;
  } | null;
  evidenceLinks: Array<{
    evidenceItemId: string;
    supportLevel: "FULL" | "PARTIAL";
    rationale: string | null;
    reviewedEvidenceVersion: number | null;
    evidence: { version: number };
  }>;
}): RequirementAssessmentInput {
  const review =
    requirement.review?.status === "NOT_REVIEWED"
      ? null
      : (requirement.review as RequirementAssessmentInput["review"]);
  return { ...requirement, review };
}

function withAssessment<T extends Parameters<typeof assessmentInput>[0]>(requirement: T) {
  return { ...requirement, assessment: assessRequirement(assessmentInput(requirement)) };
}

export async function viewJobRequirementMatching(userId: string, jobId: string) {
  const job = await getRequirementMatchingJobRecord(userId, jobId);
  if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
  const requirements = job.requirements.map(withAssessment);
  return {
    ...job,
    requirements,
    coverage: summarizeRequirementCoverage(
      requirements
        .filter((requirement) => requirement.state === "ACTIVE")
        .map((requirement) => ({
          importance: requirement.importance,
          assessment: requirement.assessment,
        })),
    ),
    orderHash: hashRequirementOrder(
      requirements
        .filter((requirement) => requirement.state === "ACTIVE")
        .map((requirement) => ({ id: requirement.id, position: requirement.position })),
    ),
  };
}

export async function viewRequirementMatch(userId: string, requirementId: string) {
  const requirement = await getRequirementRecord(userId, requirementId);
  if (!requirement) throw requirementNotFound();
  const evidenceOptions = await listEvidenceForRequirement(userId, requirementId);
  const events = await listRequirementMatchEvents(userId, requirementId);
  return {
    requirement: withAssessment(requirement),
    evidenceOptions,
    events,
  };
}

export async function createJobRequirement(
  userId: string,
  jobId: string,
  untrustedInput: unknown,
  dependencies: {
    recordAudit: (...arguments_: Parameters<typeof recordAudit>) => PromiseLike<unknown>;
  } = { recordAudit },
) {
  const values = requirementCreateSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id_userId: { id: jobId, userId } } });
    if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
    assertActiveJob(job);
    assertRequirementSource(values, job);
    const last = await tx.jobRequirement.findFirst({
      where: { userId, jobId, state: "ACTIVE" },
      select: { position: true },
      orderBy: [{ position: "desc" }, { id: "desc" }],
    });
    const requirement = await tx.jobRequirement.create({
      data: {
        userId,
        jobId,
        ...values,
        position: (last?.position ?? -1) + 1,
      },
    });
    await requirementEvent(tx, requirement, {
      eventType: "REQUIREMENT_CREATED",
      actorUserId: userId,
      safeMetadata: {
        category: requirement.category,
        importance: requirement.importance,
        source: requirement.source,
        position: requirement.position,
      },
    });
    await dependencies.recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirement.id,
      action: "JOB_REQUIREMENT_CREATED",
      newState: {
        jobId,
        version: requirement.version,
        category: requirement.category,
        importance: requirement.importance,
        source: requirement.source,
        position: requirement.position,
      },
    });
    return requirement;
  });
}

export async function updateJobRequirement(
  userId: string,
  requirementId: string,
  untrustedInput: unknown,
) {
  const input = requirementUpdateSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobRequirement.findUnique({
      where: { id_userId: { id: requirementId, userId } },
      include: { job: true },
    });
    if (!current) throw requirementNotFound();
    assertActiveRequirement(current);
    if (current.version !== input.expectedVersion) {
      throw new DomainError("The requirement changed. Reload and try again.", "VERSION_CONFLICT");
    }
    assertRequirementSource(input, current.job);
    const changedFields = (["statement", "category", "importance", "source"] as const).filter(
      (field) => current[field] !== input[field],
    );
    if (changedFields.length === 0) return current;
    const rows = await tx.jobRequirement.updateMany({
      where: {
        id: requirementId,
        userId,
        state: "ACTIVE",
        version: input.expectedVersion,
      },
      data: {
        statement: input.statement,
        category: input.category,
        importance: input.importance,
        source: input.source,
        version: { increment: 1 },
      },
    });
    if (rows.count !== 1) {
      throw new DomainError("The requirement changed. Reload and try again.", "VERSION_CONFLICT");
    }
    const updated = await tx.jobRequirement.findUniqueOrThrow({
      where: { id_userId: { id: requirementId, userId } },
    });
    await requirementEvent(tx, updated, {
      eventType: "REQUIREMENT_UPDATED",
      actorUserId: userId,
      safeMetadata: { changedFields, previousVersion: current.version },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: "JOB_REQUIREMENT_UPDATED",
      previousState: { version: current.version },
      newState: { version: updated.version, changedFields },
    });
    return updated;
  });
}

export async function transitionJobRequirementState(
  userId: string,
  requirementId: string,
  untrustedInput: unknown,
) {
  const input = requirementStateTransitionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobRequirement.findUnique({
      where: { id_userId: { id: requirementId, userId } },
      include: { job: true },
    });
    if (!current) throw requirementNotFound();
    assertActiveJob(current.job);
    if (current.version !== input.expectedVersion) {
      throw new DomainError("The requirement changed. Reload and try again.", "VERSION_CONFLICT");
    }
    const expectedState = input.targetState === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
    if (current.state !== expectedState) {
      throw new DomainError(
        `Requirement cannot move from ${current.state} to ${input.targetState}.`,
        "INVALID_STATUS_TRANSITION",
      );
    }
    const lastActive =
      input.targetState === "ACTIVE"
        ? await tx.jobRequirement.findFirst({
            where: { userId, jobId: current.jobId, state: "ACTIVE" },
            select: { position: true },
            orderBy: [{ position: "desc" }, { id: "desc" }],
          })
        : null;
    const nextPosition =
      input.targetState === "ACTIVE" ? (lastActive?.position ?? -1) + 1 : current.position;
    const updated = await tx.jobRequirement.update({
      where: { id_userId: { id: requirementId, userId } },
      data: {
        state: input.targetState,
        archivedAt: input.targetState === "ARCHIVED" ? new Date() : null,
        position: nextPosition,
      },
    });
    const restored = input.targetState === "ACTIVE";
    await requirementEvent(tx, updated, {
      eventType: restored ? "REQUIREMENT_RESTORED" : "REQUIREMENT_ARCHIVED",
      actorUserId: userId,
      safeMetadata: restored
        ? { previousPosition: current.position, position: updated.position }
        : undefined,
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: restored ? "JOB_REQUIREMENT_RESTORED" : "JOB_REQUIREMENT_ARCHIVED",
      previousState: { state: current.state, version: current.version },
      newState: { state: updated.state, version: updated.version, position: updated.position },
    });
    return updated;
  });
}

export async function moveJobRequirement(
  userId: string,
  requirementId: string,
  untrustedInput: unknown,
) {
  const input = requirementMoveSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const requirement = await tx.jobRequirement.findUnique({
      where: { id_userId: { id: requirementId, userId } },
      include: { job: true },
    });
    if (!requirement) throw requirementNotFound();
    assertActiveRequirement(requirement);
    const ordered = await tx.jobRequirement.findMany({
      where: { userId, jobId: requirement.jobId, state: "ACTIVE" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    if (
      hashRequirementOrder(ordered.map(({ id, position }) => ({ id, position }))) !==
      input.expectedOrderHash
    ) {
      throw new DomainError(
        "The requirement order changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const index = ordered.findIndex((item) => item.id === requirementId);
    const targetIndex = input.direction === "UP" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return requirement;
    const target = ordered[targetIndex]!;
    await tx.jobRequirement.update({
      where: { id_userId: { id: requirement.id, userId } },
      data: { position: target.position },
    });
    await tx.jobRequirement.update({
      where: { id_userId: { id: target.id, userId } },
      data: { position: requirement.position },
    });
    const updated = { ...requirement, position: target.position };
    await requirementEvent(tx, updated, {
      eventType: "REQUIREMENT_REORDERED",
      actorUserId: userId,
      safeMetadata: { previousPosition: requirement.position, position: target.position },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirement.id,
      action: "JOB_REQUIREMENT_REORDERED",
      previousState: { position: requirement.position },
      newState: { position: target.position },
    });
    return updated;
  });
}

async function currentRequirementWithLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  requirementId: string,
) {
  const requirement = await tx.jobRequirement.findUnique({
    where: { id_userId: { id: requirementId, userId } },
    include: { job: true, evidenceLinks: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  if (!requirement) throw requirementNotFound();
  assertActiveRequirement(requirement);
  return requirement;
}

function assertRequirementCoordinates(
  requirement: Pick<JobRequirement, "version" | "matchSetVersion">,
  expectedRequirementVersion: number,
  expectedMatchSetVersion: number,
) {
  if (
    requirement.version !== expectedRequirementVersion ||
    requirement.matchSetVersion !== expectedMatchSetVersion
  ) {
    throw new DomainError(
      "The requirement or its evidence links changed. Reload and try again.",
      "VERSION_CONFLICT",
    );
  }
}

export async function createRequirementEvidenceLink(
  userId: string,
  requirementId: string,
  untrustedInput: unknown,
) {
  const input = evidenceLinkCreateSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const requirement = await currentRequirementWithLinks(tx, userId, requirementId);
    assertRequirementCoordinates(
      requirement,
      input.expectedRequirementVersion,
      input.expectedMatchSetVersion,
    );
    const evidence = await tx.evidenceItem.findUnique({
      where: { id_userId: { id: input.evidenceItemId, userId } },
    });
    if (!evidence || evidence.version !== input.expectedEvidenceVersion) {
      throw new DomainError(
        "The selected Candidate Evidence is unavailable or changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    if (requirement.evidenceLinks.some((link) => link.evidenceItemId === input.evidenceItemId)) {
      throw new DomainError(
        "This Candidate Evidence is already linked to the requirement.",
        "CONFLICT",
      );
    }
    if (requirement.evidenceLinks.length >= MAX_REQUIREMENT_EVIDENCE_LINKS) {
      throw new DomainError(
        `A requirement can link at most ${MAX_REQUIREMENT_EVIDENCE_LINKS} Candidate Evidence records.`,
        "CONFLICT",
      );
    }
    const link = await tx.jobRequirementEvidenceLink.create({
      data: {
        userId,
        requirementId,
        evidenceItemId: evidence.id,
        supportLevel: input.supportLevel,
        rationale: input.rationale,
        position: (requirement.evidenceLinks.at(-1)?.position ?? -1) + 1,
      },
    });
    const updatedRequirement = await tx.jobRequirement.findUniqueOrThrow({
      where: { id_userId: { id: requirementId, userId } },
    });
    const links = [...requirement.evidenceLinks, link];
    const linkSetHash = hashRequirementLinkSet(links);
    await requirementEvent(tx, updatedRequirement, {
      eventType: "EVIDENCE_LINKED",
      actorUserId: userId,
      evidenceItemId: evidence.id,
      evidenceVersion: evidence.version,
      supportLevel: link.supportLevel,
      safeMetadata: { linkId: link.id, linkSetHash },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: "JOB_REQUIREMENT_EVIDENCE_LINKED",
      newState: {
        linkId: link.id,
        evidenceItemId: evidence.id,
        evidenceVersion: evidence.version,
        supportLevel: link.supportLevel,
        matchSetVersion: updatedRequirement.matchSetVersion,
        linkSetHash,
      },
    });
    return { ...link, jobId: requirement.jobId };
  });
}

export async function updateRequirementEvidenceLink(
  userId: string,
  requirementId: string,
  linkId: string,
  untrustedInput: unknown,
) {
  const input = evidenceLinkUpdateSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const requirement = await currentRequirementWithLinks(tx, userId, requirementId);
    assertRequirementCoordinates(
      requirement,
      input.expectedRequirementVersion,
      input.expectedMatchSetVersion,
    );
    const current = requirement.evidenceLinks.find((link) => link.id === linkId);
    if (!current || current.version !== input.expectedLinkVersion) throw linkNotFound();
    if (
      current.supportLevel === input.supportLevel &&
      current.rationale === (input.rationale ?? null)
    ) {
      return { ...current, jobId: requirement.jobId };
    }
    const rows = await tx.jobRequirementEvidenceLink.updateMany({
      where: {
        id: linkId,
        userId,
        requirementId,
        version: input.expectedLinkVersion,
      },
      data: {
        supportLevel: input.supportLevel,
        rationale: input.rationale,
        reviewedEvidenceVersion: null,
        version: { increment: 1 },
      },
    });
    if (rows.count !== 1) {
      throw new DomainError("The evidence link changed. Reload and try again.", "VERSION_CONFLICT");
    }
    // Interactive transactions use one database connection. Keep its queries sequential so
    // the PostgreSQL adapter never receives overlapping work on the same client.
    const link = await tx.jobRequirementEvidenceLink.findUniqueOrThrow({
      where: { id_userId: { id: linkId, userId } },
    });
    const updatedRequirement = await tx.jobRequirement.findUniqueOrThrow({
      where: { id_userId: { id: requirementId, userId } },
    });
    const links = await tx.jobRequirementEvidenceLink.findMany({
      where: { userId, requirementId },
    });
    const linkSetHash = hashRequirementLinkSet(links);
    await requirementEvent(tx, updatedRequirement, {
      eventType: "EVIDENCE_LINK_UPDATED",
      actorUserId: userId,
      evidenceItemId: link.evidenceItemId,
      supportLevel: link.supportLevel,
      safeMetadata: {
        linkId: link.id,
        previousSupportLevel: current.supportLevel,
        linkSetHash,
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: "JOB_REQUIREMENT_EVIDENCE_LINK_UPDATED",
      previousState: {
        linkId,
        supportLevel: current.supportLevel,
        version: current.version,
      },
      newState: {
        linkId,
        supportLevel: link.supportLevel,
        version: link.version,
        matchSetVersion: updatedRequirement.matchSetVersion,
        linkSetHash,
      },
    });
    return { ...link, jobId: requirement.jobId };
  });
}

export async function deleteRequirementEvidenceLink(
  userId: string,
  requirementId: string,
  linkId: string,
  untrustedInput: unknown,
) {
  const input = evidenceLinkDeleteSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const requirement = await currentRequirementWithLinks(tx, userId, requirementId);
    assertRequirementCoordinates(
      requirement,
      input.expectedRequirementVersion,
      input.expectedMatchSetVersion,
    );
    const link = requirement.evidenceLinks.find((item) => item.id === linkId);
    if (!link || link.version !== input.expectedLinkVersion) throw linkNotFound();
    await tx.jobRequirementEvidenceLink.delete({ where: { id_userId: { id: linkId, userId } } });
    const updatedRequirement = await tx.jobRequirement.findUniqueOrThrow({
      where: { id_userId: { id: requirementId, userId } },
    });
    const links = await tx.jobRequirementEvidenceLink.findMany({
      where: { userId, requirementId },
    });
    const linkSetHash = hashRequirementLinkSet(links);
    await requirementEvent(tx, updatedRequirement, {
      eventType: "EVIDENCE_UNLINKED",
      actorUserId: userId,
      evidenceItemId: link.evidenceItemId,
      supportLevel: link.supportLevel,
      safeMetadata: { linkId, reasonCode: "USER_REMOVED_LINK", linkSetHash },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: "JOB_REQUIREMENT_EVIDENCE_UNLINKED",
      previousState: {
        linkId,
        evidenceItemId: link.evidenceItemId,
        supportLevel: link.supportLevel,
      },
      newState: {
        reasonCode: "USER_REMOVED_LINK",
        matchSetVersion: updatedRequirement.matchSetVersion,
        linkSetHash,
      },
    });
    return { ...link, jobId: requirement.jobId };
  });
}

function coordinateKey(value: { evidenceItemId: string; evidenceVersion: number }) {
  return `${value.evidenceItemId}:${value.evidenceVersion}`;
}

export async function completeRequirementReview(
  userId: string,
  requirementId: string,
  untrustedInput: unknown,
  dependencies: {
    recordAudit: (...arguments_: Parameters<typeof recordAudit>) => PromiseLike<unknown>;
  } = { recordAudit },
) {
  const input = requirementReviewCompletionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const requirement = await tx.jobRequirement.findUnique({
      where: { id_userId: { id: requirementId, userId } },
      include: {
        job: true,
        review: true,
        evidenceLinks: {
          include: { evidence: { select: { id: true, version: true } } },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!requirement) throw requirementNotFound();
    assertActiveRequirement(requirement);
    assertRequirementCoordinates(
      requirement,
      input.expectedRequirementVersion,
      input.expectedMatchSetVersion,
    );
    const reviewVersion = requirement.review?.version ?? 0;
    if (reviewVersion !== input.expectedReviewVersion) {
      throw new DomainError("The review changed. Reload and try again.", "VERSION_CONFLICT");
    }
    const expectedCoordinates = [...input.evidenceCoordinates].map(coordinateKey).sort();
    const currentCoordinates = requirement.evidenceLinks
      .map((link) =>
        coordinateKey({
          evidenceItemId: link.evidenceItemId,
          evidenceVersion: link.evidence.version,
        }),
      )
      .sort();
    if (
      expectedCoordinates.length !== currentCoordinates.length ||
      expectedCoordinates.some((coordinate, index) => coordinate !== currentCoordinates[index])
    ) {
      throw new DomainError(
        "Candidate Evidence changed while the review was open. Reload and review the current records.",
        "VERSION_CONFLICT",
      );
    }
    const linkSetHash = hashRequirementLinkSet(requirement.evidenceLinks);
    const status = deriveRequirementStatus(true, requirement.evidenceLinks);
    if (status === "NOT_REVIEWED") throw new Error("Completed review cannot be not reviewed.");
    assertRequirementStatusConsistent(status, requirement.evidenceLinks);

    for (const link of requirement.evidenceLinks) {
      await tx.jobRequirementEvidenceLink.update({
        where: { id_userId: { id: link.id, userId } },
        data: { reviewedEvidenceVersion: link.evidence.version },
      });
    }
    const reviewedAt = new Date();
    let review;
    if (!requirement.review) {
      review = await tx.jobRequirementReview.create({
        data: {
          userId,
          requirementId,
          status,
          reviewedRequirementVersion: requirement.version,
          reviewedMatchSetVersion: requirement.matchSetVersion,
          matchSchemaVersion: REQUIREMENT_MATCH_SCHEMA_VERSION,
          linkSetHash,
          reviewedAt,
        },
      });
    } else {
      const rows = await tx.jobRequirementReview.updateMany({
        where: {
          id: requirement.review.id,
          userId,
          requirementId,
          version: input.expectedReviewVersion,
        },
        data: {
          status,
          reviewedRequirementVersion: requirement.version,
          reviewedMatchSetVersion: requirement.matchSetVersion,
          matchSchemaVersion: REQUIREMENT_MATCH_SCHEMA_VERSION,
          linkSetHash,
          reviewedAt,
          version: { increment: 1 },
        },
      });
      if (rows.count !== 1) {
        throw new DomainError("The review changed. Reload and try again.", "VERSION_CONFLICT");
      }
      review = await tx.jobRequirementReview.findUniqueOrThrow({
        where: { id_userId: { id: requirement.review.id, userId } },
      });
    }
    await requirementEvent(tx, requirement, {
      eventType: "REVIEW_COMPLETED",
      actorUserId: userId,
      reviewStatus: status,
      safeMetadata: {
        reviewVersion: review.version,
        matchSchemaVersion: REQUIREMENT_MATCH_SCHEMA_VERSION,
        linkSetHash,
        linkCount: requirement.evidenceLinks.length,
        reasonCode: status === "UNSUPPORTED" ? "NO_RECORDED_EVIDENCE" : "USER_CONFIRMED_SUPPORT",
      },
    });
    await dependencies.recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: requirementId,
      action: "JOB_REQUIREMENT_REVIEW_COMPLETED",
      previousState: requirement.review
        ? {
            reviewVersion: requirement.review.version,
            status: requirement.review.status,
            linkSetHash: requirement.review.linkSetHash,
          }
        : undefined,
      newState: {
        reviewVersion: review.version,
        status,
        requirementVersion: requirement.version,
        matchSetVersion: requirement.matchSetVersion,
        matchSchemaVersion: REQUIREMENT_MATCH_SCHEMA_VERSION,
        linkSetHash,
        evidenceCoordinates: currentCoordinates,
      },
    });
    return { ...review, jobId: requirement.jobId };
  });
}

export async function recordEvidenceVersionChangeInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  evidenceItemId: string,
  previousVersion: number,
  evidenceVersion: number,
) {
  const links = await tx.jobRequirementEvidenceLink.findMany({
    where: { userId, evidenceItemId },
    include: { requirement: true },
  });
  for (const link of links) {
    await requirementEvent(tx, link.requirement, {
      eventType: "EVIDENCE_VERSION_CHANGED",
      actorUserId: userId,
      evidenceItemId,
      evidenceVersion,
      supportLevel: link.supportLevel,
      safeMetadata: {
        linkId: link.id,
        previousEvidenceVersion: previousVersion,
        reasonCode: "CANDIDATE_EVIDENCE_CHANGED",
      },
    });
  }
}

export async function recordEvidenceDeletionInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  evidenceItemId: string,
  evidenceVersion: number,
) {
  const links = await tx.jobRequirementEvidenceLink.findMany({
    where: { userId, evidenceItemId },
  });
  if (links.length === 0) return;

  await tx.jobRequirementEvidenceLink.deleteMany({ where: { userId, evidenceItemId } });
  const requirementIds = [...new Set(links.map((link) => link.requirementId))];
  const updatedRequirements = await tx.jobRequirement.findMany({
    where: { userId, id: { in: requirementIds } },
  });
  const requirementById = new Map(
    updatedRequirements.map((requirement) => [requirement.id, requirement]),
  );

  for (const link of links) {
    const requirement = requirementById.get(link.requirementId);
    if (!requirement) throw requirementNotFound();
    await requirementEvent(tx, requirement, {
      eventType: "EVIDENCE_UNLINKED",
      actorUserId: userId,
      evidenceItemId,
      evidenceVersion,
      supportLevel: link.supportLevel,
      safeMetadata: { linkId: link.id, reasonCode: "CANDIDATE_EVIDENCE_DELETED" },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_REQUIREMENT",
      entityId: link.requirementId,
      action: "JOB_REQUIREMENT_EVIDENCE_UNLINKED",
      previousState: {
        linkId: link.id,
        evidenceItemId,
        evidenceVersion,
        supportLevel: link.supportLevel,
      },
      newState: {
        reasonCode: "CANDIDATE_EVIDENCE_DELETED",
        matchSetVersion: requirement.matchSetVersion,
      },
    });
  }
}

export async function getActiveRequirementCoverageSummary(
  userId: string,
  includeDuplicateMembers = false,
) {
  const rows = await summarizeActiveRequirementCoverageRecords(
    userId,
    includeDuplicateMembers,
    REQUIREMENT_MATCH_SCHEMA_VERSION,
  );
  const summary = {
    REQUIRED: emptyCoverageCounts(),
    PREFERRED: emptyCoverageCounts(),
    OTHER: emptyCoverageCounts(),
  };
  for (const row of rows) {
    summary[row.importance] = {
      supported: Number(row.supported),
      partiallySupported: Number(row.partiallySupported),
      unsupported: Number(row.unsupported),
      notReviewed: Number(row.notReviewed),
      stale: Number(row.stale),
      total: Number(row.total),
    };
  }
  return summary;
}
