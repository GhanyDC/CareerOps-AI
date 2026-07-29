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

async function createProvenancedJob(
  userId: string,
  title: string,
  values: {
    qualifications?: string[];
    responsibilities?: string[];
    skills?: string[];
  } = {},
) {
  return authTestClient.$transaction(async (tx) => {
    const reference = `requirement-match-e2e-${randomUUID()}`;
    const draft = await tx.jobParseDraft.create({
      data: {
        userId,
        sourceDiscoveryRef: reference,
        sourceBatchRef: reference,
        parserVersion: "deterministic-job-parser-v1",
        contractVersion: 1,
        sourcePayloadHash: "a".repeat(64),
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
        title,
        companyName: "Requirement Matching E2E",
        ...values,
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
        sourcePayloadHash: "a".repeat(64),
        parserVersion: "deterministic-job-parser-v1",
        contractVersion: 1,
        appliedFields: ["title"],
        confirmedByUserId: userId,
        idempotencyKey: randomUUID(),
        confirmationHash: randomUUID().replaceAll("-", "").repeat(2),
        sourcePurgedAt: new Date(),
      },
    });
    return job;
  });
}

function cardWithText(page: Page, text: string) {
  return page.locator(".record-card").filter({ hasText: text });
}

function linkedEvidenceCard(page: Page, text: string) {
  return page
    .getByRole("heading", { name: "Linked Candidate Evidence" })
    .locator("xpath=ancestor::section[1]")
    .locator(".record-card")
    .filter({ hasText: text });
}

async function expectEvidenceLinked(page: Page, claim: string, supportLevel: "FULL" | "PARTIAL") {
  const card = linkedEvidenceCard(page, claim);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator(`.status-${supportLevel.toLowerCase()}`)).toBeVisible();
  await expect(card.getByRole("button", { name: "Remove evidence link" })).toBeVisible();
  await expect(page.getByText("Candidate Evidence linked.")).toBeVisible();
  return card;
}

async function coverageTotal(page: Page, importance: string) {
  const section = page.getByRole("region", { name: `${importance} coverage` });
  return Number(
    await section
      .locator(".summary-card")
      .filter({ hasText: "Total" })
      .locator("strong")
      .textContent(),
  );
}

