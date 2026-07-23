import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { refreshDuplicateStateForJob } from "@/modules/job-duplicates/public.server";
import { evaluateJobHardFiltersInTransaction } from "@/modules/job-hard-filters/public.server";
import { findOwnedDiscoveryForParsing } from "@/modules/discovery/public.server";
import {
  JOB_CONTRACT_VERSION,
  JOB_FIELD_NAMES,
  JOB_PARSER_VERSION,
  confirmedJobValuesSchema,
  jobValuesSchema,
  jobValuesToPersistence,
  mergeSelectedJobFields,
  persistedJobToValues,
  type JobFieldName,
} from "@/modules/jobs/schemas";
import { runSerializableTransaction } from "@/server/db/transaction";

import { JobParsingError } from "./errors";
import { buildCorrectedProvenance, hashDiscoveryParsingSource, parseJobDiscovery } from "./parser";
import { getParseDraft, listReviewDrafts } from "./repository";
import {
  correctionPayloadSchema,
  draftConfirmationSchema,
  draftCorrectionSchema,
  draftTransitionSchema,
} from "./schemas";

export { listReviewDrafts };

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function viewParseDraft(userId: string, id: string) {
  const draft = await getParseDraft(userId, id);
  if (!draft) throw new JobParsingError("PARSE_DRAFT_NOT_FOUND", "Parse draft not found.");
  return draft;
}

export async function createJobParseDraft(
  userId: string,
  discoveryId: string,
  targetJobId?: string,
) {
  try {
    return await runSerializableTransaction(async (tx) => {
      const discovery = await findOwnedDiscoveryForParsing(tx, userId, discoveryId);
      if (!discovery) throw new JobParsingError("DISCOVERY_NOT_FOUND", "Discovery not found.");
      if (discovery.status !== "INBOX") {
        throw new JobParsingError(
          "INVALID_PARSE_DRAFT",
          "Restore the discovery to the inbox before creating a parse draft.",
        );
      }

      const existing = await tx.jobParseDraft.findFirst({
        where: { userId, discoveryId, status: "READY_FOR_REVIEW" },
      });
      if (existing) {
        if ((existing.targetJobId ?? undefined) !== targetJobId) {
          throw new JobParsingError(
            "SOURCE_PROVENANCE_CONFLICT",
            "This discovery already has an active review draft.",
          );
        }
        return existing;
      }

      let targetJob: { id: string; version: number; status: "ACTIVE" | "ARCHIVED" } | null = null;
      if (targetJobId) {
        targetJob = await tx.job.findUnique({
          where: { id_userId: { id: targetJobId, userId } },
          select: { id: true, version: true, status: true },
        });
        if (!targetJob) throw new JobParsingError("JOB_NOT_FOUND", "Job not found.");
        if (targetJob.status !== "ACTIVE") {
          throw new JobParsingError(
            "INVALID_JOB_TRANSITION",
            "Restore the Job before reparsing its source.",
          );
        }
        const source = await tx.jobSource.findFirst({
          where: { userId, jobId: targetJob.id, discoveryId },
          select: { id: true },
        });
        if (!source) {
          throw new JobParsingError(
            "SOURCE_PROVENANCE_CONFLICT",
            "The selected discovery is not a live source for this Job.",
          );
        }
      }

      const parsed = parseJobDiscovery(discovery);
      const draft = await tx.jobParseDraft.create({
        data: {
          userId,
          discoveryId: discovery.id,
          batchId: discovery.batchId,
          sourceDiscoveryRef: discovery.id,
          sourceBatchRef: discovery.batchId,
          targetJobId: targetJob?.id,
          baseJobVersion: targetJob?.version,
          parserVersion: JOB_PARSER_VERSION,
          contractVersion: JOB_CONTRACT_VERSION,
          sourcePayloadHash: parsed.sourcePayloadHash,
          parsedPayload: json(parsed.parsedPayload),
          validationSummary: json(parsed.validationSummary),
          fieldProvenance: json(parsed.fieldProvenance),
          userCorrections: json(parsed.initialCorrections),
        },
      });
      await tx.jobParsingEvent.create({
        data: {
          userId,
          parseDraftId: draft.id,
          eventType: "PARSE_DRAFT_CREATED",
          newStatus: "READY_FOR_REVIEW",
          safeMetadata: json({
            parserVersion: JOB_PARSER_VERSION,
            contractVersion: JOB_CONTRACT_VERSION,
            parserMode: parsed.validationSummary.parserMode,
            warningCodes: parsed.validationSummary.warningCodes,
          }),
        },
      });
      return draft;
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await getParseDraftForDiscovery(userId, discoveryId);
    if (existing) {
      if ((existing.targetJobId ?? undefined) !== targetJobId) {
        throw new JobParsingError(
          "SOURCE_PROVENANCE_CONFLICT",
          "This discovery already has an active review draft.",
        );
      }
      return existing;
    }
    throw error;
  }
}

async function getParseDraftForDiscovery(userId: string, discoveryId: string) {
  const drafts = await listReviewDrafts(userId);
  return drafts.find((draft) => draft.discoveryId === discoveryId) ?? null;
}

export async function updateJobParseDraft(userId: string, id: string, untrustedInput: unknown) {
  const { expectedVersion, correction } = draftCorrectionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobParseDraft.findUnique({ where: { id_userId: { id, userId } } });
    if (!current) throw new JobParsingError("PARSE_DRAFT_NOT_FOUND", "Parse draft not found.");
    if (current.status !== "READY_FOR_REVIEW") {
      throw new JobParsingError("INVALID_PARSE_DRAFT", "This parse draft is no longer editable.");
    }
    if (current.version !== expectedVersion) {
      throw new JobParsingError(
        "VERSION_CONFLICT",
        "The parse draft changed. Reload and try again.",
      );
    }
    const parsed = current.parsedPayload as { job?: unknown };
    const parsedValues = jobValuesSchema.parse(parsed.job);
    const fieldProvenance = buildCorrectedProvenance(
      parsedValues,
      correction.values,
      current.fieldProvenance,
    );
    const rows = await tx.jobParseDraft.updateMany({
      where: { id, userId, status: "READY_FOR_REVIEW", version: expectedVersion },
      data: {
        userCorrections: json(correction),
        fieldProvenance: json(fieldProvenance),
        version: { increment: 1 },
      },
    });
    if (rows.count !== 1) {
      throw new JobParsingError(
        "VERSION_CONFLICT",
        "The parse draft changed. Reload and try again.",
      );
    }
    const updated = await tx.jobParseDraft.findUniqueOrThrow({
      where: { id_userId: { id, userId } },
    });
    const changedFields = JOB_FIELD_NAMES.filter(
      (field) => JSON.stringify(parsedValues[field]) !== JSON.stringify(correction.values[field]),
    );
    await tx.jobParsingEvent.create({
      data: {
        userId,
        parseDraftId: id,
        eventType: "PARSE_DRAFT_CORRECTED",
        previousStatus: "READY_FOR_REVIEW",
        newStatus: "READY_FOR_REVIEW",
        safeMetadata: json({
          versionFrom: expectedVersion,
          versionTo: updated.version,
          changedFields,
        }),
      },
    });
    return updated;
  });
}

