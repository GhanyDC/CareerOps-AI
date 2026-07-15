import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { verifyDiscoveryPreviewToken } from "@/modules/discovery/preview-token.server";
import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
import {
  confirmDiscoveryImport,
  previewDiscoveryImport,
  purgeDiscoveryImportBatch,
  transitionJobDiscovery,
  viewDiscoveryImportBatch,
  viewJobDiscovery,
} from "@/modules/discovery/use-cases";

const token = randomUUID();
const userAId = `discovery-user-a-${token}`;
const userBId = `discovery-user-b-${token}`;
const contextA = {
  userId: userAId,
  sessionId: `session-a-${token}`,
  identityMode: "authenticated",
} as const;
const contextB = {
  userId: userBId,
  sessionId: `session-b-${token}`,
  identityMode: "authenticated",
} as const;

let client: PrismaClient;

function manual(rawText: string, sourceUrl = "https://example.com/jobs/1") {
  return {
    contractVersion: 1,
    importMethod: "MANUAL_ENTRY",
    sourceLabel: " LinkedIn  Jobs ",
    sourceUrl,
    titleHint: " Backend  Developer ",
    discoveredAt: "2026-07-13T08:00:00Z",
    rawText,
  } as const;
}

async function confirmed(rawText: string) {
  const preview = previewDiscoveryImport(contextA, manual(rawText));
  return confirmDiscoveryImport(contextA, preview.token);
}

