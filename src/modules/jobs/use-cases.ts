import "server-only";

import type { JobStatus, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/modules/audit/public.server";
import { refreshDuplicateStateForJob } from "@/modules/job-duplicates/public.server";
import {
  JOB_FILTER_RULE_SET_VERSION,
  evaluateJobHardFiltersInTransaction,
  isJobFilterEvaluationFresh,
  viewJobFilterProfile,
} from "@/modules/job-hard-filters/public.server";
import {
  JOB_SCORING_RULE_SET_VERSION,
  scoreJobInTransaction,
  viewJobScoringProfile,
} from "@/modules/job-scoring/public.server";
import type { JobFilterOutcome } from "@/generated/prisma/client";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import {
  countActiveJobs,
  getJobRecord,
  listJobRecords,
  listRankedJobRecords,
  type JobListFilters,
} from "./repository";
import {
  JOB_FIELD_NAMES,
  confirmedJobValuesSchema,
  jobTransitionSchema,
  jobValuesToPersistence,
  persistedJobToValues,
} from "./schemas";

export { countActiveJobs };

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function parseCursor(value?: string) {
  if (!value) return undefined;
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DomainError("The Jobs cursor is invalid.", "INVALID_INPUT");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error();
    const { confirmedAt, id } = parsed as { confirmedAt?: unknown; id?: unknown };
    const date = new Date(String(confirmedAt));
    if (typeof id !== "string" || id.length > 100 || Number.isNaN(date.getTime()))
      throw new Error();
    return { confirmedAt: date, id };
  } catch {
    throw new DomainError("The Jobs cursor is invalid.", "INVALID_INPUT");
  }
}

function parseScoreCursor(value?: string) {
  if (!value) return undefined;
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DomainError("The Jobs cursor is invalid.", "INVALID_INPUT");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const valueObject = parsed as Record<string, unknown>;
    if (
      Object.keys(valueObject).sort().join(",") !==
      "confirmedAt,coverage,id,score".split(",").sort().join(",")
    ) {
      throw new Error();
    }
    const date = new Date(String(valueObject.confirmedAt));
    const score = valueObject.score;
    const coverage = valueObject.coverage;
    if (
      typeof valueObject.id !== "string" ||
      valueObject.id.length > 100 ||
      Number.isNaN(date.getTime()) ||
      !(
        score === null ||
        (typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 100)
      ) ||
      !(
        coverage === null ||
        (typeof coverage === "number" &&
          Number.isInteger(coverage) &&
          coverage >= 0 &&
          coverage <= 100)
      ) ||
      (score === null) !== (coverage === null)
    ) {
      throw new Error();
    }
    return { score, coverage, confirmedAt: date, id: valueObject.id };
  } catch {
    throw new DomainError("The Jobs cursor is invalid.", "INVALID_INPUT");
  }
}

export async function listJobs(
  userId: string,
  input: Omit<JobListFilters, "cursor"> & {
    cursor?: string;
    filterOutcome?: JobFilterOutcome | "STALE_OR_MISSING";
    scoreSort?: boolean;
    minimumScore?: number;
    maximumScore?: number;
    excludeHardFilterFails?: boolean;
  } = {},
) {
  const pageSize = Math.min(input.pageSize ?? 25, 50);
  const [filterProfile, scoringProfile] = await Promise.all([
    viewJobFilterProfile(userId),
    viewJobScoringProfile(userId),
  ]);
  const ranked =
    Boolean(input.scoreSort) ||
    input.minimumScore !== undefined ||
    input.maximumScore !== undefined ||
    Boolean(input.excludeHardFilterFails);
  if (ranked && scoringProfile) {
    const rows = await listRankedJobRecords(userId, {
      status: input.status ?? "ACTIVE",
      employmentType: input.employmentType,
      workplaceArrangement: input.workplaceArrangement,
      query: input.query,
      consideration: input.consideration,
      minimumScore: input.minimumScore,
      maximumScore: input.maximumScore,
      filterOutcome: input.filterOutcome,
      excludeHardFilterFails: input.excludeHardFilterFails,
      scoringProfileVersion: scoringProfile.version,
      scoringRuleSetVersion: JOB_SCORING_RULE_SET_VERSION,
      filterProfileVersion: filterProfile?.version,
      filterRuleSetVersion: JOB_FILTER_RULE_SET_VERSION,
      cursor: parseScoreCursor(input.cursor),
      pageSize,
    });
    const hasNext = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const last = hasNext ? page.at(-1) : undefined;
    return {
      items: page.map((row) => row.record),
      filterProfile,
      scoringProfile,
      nextCursor: last
        ? Buffer.from(
            JSON.stringify({
              score: last.rank.freshScore,
              coverage: last.rank.freshCoverage,
              confirmedAt: last.rank.confirmedAt.toISOString(),
              id: last.rank.id,
            }),
            "utf8",
          ).toString("base64url")
        : undefined,
    };
  }
  const records = await listJobRecords(userId, {
    ...input,
    cursor: parseCursor(input.cursor),
    pageSize,
  });
  const hasNext = records.length > pageSize;
  const page = records.slice(0, pageSize);
  const items = input.filterOutcome
    ? page.filter((job) => {
        const fresh = isJobFilterEvaluationFresh(filterProfile, job, job.filterEvaluation);
        return input.filterOutcome === "STALE_OR_MISSING"
          ? !fresh
          : fresh && job.filterEvaluation?.outcome === input.filterOutcome;
      })
    : page;
  const last = hasNext ? page.at(-1) : undefined;
  return {
    items,
    filterProfile,
    scoringProfile,
    nextCursor: last
      ? Buffer.from(
          JSON.stringify({ confirmedAt: last.confirmedAt.toISOString(), id: last.id }),
          "utf8",
        ).toString("base64url")
      : undefined,
  };
}

