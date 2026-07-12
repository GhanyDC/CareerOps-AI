import { randomUUID } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setUserStatus } from "@/modules/auth/use-cases";
import {
  authTestClient,
  getAuthTestHelpers,
  testAuth,
  testAuthenticationEnv,
} from "../support/auth.test-instance";

const createdUserIds = new Set<string>();

async function createOAuthUser(prefix = randomUUID()) {
  const context = await testAuth.$context;
  const created = await context.internalAdapter.createOAuthUser(
    {
      name: `Authentication Test ${prefix}`,
      email: `auth-${prefix}@example.test`,
      emailVerified: true,
      image: null,
    },
    {
      providerId: "google",
      accountId: `google-subject-${prefix}`,
      accessToken: "transient-access-token",
      refreshToken: "transient-refresh-token",
      idToken: "transient-id-token",
      scope: "openid email profile",
    },
  );
  createdUserIds.add(created.user.id);
  return created;
}

async function signInWithTestGoogleIdToken(subject: string, email: string, name: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "careerops-test-key", alg: "RS256", use: "sig" });
  const idToken = await new SignJWT({
    sub: subject,
    email,
    email_verified: true,
    name,
  })
    .setProtectedHeader({ alg: "RS256", kid: "careerops-test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(testAuthenticationEnv.GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("Unexpected external request in authentication integration test");
  });

  try {
    return await testAuth.handler(
      new Request("http://127.0.0.1:3100/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100",
        },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/",
          idToken: { token: idToken },
        }),
      }),
    );
  } finally {
    fetchMock.mockRestore();
  }
}

async function cleanupCreatedUsers() {
  const userIds = [...createdUserIds];
  if (userIds.length === 0) return;
  await authTestClient.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.authenticationAuditLog.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.authAccount.deleteMany({ where: { userId: { in: userIds } } });
  await authTestClient.user.deleteMany({ where: { id: { in: userIds } } });
  createdUserIds.clear();
}

