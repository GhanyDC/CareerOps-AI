import "server-only";

import type { JobDiscovery, JobDiscoveryStatus, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { redactJobParsingForDiscoveryBatch } from "@/modules/job-parsing/public.server";
import { reevaluateDuplicatesForPurgedBatch } from "@/modules/job-duplicates/public.server";
import type { RequestContext } from "@/server/request-context";
import { runSerializableTransaction } from "@/server/db/transaction";

import { prepareDiscoveryImport } from "./canonical-payload";
import {
  batchConfirmedMetadata,
  discoveryImportedMetadata,
  transitionEventType,
  transitionMetadata,
} from "./events";
import { DiscoveryError } from "./errors";
import {
  type DiscoveryInboxFilters,
  countInboxDiscoveries,
  findBatchByIdempotency,
  getDiscoveryBatch,
  getDiscoveryRecord,
  listDiscoveryRecords,
  listOwnedSourceLabels,
} from "./repository";
import {
  MAX_STRUCTURED_INPUT_BYTES,
  discoveryTransitionSchema,
  manualDiscoveryDraftSchema,
  pastedDiscoveryDraftSchema,
  purgeConfirmationSchema,
  structuredDiscoveryImportSchema,
  type DiscoveryDraftV1,
} from "./schemas";
import { createDiscoveryPreviewToken, verifyDiscoveryPreviewToken } from "./preview-token.server";
import { expectedPurgeConfirmation } from "./purge";

export { countInboxDiscoveries, listOwnedSourceLabels };
export type { DiscoveryInboxFilters };

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export function parseStructuredImportText(value: string) {
  if (Buffer.byteLength(value, "utf8") > MAX_STRUCTURED_INPUT_BYTES) {
    throw new DiscoveryError("PAYLOAD_TOO_LARGE", "The structured JSON payload is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DiscoveryError("INVALID_INPUT", "The structured import is not valid JSON.");
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw new DiscoveryError(
      "UNSUPPORTED_CONTRACT_VERSION",
      "Only structured discovery schema version 1 is supported.",
    );
  }
  return structuredDiscoveryImportSchema.parse(parsed);
}

export function parseDiscoveryDraft(untrustedInput: unknown): DiscoveryDraftV1 {
  if (typeof untrustedInput !== "object" || untrustedInput === null) {
    throw new DiscoveryError("INVALID_INPUT", "The discovery draft is invalid.");
  }
  if ("schemaVersion" in untrustedInput) {
    const version = (untrustedInput as { schemaVersion?: unknown }).schemaVersion;
    if (version !== 1) {
      throw new DiscoveryError(
        "UNSUPPORTED_CONTRACT_VERSION",
        "Only discovery contract version 1 is supported.",
      );
    }
    return structuredDiscoveryImportSchema.parse(untrustedInput);
  }
  const candidate = untrustedInput as { contractVersion?: unknown; importMethod?: unknown };
  if (candidate.contractVersion !== 1) {
    throw new DiscoveryError(
      "UNSUPPORTED_CONTRACT_VERSION",
      "Only discovery contract version 1 is supported.",
    );
  }
  return candidate.importMethod === "MANUAL_ENTRY"
    ? manualDiscoveryDraftSchema.parse(untrustedInput)
    : pastedDiscoveryDraftSchema.parse(untrustedInput);
}

export function previewDiscoveryImport(
  context: RequestContext,
  untrustedInput: unknown,
  now = new Date(),
) {
  const draft = parseDiscoveryDraft(untrustedInput);
  const prepared = prepareDiscoveryImport(draft);
  return {
    token: createDiscoveryPreviewToken(context, draft, now),
    preview: prepared,
  };
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function resolveReplay(userId: string, idempotencyKey: string, payloadHash: string) {
  const existing = await findBatchByIdempotency(userId, idempotencyKey);
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) {
    throw new DiscoveryError(
      "IDEMPOTENCY_CONFLICT",
      "This confirmation key was already used for another payload.",
    );
  }
  return existing;
}

export async function confirmDiscoveryImport(context: RequestContext, token: string) {
  const signed = verifyDiscoveryPreviewToken(context, token);
  const prepared = prepareDiscoveryImport(signed.draft);

  try {
    return await runSerializableTransaction(async (tx) => {
      const existing = await tx.discoveryImportBatch.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: context.userId,
            idempotencyKey: signed.idempotencyKey,
          },
        },
        include: { discoveries: true },
      });
      if (existing) {
        if (existing.payloadHash !== prepared.payloadHash) {
          throw new DiscoveryError(
            "IDEMPOTENCY_CONFLICT",
            "This confirmation key was already used for another payload.",
          );
        }
        return existing;
      }

      const batch = await tx.discoveryImportBatch.create({
        data: {
          userId: context.userId,
          importMethod: prepared.importMethod,
          producerLabel: prepared.producerLabel,
          contractVersion: prepared.contractVersion,
          originalPayload: prepared.originalPayload,
          validationSummary: json(prepared.validationSummary),
          idempotencyKey: signed.idempotencyKey,
          payloadHash: prepared.payloadHash,
        },
      });

      const discoveries = [];
      for (const discovery of prepared.discoveries) {
        const created = await tx.jobDiscovery.create({
          data: {
            userId: context.userId,
            batchId: batch.id,
            sourceLabel: discovery.sourceLabel,
            submittedUrl: discovery.submittedUrl,
            titleHint: discovery.titleHint,
            companyHint: discovery.companyHint,
            locationHint: discovery.locationHint,
            discoveredAt: discovery.discoveredAt,
            rawContent: discovery.rawContent,
            validationSummary: json(discovery.validationSummary),
          },
        });
        discoveries.push(created);
      }

      await tx.discoveryProcessingEvent.create({
        data: {
          userId: context.userId,
          batchId: batch.id,
          eventType: "BATCH_CONFIRMED",
          safeMetadata: batchConfirmedMetadata(1, discoveries.length),
        },
      });
      for (const discovery of discoveries) {
        await tx.discoveryProcessingEvent.create({
          data: {
            userId: context.userId,
            batchId: batch.id,
            discoveryId: discovery.id,
            eventType: "DISCOVERY_IMPORTED",
            newStatus: "INBOX",
            safeMetadata: discoveryImportedMetadata(),
          },
        });
      }
      return { ...batch, discoveries };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await resolveReplay(context.userId, signed.idempotencyKey, prepared.payloadHash);
    if (replay) return replay;
    throw error;
  }
}

