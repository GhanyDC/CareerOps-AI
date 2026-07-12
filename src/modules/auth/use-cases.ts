import "server-only";

import type { UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const statusAuditAction = {
  ACTIVE: "USER_REACTIVATED",
  SUSPENDED: "USER_SUSPENDED",
  DELETED: "USER_SOFT_DELETED",
} as const;

export async function setUserStatus(userId: string, status: UserStatus, reasonCode: string) {
  const deletedAt = status === "DELETED" ? new Date() : null;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { status, deletedAt },
      select: { id: true, status: true },
    });
    await tx.authSession.deleteMany({ where: { userId } });
    await tx.authenticationAuditLog.create({
      data: { userId, action: statusAuditAction[status], reasonCode },
    });
    return user;
  });
}

export async function revokeAllUserSessions(userId: string, reasonCode: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.authSession.deleteMany({ where: { userId } });
    await tx.authenticationAuditLog.create({
      data: { userId, action: "ALL_SESSIONS_REVOKED", reasonCode },
    });
    return result.count;
  });
}