describe("production authentication persistence", () => {
  beforeEach(async () => cleanupCreatedUsers());
  afterEach(async () => cleanupCreatedUsers());
  afterAll(async () => authTestClient.$disconnect());

  it("creates and returns the same authoritative User for a stable provider subject", async () => {
    const created = await createOAuthUser();
    const context = await testAuth.$context;
    const returning = await context.internalAdapter.findOAuthUser(
      created.user.email,
      created.account.accountId,
      created.account.providerId,
    );

    expect(returning?.user.id).toBe(created.user.id);
    expect(returning?.linkedAccount?.userId).toBe(created.user.id);
    expect(
      await authTestClient.authAccount.findUnique({
        where: {
          providerId_accountId: {
            providerId: created.account.providerId,
            accountId: created.account.accountId,
          },
        },
      }),
    ).toMatchObject({ userId: created.user.id });
  });

  it("does not create or link another account merely because email matches", async () => {
    const created = await createOAuthUser();
    const context = await testAuth.$context;
    const collision = await context.internalAdapter.findOAuthUser(
      created.user.email,
      "different-google-subject",
      "google",
    );

    expect(collision?.user.id).toBe(created.user.id);
    expect(collision?.linkedAccount).toBeNull();
    expect(await authTestClient.authAccount.count({ where: { userId: created.user.id } })).toBe(1);
    expect(testAuth.options.account?.accountLinking?.disableImplicitLinking).toBe(true);
  });

  it("rejects a same-email different-subject Google token at the social sign-in boundary", async () => {
    const created = await createOAuthUser();
    const profile = await authTestClient.candidateProfile.create({
      data: { userId: created.user.id },
    });
    const experience = await authTestClient.experience.create({
      data: {
        userId: created.user.id,
        candidateProfileId: profile.id,
        title: "Private evidence source",
        experienceType: "INDEPENDENT_WORK",
      },
    });
    const attackerSubject = `different-subject-${randomUUID()}`;
    const response = await signInWithTestGoogleIdToken(
      attackerSubject,
      created.user.email,
      "Different Subject",
    );
    const responseBody = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(responseBody).not.toContain(created.user.email);
    expect(responseBody).not.toContain(attackerSubject);
    expect(responseBody).not.toContain(created.user.id);
    expect(
      await authTestClient.authAccount.count({
        where: { providerId: "google", accountId: attackerSubject },
      }),
    ).toBe(0);
    expect(await authTestClient.authSession.count({ where: { userId: created.user.id } })).toBe(0);
    expect(
      await authTestClient.experience.findUnique({
        where: { id_userId: { id: experience.id, userId: created.user.id } },
      }),
    ).not.toBeNull();
  });

  it("enforces provider-subject uniqueness across internal users", async () => {
    const first = await createOAuthUser();
    const second = await createOAuthUser();

    await expect(
      authTestClient.authAccount.create({
        data: {
          userId: second.user.id,
          providerId: first.account.providerId,
          accountId: first.account.accountId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("serializes concurrent first-login attempts to one user and provider mapping", async () => {
    const prefix = randomUUID();
    const email = `concurrent-${prefix}@example.test`;
    const context = await testAuth.$context;
    const attempt = () =>
      context.internalAdapter.createOAuthUser(
        { name: "Concurrent User", email, emailVerified: true, image: null },
        { providerId: "google", accountId: `concurrent-subject-${prefix}` },
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    const users = await authTestClient.user.findMany({ where: { authEmail: email } });
    users.forEach(({ id }) => createdUserIds.add(id));

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(users).toHaveLength(1);
    expect(
      await authTestClient.authAccount.count({
        where: { providerId: "google", accountId: `concurrent-subject-${prefix}` },
      }),
    ).toBe(1);
  });

  it("rolls back failed OAuth provisioning completely and permits a clean retry", async () => {
    const prefix = randomUUID();
    const email = `rollback-${prefix}@example.test`;
    const subject = `rollback-subject-${prefix}`;
    const context = await testAuth.$context;
    const auditCountBefore = await authTestClient.authenticationAuditLog.count();

    await expect(
      context.internalAdapter.createOAuthUser(
        { name: "Rollback User", email, emailVerified: true, image: null },
        { providerId: "Google", accountId: subject },
      ),
    ).rejects.toThrow();

    expect(await authTestClient.user.count({ where: { authEmail: email } })).toBe(0);
    expect(
      await authTestClient.authAccount.count({
        where: { providerId: "Google", accountId: subject },
      }),
    ).toBe(0);
    expect(await authTestClient.authenticationAuditLog.count()).toBe(auditCountBefore);

    const retry = await context.internalAdapter.createOAuthUser(
      { name: "Rollback User", email, emailVerified: true, image: null },
      { providerId: "google", accountId: subject },
    );
    createdUserIds.add(retry.user.id);

    expect(await authTestClient.user.count({ where: { authEmail: email } })).toBe(1);
    expect(
      await authTestClient.authAccount.count({
        where: { providerId: "google", accountId: subject },
      }),
    ).toBe(1);
    expect(
      await authTestClient.authenticationAuditLog.count({
        where: {
          userId: retry.user.id,
          action: { in: ["USER_CREATED_FROM_PROVIDER", "PROVIDER_ACCOUNT_LINKED"] },
        },
      }),
    ).toBe(2);
  });

  it("strips provider tokens and database-rejects direct token persistence", async () => {
    const created = await createOAuthUser();
    const stored = await authTestClient.authAccount.findUniqueOrThrow({
      where: { id: created.account.id },
    });

    expect(stored).toMatchObject({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      scope: null,
      password: null,
    });
    await expect(
      authTestClient.authAccount.update({
        where: { id: created.account.id },
        data: { accessToken: "must-fail" },
      }),
    ).rejects.toThrow();
  });

  it("accepts valid sessions and rejects expired and revoked sessions", async () => {
    const helpers = await getAuthTestHelpers();
    const user = helpers.createUser({
      email: `session-${randomUUID()}@example.test`,
      name: "Session User",
      emailVerified: true,
    });
    await helpers.saveUser(user);
    createdUserIds.add(user.id);

    const login = await helpers.login({ userId: user.id });
    expect(await testAuth.api.getSession({ headers: login.headers })).toMatchObject({
      user: { id: user.id },
    });

    await authTestClient.authSession.update({
      where: { id: login.session.id },
      data: {
        createdAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    expect(await testAuth.api.getSession({ headers: login.headers })).toBeNull();

    const replacement = await helpers.login({ userId: user.id });
    await authTestClient.authSession.delete({ where: { id: replacement.session.id } });
    expect(await testAuth.api.getSession({ headers: replacement.headers })).toBeNull();
  });

  it.each(["SUSPENDED", "DELETED"] as const)(
    "rejects %s users before a session or success audit is issued",
    async (status) => {
      const helpers = await getAuthTestHelpers();
      const user = helpers.createUser({
        email: `rejected-${status.toLowerCase()}-${randomUUID()}@example.test`,
        name: "Rejected Session User",
        emailVerified: true,
      });
      await helpers.saveUser(user);
      createdUserIds.add(user.id);
      await authTestClient.user.update({
        where: { id: user.id },
        data: { status, deletedAt: status === "DELETED" ? new Date() : null },
      });

      await expect(helpers.login({ userId: user.id })).rejects.toThrow();
      expect(await authTestClient.authSession.count({ where: { userId: user.id } })).toBe(0);
      expect(
        await authTestClient.authenticationAuditLog.count({
          where: { userId: user.id, action: "SIGN_IN_SUCCEEDED" },
        }),
      ).toBe(0);
    },
  );

  it.each(["SUSPENDED", "DELETED"] as const)(
    "returns a generic social sign-in rejection for a %s provider account",
    async (status) => {
      const created = await createOAuthUser();
      await authTestClient.user.update({
        where: { id: created.user.id },
        data: { status, deletedAt: status === "DELETED" ? new Date() : null },
      });

      const response = await signInWithTestGoogleIdToken(
        created.account.accountId,
        created.user.email,
        "Rejected Provider User",
      );
      const responseBody = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token");
      expect(responseBody).not.toContain(created.user.email);
      expect(responseBody).not.toContain(created.user.id);
      expect(responseBody).not.toContain(status);
      expect(await authTestClient.authSession.count({ where: { userId: created.user.id } })).toBe(
        0,
      );
      expect(
        await authTestClient.authenticationAuditLog.count({
          where: { userId: created.user.id, action: "SIGN_IN_SUCCEEDED" },
        }),
      ).toBe(0);
    },
  );

  it("issues an active user session and records success in the same database transaction", async () => {
    const helpers = await getAuthTestHelpers();
    const user = helpers.createUser({
      email: `active-${randomUUID()}@example.test`,
      name: "Active Session User",
      emailVerified: true,
    });
    await helpers.saveUser(user);
    createdUserIds.add(user.id);

    const login = await helpers.login({ userId: user.id });
    expect(
      await authTestClient.authSession.findUnique({ where: { id: login.session.id } }),
    ).not.toBeNull();
    expect(
      await authTestClient.authenticationAuditLog.count({
        where: { userId: user.id, authSessionId: login.session.id, action: "SIGN_IN_SUCCEEDED" },
      }),
    ).toBe(1);
  });

  it("revokes every session when an internal user is suspended or soft-deleted", async () => {
    const helpers = await getAuthTestHelpers();
    const user = helpers.createUser({
      email: `status-${randomUUID()}@example.test`,
      name: "Status User",
      emailVerified: true,
    });
    await helpers.saveUser(user);
    createdUserIds.add(user.id);

    await helpers.login({ userId: user.id });
    await setUserStatus(user.id, "SUSPENDED", "integration_test");
    expect(await authTestClient.authSession.count({ where: { userId: user.id } })).toBe(0);

    await setUserStatus(user.id, "ACTIVE", "integration_test");
    await helpers.login({ userId: user.id });
    await setUserStatus(user.id, "DELETED", "integration_test");

    expect(await authTestClient.authSession.count({ where: { userId: user.id } })).toBe(0);
    expect(await authTestClient.user.findUnique({ where: { id: user.id } })).toMatchObject({
      status: "DELETED",
      deletedAt: expect.any(Date),
    });
    expect(
      await authTestClient.authenticationAuditLog.findMany({
        where: { userId: user.id },
        select: { action: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { action: "USER_SUSPENDED" },
        { action: "USER_REACTIVATED" },
        { action: "USER_SOFT_DELETED" },
      ]),
    );
  });

  it("attributes authentication audit records without provider subjects or token material", async () => {
    const created = await createOAuthUser();
    const audits = await authTestClient.authenticationAuditLog.findMany({
      where: { userId: created.user.id },
    });

    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(["USER_CREATED_FROM_PROVIDER", "PROVIDER_ACCOUNT_LINKED"]),
    );
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(created.account.accountId);
    expect(serialized).not.toContain("transient-access-token");
  });

  it("leaves the seeded development user's Candidate Evidence ownership unchanged", async () => {
    const developmentKey = process.env.DEVELOPMENT_USER_KEY;
    if (!developmentKey) return;
    const before = await authTestClient.user.findUnique({
      where: { developmentKey },
      select: {
        id: true,
        _count: {
          select: { experiences: true, projects: true, evidenceItems: true, claims: true },
        },
      },
    });
    if (!before) return;

    await createOAuthUser();
    const after = await authTestClient.user.findUnique({
      where: { developmentKey },
      select: {
        id: true,
        _count: {
          select: { experiences: true, projects: true, evidenceItems: true, claims: true },
        },
      },
    });
    expect(after).toEqual(before);
  });
});
