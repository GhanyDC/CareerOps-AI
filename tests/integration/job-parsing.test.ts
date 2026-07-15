import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/config/env.schema";
import { PrismaClient } from "@/generated/prisma/client";
import {
  previewDiscoveryImport,
  confirmDiscoveryImport,
  purgeDiscoveryImportBatch,
} from "@/modules/discovery/use-cases";
import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
import {
  confirmJobParseDraft,
  createJobParseDraft,
  updateJobParseDraft,
  viewParseDraft,
} from "@/modules/job-parsing/use-cases";
import { emptyJobValues, persistedJobToValues } from "@/modules/jobs/schemas";
import { updateJob, viewJob } from "@/modules/jobs/use-cases";

const run = randomUUID();
const userAId = `job-parsing-a-${run}`;
const userBId = `job-parsing-b-${run}`;
const contextA = {
  userId: userAId,
  sessionId: `session-a-${run}`,
  identityMode: "authenticated" as const,
};
let client: PrismaClient;
let batchId: string;
let discoveryId: string;
let jobId: string;

function correction(title: string, companyName: string) {
  const values = { ...emptyJobValues(), title, companyName, locationLabel: "Remote" };
  return { schemaVersion: 1 as const, rawInput: { title, companyName }, values };
}

describe("Job parsing and authoritative records", () => {
  beforeAll(async () => {
    const env = parseDatabaseEnv(process.env);
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    await client.user.createMany({ data: [{ id: userAId }, { id: userBId }] });
    const preview = previewDiscoveryImport(contextA, {
      contractVersion: 1,
      importMethod: "PASTED_TEXT",
      titleHint: "Backend Developer",
      companyHint: "Example Company",
      locationHint: "Remote",
      rawText: "Unstructured raw source that must not become authoritative automatically.",
    });
    const batch = await confirmDiscoveryImport(contextA, preview.token);
    batchId = batch.id;
    discoveryId = batch.discoveries[0]!.id;
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.discoveryImportBatch.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await client.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await client.$disconnect();
  });

  it("creates a review draft without creating an authoritative Job", async () => {
    const draft = await createJobParseDraft(userAId, discoveryId);
    expect(draft.status).toBe("READY_FOR_REVIEW");
    expect(await client.job.count({ where: { userId: userAId } })).toBe(0);
    expect(await client.jobParsingEvent.count({ where: { parseDraftId: draft.id } })).toBe(1);
    await expect(viewParseDraft(userBId, draft.id)).rejects.toMatchObject({
      code: "PARSE_DRAFT_NOT_FOUND",
    });
  });

  it("preserves corrections and atomically confirms Job, source, events, and audit", async () => {
    const draft = await client.jobParseDraft.findFirstOrThrow({
      where: { userId: userAId, discoveryId },
    });
    const corrected = await updateJobParseDraft(userAId, draft.id, {
      expectedVersion: draft.version,
      correction: correction("Corrected Backend Engineer", "Corrected Company"),
    });
    const key = randomUUID();
    const job = await confirmJobParseDraft(userAId, draft.id, {
      expectedVersion: corrected.version,
      idempotencyKey: key,
      reviewed: true,
      selectedFields: [],
    });
    jobId = job.id;
    expect(job).toMatchObject({
      title: "Corrected Backend Engineer",
      companyName: "Corrected Company",
      version: 1,
    });
    expect(await client.jobSource.count({ where: { jobId } })).toBe(1);
    expect(await client.jobParsingEvent.count({ where: { parseDraftId: draft.id } })).toBe(4);
    expect(
      await client.auditLog.count({
        where: { entityType: "JOB", entityId: jobId, action: "JOB_CREATED_FROM_DISCOVERY" },
      }),
    ).toBe(1);

    const replay = await confirmJobParseDraft(userAId, draft.id, {
      expectedVersion: corrected.version,
      idempotencyKey: key,
      reviewed: true,
      selectedFields: [],
    });
    expect(replay.id).toBe(job.id);
    expect(await client.job.count({ where: { userId: userAId } })).toBe(1);
  });

  it("reparse merges only explicitly selected fields", async () => {
    const draft = await createJobParseDraft(userAId, discoveryId, jobId);
    const corrected = await updateJobParseDraft(userAId, draft.id, {
      expectedVersion: draft.version,
      correction: correction("Reparsed title", "Must not overwrite"),
    });
    const updated = await confirmJobParseDraft(userAId, draft.id, {
      expectedVersion: corrected.version,
      idempotencyKey: randomUUID(),
      reviewed: true,
      selectedFields: ["title"],
    });
    expect(updated).toMatchObject({
      title: "Reparsed title",
      companyName: "Corrected Company",
      version: 2,
    });
    expect(await client.jobSource.count({ where: { jobId } })).toBe(2);
  });

  it("preserves unchanged field provenance during an authoritative edit", async () => {
    const current = await client.job.findUniqueOrThrow({ where: { id: jobId } });
    const previousFields = (current.fieldProvenance as { fields: Record<string, unknown> }).fields;
    const updated = await updateJob(userAId, jobId, current.version, {
      ...persistedJobToValues(current),
      notes: "Reviewed directly in the authoritative record.",
    });
    const fields = (updated.fieldProvenance as { fields: Record<string, unknown> }).fields;
    expect(fields.title).toEqual(previousFields.title);
    expect(fields.notes).toMatchObject({
      origin: "AUTHORITATIVE_EDIT",
      sourceKind: "AUTHORITATIVE_JOB",
      userModified: true,
    });
    const audit = await client.auditLog.findFirstOrThrow({
      where: { userId: userAId, entityId: jobId, action: "JOB_UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.newState).toMatchObject({ changedFields: ["notes"] });
  });

  it("rejects a direct authoritative Job without provenance", async () => {
    await expect(
      client.job.create({
        data: {
          userId: userAId,
          title: "Unproven Job",
          fieldProvenance: { schemaVersion: 1, fields: {} },
        },
      }),
    ).rejects.toThrow();
  });

  it("privacy-purges raw source content while retaining redacted provenance and Job", async () => {
    await purgeDiscoveryImportBatch(userAId, batchId, {
      confirmation: expectedPurgeConfirmation(batchId),
    });
    const job = await viewJob(userAId, jobId);
    expect(job.title).toBe("Reparsed title");
    expect(job.sources).toHaveLength(2);
    expect(
      job.sources.every((source) => source.discoveryId === null && source.sourcePurgedAt),
    ).toBe(true);
    const drafts = await client.jobParseDraft.findMany({ where: { userId: userAId } });
    expect(drafts.every((draft) => draft.discoveryId === null && draft.contentPurgedAt)).toBe(true);
    expect(JSON.stringify(drafts)).not.toContain("Corrected Backend Engineer");
    expect(await client.discoveryImportBatch.findUnique({ where: { id: batchId } })).toBeNull();
  });
});
