import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  assertDevelopmentLinkingEnvironment,
  linkDevelopmentUser,
  type DevelopmentLinkInput,
} from "@/server/auth/development-linker";
import { authTestClient } from "../support/auth.test-instance";

const createdUserIds = new Set<string>();

function linkInput(developmentKey: string, overrides: Partial<DevelopmentLinkInput> = {}) {
  const suffix = randomUUID();
  return {
    developmentKey,
    providerId: "google",
    providerSubject: `development-subject-${suffix}`,
    email: `development-${suffix}@example.test`,
    name: "Development Link User",
    confirm: "LINK_LOCAL_DEVELOPMENT_USER",
    ...overrides,
  } satisfies DevelopmentLinkInput;
}

async function createDevelopmentUser() {
  const suffix = randomUUID();
  const user = await authTestClient.user.create({
    data: { developmentKey: `development-link-${suffix}` },
  });
  createdUserIds.add(user.id);
  return user;
}

async function cleanup() {
  const userIds = [...createdUserIds];
  if (userIds.length === 0) return;
  await authTestClient.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.authenticationAuditLog.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.authAccount.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.user.deleteMany({ where: { id: { in: userIds } } });
  createdUserIds.clear();
}

describe("explicit development-user provider linking", () => {
  afterEach(cleanup);
  afterAll(async () => authTestClient.$disconnect());

  it("creates the first explicit link without transferring Candidate Evidence", async () => {
    const user = await createDevelopmentUser();
    const profile = await authTestClient.candidateProfile.create({ data: { userId: user.id } });
    const experience = await authTestClient.experience.create({
      data: {
        userId: user.id,
        candidateProfileId: profile.id,
        title: "Owned before authentication linking",
        experienceType: "INDEPENDENT_WORK",
      },
    });

    const result = await linkDevelopmentUser(authTestClient, linkInput(user.developmentKey!));

    expect(result).toMatchObject({ userId: user.id, outcome: "created" });
    expect(
      await authTestClient.experience.findUnique({
        where: { id_userId: { id: experience.id, userId: user.id } },
      }),
    ).not.toBeNull();
    expect(
      await authTestClient.authenticationAuditLog.count({
        where: { userId: user.id, action: "DEVELOPMENT_USER_LINKED" },
      }),
    ).toBe(1);
  });

  it("returns success without duplicate account or audit for an identical rerun", async () => {
    const user = await createDevelopmentUser();
    const input = linkInput(user.developmentKey!);
    const first = await linkDevelopmentUser(authTestClient, input);
    const second = await linkDevelopmentUser(authTestClient, input);

    expect(first.outcome).toBe("created");
    expect(second).toEqual({ ...first, outcome: "already-linked" });
    expect(await authTestClient.authAccount.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await authTestClient.authenticationAuditLog.count({
        where: { userId: user.id, action: "DEVELOPMENT_USER_LINKED" },
      }),
    ).toBe(1);
  });

  it("rejects replacing the seeded user's existing provider subject", async () => {
    const user = await createDevelopmentUser();
    const first = linkInput(user.developmentKey!);
    await linkDevelopmentUser(authTestClient, first);

    await expect(
      linkDevelopmentUser(
        authTestClient,
        linkInput(user.developmentKey!, { providerSubject: "different-provider-subject" }),
      ),
    ).rejects.toThrow(/different provider identity/);
    expect(await authTestClient.authAccount.count({ where: { userId: user.id } })).toBe(1);
  });

  it("rejects a provider subject already owned by another internal user", async () => {
    const seededUser = await createDevelopmentUser();
    const otherUser = await authTestClient.user.create({
      data: {
        authName: "Other User",
        authEmail: `other-${randomUUID()}@example.test`,
        authEmailVerified: true,
      },
    });
    createdUserIds.add(otherUser.id);
    const subject = `owned-subject-${randomUUID()}`;
    await authTestClient.authAccount.create({
      data: { userId: otherUser.id, providerId: "google", accountId: subject },
    });

    await expect(
      linkDevelopmentUser(
        authTestClient,
        linkInput(seededUser.developmentKey!, { providerSubject: subject }),
      ),
    ).rejects.toThrow(/another internal user/);
    expect(await authTestClient.authAccount.count({ where: { userId: seededUser.id } })).toBe(0);
  });

  it("rejects email-only matching without creating a provider mapping", async () => {
    const seededUser = await createDevelopmentUser();
    const email = `email-owner-${randomUUID()}@example.test`;
    const emailOwner = await authTestClient.user.create({
      data: { authName: "Email Owner", authEmail: email, authEmailVerified: true },
    });
    createdUserIds.add(emailOwner.id);

    await expect(
      linkDevelopmentUser(authTestClient, linkInput(seededUser.developmentKey!, { email })),
    ).rejects.toThrow(/metadata conflicts/);
    expect(await authTestClient.authAccount.count({ where: { userId: seededUser.id } })).toBe(0);
  });

  it("rejects the linking tool in production before database access", () => {
    expect(() =>
      assertDevelopmentLinkingEnvironment(
        "production",
        "postgresql://careerops:local@127.0.0.1:5432/careerops",
      ),
    ).toThrow(/restricted to a loopback development database/);
  });
});
