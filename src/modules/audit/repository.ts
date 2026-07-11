import "server-only";

import type { AuditAction, AuditEntityType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type AuditInput = Readonly<{
  userId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
}>;

export function recordAudit(tx: Prisma.TransactionClient, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousState: input.previousState,
      newState: input.newState,
    },
  });
}

export function listAuditHistory(userId: string, entityType: AuditEntityType, entityId: string) {
  return prisma.auditLog.findMany({
    where: { userId, entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
}
