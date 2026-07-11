import "server-only";

import {
  createEvidenceRecord,
  getEvidenceItem,
  listEvidenceItems,
  listVerifiedEvidenceOptions,
  type EvidenceFilters,
} from "./repository";
import {
  canTransitionEvidence,
  evidenceInputSchema,
  evidenceTransitionSchema,
  type EvidenceInput,
  type EvidenceVerificationStatus,
} from "./schemas";
import { recordAudit } from "@/modules/audit/public.server";
import { findOwnedExperienceSource } from "@/modules/experiences/public.server";
import { findOwnedProjectSource } from "@/modules/projects/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

export { listEvidenceItems, listVerifiedEvidenceOptions };
export type { EvidenceFilters };

async function assertOwnedSource(userId: string, input: EvidenceInput) {
  if (input.sourceType === "EXPERIENCE") {
    const experience = await findOwnedExperienceSource(userId, input.sourceExperienceId!);
    if (!experience) throw new DomainError("The selected experience source is unavailable.");
  } else {
    const project = await findOwnedProjectSource(userId, input.sourceProjectId!);
    if (!project) throw new DomainError("The selected project source is unavailable.");
  }
}

export async function viewEvidenceItem(userId: string, id: string) {
  const evidence = await getEvidenceItem(userId, id);
  if (!evidence) throw new DomainError("Evidence item not found.");
  return evidence;
}

export async function createEvidenceItem(userId: string, untrustedInput: unknown) {
  const input = evidenceInputSchema.parse(untrustedInput);
  await assertOwnedSource(userId, input);
  return createEvidenceRecord(userId, input);
}

export async function updateEvidenceItem(userId: string, id: string, untrustedInput: unknown) {
  const input = evidenceInputSchema.parse(untrustedInput);
  await assertOwnedSource(userId, input);

  return runSerializableTransaction(async (tx) => {
    const evidence = await tx.evidenceItem.findUnique({ where: { id_userId: { id, userId } } });
    if (!evidence) throw new DomainError("Evidence item not found.");
    if (evidence.verificationStatus === "VERIFIED") {
      throw new DomainError(
        "Verified evidence is locked. Revoke verification before changing the evidence item.",
      );
    }

    return tx.evidenceItem.update({ where: { id_userId: { id, userId } }, data: input });
  });
}

function transitionAction(
  from: EvidenceVerificationStatus,
  to: EvidenceVerificationStatus,
):
  | "EVIDENCE_VERIFIED"
  | "EVIDENCE_REJECTED"
  | "EVIDENCE_REQUIRES_VERIFICATION"
  | "EVIDENCE_VERIFICATION_REVOKED"
  | "EVIDENCE_RETURNED_TO_DRAFT" {
  if (to === "DRAFT") return "EVIDENCE_RETURNED_TO_DRAFT";
  if (to === "VERIFIED") return "EVIDENCE_VERIFIED";
  if (to === "REJECTED") return "EVIDENCE_REJECTED";
  if (from === "VERIFIED") return "EVIDENCE_VERIFICATION_REVOKED";
  return "EVIDENCE_REQUIRES_VERIFICATION";
}

export async function transitionEvidenceStatus(
  userId: string,
  id: string,
  untrustedInput: unknown,
  dependencies: {
    recordAudit: (...arguments_: Parameters<typeof recordAudit>) => PromiseLike<unknown>;
  } = { recordAudit },
) {
  const { targetStatus } = evidenceTransitionSchema.parse(untrustedInput);

  return runSerializableTransaction(async (tx) => {
    const evidence = await tx.evidenceItem.findUnique({ where: { id_userId: { id, userId } } });
    if (!evidence) throw new DomainError("Evidence item not found.");

    if (!canTransitionEvidence(evidence.verificationStatus, targetStatus)) {
      throw new DomainError(
        `Evidence cannot move from ${evidence.verificationStatus} to ${targetStatus}.`,
      );
    }

    const updated = await tx.evidenceItem.update({
      where: { id_userId: { id, userId } },
      data: { verificationStatus: targetStatus },
    });

    await dependencies.recordAudit(tx, {
      userId,
      entityType: "EVIDENCE",
      entityId: id,
      action: transitionAction(evidence.verificationStatus, targetStatus),
      previousState: { verificationStatus: evidence.verificationStatus },
      newState: { verificationStatus: targetStatus },
    });

    if (evidence.verificationStatus === "VERIFIED" && targetStatus !== "VERIFIED") {
      const approvedClaims = await tx.claim.findMany({
        where: { userId, evidenceItemId: id, status: "APPROVED" },
        select: { id: true, approvedAt: true },
      });

      for (const claim of approvedClaims) {
        await tx.claim.update({
          where: { id_userId: { id: claim.id, userId } },
          data: { status: "REQUIRES_VERIFICATION", approvedAt: null },
        });

        const previousState = {
          status: "APPROVED",
          approvedAt: claim.approvedAt?.toISOString() ?? null,
        } as const;
        const newState = {
          status: "REQUIRES_VERIFICATION",
          approvedAt: null,
        } as const;

        await dependencies.recordAudit(tx, {
          userId,
          entityType: "CLAIM",
          entityId: claim.id,
          action: "CLAIM_APPROVAL_REVOKED",
          previousState,
          newState,
        });
        await dependencies.recordAudit(tx, {
          userId,
          entityType: "CLAIM",
          entityId: claim.id,
          action: "CLAIM_REQUIRES_VERIFICATION",
          previousState,
          newState,
        });
      }
    }

    return updated;
  });
}

export async function deleteEvidenceItem(userId: string, id: string) {
  return runSerializableTransaction(async (tx) => {
    const evidence = await tx.evidenceItem.findUnique({
      where: { id_userId: { id, userId } },
      include: { _count: { select: { claims: true } } },
    });
    if (!evidence) throw new DomainError("Evidence item not found.");
    if (evidence._count.claims > 0) {
      throw new DomainError(
        "This evidence item has linked claims and cannot be deleted. Preserve or re-home those claims first.",
      );
    }

    return tx.evidenceItem.delete({ where: { id_userId: { id, userId } } });
  });
}