export async function rejectJobParseDraft(userId: string, id: string, untrustedInput: unknown) {
  const { expectedVersion } = draftTransitionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobParseDraft.findUnique({ where: { id_userId: { id, userId } } });
    if (!current) throw new JobParsingError("PARSE_DRAFT_NOT_FOUND", "Parse draft not found.");
    if (current.status !== "READY_FOR_REVIEW" || current.version !== expectedVersion) {
      throw new JobParsingError(
        "VERSION_CONFLICT",
        "The parse draft changed. Reload and try again.",
      );
    }
    const updated = await tx.jobParseDraft.update({
      where: { id_userId: { id, userId } },
      data: { status: "REJECTED", rejectedAt: new Date(), version: { increment: 1 } },
    });
    await tx.jobParsingEvent.create({
      data: {
        userId,
        parseDraftId: id,
        eventType: "PARSE_DRAFT_REJECTED",
        previousStatus: "READY_FOR_REVIEW",
        newStatus: "REJECTED",
        safeMetadata: json({ versionFrom: expectedVersion, versionTo: updated.version }),
      },
    });
    return updated;
  });
}

function confirmationHash(input: object) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function mergeProvenance(
  current: Prisma.JsonValue,
  proposed: Prisma.JsonValue,
  selected: readonly JobFieldName[],
) {
  const currentFields = (current as { fields?: Record<string, unknown> }).fields ?? {};
  const proposedFields = (proposed as { fields?: Record<string, unknown> }).fields ?? {};
  const fields = { ...currentFields };
  for (const field of selected) fields[field] = proposedFields[field];
  return { schemaVersion: 1, fields };
}

