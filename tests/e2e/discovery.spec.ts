import { createHash, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

import { expectedPurgeConfirmation } from "@/modules/discovery/purge";
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
  return user;
}

test("redirects unauthenticated discovery import visitors to sign-in", async ({ page }) => {
  await page.goto("/discoveries/import");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("previews, confirms, transitions, and privacy-purges one raw discovery", async ({
  context,
  page,
}) => {
  const user = await createAuthenticatedUser(context, "discovery-workflow");
  const unique = randomUUID();
  const rawText = `<script>inert-${unique}</script>\nRaw discovery description`;
  try {
    await page.goto("/discoveries/import");
    await page.getByLabel("Opportunity source").fill(" LinkedIn  Jobs ");
    await page.getByLabel("Source URL").fill("https://example.com/jobs/e2e");
    await page.getByLabel("Job title hint").fill(`Backend Developer ${unique}`);
    await page.getByLabel("Company hint").fill("Example Company");
    await page.getByLabel("Raw job description or notes").fill(rawText);
    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(page.getByRole("heading", { name: "1 raw discovery record(s)" })).toBeVisible();
    await expect(page.locator("pre.raw-content")).toHaveText(rawText);
    expect(await authTestClient.jobDiscovery.count({ where: { userId: user.id } })).toBe(0);

    await page.getByRole("button", { name: "Return to edit" }).click();
    await expect(page.getByLabel("Raw job description or notes")).toHaveValue(rawText);
    await page.getByRole("button", { name: "Preview import" }).click();
    await page.getByRole("button", { name: "Confirm import" }).click();
    await expect(page.getByText("Import confirmed and stored atomically.")).toBeVisible();

    const batches = await authTestClient.discoveryImportBatch.findMany({
      where: { userId: user.id },
      include: { discoveries: true },
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.discoveries).toHaveLength(1);
    const batch = batches[0]!;
    const discovery = batch.discoveries[0]!;

    await page.getByRole("link", { name: "Discovery Inbox" }).click();
    await expect(
      page.getByRole("heading", { name: "Raw, unverified opportunities" }),
    ).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`Backend Developer ${unique}`) }).click();
    await expect(page.getByText("Raw discovery — not parsed or verified")).toBeVisible();
    await expect(page.locator("pre.raw-content")).toContainText("<script>inert-");
    const external = page.getByRole("link", { name: "Open submitted URL" });
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    await expect(external).toHaveAttribute("referrerpolicy", "no-referrer");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reject discovery" }).click();
    await expect(page.getByText("Discovery status updated.")).toBeVisible();
    await page.getByRole("button", { name: "Restore to inbox" }).click();
    await expect(page.getByText("Discovery status updated.")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive discovery" }).click();
    await expect(page.getByText("Discovery status updated.")).toBeVisible();

    await page.goto(`/discoveries/batches/${batch.id}`);
    const phrase = expectedPurgeConfirmation(batch.id);
    await page.getByLabel(new RegExp("Type DELETE IMPORT")).fill(phrase.toLowerCase());
    await expect(page.getByRole("button", { name: "Permanently purge import" })).toBeDisabled();
    await page.getByLabel(new RegExp("Type DELETE IMPORT")).fill(phrase);
    await page.getByRole("button", { name: "Permanently purge import" }).click();
    await expect(page.getByText("Import batch permanently purged.")).toBeVisible();
    expect(
      await authTestClient.discoveryImportBatch.findUnique({ where: { id: batch.id } }),
    ).toBeNull();
    expect(
      await authTestClient.jobDiscovery.findUnique({ where: { id: discovery.id } }),
    ).toBeNull();
    const visibleMain = await page.locator("main").textContent();
    expect(visibleMain).not.toContain(unique);
    const audit = await authTestClient.auditLog.findFirstOrThrow({
      where: { userId: user.id, entityId: batch.id, action: "DISCOVERY_IMPORT_BATCH_PURGED" },
    });
    expect(JSON.stringify(audit)).not.toContain(unique);
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});

test("returns safe import validation errors without persistence", async ({ context, page }) => {
  const user = await createAuthenticatedUser(context, "discovery-invalid");
  try {
    await page.goto("/discoveries/import");
    await page.getByLabel("Source URL").fill("javascript:alert(1)");
    await page.getByLabel("Raw job description or notes").fill("Raw but invalid URL");
    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.locator(".notice.error")).toContainText("Review the highlighted values");
    expect(await authTestClient.discoveryImportBatch.count({ where: { userId: user.id } })).toBe(0);
    const visibleMain = await page.locator("main").textContent();
    expect(visibleMain).not.toContain("Prisma");
    expect(visibleMain).not.toContain("DATABASE_URL");
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});

test("prevents one authenticated user from opening another user's discovery and batch", async ({
  context,
  page,
}) => {
  const userA = await createAuthenticatedUser(context, "discovery-tenant-a");
  const helpers = await getAuthTestHelpers();
  const userB = helpers.createUser({
    email: `discovery-tenant-b-${randomUUID()}@example.test`,
    name: "Discovery Tenant B",
    emailVerified: true,
  });
  await helpers.saveUser(userB);
  const originalPayload =
    '{"contractVersion":1,"importMethod":"MANUAL_ENTRY","rawText":"Tenant B private"}';
  try {
    const batch = await authTestClient.discoveryImportBatch.create({
      data: {
        userId: userB.id,
        importMethod: "MANUAL_ENTRY",
        producerLabel: "Manual Entry",
        originalPayload,
        validationSummary: {
          validatorVersion: "discovery-import-v1",
          discoveryCount: 1,
          totalPayloadBytes: Buffer.byteLength(originalPayload),
        },
        idempotencyKey: randomUUID(),
        payloadHash: createHash("sha256").update(originalPayload).digest("hex"),
      },
    });
    const discovery = await authTestClient.jobDiscovery.create({
      data: {
        userId: userB.id,
        batchId: batch.id,
        rawContent: "Tenant B private",
        validationSummary: {
          rawContentBytes: Buffer.byteLength("Tenant B private"),
          urlValidated: false,
          controlCharacterCheck: "PASSED",
        },
      },
    });
    await page.goto(`/discoveries/${discovery.id}`);
    await expect(
      page.getByRole("heading", { name: "The requested record is unavailable" }),
    ).toBeVisible();
    await page.goto(`/discoveries/batches/${batch.id}`);
    await expect(
      page.getByRole("heading", { name: "The requested record is unavailable" }),
    ).toBeVisible();
    await expect(page.getByText("Tenant B private")).toHaveCount(0);
  } finally {
    await cleanupAuthenticationUser(userA.id);
    await cleanupAuthenticationUser(userB.id);
  }
});
