import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

import { authTestClient, getAuthTestHelpers } from "../support/auth.test-instance";
import { cleanupAuthenticationUser } from "./cleanup";

async function createAuthenticatedUser(context: BrowserContext, label: string) {
  const helpers = await getAuthTestHelpers();
  const suffix = randomUUID();
  const user = helpers.createUser({
    email: `${label}-${suffix}@example.test`,
    name: `${label} User`,
    emailVerified: true,
  });
  await helpers.saveUser(user);
  const login = await helpers.login({ userId: user.id });
  await context.addCookies(login.cookies);
  return { user, login, suffix };
}

async function dashboardCount(page: import("@playwright/test").Page, label: string) {
  const text = await page
    .locator(".summary-card")
    .filter({ hasText: label })
    .locator("strong")
    .textContent();
  return Number(text);
}

test("redirects unauthenticated visitors to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to your evidence workspace" }),
  ).toBeVisible();
  await expect(page.getByText("Development identity")).toHaveCount(0);
});

test("renders generic authentication errors without account details", async ({ page }) => {
  await page.goto(
    "/auth/error?error=account_not_linked&email=private%40example.test&subject=provider-secret",
  );
  await expect(
    page.getByRole("heading", { name: "CareerOps could not complete sign-in" }),
  ).toBeVisible();
  const body = await page.locator("body").textContent();
  expect(body).not.toContain("private@example.test");
  expect(body).not.toContain("provider-secret");
  expect(body).not.toContain("account_not_linked");
});

test.describe.serial("authenticated candidate evidence workflow", () => {
  test("uses a database session through sign-out and post-sign-out denial", async ({
    context,
    page,
  }) => {
    const { user, suffix } = await createAuthenticatedUser(context, "workflow");
    try {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Candidate evidence dashboard" }),
      ).toBeVisible();
      const initialExperiences = await dashboardCount(page, "Experiences");
      const initialProjects = await dashboardCount(page, "Projects");
      const initialEvidence = await dashboardCount(page, "Evidence items");
      const initialApprovedClaims = await dashboardCount(page, "Approved claims");

      await page.getByRole("link", { name: "Candidate Profile" }).click();
      await page.getByLabel("Full name").fill(`E2E Candidate ${suffix}`);
      await page.getByRole("button", { name: "Save profile" }).click();
      await expect(page.getByText("Candidate profile saved.")).toBeVisible();

      await page.getByRole("link", { name: "Experiences" }).click();
      await page.getByRole("link", { name: "Add experience" }).click();
      await page.getByLabel("Title").fill(`E2E Experience ${suffix}`);
      await page.getByLabel("Organization").fill("CareerOps E2E");
      await page.getByLabel("Experience type").selectOption("INDEPENDENT_WORK");
      await page.getByLabel("Summary").fill("Created through a database-backed test session.");
      await page.getByRole("button", { name: "Create experience" }).click();
      await expect(page.getByText("Experience saved.")).toBeVisible();

      await page.getByRole("link", { name: "Projects" }).click();
      await page.getByRole("link", { name: "Add project" }).click();
      await page.getByLabel("Project name").fill(`E2E Project ${suffix}`);
      await page.getByLabel("Candidate role").fill("Developer");
      await page
        .getByLabel("Short description")
        .fill("Created during authenticated E2E verification.");
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page.getByText("Project saved.")).toBeVisible();

      await page.getByRole("link", { name: "Experiences" }).click();
      await page.getByRole("link", { name: new RegExp(`E2E Experience ${suffix}`) }).click();
      await page.getByRole("link", { name: "Add evidence from this experience" }).click();
      const evidenceClaim = `Built an isolated authenticated workflow ${suffix}.`;
      await page.getByLabel("Atomic claim").fill(evidenceClaim);
      await page
        .getByLabel("Supporting context")
        .fill("This content remains inert text until reviewed.");
      await page.getByLabel("Resume").check();
      await page.getByRole("button", { name: "Create evidence" }).click();
      await expect(page.getByText("Evidence item saved.")).toBeVisible();

      await page.getByRole("button", { name: "Verify evidence" }).click();
      await expect(page.getByText("Evidence status updated and audited.")).toBeVisible();

      await page.getByRole("link", { name: "Create claim from evidence" }).click();
      await page.getByLabel("Claim text").fill(`Verified authenticated workflow ${suffix}.`);
      await page.getByLabel("Reviewer notes").fill("Explicitly reviewed in E2E.");
      await page.getByLabel("Resume").check();
      await page.getByRole("button", { name: "Create draft claim" }).click();
      await expect(page.getByText("Draft claim saved.")).toBeVisible();

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Approve claim" }).click();
      await expect(page.getByText("Claim status updated and audited.")).toBeVisible();

      await page.getByRole("link", { name: "Dashboard" }).click();
      expect(await dashboardCount(page, "Experiences")).toBe(initialExperiences + 1);
      expect(await dashboardCount(page, "Projects")).toBe(initialProjects + 1);
      expect(await dashboardCount(page, "Evidence items")).toBe(initialEvidence + 1);
      expect(await dashboardCount(page, "Approved claims")).toBe(initialApprovedClaims + 1);

      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/);
      await page.goto("/");
      await expect(page).toHaveURL(/\/sign-in$/);
    } finally {
      await cleanupAuthenticationUser(user.id);
    }
  });
});