function parseCursor(value?: string) {
  if (!value) return undefined;
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DiscoveryError("INVALID_INPUT", "The inbox cursor is invalid.");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).sort().join(",") !== "createdAt,id"
    ) {
      throw new Error();
    }
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    const date = new Date(String(createdAt));
    if (typeof id !== "string" || id.length > 100 || Number.isNaN(date.getTime()))
      throw new Error();
    return { createdAt: date, id };
  } catch {
    throw new DiscoveryError("INVALID_INPUT", "The inbox cursor is invalid.");
  }
}

export async function listDiscoveryInbox(
  userId: string,
  input: Omit<DiscoveryInboxFilters, "cursor"> & { cursor?: string } = {},
) {
  const pageSize = Math.min(input.pageSize ?? 25, 50);
  const records = await listDiscoveryRecords(userId, {
    ...input,
    cursor: parseCursor(input.cursor),
    pageSize,
  });
  const hasNext = records.length > pageSize;
  const items = records.slice(0, pageSize);
  const last = hasNext ? items.at(-1) : undefined;
  const nextCursor = last
    ? Buffer.from(
        JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
        "utf8",
      ).toString("base64url")
    : undefined;
  return { items, nextCursor };
}

export async function viewJobDiscovery(userId: string, id: string) {
  const discovery = await getDiscoveryRecord(userId, id);
  if (!discovery) throw new DiscoveryError("DISCOVERY_NOT_FOUND", "Discovery not found.");
  return discovery;
}

export async function viewDiscoveryImportBatch(userId: string, id: string) {
  const batch = await getDiscoveryBatch(userId, id);
  if (!batch) throw new DiscoveryError("BATCH_NOT_FOUND", "Import batch not found.");
  return batch;
}

const allowedTransitions: Record<JobDiscoveryStatus, readonly JobDiscoveryStatus[]> = {
  INBOX: ["REJECTED", "ARCHIVED"],
  REJECTED: ["INBOX", "ARCHIVED"],
  ARCHIVED: ["INBOX"],
};

type TransitionRow = JobDiscovery;

