import { authTestClient } from "../support/auth.test-instance";

export async function cleanupAuthenticationUser(userId: string) {
  await authTestClient.authSession.deleteMany({ where: { userId } });
  await authTestClient.authenticationAuditLog.deleteMany({ where: { userId } });
  await authTestClient.user.deleteMany({ where: { id: userId } });
}
