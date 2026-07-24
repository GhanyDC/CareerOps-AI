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
    companyName: string;
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
      const reference = `purged-scoring-e2e-${randomUUID()}`;
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

test("protects Preliminary Job Scoring settings from unauthenticated access", async ({ page }) => {
  await page.goto("/jobs/scoring");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("configures, scans, explains, ranks, and preserves preliminary preference scores", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createAuthenticatedUser(context, "job-scoring");
  const marker = randomUUID();
  try {
    const jobs = await createProvenancedJobs(
      user.id,
      Array.from({ length: 51 }, (_, index) => ({
        title: `Scoring E2E ${index.toString().padStart(2, "0")} ${marker}`,
        companyName: "Scoring E2E Company",
        employmentType: index === 2 ? ("CONTRACT" as const) : ("FULL_TIME" as const),
        workplaceArrangement: "REMOTE" as const,
        countryCode: "PH",
        ...(index === 2
          ? {}
          : {
              salaryMin: index === 1 ? "80000" : index === 0 ? "120000" : "150000",
              salaryMax: index === 1 ? "90000" : index === 0 ? "125000" : "160000",
              salaryCurrency: "USD",
              salaryPeriod: "YEAR" as const,
            }),
        description: `Private scoring description ${marker} must not enter scoring storage.`,
        contactDetails: `private-scoring-${marker}@example.test`,
        confirmedAt: new Date(Date.now() + (51 - index) * 1_000),
      })),
    );
    const primary = jobs[0]!;
    const secondary = jobs[1]!;
    const duplicateQuery = "Scoring E2E 0";
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

    await page.goto("/jobs/scoring");
    await expect(page.getByRole("heading", { name: "Preliminary Job Scoring" })).toBeVisible();
    const salary = page.getByRole("group", { name: "Salary preference" });
    await salary.getByRole("checkbox", { name: "Enable this scoring component" }).check();
    await salary.getByLabel("Weight").fill("50");
    await salary.getByLabel("Preferred minimum").fill("100000");
    await salary.getByLabel("Target amount").fill("120000");
    await salary.getByLabel("Currency").fill("USD");
    await salary.getByLabel("Salary period").selectOption("YEAR");

    const employment = page.getByRole("group", { name: "Employment-type preference" });
    await employment.getByRole("checkbox", { name: "Enable this scoring component" }).check();
    await employment.getByLabel("Weight").fill("50");
    await employment.getByLabel("Full time").selectOption("MOST_PREFERRED");
    await employment.getByLabel("Contract").selectOption("ACCEPTABLE");
    await page.getByRole("button", { name: "Create scoring profile and score Jobs" }).click();

    await expect(page.getByText("Scoring profile saved.")).toBeVisible();
    await expect(page.getByText("Scored 50 active authoritative Job(s).")).toBeVisible();
    await expect(page.getByRole("heading", { name: "More active Jobs remain" })).toBeVisible();
    expect(await authTestClient.jobPreliminaryScore.count({ where: { userId: user.id } })).toBe(50);
    await page.getByRole("button", { name: "Continue bounded scoring" }).click();
    await expect(page.getByText("Scored 1 active authoritative Job(s).")).toBeVisible();
    expect(await authTestClient.jobPreliminaryScore.count({ where: { userId: user.id } })).toBe(51);

    await page.goto(`/jobs/${primary.id}`);
    await expect(page.getByRole("heading", { name: "Component explanation" })).toBeVisible();
    await expect(
      page.getByText("The conservative known salary amount is at or above the configured target."),
    ).toBeVisible();
    const explanation = page
      .getByRole("heading", { name: "Component explanation" })
      .locator("xpath=ancestor::section[1]");
    await expect(explanation).not.toContainText(`private-scoring-${marker}@example.test`);
    await expect(explanation).not.toContainText(`Private scoring description ${marker}`);
    await expect(page.getByText(/Preliminary score reflects Job preferences only/)).toBeVisible();

    await page.goto("/jobs/scoring");
    const editSalary = page.getByRole("group", { name: "Salary preference" });
    await editSalary.getByLabel("Target amount").fill("140000");
    await page.getByRole("button", { name: "Save scoring profile and rescore Jobs" }).click();
    await expect(page.getByText("Scoring profile saved.")).toBeVisible();
    const profile = await authTestClient.jobScoringProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.version).toBe(2);
    const stale = await authTestClient.jobPreliminaryScore.findFirstOrThrow({
      where: { userId: user.id, scoringProfileVersion: 1 },
    });
    await page.goto(`/jobs/${stale.jobId}`);
    await expect(page.getByText(/preliminary score is stale/)).toBeVisible();
    await page.getByRole("button", { name: "Rescore preferences" }).click();
    await expect(page.getByText("Preliminary preferences rescored for this Job.")).toBeVisible();
    await expect(page.getByText(/preliminary score is stale/)).toHaveCount(0);

    await page.goto("/jobs/filters");
    const filterSalary = page.getByRole("group", { name: "Minimum salary" });
    await filterSalary.getByRole("checkbox", { name: "Enable this hard constraint" }).check();
    await filterSalary.getByLabel("Minimum amount").fill("100000");
    await filterSalary.getByLabel("Currency").fill("USD");
    await filterSalary.getByLabel("Salary period").selectOption("YEAR");
    await filterSalary.getByLabel("When required data is missing").selectOption("FAIL");
    await page.getByRole("button", { name: "Create filters and evaluate Jobs" }).click();
    await expect(page.getByText("Filter settings saved.")).toBeVisible();
    await page.getByRole("button", { name: "Continue bounded reevaluation" }).click();

    await page.goto(`/jobs?query=${encodeURIComponent(secondary.title)}&sort=SCORE_DESC`);
    const secondaryCard = page.getByRole("link", { name: new RegExp(secondary.title) });
    await expect(secondaryCard).toBeVisible();
    await expect(secondaryCard.locator(".score-badge")).toBeVisible();
    await expect(secondaryCard.locator(".status-fail")).toBeVisible();

    await page.goto(
      `/jobs?view=CONSIDERATION&sort=SCORE_DESC&minimumScore=0&query=${encodeURIComponent(duplicateQuery)}`,
    );
    await expect(page.getByRole("link", { name: new RegExp(primary.title) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(secondary.title) })).toHaveCount(0);
    await page.getByLabel("Include duplicate members").check();
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: new RegExp(secondary.title) })).toBeVisible();

    await page.goto(
      `/jobs?view=CONSIDERATION&sort=SCORE_DESC&excludeHardFilterFails=1&query=${encodeURIComponent(duplicateQuery)}`,
    );
    await expect(page.getByRole("link", { name: new RegExp(secondary.title) })).toHaveCount(0);

    await page.goto("/");
    expect(await summaryCount(page, "Score: 80–100")).toBeGreaterThan(0);
    expect(await summaryCount(page, "Filter: fail")).toBeGreaterThan(0);

    await page.goto(`/jobs/${primary.id}`);
    const scoreBeforeArchive = await authTestClient.jobPreliminaryScore.findUniqueOrThrow({
      where: { jobId_userId: { jobId: primary.id, userId: user.id } },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive Job" }).click();
    await expect(page.getByText(/archived Job retains its last preliminary score/)).toBeVisible();
    expect(
      (
        await authTestClient.jobPreliminaryScore.findUniqueOrThrow({
          where: { jobId_userId: { jobId: primary.id, userId: user.id } },
        })
      ).explanationHash,
    ).toBe(scoreBeforeArchive.explanationHash);
    await page.reload();
    await page.getByRole("button", { name: "Restore Job" }).click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.job.findUniqueOrThrow({
              where: { id: primary.id },
              select: { status: true },
            })
          ).status,
      )
      .toBe("ACTIVE");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/);
    await page.goto("/jobs/scoring");
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