export async function transitionJobDiscovery(userId: string, id: string, untrustedInput: unknown) {
  const { targetStatus, expectedVersion } = discoveryTransitionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.jobDiscovery.findUnique({ where: { id_userId: { id, userId } } });
    if (!current) throw new DiscoveryError("DISCOVERY_NOT_FOUND", "Discovery not found.");
    if (current.version !== expectedVersion) {
      throw new DiscoveryError("VERSION_CONFLICT", "The discovery changed. Reload and try again.");
    }
    if (!allowedTransitions[current.status].includes(targetStatus)) {
      throw new DiscoveryError(
        "INVALID_STATUS_TRANSITION",
        `Discovery cannot move from ${current.status} to ${targetStatus}.`,
      );
    }

    const rows = await tx.$queryRaw<TransitionRow[]>`
      UPDATE "JobDiscovery"
      SET
        "status" = ${targetStatus}::"JobDiscoveryStatus",
        "version" = "version" + 1,
        "rejectedAt" = CASE WHEN ${targetStatus} = 'REJECTED' THEN CURRENT_TIMESTAMP ELSE NULL END,
        "archivedAt" = CASE WHEN ${targetStatus} = 'ARCHIVED' THEN CURRENT_TIMESTAMP ELSE NULL END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
        AND "userId" = ${userId}
        AND "status" = ${current.status}::"JobDiscoveryStatus"
        AND "version" = ${expectedVersion}
      RETURNING *
    `;
    const updated = rows[0];
    if (!updated) {
      throw new DiscoveryError("VERSION_CONFLICT", "The discovery changed. Reload and try again.");
    }
    await tx.discoveryProcessingEvent.create({
      data: {
        userId,
        batchId: current.batchId,
        discoveryId: id,
        eventType: transitionEventType(current.status, targetStatus),
        previousStatus: current.status,
        newStatus: targetStatus,
        safeMetadata: transitionMetadata(current.version, updated.version),
      },
    });
    return updated;
  });
}

export async function purgeDiscoveryImportBatch(
  userId: string,
  batchId: string,
  untrustedInput: unknown,
  dependencies: {
    recordAudit: (
      tx: Prisma.TransactionClient,
      input: Parameters<typeof recordAudit>[1],
    ) => PromiseLike<unknown>;
    deleteBatch: (
      tx: Prisma.TransactionClient,
      input: { id: string; userId: string },
    ) => PromiseLike<unknown>;
    redactParsing?: (
      tx: Prisma.TransactionClient,
      userId: string,
      batchId: string,
    ) => PromiseLike<unknown>;
    reevaluateDuplicates?: (
      tx: Prisma.TransactionClient,
      userId: string,
      batchId: string,
    ) => PromiseLike<unknown>;
  } = {
    recordAudit: (tx, input) => recordAudit(tx, input),
    deleteBatch: (tx, input) =>
      tx.discoveryImportBatch.delete({
        where: { id_userId: input },
      }),
    redactParsing: redactJobParsingForDiscoveryBatch,
    reevaluateDuplicates: reevaluateDuplicatesForPurgedBatch,
  },
) {
  const { confirmation } = purgeConfirmationSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const batch = await tx.discoveryImportBatch.findUnique({
      where: { id_userId: { id: batchId, userId } },
      include: { _count: { select: { discoveries: true } } },
    });
    if (!batch) throw new DiscoveryError("BATCH_NOT_FOUND", "Import batch not found.");
    if (confirmation !== expectedPurgeConfirmation(batch.id)) {
      throw new DiscoveryError(
        "INVALID_PURGE_CONFIRMATION",
        "The privacy-purge confirmation phrase does not match.",
      );
    }
    await dependencies.redactParsing?.(tx, userId, batch.id);
    await dependencies.reevaluateDuplicates?.(tx, userId, batch.id);
    await dependencies.recordAudit(tx, {
      userId,
      entityType: "DISCOVERY_IMPORT_BATCH",
      entityId: batch.id,
      action: "DISCOVERY_IMPORT_BATCH_PURGED",
      newState: {
        discoveryCount: batch._count.discoveries,
        reasonCode: "USER_PRIVACY_PURGE",
      },
    });
    await dependencies.deleteBatch(tx, { id: batch.id, userId });
    return { id: batch.id, discoveryCount: batch._count.discoveries };
  });
}
