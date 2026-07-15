import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

import { authTestClient, getAuthTestHelpers } from "../support/auth.test-instance";
import { cleanupAuthenticationUser } from "./cleanup";

async function createAuthenticatedUser(context: BrowserContext, label: string) {
  const helpers = await getAuthTestHelpers();
  const user = helpers.createUser({
    email: `${label}-${randomUUID()}@example.test`,
    name: `${label} User`,
    emailVerified: true,
  });
  await helpers.saveUser(user);
  const login = await helpers.login({ userId: user.id });
  await context.addCookies(login.cookies);
  return user;
}

test("redirects unauthenticated authoritative Job visitors to sign-in", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("reviews a Discovery before creating and archiving an authoritative Job", async ({
  context,
  page,
}) => {
  const user = await createAuthenticatedUser(context, "job-parsing-workflow");
  const marker = randomUUID();
  try {
    await page.goto("/discoveries/import");
    await page.getByLabel("Job title hint").fill(`Backend Developer ${marker}`);
    await page.getByLabel("Company hint").fill("Example Company");
    await page
      .getByLabel("Raw job description or notes")
      .fill(
        `<script>inert-${marker}</script>\nThis prose must not be inferred into structured fields.`,
      );
    await page.getByRole("button", { name: "Preview import" }).click();
    await page.getByRole("button", { name: "Confirm import" }).click();
    await expect(page.getByText("Import confirmed and stored atomically.")).toBeVisible();

    const discovery = await authTestClient.jobDiscovery.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(await authTestClient.job.count({ where: { userId: user.id } })).toBe(0);

    await page.goto(`/discoveries/${discovery.id}`);
    await page.getByRole("button", { name: "Create structured job draft" }).click();
    await expect(page.getByRole("heading", { name: "Review structured Job" })).toBeVisible();
    await expect(page.getByLabel("Job title")).toHaveValue(`Backend Developer ${marker}`);
    await expect(page.getByLabel("Description")).toHaveValue("");
    await expect(page.locator("pre.raw-content")).toContainText("<script>inert-");

    await page.getByLabel("Job title").fill(`Corrected Engineer ${marker}`);
    await page.getByRole("button", { name: "Save corrections" }).click();
    await expect(page.getByText("Corrections saved.")).toBeVisible();
    expect(await authTestClient.job.count({ where: { userId: user.id } })).toBe(0);

    await page
      .getByLabel("I reviewed this structured Job and want to make it authoritative.")
      .check();
    await page.getByRole("button", { name: "Confirm authoritative Job" }).click();
    await expect(
      page.getByText("Parse draft confirmed and authoritative Job stored atomically."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: `Corrected Engineer ${marker}` })).toBeVisible();

    const jobs = await authTestClient.job.findMany({ where: { userId: user.id } });
    expect(jobs).toHaveLength(1);
    expect(await authTestClient.jobSource.count({ where: { jobId: jobs[0]!.id } })).toBe(1);

    await page.getByRole("link", { name: "Jobs" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(`Corrected Engineer ${marker}`) }),
    ).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`Corrected Engineer ${marker}`) }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive Job" }).click();
    await expect(page.getByText("Job status updated.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore Job" })).toBeVisible();
    await page.getByRole("button", { name: "Restore Job" }).click();
    await expect(page.getByRole("button", { name: "Archive Job" })).toBeVisible();
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
