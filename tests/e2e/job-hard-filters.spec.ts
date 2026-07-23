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

async function summaryCount(page: Page, label: string) {
  const value = await page
    .locator(".summary-card")
    .filter({ hasText: label })
    .locator("strong")
    .textContent();
  return Number(value);
}

async function createProvenancedJobs(
  userId: string,
  values: Array<{
    title: string;
    companyName?: string;
    employmentType?: "FULL_TIME" | "CONTRACT";
    workplaceArrangement?: "REMOTE";
    countryCode?: string;
    salaryMin?: string;
    salaryMax?: string;
    salaryCurrency?: string;
    salaryPeriod?: "YEAR";
    description?: string;
    contactDetails?: string;
    confirmedAt?: Date;
  }>,
) {
  return authTestClient.$transaction(async (tx) => {
    const jobs = [];
    for (const [index, value] of values.entries()) {
      const reference = `purged-filter-e2e-${randomUUID()}`;
      const sourceHash = "a".repeat(64);
      const draft = await tx.jobParseDraft.create({
        data: {
          userId,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          sourcePayloadHash: sourceHash,
          parsedPayload: {},
          validationSummary: { schemaVersion: 1 },
          fieldProvenance: { schemaVersion: 1, fields: {} },
          status: "CONFIRMED",
          userCorrections: {},
          confirmedAt: new Date(),
          contentPurgedAt: new Date(),
        },
      });
      const job = await tx.job.create({
        data: {
          userId,
          ...value,
          fieldProvenance: { schemaVersion: 1, fields: {} },
        },
      });
      await tx.jobSource.create({
        data: {
          userId,
          jobId: job.id,
          parseDraftId: draft.id,
          sourceDiscoveryRef: reference,
          sourceBatchRef: reference,
          purpose: "INITIAL_CONFIRMATION",
          sourcePayloadHash: sourceHash,
          parserVersion: "deterministic-job-parser-v1",
          contractVersion: 1,
          appliedFields: ["title"],
          confirmedByUserId: userId,
          idempotencyKey: randomUUID(),
          confirmationHash: (index % 16).toString(16).repeat(64),
          sourcePurgedAt: new Date(),
        },
      });
      jobs.push(job);
    }
    return jobs;
  });
}