export async function confirmJobParseDraft(userId: string, id: string, untrustedInput: unknown) {
  const input = draftConfirmationSchema.parse(untrustedInput);

  const execute = async () =>
    runSerializableTransaction(async (tx) => {
      const draft = await tx.jobParseDraft.findUnique({
        where: { id_userId: { id, userId } },
        include: {
          discovery: {
            include: {
              batch: { select: { payloadHash: true, contractVersion: true, importMethod: true } },
            },
          },
          source: true,
        },
      });
      if (!draft) throw new JobParsingError("PARSE_DRAFT_NOT_FOUND", "Parse draft not found.");

      const correction = correctionPayloadSchema.parse(draft.userCorrections);
      const proposed = confirmedJobValuesSchema.parse(correction.values);
      const selectedFields = draft.targetJobId ? input.selectedFields : [...JOB_FIELD_NAMES];
      if (draft.targetJobId && selectedFields.length === 0) {
        throw new JobParsingError("INVALID_PARSE_DRAFT", "Select at least one field to update.");
      }
      const hash = confirmationHash({
        draftId: draft.id,
        expectedVersion: input.expectedVersion,
        sourcePayloadHash: draft.sourcePayloadHash,
        targetJobId: draft.targetJobId,
        baseJobVersion: draft.baseJobVersion,
        selectedFields: [...selectedFields].sort(),
        values: proposed,
      });

      const replay = await tx.jobSource.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      if (replay) {
        if (replay.confirmationHash !== hash) {
          throw new JobParsingError(
            "IDEMPOTENCY_CONFLICT",
            "This confirmation key was already used for another confirmation.",
          );
        }
        return tx.job.findUniqueOrThrow({ where: { id_userId: { id: replay.jobId, userId } } });
      }
      if (draft.source) {
        if (draft.source.confirmationHash === hash) {
          return tx.job.findUniqueOrThrow({
            where: { id_userId: { id: draft.source.jobId, userId } },
          });
        }
        throw new JobParsingError(
          "PARSE_ALREADY_CONFIRMED",
          "This parse draft is already confirmed.",
        );
      }
      if (draft.status !== "READY_FOR_REVIEW") {
        throw new JobParsingError("INVALID_PARSE_DRAFT", "This parse draft cannot be confirmed.");
      }
      if (draft.version !== input.expectedVersion) {
        throw new JobParsingError(
          "VERSION_CONFLICT",
          "The parse draft changed. Reload and try again.",
        );
      }
      if (!draft.discovery || draft.discovery.status !== "INBOX") {
        throw new JobParsingError(
          "INVALID_PARSE_DRAFT",
          "Restore the source discovery before confirming this draft.",
        );
      }
      if (hashDiscoveryParsingSource(draft.discovery) !== draft.sourcePayloadHash) {
        throw new JobParsingError(
          "SOURCE_PROVENANCE_CONFLICT",
          "The source no longer matches this parse draft.",
        );
      }

      let job;
      let purpose: "INITIAL_CONFIRMATION" | "REPARSE_MERGE";
      if (!draft.targetJobId) {
        purpose = "INITIAL_CONFIRMATION";
        job = await tx.job.create({
          data: {
            userId,
            ...jobValuesToPersistence(proposed),
            fieldProvenance: json(draft.fieldProvenance),
          },
        });
      } else {
        purpose = "REPARSE_MERGE";
        const current = await tx.job.findUnique({
          where: { id_userId: { id: draft.targetJobId, userId } },
        });
        if (!current) throw new JobParsingError("JOB_NOT_FOUND", "Job not found.");
        if (current.status !== "ACTIVE") {
          throw new JobParsingError(
            "INVALID_JOB_TRANSITION",
            "Restore the Job before updating it.",
          );
        }
        if (current.version !== draft.baseJobVersion) {
          throw new JobParsingError(
            "VERSION_CONFLICT",
            "The Job changed. Create a fresh reparse draft.",
          );
        }
        const merged = mergeSelectedJobFields(
          persistedJobToValues(current),
          proposed,
          selectedFields,
        );
        job = await tx.job.update({
          where: { id_userId: { id: current.id, userId } },
          data: {
            ...jobValuesToPersistence(merged),
            fieldProvenance: json(
              mergeProvenance(current.fieldProvenance, draft.fieldProvenance, selectedFields),
            ),
            version: { increment: 1 },
          },
        });
      }

      const confirmedDraft = await tx.jobParseDraft.update({
        where: { id_userId: { id: draft.id, userId } },
        data: { status: "CONFIRMED", confirmedAt: new Date(), version: { increment: 1 } },
      });
      const source = await tx.jobSource.create({
        data: {
          userId,
          jobId: job.id,
          discoveryId: draft.discoveryId,
          batchId: draft.batchId,
          sourceDiscoveryRef: draft.sourceDiscoveryRef,
          sourceBatchRef: draft.sourceBatchRef,
          parseDraftId: draft.id,
          purpose,
          sourcePayloadHash: draft.sourcePayloadHash,
          parserVersion: draft.parserVersion,
          contractVersion: draft.contractVersion,
          appliedFields: selectedFields,
          confirmedByUserId: userId,
          idempotencyKey: input.idempotencyKey,
          confirmationHash: hash,
        },
      });
      await refreshDuplicateStateForJob(tx, userId, job.id);
      await evaluateJobHardFiltersInTransaction(tx, userId, job.id, userId);
      await tx.jobParsingEvent.createMany({
        data: [
          {
            userId,
            parseDraftId: draft.id,
            jobId: job.id,
            eventType: "PARSE_DRAFT_CONFIRMED",
            previousStatus: "READY_FOR_REVIEW",
            newStatus: "CONFIRMED",
            safeMetadata: json({
              versionFrom: draft.version,
              versionTo: confirmedDraft.version,
              purpose,
            }),
          },
          {
            userId,
            parseDraftId: draft.id,
            jobId: job.id,
            eventType:
              purpose === "INITIAL_CONFIRMATION"
                ? "JOB_CREATED_FROM_DISCOVERY"
                : "JOB_UPDATED_FROM_PARSE",
            safeMetadata: json({
              jobSourceId: source.id,
              appliedFields: selectedFields,
              jobVersion: job.version,
            }),
          },
        ],
      });
      await recordAudit(tx, {
        userId,
        entityType: "JOB",
        entityId: job.id,
        action:
          purpose === "INITIAL_CONFIRMATION"
            ? "JOB_CREATED_FROM_DISCOVERY"
            : "JOB_UPDATED_FROM_PARSE",
        newState: {
          version: job.version,
          status: job.status,
          sourceId: source.id,
          appliedFields: selectedFields,
        },
      });
      return job;
    });

  try {
    return await execute();
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const source = await resolveConfirmationReplay(userId, id, input.idempotencyKey);
    if (source) return source;
    throw error;
  }
}