test("prevents one authenticated user from viewing another user's record", async ({
  context,
  page,
}) => {
  const userA = await createAuthenticatedUser(context, "tenant-a");
  const helpers = await getAuthTestHelpers();
  const userB = helpers.createUser({
    email: `tenant-b-${randomUUID()}@example.test`,
    name: "Tenant B User",
    emailVerified: true,
  });
  await helpers.saveUser(userB);
  try {
    const profile = await authTestClient.candidateProfile.create({ data: { userId: userB.id } });
    const experience = await authTestClient.experience.create({
      data: {
        userId: userB.id,
        candidateProfileId: profile.id,
        title: "Tenant B private experience",
        experienceType: "INDEPENDENT_WORK",
      },
    });

    await page.goto(`/experiences/${experience.id}`);
    await expect(
      page.getByRole("heading", { name: "The requested record is unavailable" }),
    ).toBeVisible();
    await expect(page.getByText("Tenant B private experience")).toHaveCount(0);
  } finally {
    await cleanupAuthenticationUser(userA.user.id);
    await cleanupAuthenticationUser(userB.id);
  }
});

test("rejects expired and revoked database sessions immediately", async ({ browser }) => {
  const expiredContext = await browser.newContext();
  const expired = await createAuthenticatedUser(expiredContext, "expired");
  try {
    await authTestClient.authSession.update({
      where: { id: expired.login.session.id },
      data: {
        createdAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const page = await expiredContext.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await expiredContext.close();
    await cleanupAuthenticationUser(expired.user.id);
  }

  const revokedContext = await browser.newContext();
  const revoked = await createAuthenticatedUser(revokedContext, "revoked");
  try {
    await authTestClient.authSession.delete({ where: { id: revoked.login.session.id } });
    const page = await revokedContext.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await revokedContext.close();
    await cleanupAuthenticationUser(revoked.user.id);
  }
});

test("keeps authentication secrets out of browser-visible output", async ({ context, page }) => {
  const { user } = await createAuthenticatedUser(context, "secret-check");
  try {
    await page.goto("/");
    const browserVisible = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      localStorage: JSON.stringify(localStorage),
      sessionStorage: JSON.stringify(sessionStorage),
      cookies: document.cookie,
    }));
    const serialized = JSON.stringify(browserVisible);
    expect(serialized).not.toContain("careerops-e2e-auth-secret");
    expect(serialized).not.toContain("e2e-google-secret");
    expect(serialized).not.toContain("session_token");
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});

test("returns a non-sensitive public liveness response", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});