test("protects Job Hard Filter settings from unauthenticated access", async ({ page }) => {
  await page.goto("/jobs/filters");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("configures, scans, explains, filters, and retains informational Job results", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const user = await createAuthenticatedUser(context, "job-hard-filters");
  const marker = randomUUID();
  let otherUserId: string | undefined;
  try {
    const jobs = await createProvenancedJobs(
      user.id,
      Array.from({ length: 52 }, (_, index) => ({
        title: `Filter E2E ${index.toString().padStart(2, "0")} ${marker}`,
        companyName: "Filter E2E Company",
        employmentType: index === 2 ? ("CONTRACT" as const) : ("FULL_TIME" as const),
        workplaceArrangement: "REMOTE" as const,
        countryCode: "PH",
        ...(index === 2
          ? {}
          : {
              salaryMin: index === 1 ? "80000" : "120000",
              salaryMax: index === 1 ? "90000" : "125000",
              salaryCurrency: "USD",
              salaryPeriod: "YEAR" as const,
            }),
        description: `Private description ${marker} must never enter filter storage.`,
        contactDetails: `private-${marker}@example.test`,
        confirmedAt: new Date(Date.now() + (52 - index) * 1_000),
      })),
    );
    const primary = jobs[0]!;
    const secondary = jobs[1]!;
    await authTestClient.$transaction(async (tx) => {
      const group = await tx.jobDuplicateGroup.create({
        data: { userId: user.id, primaryJobId: primary.id },
      });
      await tx.jobDuplicateGroupMember.createMany({
        data: [primary.id, secondary.id].map((jobId) => ({
          groupId: group.id,
          userId: user.id,
          jobId,
        })),
      });
    });

    await page.goto("/jobs/filters");
    await expect(page.getByRole("heading", { name: "Job Hard Filters" })).toBeVisible();
    const salary = page.getByRole("group", { name: "Minimum salary" });
    await salary.getByRole("checkbox", { name: "Enable this hard constraint" }).check();
    await salary.getByLabel("Minimum amount").fill("100000.00");
    await salary.getByLabel("Currency").fill("USD");
    await salary.getByLabel("Salary period").selectOption("YEAR");

    const employment = page.getByRole("group", { name: "Allowed employment types" });
    await employment.getByRole("checkbox", { name: "Enable this hard constraint" }).check();
    await employment.getByRole("checkbox", { name: "Full time" }).check();
    await employment.getByLabel("When required data is missing").selectOption("FAIL");
    await page.getByRole("button", { name: "Create filters and evaluate Jobs" }).click();

    await expect(page.getByText("Filter settings saved.")).toBeVisible();
    await expect(page.getByText("Reevaluated 50 active authoritative Job(s).")).toBeVisible();
    await expect(page.getByRole("heading", { name: "More active Jobs remain" })).toBeVisible();
    expect(await authTestClient.jobFilterEvaluation.count({ where: { userId: user.id } })).toBe(50);
    const createdProfile = await authTestClient.jobFilterProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(createdProfile.version).toBe(1);
    expect(JSON.stringify(createdProfile.configuration)).toContain('"missingDataPolicy":"FAIL"');

    await page.getByRole("button", { name: "Continue bounded reevaluation" }).click();
    await expect(page.getByText("Reevaluated 2 active authoritative Job(s).")).toBeVisible();
    expect(await authTestClient.jobFilterEvaluation.count({ where: { userId: user.id } })).toBe(52);

    await page.goto(`/jobs/${primary.id}`);
    await expect(page.getByRole("heading", { name: "Rule-by-rule explanation" })).toBeVisible();
    await expect(
      page.getByText("The known salary minimum meets the configured minimum."),
    ).toBeVisible();
    const explanation = page
      .getByRole("heading", { name: "Rule-by-rule explanation" })
      .locator("xpath=ancestor::section[1]");
    await expect(explanation).not.toContainText(`private-${marker}@example.test`);
    await expect(explanation).not.toContainText(`Private description ${marker}`);

    await page.goto("/jobs/filters");
    const editSalary = page.getByRole("group", { name: "Minimum salary" });
    await editSalary.getByLabel("Minimum amount").fill("130000");
    const editEmployment = page.getByRole("group", { name: "Allowed employment types" });
    await editEmployment.getByRole("checkbox", { name: "Enable this hard constraint" }).uncheck();
    await page.getByRole("button", { name: "Save filters and reevaluate Jobs" }).click();
    await expect(page.getByText("Filter settings saved.")).toBeVisible();
    const editedProfile = await authTestClient.jobFilterProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(editedProfile.version).toBe(2);
    await expect(page.getByRole("heading", { name: "More active Jobs remain" })).toBeVisible();

    const stale = await authTestClient.jobFilterEvaluation.findFirstOrThrow({
      where: { userId: user.id, filterProfileVersion: 1 },
    });
    await page.goto(`/jobs/${stale.jobId}`);
    await expect(page.getByText(/result is stale/)).toBeVisible();
    await page.getByRole("button", { name: "Reevaluate hard filters" }).click();
    await expect(page.getByText("Hard filters reevaluated against the current Job.")).toBeVisible();
    await expect(page.getByText(/result is stale/)).toHaveCount(0);

    await page.goto(`/jobs?query=${encodeURIComponent(primary.title)}`);
    const primaryInventoryLink = page.getByRole("link", { name: new RegExp(primary.title) });
    await expect(primaryInventoryLink).toBeVisible();
    await expect(primaryInventoryLink.locator(".status-fail")).toBeVisible();
    await page.getByLabel("Hard-filter result").selectOption("FAIL");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: new RegExp(primary.title) })).toBeVisible();

    await page.goto(`/jobs?view=CONSIDERATION&query=${encodeURIComponent(marker)}`);
    await expect(page.getByRole("link", { name: new RegExp(primary.title) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(secondary.title) })).toHaveCount(0);
    await page.getByLabel("Include duplicate members").check();
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: new RegExp(secondary.title) })).toBeVisible();

    await page.goto("/");
    expect(await summaryCount(page, "Fail")).toBeGreaterThan(0);

    await page.goto(`/jobs/${primary.id}`);
    const evaluationBeforeArchive = await authTestClient.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId: primary.id, userId: user.id } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive Job" }).click();
    await expect(page.getByText(/archived Job retains its last result/)).toBeVisible();
    const retained = await authTestClient.jobFilterEvaluation.findUniqueOrThrow({
      where: { jobId_userId: { jobId: primary.id, userId: user.id } },
    });
    expect(retained.explanationHash).toBe(evaluationBeforeArchive.explanationHash);
    await page.reload();
    await expect(page.getByRole("button", { name: "Restore Job" })).toBeVisible();
    await page.getByRole("button", { name: "Restore Job" }).click();
    await expect(page.locator(".notice.error")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await authTestClient.job.findUniqueOrThrow({
              where: { id: primary.id },
              select: { status: true },
            })
          ).status,
        { timeout: 20_000 },
      )
      .toBe("ACTIVE");
    await page.reload();
    await expect(page.getByRole("button", { name: "Archive Job" })).toBeVisible();

    const helpers = await getAuthTestHelpers();
    const otherUser = helpers.createUser({
      email: `filter-other-${randomUUID()}@example.test`,
      name: "Filter Other User",
      emailVerified: true,
    });
    await helpers.saveUser(otherUser);
    otherUserId = otherUser.id;
    const [otherJob] = await createProvenancedJobs(otherUser.id, [
      { title: `Other tenant private Job ${marker}` },
    ]);
    if (!otherJob) throw new Error("Expected cross-tenant Job fixture");
    await page.goto(`/jobs/${otherJob.id}`);
    await expect(
      page.getByRole("heading", { name: "The requested record is unavailable" }),
    ).toBeVisible();
    await expect(page.getByText(otherJob.title)).toHaveCount(0);
  } finally {
    await cleanupAuthenticationUser(user.id);
    if (otherUserId) await cleanupAuthenticationUser(otherUserId);
  }
});