async function resolveConfirmationReplay(userId: string, draftId: string, idempotencyKey: string) {
  const draft = await getParseDraft(userId, draftId);
  const source = draft?.source;
  if (!source || source.idempotencyKey !== idempotencyKey) return null;
  const { prisma } = await import("@/server/db/client");
  return prisma.job.findUnique({ where: { id_userId: { id: source.jobId, userId } } });
}

export async function redactJobParsingForDiscoveryBatch(
  tx: Prisma.TransactionClient,
  userId: string,
  batchId: string,
) {
  const drafts = await tx.jobParseDraft.findMany({
    where: { userId, sourceBatchRef: batchId },
    include: { source: true },
  });
  for (const draft of drafts) {
    if (!draft.source) {
      await tx.jobParseDraft.delete({ where: { id_userId: { id: draft.id, userId } } });
      continue;
    }
    const now = new Date();
    await tx.jobSource.update({
      where: { parseDraftId: draft.id },
      data: { discoveryId: null, batchId: null, sourcePurgedAt: now },
    });
    await tx.jobParseDraft.update({
      where: { id_userId: { id: draft.id, userId } },
      data: {
        discoveryId: null,
        batchId: null,
        contentPurgedAt: now,
        parsedPayload: json({ schemaVersion: 1, purged: true }),
        validationSummary: json({ schemaVersion: 1, purged: true }),
        fieldProvenance: json({ schemaVersion: 1, purged: true }),
        userCorrections: json({ schemaVersion: 1, purged: true }),
      },
    });
    await tx.jobParsingEvent.create({
      data: {
        userId,
        parseDraftId: draft.id,
        jobId: draft.source.jobId,
        eventType: "PARSE_SOURCE_PRIVACY_REDACTED",
        safeMetadata: json({ sourceId: draft.source.id, reasonCode: "USER_PRIVACY_PURGE" }),
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB",
      entityId: draft.source.jobId,
      action: "JOB_SOURCE_PRIVACY_REDACTED",
      newState: { sourceId: draft.source.id, reasonCode: "USER_PRIVACY_PURGE" },
    });
  }
}
