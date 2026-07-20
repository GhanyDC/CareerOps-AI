import "server-only";

import { createHash } from "node:crypto";

import type {
  JobCanonicalRepresentation,
  JobDuplicateCandidate,
  Prisma,
} from "@/generated/prisma/client";
import { refreshCanonicalRepresentation } from "@/modules/job-canonicalization/public.server";
import { recordAudit } from "@/modules/audit/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import {
  countPendingDuplicateReviews,
  getDuplicateCandidateRecord,
  getDuplicateGroupRecord,
  listDuplicateCandidateRecords,
  type DuplicateQueueFilters,
  type DuplicateQueueView,
} from "./repository";
import { evaluateDuplicatePair, orderDuplicatePair, type DuplicateSourceEvidence } from "./rules";
import {
  DUPLICATE_RULE_SET_VERSION,
  duplicateConflictsSchema,
  duplicateDecisionInputSchema,
  duplicateEvidenceSchema,
  duplicatePrimaryInputSchema,
  duplicateScanInputSchema,
} from "./schemas";

const MAX_MATCHES_PER_JOB = 100;

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function requestHash(value: object) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

type LiveSource = Readonly<{
  jobId: string;
  sourceDiscoveryRef: string;
  sourceBatchRef: string;
  sourcePayloadHash: string;
}>;

function sourceEvidence(left: readonly LiveSource[], right: readonly LiveSource[]) {
  const sameLiveSource = left.some((a) =>
    right.some(
      (b) => a.sourceDiscoveryRef === b.sourceDiscoveryRef && a.sourceBatchRef === b.sourceBatchRef,
    ),
  );
  const sameLiveSourceHash = left.some((a) =>
    right.some((b) => a.sourcePayloadHash === b.sourcePayloadHash),
  );
  return { sameLiveSource, sameLiveSourceHash } satisfies DuplicateSourceEvidence;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}

function eventMetadata(input: Record<string, unknown>) {
  return json({ schemaVersion: 1, ...input });
}

