import "server-only";

import { recordAudit } from "@/modules/audit/public.server";
import { findOwnedEvidence } from "@/modules/evidence/public.server";
import { DomainError } from "@/modules/shared/errors";
import { runSerializableTransaction } from "@/server/db/transaction";

import { createClaimRecord, getClaim, listClaims, updateClaimRecord } from "./repository";
import {
  canApproveClaim,
  canTransitionClaim,
  claimInputSchema,
  claimTransitionSchema,
  type ClaimBankStatus,
} from "./schemas";

export { listClaims };

export async function viewClaim(userId: string, id: string) {
  const claim = await getClaim(userId, id);
  if (!claim) throw new DomainError("Claim not found.");
  return claim;
}

async function assertOwnedEvidence(userId: string, evidenceItemId?: string) {
  if (!evidenceItemId) return;
  const evidence = await findOwnedEvidence(userId, evidenceItemId);
  if (!evidence || evidence.state !== "ACTIVE") {
    throw new DomainError("The linked evidence item is unavailable.");
  }
}

export async function createDraftClaim(userId: string, untrustedInput: unknown) {
  const input = claimInputSchema.parse(untrustedInput);
  await assertOwnedEvidence(userId, input.evidenceItemId);
  return createClaimRecord(userId, input);
}

export async function updateDraftClaim(userId: string, id: string, untrustedInput: unknown) {
  const claim = await viewClaim(userId, id);
  if (claim.status !== "DRAFT" && claim.status !== "REQUIRES_VERIFICATION") {
    throw new DomainError("Approved, prohibited, and archived claims cannot be edited directly.");
  }
  const input = claimInputSchema.parse(untrustedInput);
  await assertOwnedEvidence(userId, input.evidenceItemId);
  return updateClaimRecord(userId, id, input);
}

function claimAuditAction(target: ClaimBankStatus) {
  if (target === "DRAFT") return "CLAIM_RETURNED_TO_DRAFT" as const;
  if (target === "APPROVED") return "CLAIM_APPROVED";
  if (target === "PROHIBITED") return "CLAIM_PROHIBITED";
  if (target === "ARCHIVED") return "CLAIM_ARCHIVED";
  return "CLAIM_REQUIRES_VERIFICATION";
}

export async function transitionClaimStatus(userId: string, id: string, untrustedInput: unknown) {
  const { targetStatus } = claimTransitionSchema.parse(untrustedInput);

  return runSerializableTransaction(async (tx) => {
    const claim = await tx.claim.findUnique({
      where: { id_userId: { id, userId } },
      include: { evidenceItem: { select: { verificationStatus: true, state: true } } },
    });
    if (!claim) throw new DomainError("Claim not found.");

    if (!canTransitionClaim(claim.status, targetStatus)) {
      throw new DomainError(`Claim cannot move from ${claim.status} to ${targetStatus}.`);
    }

    if (
      targetStatus === "APPROVED" &&
      (claim.evidenceItem?.state !== "ACTIVE" ||
        !canApproveClaim(claim.status, claim.evidenceItem?.verificationStatus))
    ) {
      throw new DomainError("Only claims linked to verified evidence can be approved.");
    }

    const approvedAt = targetStatus === "APPROVED" ? new Date() : null;
    const updated = await tx.claim.update({
      where: { id_userId: { id, userId } },
      data: { status: targetStatus, approvedAt },
    });

    const previousState = {
      status: claim.status,
      approvedAt: claim.approvedAt?.toISOString() ?? null,
    };
    const newState = {
      status: targetStatus,
      approvedAt: approvedAt?.toISOString() ?? null,
    };

    if (claim.status === "APPROVED" && targetStatus !== "APPROVED") {
      await recordAudit(tx, {
        userId,
        entityType: "CLAIM",
        entityId: id,
        action: "CLAIM_APPROVAL_REVOKED",
        previousState,
        newState,
      });
    }

    await recordAudit(tx, {
      userId,
      entityType: "CLAIM",
      entityId: id,
      action: claimAuditAction(targetStatus),
      previousState,
      newState,
    });

    return updated;
  });
}