describe("discovery import persistence", () => {
  beforeAll(async () => {
    const env = parseDatabaseEnv(process.env);
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    await client.user.createMany({ data: [{ id: userAId }, { id: userBId }] });
    await client.candidateProfile.create({
      data: { userId: userAId, fullName: "Preserved candidate" },
    });
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.discoveryImportBatch.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.candidateProfile.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await client.$disconnect();
  });

  it("atomically confirms canonical raw content, provenance, summaries, and initial events", async () => {
    const batch = await confirmed("Exact raw\r\ncontent");
    const stored = await client.discoveryImportBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { discoveries: true, processingEvents: true },
    });
    expect(stored.originalPayload).toBe(
      '{"contractVersion":1,"importMethod":"MANUAL_ENTRY","sourceLabel":" LinkedIn  Jobs ","sourceUrl":"https://example.com/jobs/1","titleHint":" Backend  Developer ","discoveredAt":"2026-07-13T08:00:00Z","rawText":"Exact raw\\r\\ncontent"}',
    );
    expect(stored.producerLabel).toBe("Manual Entry");
    expect(stored.confirmedAt).toEqual(stored.createdAt);
    expect(stored.discoveries).toHaveLength(1);
    expect(stored.discoveries[0]).toMatchObject({
      userId: userAId,
      sourceLabel: "LinkedIn Jobs",
      submittedUrl: "https://example.com/jobs/1",
      titleHint: "Backend Developer",
      rawContent: "Exact raw\r\ncontent",
      status: "INBOX",
      version: 1,
    });
    expect(stored.discoveries[0]?.createdAt).toBeInstanceOf(Date);
    expect(stored.discoveries[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(
      stored.confirmedAt.getTime(),
    );
    expect(stored.processingEvents.map((event) => event.eventType).sort()).toEqual([
      "BATCH_CONFIRMED",
      "DISCOVERY_IMPORTED",
    ]);
    expect(
      stored.processingEvents.every(
        (event) => event.createdAt.getTime() >= stored.confirmedAt.getTime(),
      ),
    ).toBe(true);
    expect(JSON.stringify(stored.validationSummary)).not.toContain("Exact raw");
    expect(JSON.stringify(stored.discoveries[0]?.validationSummary)).not.toContain("LinkedIn");
  });

  it("maps structured producer, opportunity source, and top-level discovered time without deduplication", async () => {
    const preview = previewDiscoveryImport(contextA, {
      schemaVersion: 1,
      producerLabel: " ChatGPT  Work ",
      discoveredAt: "2026-07-13T09:30:00+08:00",
      discoveries: [
        { sourceLabel: "JobStreet", rawText: "Same" },
        { sourceLabel: "JobStreet", rawText: "Same" },
      ],
    });
    const batch = await confirmDiscoveryImport(contextA, preview.token);
    const stored = await viewDiscoveryImportBatch(userAId, batch.id);
    expect(stored.producerLabel).toBe("ChatGPT Work");
    expect(stored.discoveries).toHaveLength(2);
    expect(stored.discoveries.every((item) => item.sourceLabel === "JobStreet")).toBe(true);
    expect(
      stored.discoveries.every(
        (item) => item.discoveredAt?.toISOString() === "2026-07-13T01:30:00.000Z",
      ),
    ).toBe(true);
  });

  it("treats exact replay and concurrent confirmation as one batch graph", async () => {
    const preview = previewDiscoveryImport(contextA, manual("Idempotent raw"));
    const first = await confirmDiscoveryImport(contextA, preview.token);
    const replay = await confirmDiscoveryImport(contextA, preview.token);
    expect(replay.id).toBe(first.id);

    const concurrentPreview = previewDiscoveryImport(contextA, manual("Concurrent raw"));
    const [left, right] = await Promise.all([
      confirmDiscoveryImport(contextA, concurrentPreview.token),
      confirmDiscoveryImport(contextA, concurrentPreview.token),
    ]);
    expect(left.id).toBe(right.id);
    expect(await client.jobDiscovery.count({ where: { batchId: left.id } })).toBe(1);
    expect(await client.discoveryProcessingEvent.count({ where: { batchId: left.id } })).toBe(2);
  });

  it("rejects the same key with a different canonical hash", async () => {
    const preview = previewDiscoveryImport(contextA, manual("Original key payload"));
    const signed = verifyDiscoveryPreviewToken(contextA, preview.token);
    await client.discoveryImportBatch.create({
      data: {
        userId: userAId,
        importMethod: "MANUAL_ENTRY",
        producerLabel: "Manual Entry",
        originalPayload: '{"contractVersion":1,"importMethod":"MANUAL_ENTRY","rawText":"Other"}',
        validationSummary: {
          validatorVersion: "discovery-import-v1",
          discoveryCount: 1,
          totalPayloadBytes: Buffer.byteLength(
            '{"contractVersion":1,"importMethod":"MANUAL_ENTRY","rawText":"Other"}',
          ),
        },
        idempotencyKey: signed.idempotencyKey,
        payloadHash: "a".repeat(64),
      },
    });
    await expect(confirmDiscoveryImport(contextA, preview.token)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("enforces user scoping and composite cross-user relationships", async () => {
    const batchA = await confirmed("Owned by A");
    const discoveryA = batchA.discoveries[0]!;
    await expect(viewJobDiscovery(userBId, discoveryA.id)).rejects.toMatchObject({
      code: "DISCOVERY_NOT_FOUND",
    });
    await expect(viewDiscoveryImportBatch(userBId, batchA.id)).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
    });

    const previewB = previewDiscoveryImport(contextB, manual("Owned by B"));
    const batchB = await confirmDiscoveryImport(contextB, previewB.token);
    await expect(
      client.jobDiscovery.create({
        data: {
          userId: userAId,
          batchId: batchB.id,
          rawContent: "Cross-user relation",
          validationSummary: {
            rawContentBytes: Buffer.byteLength("Cross-user relation"),
            urlValidated: false,
            controlCharacterCheck: "PASSED",
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects direct whitespace-only raw insertion at the database boundary", async () => {
    const batch = await confirmed("Constraint parent");
    await expect(
      client.jobDiscovery.create({
        data: {
          userId: userAId,
          batchId: batch.id,
          rawContent: " \t ",
          validationSummary: {
            rawContentBytes: 3,
            urlValidated: false,
            controlCharacterCheck: "PASSED",
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces status transitions, database timestamps, and optimistic versions", async () => {
    const batch = await confirmed("Transition raw");
    const discovery = batch.discoveries[0]!;
    const rejected = await transitionJobDiscovery(userAId, discovery.id, {
      targetStatus: "REJECTED",
      expectedVersion: 1,
    });
    expect(rejected).toMatchObject({ status: "REJECTED", version: 2, archivedAt: null });
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
    await expect(
      transitionJobDiscovery(userAId, discovery.id, {
        targetStatus: "ARCHIVED",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const archived = await transitionJobDiscovery(userAId, discovery.id, {
      targetStatus: "ARCHIVED",
      expectedVersion: 2,
    });
    expect(archived).toMatchObject({ status: "ARCHIVED", version: 3, rejectedAt: null });
    expect(archived.archivedAt).toBeInstanceOf(Date);
  });

  it("atomically purges one batch and retains exactly one metadata-only product audit", async () => {
    const profileBefore = await client.candidateProfile.findUniqueOrThrow({
      where: { userId: userAId },
    });
    const batch = await confirmed("Sensitive accidental value SECRET-MARKER");
    await purgeDiscoveryImportBatch(userAId, batch.id, {
      confirmation: expectedPurgeConfirmation(batch.id),
    });
    expect(await client.discoveryImportBatch.findUnique({ where: { id: batch.id } })).toBeNull();
    expect(await client.jobDiscovery.count({ where: { batchId: batch.id } })).toBe(0);
    expect(await client.discoveryProcessingEvent.count({ where: { batchId: batch.id } })).toBe(0);
    const audits = await client.auditLog.findMany({
      where: { userId: userAId, entityType: "DISCOVERY_IMPORT_BATCH", entityId: batch.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "DISCOVERY_IMPORT_BATCH_PURGED" });
    expect(audits[0]?.newState).toEqual({ discoveryCount: 1, reasonCode: "USER_PRIVACY_PURGE" });
    expect(JSON.stringify(audits[0])).not.toContain("SECRET-MARKER");
    expect(await client.candidateProfile.findUniqueOrThrow({ where: { userId: userAId } })).toEqual(
      profileBefore,
    );
  });

  it("rolls back purge deletion when audit fails and audit when deletion fails", async () => {
    const auditFailureBatch = await confirmed("Audit failure raw");
    await expect(
      purgeDiscoveryImportBatch(
        userAId,
        auditFailureBatch.id,
        { confirmation: expectedPurgeConfirmation(auditFailureBatch.id) },
        {
          recordAudit: async () => {
            throw new Error("controlled audit failure");
          },
          deleteBatch: async () => undefined,
        },
      ),
    ).rejects.toThrow("controlled audit failure");
    expect(
      await client.discoveryImportBatch.findUnique({ where: { id: auditFailureBatch.id } }),
    ).not.toBeNull();

    const deleteFailureBatch = await confirmed("Delete failure raw");
    await expect(
      purgeDiscoveryImportBatch(
        userAId,
        deleteFailureBatch.id,
        { confirmation: expectedPurgeConfirmation(deleteFailureBatch.id) },
        {
          recordAudit,
          deleteBatch: async () => {
            throw new Error("controlled deletion failure");
          },
        },
      ),
    ).rejects.toThrow("controlled deletion failure");
    expect(
      await client.discoveryImportBatch.findUnique({ where: { id: deleteFailureBatch.id } }),
    ).not.toBeNull();
    expect(
      await client.auditLog.count({
        where: { entityType: "DISCOVERY_IMPORT_BATCH", entityId: deleteFailureBatch.id },
      }),
    ).toBe(0);
  });
});