export async function viewJob(userId: string, id: string) {
  const job = await getJobRecord(userId, id);
  if (!job) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
  return job;
}

export async function updateJob(
  userId: string,
  id: string,
  expectedVersion: number,
  untrustedInput: unknown,
) {
  const values = confirmedJobValuesSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.job.findUnique({ where: { id_userId: { id, userId } } });
    if (!current) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
    if (current.status !== "ACTIVE") {
      throw new DomainError("Restore this Job before editing it.", "INVALID_JOB_TRANSITION");
    }
    if (current.version !== expectedVersion) {
      throw new DomainError("The Job changed. Reload and try again.", "VERSION_CONFLICT");
    }
    const currentValues = persistedJobToValues(current);
    const changedFields = JOB_FIELD_NAMES.filter(
      (field) => JSON.stringify(currentValues[field]) !== JSON.stringify(values[field]),
    );
    const fields = {
      ...((current.fieldProvenance as { fields?: Record<string, unknown> }).fields ?? {}),
    };
    for (const field of changedFields) {
      fields[field] = {
        origin: "AUTHORITATIVE_EDIT",
        sourceKind: "AUTHORITATIVE_JOB",
        sourceRef: `job.${field}`,
        userModified: true,
      };
    }
    const updated = await tx.job.update({
      where: { id_userId: { id, userId } },
      data: {
        ...jobValuesToPersistence(values),
        fieldProvenance: json({ schemaVersion: 1, fields }),
        version: { increment: 1 },
      },
    });
    await refreshDuplicateStateForJob(tx, userId, updated.id);
    await evaluateJobHardFiltersInTransaction(tx, userId, updated.id, userId);
    await scoreJobInTransaction(tx, userId, updated.id, userId);
    await recordAudit(tx, {
      userId,
      entityType: "JOB",
      entityId: id,
      action: "JOB_UPDATED",
      previousState: { version: current.version },
      newState: { version: updated.version, changedFields },
    });
    return updated;
  });
}

const allowedTransitions: Record<JobStatus, readonly JobStatus[]> = {
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: ["ACTIVE"],
};

export async function transitionJob(userId: string, id: string, untrustedInput: unknown) {
  const { targetStatus, expectedVersion } = jobTransitionSchema.parse(untrustedInput);
  return runSerializableTransaction(async (tx) => {
    const current = await tx.job.findUnique({ where: { id_userId: { id, userId } } });
    if (!current) throw new DomainError("Job not found.", "JOB_NOT_FOUND");
    if (current.version !== expectedVersion) {
      throw new DomainError("The Job changed. Reload and try again.", "VERSION_CONFLICT");
    }
    if (!allowedTransitions[current.status].includes(targetStatus)) {
      throw new DomainError(
        `Job cannot move from ${current.status} to ${targetStatus}.`,
        "INVALID_JOB_TRANSITION",
      );
    }
    const updated = await tx.job.update({
      where: { id_userId: { id, userId } },
      data: {
        status: targetStatus,
        archivedAt: targetStatus === "ARCHIVED" ? new Date() : null,
        version: { increment: 1 },
      },
    });
    await refreshDuplicateStateForJob(tx, userId, updated.id);
    if (targetStatus === "ACTIVE") {
      await evaluateJobHardFiltersInTransaction(tx, userId, updated.id, userId);
      await scoreJobInTransaction(tx, userId, updated.id, userId);
    }
    await recordAudit(tx, {
      userId,
      entityType: "JOB",
      entityId: id,
      action: targetStatus === "ARCHIVED" ? "JOB_ARCHIVED" : "JOB_RESTORED",
      previousState: { status: current.status, version: current.version },
      newState: { status: updated.status, version: updated.version },
    });
    return updated;
  });
}