test("protects Requirement-to-Evidence Matching routes", async ({ page }) => {
  await page.goto("/jobs/requirements");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("creates, reviews, stales, preserves, and projects requirement matches", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createAuthenticatedUser(context, "requirement-matching");
  const marker = randomUUID();
  const primaryStatement = `Operate reliable TypeScript APIs ${marker}`;
  const partialStatement = `Lead distributed systems design ${marker}`;
  const unsupportedStatement = `Hold a specialist certification ${marker}`;
  try {
    const job = await createProvenancedJob(user.id, `Requirement Matching ${marker}`, {
      qualifications: ["Five years of backend engineering experience."],
      responsibilities: ["Design reliable APIs."],
      skills: ["TypeScript"],
    });
    const profile = await authTestClient.candidateProfile.create({ data: { userId: user.id } });
    const experience = await authTestClient.experience.create({
      data: {
        userId: user.id,
        candidateProfileId: profile.id,
        title: "Platform Engineer",
        organization: "Evidence Company",
        experienceType: "EMPLOYMENT",
      },
    });
    const fullEvidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Built and operated reliable TypeScript APIs ${marker}`,
        evidenceStrength: "DIRECT",
      },
    });
    const partialEvidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Contributed to distributed system design ${marker}`,
        evidenceStrength: "TRANSFERABLE",
      },
    });

    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText(/Preliminary scoring is not configured/)).toBeVisible();
    await expect(page.getByText(/Filters not configured/)).toBeVisible();
    await expect(
      page.getByText(/Matches show which Candidate Evidence records support a Job requirement/),
    ).toBeVisible();
    const matching = page.locator("#requirement-matching");
    await matching.getByLabel("Atomic requirement statement").fill(primaryStatement);
    await matching.getByLabel("Category").selectOption("SKILL");
    await matching.getByLabel("Importance").selectOption("REQUIRED");
    await matching.getByLabel("Source classification").selectOption("MANUAL");
    await matching.getByRole("button", { name: "Create authoritative requirement" }).click();
    await expect(page.getByText("Authoritative requirement created.")).toBeVisible();
    await expect(cardWithText(page, primaryStatement)).toContainText("Not Reviewed");
    const primaryRequirement = await authTestClient.jobRequirement.findFirstOrThrow({
      where: { userId: user.id, jobId: job.id, statement: primaryStatement },
    });

    await cardWithText(page, primaryStatement)
      .getByRole("link", { name: "Review evidence" })
      .click();
    await expect(page.getByRole("heading", { name: primaryStatement })).toBeVisible();
    const fullCard = cardWithText(page, fullEvidence.claim);
    await fullCard.getByLabel("Optional short rationale").fill("Direct full support.");
    await fullCard.getByRole("button", { name: "Link this evidence" }).click();
    await expectEvidenceLinked(page, fullEvidence.claim, "FULL");
    const partialCard = cardWithText(page, partialEvidence.claim);
    await partialCard.getByLabel("Support level").selectOption("PARTIAL");
    await partialCard.getByLabel("Optional short rationale").fill("Supports only part.");
    await partialCard.getByRole("button", { name: "Link this evidence" }).click();
    const linkedPartial = await expectEvidenceLinked(page, partialEvidence.claim, "PARTIAL");
    await expect(page.getByText("2 link(s)")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete evidence review" }).click();
    await expect(
      page.getByText("Requirement evidence review completed and audited."),
    ).toBeVisible();
    await expect(page.locator(".status-supported")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await linkedPartial.getByRole("button", { name: "Remove evidence link" }).click();
    await expect(page.getByText("Evidence link removed.")).toBeVisible();
    await expect(page.getByText("This review is stale.")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete evidence review" }).click();
    await expect(page.getByText("This review is stale.")).toHaveCount(0);

    await page.getByLabel("Atomic requirement statement").fill(`${primaryStatement} updated`);
    await page.getByRole("button", { name: "Save requirement" }).click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.jobRequirement.findUniqueOrThrow({
              where: { id: primaryRequirement.id },
              select: { statement: true },
            })
          ).statement,
        { timeout: 20_000 },
      )
      .toBe(`${primaryStatement} updated`);
    await expect(page.getByText("This review is stale.")).toBeVisible({ timeout: 20_000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete evidence review" }).click();

    await page.goto(`/evidence/${fullEvidence.id}`);
    await page
      .getByLabel("Atomic claim")
      .fill(`Built, observed, and operated reliable TypeScript APIs ${marker}`);
    await page.getByRole("button", { name: "Save evidence" }).click();
    await expect(page.getByText("Evidence item saved.")).toBeVisible();
    await page.goto(`/jobs/${job.id}`);
    await expect(cardWithText(page, `${primaryStatement} updated`)).toContainText("Stale");
    await page.goto(`/jobs/${job.id}/requirements/${primaryRequirement.id}`);
    await expect(page.getByText("This review is stale.")).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Evidence Version Changed" }),
    ).toBeVisible();

    await page.goto(`/jobs/${job.id}`);
    const matchingAfterEdit = page.locator("#requirement-matching");
    await matchingAfterEdit.getByLabel("Atomic requirement statement").fill(partialStatement);
    await matchingAfterEdit.getByLabel("Importance").selectOption("PREFERRED");
    await matchingAfterEdit
      .getByRole("button", { name: "Create authoritative requirement" })
      .click();
    await cardWithText(page, partialStatement)
      .getByRole("link", { name: "Review evidence" })
      .click();
    const onlyPartial = cardWithText(page, partialEvidence.claim);
    await onlyPartial.getByLabel("Support level").selectOption("PARTIAL");
    await onlyPartial.getByRole("button", { name: "Link this evidence" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete evidence review" }).click();
    await expect(page.locator(".status-partially_supported")).toBeVisible();

    await page.goto(`/jobs/${job.id}`);
    const matchingForUnsupported = page.locator("#requirement-matching");
    await matchingForUnsupported
      .getByLabel("Atomic requirement statement")
      .fill(unsupportedStatement);
    await matchingForUnsupported.getByLabel("Category").selectOption("CERTIFICATION");
    await matchingForUnsupported.getByLabel("Importance").selectOption("REQUIRED");
    await matchingForUnsupported
      .getByRole("button", { name: "Create authoritative requirement" })
      .click();
    await cardWithText(page, unsupportedStatement)
      .getByRole("link", { name: "Review evidence" })
      .click();
    const unsupportedRequirement = await authTestClient.jobRequirement.findFirstOrThrow({
      where: { userId: user.id, jobId: job.id, statement: unsupportedStatement },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete review: no recorded evidence" }).click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.jobRequirementReview.findUnique({
              where: {
                requirementId_userId: {
                  requirementId: unsupportedRequirement.id,
                  userId: user.id,
                },
              },
              select: { status: true },
            })
          )?.status,
        { timeout: 20_000 },
      )
      .toBe("UNSUPPORTED");
    await page.reload();
    await expect(page.locator(".status-unsupported")).toBeVisible();

    await page.goto(`/jobs/${job.id}`);
    await cardWithText(page, unsupportedStatement).getByRole("button", { name: "Move up" }).click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.jobRequirement.findUniqueOrThrow({
              where: { id: unsupportedRequirement.id },
              select: { position: true },
            })
          ).position,
        { timeout: 20_000 },
      )
      .toBeLessThan(unsupportedRequirement.position);
    await page.reload();
    page.once("dialog", (dialog) => dialog.accept());
    await cardWithText(page, unsupportedStatement)
      .getByRole("button", { name: "Archive requirement" })
      .click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.jobRequirement.findUniqueOrThrow({
              where: { id: unsupportedRequirement.id },
              select: { state: true },
            })
          ).state,
        { timeout: 20_000 },
      )
      .toBe("ARCHIVED");
    await page.reload();
    const archivedRequirement = page.locator("details").filter({ hasText: unsupportedStatement });
    await archivedRequirement.locator("summary").click();
    await archivedRequirement.getByRole("button", { name: "Restore requirement" }).click();
    await expect
      .poll(
        async () =>
          (
            await authTestClient.jobRequirement.findUniqueOrThrow({
              where: { id: unsupportedRequirement.id },
              select: { state: true },
            })
          ).state,
        { timeout: 20_000 },
      )
      .toBe("ACTIVE");
    await page.reload();
    await expect(cardWithText(page, unsupportedStatement)).toContainText("Unsupported");

    const duplicateMember = await createProvenancedJob(
      user.id,
      `Requirement Duplicate Member ${marker}`,
    );
    await authTestClient.jobRequirement.create({
      data: {
        userId: user.id,
        jobId: duplicateMember.id,
        statement: `Independent duplicate-member requirement ${marker}`,
        category: "OTHER",
        importance: "REQUIRED",
        source: "MANUAL",
        position: 0,
      },
    });
    await authTestClient.$transaction(async (tx) => {
      const group = await tx.jobDuplicateGroup.create({
        data: { userId: user.id, primaryJobId: job.id },
      });
      await tx.jobDuplicateGroupMember.createMany({
        data: [job.id, duplicateMember.id].map((jobId) => ({
          groupId: group.id,
          userId: user.id,
          jobId,
        })),
      });
    });

    await page.goto("/jobs/requirements");
    const collapsedTotal = await coverageTotal(page, "Required");
    await page.getByLabel("Include duplicate members").check();
    await page.getByRole("button", { name: "Update coverage" }).click();
    expect(await coverageTotal(page, "Required")).toBe(collapsedTotal + 1);

    await page.goto(`/jobs/${job.id}`);
    const requirementCount = await authTestClient.jobRequirement.count({
      where: { userId: user.id, jobId: job.id },
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive Job" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}\\?transitioned=ARCHIVED$`), {
      timeout: 15_000,
    });
    await expect(page.getByText(/Requirements and matches are preserved/)).toBeVisible();
    expect(
      await authTestClient.jobRequirement.count({ where: { userId: user.id, jobId: job.id } }),
    ).toBe(requirementCount);
    await page.getByRole("button", { name: "Restore Job" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}\\?transitioned=ACTIVE$`), {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Archive Job" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/);
    await page.goto(`/jobs/${job.id}`);
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
