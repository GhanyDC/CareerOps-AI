import "server-only";

import type { AuthenticationAuditAction } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export type AuthenticationAuditInput = Readonly<{
  userId: string;
  action: AuthenticationAuditAction;
  authAccountId?: string;
  authSessionId?: string;
  providerId?: string;
  reasonCode?: string;
}>;

export function writeAuthenticationAudit(input: AuthenticationAuditInput) {
  return prisma.authenticationAuditLog.create({ data: input });
}

export const authenticationAuditSink = {
  async canCreateSession(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    return user?.status === "ACTIVE";
  },
};
