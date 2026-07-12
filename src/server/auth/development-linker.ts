import type { PrismaClient } from "@/generated/prisma/client";

export type DevelopmentLinkInput = Readonly<{
  developmentKey: string;
  providerId: "google";
  providerSubject: string;
  email: string;
  name: string;
  confirm: "LINK_LOCAL_DEVELOPMENT_USER";
}>;

export type DevelopmentLinkResult = Readonly<{
  userId: string;
  authAccountId: string;
  outcome: "created" | "already-linked";
}>;

export function assertDevelopmentLinkingEnvironment(nodeEnv: string, databaseUrl: string) {
  const database = new URL(databaseUrl);
  if (nodeEnv === "production" || !["localhost", "127.0.0.1", "::1"].includes(database.hostname)) {
    throw new Error("Development-user linking is restricted to a loopback development database.");
  }
}

export async function linkDevelopmentUser(
  client: PrismaClient,
  input: DevelopmentLinkInput,
): Promise<DevelopmentLinkResult> {
  return client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { developmentKey: input.developmentKey } });
    if (!user) throw new Error("The requested development user does not exist.");

    const existingAccount = await tx.authAccount.findUnique({
      where: {
        providerId_accountId: {
          providerId: input.providerId,
          accountId: input.providerSubject,
        },
      },
    });
    if (existingAccount) {
      if (existingAccount.userId !== user.id) {
        throw new Error("That provider identity belongs to another internal user.");
      }
      const otherProviderAccount = await tx.authAccount.findFirst({
        where: { userId: user.id, providerId: input.providerId, id: { not: existingAccount.id } },
        select: { id: true },
      });
      if (otherProviderAccount) {
        throw new Error("The development user has conflicting provider identities.");
      }
      return {
        userId: user.id,
        authAccountId: existingAccount.id,
        outcome: "already-linked",
      };
    }

    const conflictingAccount = await tx.authAccount.findFirst({
      where: { userId: user.id, providerId: input.providerId },
      select: { id: true },
    });
    if (conflictingAccount) {
      throw new Error("The development user already has a different provider identity.");
    }

    const emailOwner = await tx.user.findUnique({ where: { authEmail: input.email } });
    if (emailOwner && emailOwner.id !== user.id) {
      throw new Error("The authentication metadata conflicts with another internal user.");
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        authName: input.name,
        authEmail: input.email,
        authEmailVerified: true,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    const account = await tx.authAccount.create({
      data: {
        userId: user.id,
        providerId: input.providerId,
        accountId: input.providerSubject,
      },
    });

    return { userId: user.id, authAccountId: account.id, outcome: "created" };
  });
}