async function retireCandidateForArchive(
  tx: Prisma.TransactionClient,
  candidate: JobDuplicateCandidate,
  representation: JobCanonicalRepresentation,
  jobId: string,
) {
  if (!candidate.activeCandidate) return;
  await tx.jobDuplicateCandidate.update({
    where: { id_userId: { id: candidate.id, userId: candidate.userId } },
    data: {
      activeCandidate: false,
      ...(candidate.jobAId === jobId
        ? { jobARepresentationHash: representation.comparisonHash }
        : { jobBRepresentationHash: representation.comparisonHash }),
      evaluatedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await tx.jobDuplicateEvent.create({
    data: {
      userId: candidate.userId,
      candidateId: candidate.id,
      eventType: "CANDIDATE_REEVALUATED",
      safeMetadata: eventMetadata({ activeCandidate: false, reasonCode: "JOB_ARCHIVED" }),
    },
  });
}

export async function refreshDuplicateStateForJob(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const job = await tx.job.findUnique({ where: { id_userId: { id: jobId, userId } } });
  if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
  const { representation } = await refreshCanonicalRepresentation(tx, userId, job);
  const existingCandidates = await tx.jobDuplicateCandidate.findMany({
    where: { userId, OR: [{ jobAId: jobId }, { jobBId: jobId }] },
    orderBy: { id: "asc" },
    take: MAX_MATCHES_PER_JOB,
  });

  if (job.status === "ARCHIVED") {
    for (const candidate of existingCandidates) {
      await retireCandidateForArchive(tx, candidate, representation, jobId);
    }
    return { representation, candidateCount: 0, truncated: false };
  }

  const blocking: Prisma.JobCanonicalRepresentationWhereInput[] = [];
  if (representation.canonicalSourceUrlHash) {
    blocking.push({ canonicalSourceUrlHash: representation.canonicalSourceUrlHash });
  }
  if (representation.companyTitleHash) {
    blocking.push({ companyTitleHash: representation.companyTitleHash });
  }
  if (representation.companyTitleLocationHash) {
    blocking.push({ companyTitleLocationHash: representation.companyTitleLocationHash });
  }

  const blocked =
    blocking.length === 0
      ? []
      : await tx.jobCanonicalRepresentation.findMany({
          where: {
            userId,
            jobId: { not: jobId },
            job: { status: "ACTIVE" },
            OR: blocking,
          },
          orderBy: { jobId: "asc" },
          take: MAX_MATCHES_PER_JOB + 1,
        });
  const currentSources = await tx.jobSource.findMany({
    where: { userId, jobId, sourcePurgedAt: null },
    select: { sourceDiscoveryRef: true, sourceBatchRef: true, sourcePayloadHash: true },
  });
  const sourceBlocks: Prisma.JobSourceWhereInput[] = currentSources.flatMap((source) => [
    {
      sourceDiscoveryRef: source.sourceDiscoveryRef,
      sourceBatchRef: source.sourceBatchRef,
    },
    { sourcePayloadHash: source.sourcePayloadHash },
  ]);
  const sourceBlocked =
    sourceBlocks.length === 0
      ? []
      : await tx.jobSource.findMany({
          where: {
            userId,
            jobId: { not: jobId },
            sourcePurgedAt: null,
            job: { status: "ACTIVE" },
            OR: sourceBlocks,
          },
          select: { jobId: true },
          distinct: ["jobId"],
          orderBy: { jobId: "asc" },
          take: MAX_MATCHES_PER_JOB + 1,
        });
  let truncated =
    blocked.length > MAX_MATCHES_PER_JOB || sourceBlocked.length > MAX_MATCHES_PER_JOB;
  const otherIds = new Set(blocked.slice(0, MAX_MATCHES_PER_JOB).map((item) => item.jobId));
  for (const source of sourceBlocked.slice(0, MAX_MATCHES_PER_JOB)) otherIds.add(source.jobId);
  for (const candidate of existingCandidates) {
    otherIds.add(candidate.jobAId === jobId ? candidate.jobBId : candidate.jobAId);
  }
  truncated ||= otherIds.size > MAX_MATCHES_PER_JOB;
  const others = await tx.jobCanonicalRepresentation.findMany({
    where: { userId, jobId: { in: [...otherIds] }, job: { status: "ACTIVE" } },
    orderBy: { jobId: "asc" },
    take: MAX_MATCHES_PER_JOB,
  });
  const allJobIds = [jobId, ...others.map((item) => item.jobId)];
  const liveSources = await tx.jobSource.findMany({
    where: { userId, jobId: { in: allJobIds }, sourcePurgedAt: null },
    select: {
      jobId: true,
      sourceDiscoveryRef: true,
      sourceBatchRef: true,
      sourcePayloadHash: true,
    },
  });
  const sourcesByJob = new Map<string, LiveSource[]>();
  for (const source of liveSources) {
    const values = sourcesByJob.get(source.jobId) ?? [];
    values.push(source);
    sourcesByJob.set(source.jobId, values);
  }
  const existingByOther = new Map(
    existingCandidates.map((candidate) => [
      candidate.jobAId === jobId ? candidate.jobBId : candidate.jobAId,
      candidate,
    ]),
  );
  const evaluatedOtherIds = new Set<string>();
  let candidateCount = 0;

  for (const other of others) {
    evaluatedOtherIds.add(other.jobId);
    const pair = orderDuplicatePair(jobId, other.jobId);
    const [jobARepresentation, jobBRepresentation] =
      pair.jobAId === jobId ? [representation, other] : [other, representation];
    const evaluation = evaluateDuplicatePair(
      jobARepresentation,
      jobBRepresentation,
      sourceEvidence(sourcesByJob.get(jobId) ?? [], sourcesByJob.get(other.jobId) ?? []),
    );
    const existing = existingByOther.get(other.jobId);
    if (!evaluation.qualifies || evaluation.tier === null) {
      if (existing?.activeCandidate) {
        const shouldStale = existing.decision !== null && !existing.decisionNeedsReview;
        await tx.jobDuplicateCandidate.update({
          where: { id_userId: { id: existing.id, userId } },
          data: {
            activeCandidate: false,
            jobARepresentationHash: jobARepresentation.comparisonHash,
            jobBRepresentationHash: jobBRepresentation.comparisonHash,
            conflicts: json(duplicateConflictsSchema.parse(evaluation.conflicts)),
            ...(shouldStale ? { decisionNeedsReview: true, decisionStaleAt: new Date() } : {}),
            evaluatedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.jobDuplicateEvent.create({
          data: {
            userId,
            candidateId: existing.id,
            eventType: "CANDIDATE_REEVALUATED",
            safeMetadata: eventMetadata({
              activeCandidate: false,
              reasonCode: "RULES_NO_LONGER_MATCH",
            }),
          },
        });
        if (shouldStale) {
          await tx.jobDuplicateEvent.create({
            data: {
              userId,
              candidateId: existing.id,
              eventType: "DUPLICATE_DECISION_MARKED_STALE",
              safeMetadata: eventMetadata({ reasonCode: "EVIDENCE_CHANGED" }),
            },
          });
        }
      }
      continue;
    }

    candidateCount += 1;
    const evidenceTier = evaluation.tier;
    const evidence = duplicateEvidenceSchema.parse(evaluation.evidence);
    const conflicts = duplicateConflictsSchema.parse(evaluation.conflicts);
    if (!existing) {
      let created;
      try {
        created = await tx.jobDuplicateCandidate.create({
          data: {
            userId,
            ...pair,
            evidenceTier,
            ruleSetVersion: DUPLICATE_RULE_SET_VERSION,
            canonicalizationVersion: representation.canonicalizationVersion,
            jobARepresentationHash: jobARepresentation.comparisonHash,
            jobBRepresentationHash: jobBRepresentation.comparisonHash,
            evidence: json(evidence),
            conflicts: json(conflicts),
          },
        });
      } catch (error) {
        const uniqueConflict =
          typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
        if (!uniqueConflict) throw error;
        const concurrent = await tx.jobDuplicateCandidate.findUnique({
          where: { userId_jobAId_jobBId: { userId, ...pair } },
        });
        if (!concurrent) throw error;
        continue;
      }
      await tx.jobDuplicateEvent.create({
        data: {
          userId,
          candidateId: created.id,
          eventType: "CANDIDATE_CREATED",
          safeMetadata: eventMetadata({
            tier: evidenceTier,
            ruleCodes: evidence.qualifyingRules.map((item) => item.code),
          }),
        },
      });
      continue;
    }

    const changed =
      !existing.activeCandidate ||
      existing.evidenceTier !== evidenceTier ||
      existing.jobARepresentationHash !== jobARepresentation.comparisonHash ||
      existing.jobBRepresentationHash !== jobBRepresentation.comparisonHash ||
      stableJson(existing.evidence) !== stableJson(evidence) ||
      stableJson(existing.conflicts) !== stableJson(conflicts);
    const jobAVersion = pair.jobAId === jobId ? job.version : other.sourceJobVersion;
    const jobBVersion = pair.jobBId === jobId ? job.version : other.sourceJobVersion;
    if (!changed) {
      if (existing.decision && !existing.decisionNeedsReview) {
        await tx.jobDuplicateCandidate.update({
          where: { id_userId: { id: existing.id, userId } },
          data: { decisionJobAVersion: jobAVersion, decisionJobBVersion: jobBVersion },
        });
      }
      continue;
    }
    const shouldStale = existing.decision !== null && !existing.decisionNeedsReview;
    await tx.jobDuplicateCandidate.update({
      where: { id_userId: { id: existing.id, userId } },
      data: {
        activeCandidate: true,
        evidenceTier,
        ruleSetVersion: DUPLICATE_RULE_SET_VERSION,
        canonicalizationVersion: representation.canonicalizationVersion,
        jobARepresentationHash: jobARepresentation.comparisonHash,
        jobBRepresentationHash: jobBRepresentation.comparisonHash,
        evidence: json(evidence),
        conflicts: json(conflicts),
        ...(shouldStale
          ? { decisionNeedsReview: true, decisionStaleAt: new Date() }
          : existing.decision
            ? { decisionJobAVersion: jobAVersion, decisionJobBVersion: jobBVersion }
            : {}),
        evaluatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.jobDuplicateEvent.create({
      data: {
        userId,
        candidateId: existing.id,
        eventType: "CANDIDATE_REEVALUATED",
        safeMetadata: eventMetadata({
          activeCandidate: true,
          tier: evidenceTier,
          ruleCodes: evidence.qualifyingRules.map((item) => item.code),
        }),
      },
    });
    if (shouldStale) {
      await tx.jobDuplicateEvent.create({
        data: {
          userId,
          candidateId: existing.id,
          eventType: "DUPLICATE_DECISION_MARKED_STALE",
          safeMetadata: eventMetadata({ reasonCode: "EVIDENCE_CHANGED" }),
        },
      });
    }
  }

  for (const [otherId, existing] of existingByOther) {
    if (!evaluatedOtherIds.has(otherId) && existing.activeCandidate) {
      const shouldStale = existing.decision !== null && !existing.decisionNeedsReview;
      await tx.jobDuplicateCandidate.update({
        where: { id_userId: { id: existing.id, userId } },
        data: {
          activeCandidate: false,
          ...(shouldStale ? { decisionNeedsReview: true, decisionStaleAt: new Date() } : {}),
          evaluatedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.jobDuplicateEvent.create({
        data: {
          userId,
          candidateId: existing.id,
          eventType: "CANDIDATE_REEVALUATED",
          safeMetadata: eventMetadata({
            activeCandidate: false,
            reasonCode: "OTHER_JOB_UNAVAILABLE",
          }),
        },
      });
    }
  }

  return { representation, candidateCount, truncated };
}

function parseQueueCursor(value?: string) {
  if (!value) return undefined;
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DomainError("The duplicate queue cursor is invalid.", "INVALID_INPUT");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    const updatedAt = new Date(String(parsed.updatedAt));
    if (
      typeof parsed.id !== "string" ||
      parsed.id.length > 100 ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error();
    }
    return { updatedAt, id: parsed.id };
  } catch {
    throw new DomainError("The duplicate queue cursor is invalid.", "INVALID_INPUT");
  }
}

export async function listDuplicateCandidates(
  userId: string,
  input: Omit<DuplicateQueueFilters, "cursor"> & { cursor?: string } = {},
) {
  const pageSize = Math.min(input.pageSize ?? 25, 50);
  const records = await listDuplicateCandidateRecords(userId, {
    ...input,
    cursor: parseQueueCursor(input.cursor),
    pageSize,
  });
  const hasNext = records.length > pageSize;
  const items = records.slice(0, pageSize);
  const last = hasNext ? items.at(-1) : undefined;
  return {
    items,
    nextCursor: last
      ? Buffer.from(
          JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id }),
          "utf8",
        ).toString("base64url")
      : undefined,
  };
}

export async function viewDuplicateCandidate(userId: string, id: string) {
  const candidate = await getDuplicateCandidateRecord(userId, id);
  if (!candidate) {
    throw new DomainError("Duplicate candidate not found.", "DUPLICATE_CANDIDATE_NOT_FOUND");
  }
  return candidate;
}

export async function viewDuplicateGroup(userId: string, id: string) {
  const group = await getDuplicateGroupRecord(userId, id);
  if (!group) throw new DomainError("Duplicate group not found.", "DUPLICATE_GROUP_NOT_FOUND");
  return group;
}

export { countPendingDuplicateReviews };

export async function scanJobsForDuplicates(userId: string, untrustedInput: unknown) {
  const input = duplicateScanInputSchema.parse(untrustedInput);
  const { prisma } = await import("@/server/db/client");
  const jobs = await prisma.job.findMany({
    where: { userId, status: "ACTIVE", ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
    take: input.pageSize + 1,
  });
  const page = jobs.slice(0, input.pageSize);
  let candidateCount = 0;
  let truncated = false;
  for (const job of page) {
    const result = await runSerializableTransaction((tx) =>
      refreshDuplicateStateForJob(tx, userId, job.id),
    );
    candidateCount += result.candidateCount;
    truncated ||= result.truncated;
  }
  return {
    processedJobs: page.length,
    candidateCount,
    truncated,
    nextCursor: jobs.length > input.pageSize ? page.at(-1)?.id : undefined,
  };
}

async function applySameOpportunityGroup(
  tx: Prisma.TransactionClient,
  userId: string,
  candidate: JobDuplicateCandidate,
  primaryJobId: string,
) {
  const memberships = await tx.jobDuplicateGroupMember.findMany({
    where: { userId, jobId: { in: [candidate.jobAId, candidate.jobBId] } },
    include: { group: { include: { members: true } } },
  });
  const groups = [...new Map(memberships.map((item) => [item.group.id, item.group])).values()];
  const memberIds = new Set([candidate.jobAId, candidate.jobBId]);
  for (const group of groups) for (const member of group.members) memberIds.add(member.jobId);
  if (!memberIds.has(primaryJobId)) {
    throw new DomainError(
      "Select a Job from the resulting group as primary.",
      "INVALID_PRIMARY_JOB",
    );
  }

  if (groups.length === 0) {
    const group = await tx.jobDuplicateGroup.create({ data: { userId, primaryJobId } });
    await tx.jobDuplicateGroupMember.createMany({
      data: [...memberIds].map((jobId) => ({ groupId: group.id, userId, jobId })),
    });
    return { groupId: group.id, operation: "CREATED", absorbedGroupId: null } as const;
  }

  let target = groups.find((group) =>
    group.members.some((member) => member.jobId === primaryJobId),
  );
  target ??= groups[0];
  if (!target) throw new DomainError("Duplicate group not found.", "DUPLICATE_GROUP_NOT_FOUND");
  const absorbed = groups.find((group) => group.id !== target.id);
  if (absorbed) {
    const absorbedMemberIds = absorbed.members.map((member) => member.jobId);
    await tx.jobDuplicateGroupMember.deleteMany({ where: { userId, groupId: absorbed.id } });
    await tx.jobDuplicateGroupMember.createMany({
      data: absorbedMemberIds.map((jobId) => ({ groupId: target!.id, userId, jobId })),
      skipDuplicates: true,
    });
    await tx.jobDuplicateGroup.delete({ where: { id_userId: { id: absorbed.id, userId } } });
  }
  await tx.jobDuplicateGroupMember.createMany({
    data: [...memberIds].map((jobId) => ({ groupId: target.id, userId, jobId })),
    skipDuplicates: true,
  });
  await tx.jobDuplicateGroup.update({
    where: { id_userId: { id: target.id, userId } },
    data: { primaryJobId, version: { increment: 1 } },
  });
  return {
    groupId: target.id,
    operation: absorbed ? "MERGED" : "UPDATED",
    absorbedGroupId: absorbed?.id ?? null,
  } as const;
}

function graphComponents(
  memberIds: readonly string[],
  edges: readonly { jobAId: string; jobBId: string }[],
) {
  const adjacency = new Map(memberIds.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.jobAId)?.add(edge.jobBId);
    adjacency.get(edge.jobBId)?.add(edge.jobAId);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of memberIds) {
    if (seen.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component.sort());
  }
  return components;
}

async function rebuildGroupAfterSameDecisionRemoved(
  tx: Prisma.TransactionClient,
  userId: string,
  groupId: string | undefined,
  splitPrimaryJobIds: readonly string[],
) {
  if (!groupId) return { operation: "UNCHANGED", groupIds: [] as string[] } as const;
  const group = await tx.jobDuplicateGroup.findUnique({
    where: { id_userId: { id: groupId, userId } },
    include: { members: true },
  });
  if (!group) return { operation: "UNCHANGED", groupIds: [] as string[] } as const;
  const memberIds = group.members.map((member) => member.jobId).sort();
  const edges = await tx.jobDuplicateCandidate.findMany({
    where: {
      userId,
      decision: "SAME_OPPORTUNITY",
      jobAId: { in: memberIds },
      jobBId: { in: memberIds },
    },
    select: { jobAId: true, jobBId: true },
  });
  const components = graphComponents(memberIds, edges);
  if (components.length === 1) return { operation: "UNCHANGED", groupIds: [group.id] } as const;

  const selections = new Set(splitPrimaryJobIds);
  const plans = components
    .filter((component) => component.length > 1)
    .map((component) => {
      const primary = component.includes(group.primaryJobId)
        ? group.primaryJobId
        : component.find((id) => selections.has(id));
      if (!primary) {
        throw new DomainError(
          "Select a primary Job for every group created by this decision change.",
          "INVALID_PRIMARY_JOB",
        );
      }
      return { component, primary };
    });
  await tx.jobDuplicateGroupMember.deleteMany({ where: { userId, groupId: group.id } });
  await tx.jobDuplicateGroup.delete({ where: { id_userId: { id: group.id, userId } } });
  const groupIds: string[] = [];
  for (const plan of plans) {
    const created = await tx.jobDuplicateGroup.create({
      data: { userId, primaryJobId: plan.primary },
    });
    await tx.jobDuplicateGroupMember.createMany({
      data: plan.component.map((jobId) => ({ groupId: created.id, userId, jobId })),
    });
    groupIds.push(created.id);
  }
  return { operation: "SPLIT", groupIds } as const;
}

export async function recordDuplicateDecision(
  userId: string,
  candidateId: string,
  untrustedInput: unknown,
) {
  const input = duplicateDecisionInputSchema.parse(untrustedInput);
  const hash = requestHash({
    candidateId,
    ...input,
    splitPrimaryJobIds: [...input.splitPrimaryJobIds].sort(),
  });
  return runSerializableTransaction(async (tx) => {
    const replay = await tx.jobDuplicateEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (replay) {
      if (replay.requestHash !== hash) {
        throw new DomainError(
          "This decision key was already used for another request.",
          "IDEMPOTENCY_CONFLICT",
        );
      }
      return tx.jobDuplicateCandidate.findUniqueOrThrow({
        where: { id_userId: { id: candidateId, userId } },
      });
    }
    const candidate = await tx.jobDuplicateCandidate.findUnique({
      where: { id_userId: { id: candidateId, userId } },
      include: {
        jobA: { include: { canonicalRepresentation: true, duplicateGroupMembership: true } },
        jobB: { include: { canonicalRepresentation: true, duplicateGroupMembership: true } },
      },
    });
    if (!candidate) {
      throw new DomainError("Duplicate candidate not found.", "DUPLICATE_CANDIDATE_NOT_FOUND");
    }
    if (!candidate.activeCandidate && !candidate.decisionNeedsReview) {
      throw new DomainError("This pair is no longer an active duplicate candidate.", "CONFLICT");
    }
    if (candidate.version !== input.expectedVersion) {
      throw new DomainError(
        "The duplicate candidate changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    if (
      !candidate.jobA.canonicalRepresentation ||
      !candidate.jobB.canonicalRepresentation ||
      candidate.jobARepresentationHash !== candidate.jobA.canonicalRepresentation.comparisonHash ||
      candidate.jobBRepresentationHash !== candidate.jobB.canonicalRepresentation.comparisonHash
    ) {
      throw new DomainError(
        "The compared Jobs changed. Reload the duplicate review.",
        "DUPLICATE_DECISION_STALE",
      );
    }
    if (input.decision === "SAME_OPPORTUNITY" && !input.primaryJobId) {
      throw new DomainError("Select the primary Job.", "INVALID_PRIMARY_JOB");
    }
    const previousDecision = candidate.decision;
    const previousGroupId =
      candidate.jobA.duplicateGroupMembership?.groupId ??
      candidate.jobB.duplicateGroupMembership?.groupId;
    const updated = await tx.jobDuplicateCandidate.update({
      where: { id_userId: { id: candidate.id, userId } },
      data: {
        decision: input.decision,
        decisionActorUserId: userId,
        decisionAt: new Date(),
        decisionRuleSetVersion: candidate.ruleSetVersion,
        decisionCanonicalizationVersion: candidate.canonicalizationVersion,
        decisionJobAVersion: candidate.jobA.version,
        decisionJobBVersion: candidate.jobB.version,
        decisionNeedsReview: false,
        decisionStaleAt: null,
        version: { increment: 1 },
      },
    });

    let groupChange:
      | Awaited<ReturnType<typeof applySameOpportunityGroup>>
      | Awaited<ReturnType<typeof rebuildGroupAfterSameDecisionRemoved>>
      | null = null;
    if (input.decision === "SAME_OPPORTUNITY") {
      groupChange = await applySameOpportunityGroup(tx, userId, updated, input.primaryJobId!);
    } else if (previousDecision === "SAME_OPPORTUNITY") {
      groupChange = await rebuildGroupAfterSameDecisionRemoved(
        tx,
        userId,
        previousGroupId,
        input.splitPrimaryJobIds,
      );
    }

    await tx.jobDuplicateEvent.create({
      data: {
        userId,
        candidateId,
        eventType: "DUPLICATE_DECISION_RECORDED",
        actorUserId: userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        previousDecision,
        newDecision: input.decision,
        safeMetadata: eventMetadata({
          versionFrom: candidate.version,
          versionTo: updated.version,
          groupChanged: groupChange !== null,
        }),
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_DUPLICATE_CANDIDATE",
      entityId: candidate.id,
      action: "JOB_DUPLICATE_DECISION_RECORDED",
      previousState: { decision: previousDecision, version: candidate.version },
      newState: { decision: input.decision, version: updated.version },
    });
    if (groupChange) {
      await tx.jobDuplicateEvent.create({
        data: {
          userId,
          candidateId,
          eventType: "DUPLICATE_GROUP_CHANGED",
          actorUserId: userId,
          safeMetadata: eventMetadata(groupChange),
        },
      });
      await recordAudit(tx, {
        userId,
        entityType: "JOB_DUPLICATE_GROUP",
        entityId:
          "groupId" in groupChange
            ? groupChange.groupId
            : (groupChange.groupIds[0] ?? candidate.id),
        action: "JOB_DUPLICATE_GROUP_CHANGED",
        newState: { operation: groupChange.operation },
      });
    }
    return updated;
  });
}

export async function selectDuplicateGroupPrimary(
  userId: string,
  groupId: string,
  untrustedInput: unknown,
) {
  const input = duplicatePrimaryInputSchema.parse(untrustedInput);
  const hash = requestHash({ groupId, ...input });
  return runSerializableTransaction(async (tx) => {
    const replay = await tx.jobDuplicateEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (replay) {
      if (replay.requestHash !== hash) {
        throw new DomainError(
          "This primary-selection key was already used for another request.",
          "IDEMPOTENCY_CONFLICT",
        );
      }
      return tx.jobDuplicateGroup.findUniqueOrThrow({
        where: { id_userId: { id: groupId, userId } },
      });
    }
    const group = await tx.jobDuplicateGroup.findUnique({
      where: { id_userId: { id: groupId, userId } },
    });
    if (!group) throw new DomainError("Duplicate group not found.", "DUPLICATE_GROUP_NOT_FOUND");
    if (group.version !== input.expectedVersion) {
      throw new DomainError(
        "The duplicate group changed. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }
    const member = await tx.jobDuplicateGroupMember.findUnique({
      where: { jobId_userId: { jobId: input.primaryJobId, userId } },
    });
    if (!member || member.groupId !== group.id) {
      throw new DomainError("Select a Job in this group as primary.", "INVALID_PRIMARY_JOB");
    }
    const updated = await tx.jobDuplicateGroup.update({
      where: { id_userId: { id: group.id, userId } },
      data: { primaryJobId: input.primaryJobId, version: { increment: 1 } },
    });
    await tx.jobDuplicateEvent.create({
      data: {
        userId,
        eventType: "DUPLICATE_GROUP_CHANGED",
        actorUserId: userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        safeMetadata: eventMetadata({
          operation: "PRIMARY_SELECTED",
          groupId,
          versionFrom: group.version,
          versionTo: updated.version,
        }),
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "JOB_DUPLICATE_GROUP",
      entityId: group.id,
      action: "JOB_DUPLICATE_GROUP_CHANGED",
      previousState: { primaryJobId: group.primaryJobId, version: group.version },
      newState: { primaryJobId: updated.primaryJobId, version: updated.version },
    });
    return updated;
  });
}

export async function reevaluateDuplicatesForPurgedBatch(
  tx: Prisma.TransactionClient,
  userId: string,
  batchId: string,
) {
  const affected = await tx.jobSource.findMany({
    where: { userId, sourceBatchRef: batchId },
    select: { jobId: true },
    distinct: ["jobId"],
  });
  for (const source of affected) {
    await refreshDuplicateStateForJob(tx, userId, source.jobId);
  }
}

export const DUPLICATE_QUEUE_VIEWS = [
  "PENDING",
  "DEFERRED",
  "SAME_OPPORTUNITY",
  "DIFFERENT_OPPORTUNITIES",
  "STALE",
  "HISTORY",
] as const satisfies readonly DuplicateQueueView[];
