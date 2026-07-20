import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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

async function createJobFromDiscovery(
  page: Page,
  userId: string,
  title: string,
  trackingValue: string,
  company = "Example Company",
) {
  await page.goto("/discoveries/import");
  await page
    .getByLabel("Source URL")
    .fill(`https://jobs.example.test/opening/42?jobId=42&utm_source=${trackingValue}`);
  await page.getByLabel("Job title hint").fill(title);
  await page.getByLabel("Company hint").fill(company);
  await page.getByLabel("Location hint").fill("Remote – Philippines");
  await page
    .getByLabel("Raw job description or notes")
    .fill(`Plain-text source for ${title}; it remains untrusted until reviewed.`);
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page).toHaveURL(/\/discoveries\/batches\/.+\?confirmed=1$/);
  await expect(page.getByText("Import confirmed and stored atomically.")).toBeVisible();
  const discovery = await authTestClient.jobDiscovery.findFirstOrThrow({
    where: { userId, titleHint: title },
    orderBy: { createdAt: "desc" },
  });
  await page.goto(`/discoveries/${discovery.id}`);
  await page.getByRole("button", { name: "Create structured job draft" }).click();
  await page
    .getByLabel("I reviewed this structured Job and want to make it authoritative.")
    .check();
  await page.getByRole("button", { name: "Confirm authoritative Job" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return authTestClient.job.findFirstOrThrow({ where: { userId, title } });
}

test("redirects unauthenticated duplicate-review visitors to sign-in", async ({ page }) => {
  await page.goto("/jobs/duplicates");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("reviews explainable duplicates without deleting or overwriting authoritative Jobs", async ({
  context,
  page,
}) => {
  const user = await createAuthenticatedUser(context, "job-duplicates-workflow");
  const marker = randomUUID().slice(0, 8);
  try {
    const jobA = await createJobFromDiscovery(
      page,
      user.id,
      `Backend Engineer A ${marker}`,
      "first",
    );
    const jobB = await createJobFromDiscovery(
      page,
      user.id,
      `Backend Engineer B ${marker}`,
      "second",
      "Example Company Philippines",
    );

    await page.goto("/jobs/duplicates");
    await expect(page.getByRole("heading", { name: "Possible duplicate Jobs" })).toBeVisible();
    await page
      .getByRole("link", { name: new RegExp(`Backend Engineer A ${marker}.*Backend Engineer B`) })
      .click();
    await expect(page.getByText("Exact canonical url", { exact: false })).toBeVisible();
    await expect(page.getByText("Conflict evidence")).toBeVisible();
    await expect(page.getByText(jobA.sourceUrl!, { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    const jobAInitialPrimaryChoice = page.locator(`input[name="primaryJobId"][value="${jobA.id}"]`);
    await jobAInitialPrimaryChoice.check();
    await expect(jobAInitialPrimaryChoice).toBeChecked();
    await page.getByRole("button", { name: "Confirm same opportunity" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/duplicates/.+\\?decided=1$`));
    await expect(page.getByText("Duplicate decision recorded atomically.")).toBeVisible();
    expect(await authTestClient.job.count({ where: { userId: user.id } })).toBe(2);
    const group = await authTestClient.jobDuplicateGroup.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(group.primaryJobId).toBe(jobA.id);

    await page.getByRole("link", { name: "Review group and primary Job" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/duplicate-groups/${group.id}$`));
    const jobBPrimaryChoice = page.locator(`input[name="primaryJobId"][value="${jobB.id}"]`);
    await jobBPrimaryChoice.check();
    await expect(jobBPrimaryChoice).toBeChecked();
    await page.getByRole("button", { name: "Save primary Job" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/duplicate-groups/.+\\?primaryChanged=1$`));
    await expect(page.getByText("Primary Job selection updated.")).toBeVisible();
    expect(
      (await authTestClient.jobDuplicateGroup.findUniqueOrThrow({ where: { id: group.id } }))
        .primaryJobId,
    ).toBe(jobB.id);

    const candidate = await authTestClient.jobDuplicateCandidate.findFirstOrThrow({
      where: { userId: user.id },
    });
    await page.goto(`/jobs/duplicates/${candidate.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Confirm different opportunities" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/duplicates/.+\\?decided=1$`));
    await expect(page.getByText("Duplicate decision recorded atomically.")).toBeVisible();
    expect(await authTestClient.jobDuplicateGroup.count({ where: { userId: user.id } })).toBe(0);
    expect(await authTestClient.job.count({ where: { userId: user.id } })).toBe(2);

    await page.goto(`/jobs/duplicates/${candidate.id}`);
    await page.getByRole("button", { name: "Defer review" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/duplicates/.+\\?decided=1$`));
    await expect(page.getByText("Duplicate decision recorded atomically.")).toBeVisible();
    expect(
      (
        await authTestClient.jobDuplicateCandidate.findUniqueOrThrow({
          where: { id: candidate.id },
        })
      ).decision,
    ).toBe("DEFERRED");

    await page.goto(`/jobs/${jobA.id}`);
    await expect(page.getByText("Duplicate review history is available.")).toBeVisible();
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
