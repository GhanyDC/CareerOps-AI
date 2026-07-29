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

async function createProvenancedJob(userId: string, title: string) {
  return authTestClient.$transaction(async (tx) => {
    const reference = `retrieval-e2e-${randomUUID()}`;
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
        companyName: "Grounded Retrieval E2E",
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

async function indexFromEvidencePage(page: Page, evidenceItemId: string) {
  await page.goto(`/evidence/${evidenceItemId}`);
  await page
    .getByRole("button", { name: /Index or reindex Evidence|Retry retrieval indexing/u })
    .click({ timeout: 20_000 });
  await expect(page.getByText("Retrieval indexing completed with state Current.")).toBeVisible({
    timeout: 20_000,
  });
}

function resultCard(page: Page, claim: string) {
  return page
    .getByRole("region", { name: "Retrieved Candidate Evidence" })
    .locator(".record-card")
    .filter({ hasText: claim });
}

test("protects the Grounded Retrieval route", async ({ page }) => {
  await page.goto("/retrieval");
  await expect(page).toHaveURL(/\/sign-in$/u);
});

test("retrieves, cites, stales, retries, archives, and bounds indexing", async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createAuthenticatedUser(context, "grounded-retrieval");
  const marker = randomUUID();
  try {
    const profile = await authTestClient.candidateProfile.create({ data: { userId: user.id } });
    const experience = await authTestClient.experience.create({
      data: {
        userId: user.id,
        candidateProfileId: profile.id,
        title: "ERP Automation Engineer",
        organization: "Synthetic Test Company",
        experienceType: "EMPLOYMENT",
      },
    });
    const fullEvidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Built Odoo automation workflows ${marker}.`,
        supportingContext: "Implemented Python approval routing and reconciliation controls.",
        skillsDemonstrated: ["Odoo", "Python", "Workflow automation"],
        evidenceStrength: "DIRECT",
      },
    });
    const partialEvidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Mapped ERP finance processes ${marker}.`,
        supportingContext: "Contributed process discovery without implementing the full workflow.",
        skillsDemonstrated: ["ERP", "Process mapping"],
        evidenceStrength: "TRANSFERABLE",
      },
    });
    const retrievedEvidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Automated Odoo invoice validation ${marker}.`,
        supportingContext: "Designed deterministic finance controls in Python.",
        skillsDemonstrated: ["Odoo", "Python"],
        evidenceStrength: "SUPPORTING",
      },
    });
    const job = await createProvenancedJob(user.id, `Odoo Automation Engineer ${marker}`);
    const requirement = await authTestClient.jobRequirement.create({
      data: {
        userId: user.id,
        jobId: job.id,
        statement: `Demonstrate Odoo automation experience ${marker}.`,
        category: "EXPERIENCE",
        importance: "REQUIRED",
        source: "MANUAL",
        position: 0,
      },
    });
    await authTestClient.jobRequirementEvidenceLink.createMany({
      data: [
        {
          userId: user.id,
          requirementId: requirement.id,
          evidenceItemId: fullEvidence.id,
          supportLevel: "FULL",
          position: 0,
        },
        {
          userId: user.id,
          requirementId: requirement.id,
          evidenceItemId: partialEvidence.id,
          supportLevel: "PARTIAL",
          position: 1,
        },
      ],
    });

    await indexFromEvidencePage(page, fullEvidence.id);
    await indexFromEvidencePage(page, partialEvidence.id);
    await indexFromEvidencePage(page, retrievedEvidence.id);

    await page.goto("/retrieval");
    await expect(
      page.getByText(
        "Grounded retrieval finds relevant Candidate Evidence and cites its source. Retrieval does not independently prove qualification or generate application claims.",
      ),
    ).toBeVisible();
    await page.getByLabel("Search query").fill(`Odoo automation ${marker}`);
    await page.getByRole("button", { name: "Search Candidate Evidence" }).click();
    const userQueryCard = resultCard(page, fullEvidence.claim);
    await expect(userQueryCard).toBeVisible({ timeout: 20_000 });
    await expect(userQueryCard.getByText("Lexical", { exact: true })).toBeVisible();
    await expect(userQueryCard.getByText("Semantic", { exact: true })).toBeVisible();
    await expect(userQueryCard.getByText("Hybrid", { exact: true })).toBeVisible();
    await expect(page.getByText("Semantic channel: available")).toBeVisible();

    await page.goto(`/retrieval?requirementId=${requirement.id}`);
    const explicitSection = page.getByRole("region", { name: "Explicit Evidence links" });
    await expect(explicitSection.getByText(fullEvidence.claim, { exact: false })).toBeVisible();
    await expect(explicitSection.getByText(partialEvidence.claim, { exact: false })).toBeVisible();
    await expect(explicitSection.getByText("Explicit Full Link", { exact: true })).toBeVisible();
    await expect(explicitSection.getByText("Explicit Partial Link", { exact: true })).toBeVisible();
    await expect(resultCard(page, retrievedEvidence.claim)).toBeVisible();
    const citationTarget = await resultCard(page, retrievedEvidence.claim)
      .getByRole("link")
      .getAttribute("href");
    expect(citationTarget).toContain(`citationVersion=${retrievedEvidence.version}`);
    await page.goto(citationTarget!);
    await expect(page).toHaveURL(/citationVersion=1/u);
    await expect(
      page.getByText(/Citation resolved to this authorized Evidence record at current version/u),
    ).toBeVisible();

    await page.getByLabel("Atomic claim").fill(`Automated Odoo payment validation ${marker}.`);
    await page.getByRole("button", { name: "Save evidence" }).click();
    await expect(page.getByText("Evidence item saved.")).toBeVisible();
    await expect(page.locator(".status-stale")).toBeVisible();
    await indexFromEvidencePage(page, retrievedEvidence.id);

    await authTestClient.evidenceRetrievalIndex.update({
      where: {
        evidenceItemId_userId: {
          evidenceItemId: retrievedEvidence.id,
          userId: user.id,
        },
      },
      data: {
        status: "FAILED",
        semanticCurrent: false,
        errorCode: "EMBEDDING_TIMEOUT",
      },
    });
    await page.goto(`/evidence/${retrievedEvidence.id}`);
    await expect(page.locator(".status-failed")).toBeVisible();
    await page.getByRole("button", { name: "Retry retrieval indexing" }).click();
    await expect(page.getByText("Retrieval indexing completed with state Current.")).toBeVisible({
      timeout: 20_000,
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive Evidence" }).click();
    await expect(page.getByText(/excluded from active retrieval and is read-only/u)).toBeVisible();
    await page.goto("/retrieval");
    await page.getByLabel("Search query").fill(`Automated Odoo payment validation ${marker}`);
    await page.getByRole("button", { name: "Search Candidate Evidence" }).click();
    await expect(resultCard(page, retrievedEvidence.claim)).toHaveCount(0);
    await page.goto(`/evidence/${retrievedEvidence.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Restore Evidence" }).click();
    await expect(page.locator(".status-active")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Evidence archive state updated and audited.")).toBeVisible();
    await expect(page.locator(".status-stale")).toBeVisible();
    await indexFromEvidencePage(page, retrievedEvidence.id);

    const bounded = [];
    for (let index = 0; index < 6; index += 1) {
      bounded.push(
        await authTestClient.evidenceItem.create({
          data: {
            userId: user.id,
            sourceType: "EXPERIENCE",
            sourceExperienceId: experience.id,
            claim: `Bounded stale index fixture ${index} ${marker}.`,
            evidenceStrength: "WEAK",
          },
        }),
      );
    }
    await page.goto("/retrieval");
    await page.getByRole("button", { name: "Index next bounded page" }).click();
    await expect(page.getByText("Bounded indexing processed 5 Evidence record(s).")).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await authTestClient.evidenceRetrievalIndex.count({
        where: {
          userId: user.id,
          evidenceItemId: { in: bounded.map((item) => item.id) },
          status: "CURRENT",
        },
      }),
    ).toBe(5);
    expect(
      await authTestClient.evidenceRetrievalIndex.count({
        where: {
          userId: user.id,
          evidenceItemId: { in: bounded.map((item) => item.id) },
          status: "PENDING",
        },
      }),
    ).toBe(1);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/u);
    await page.goto("/retrieval");
    await expect(page).toHaveURL(/\/sign-in$/u);
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});

test("renders a factual empty state for a user with no current index", async ({
  context,
  page,
}) => {
  const user = await createAuthenticatedUser(context, "retrieval-empty");
  try {
    await page.goto("/retrieval");
    await page.getByLabel("Search query").fill("Synthetic query with no indexed corpus");
    await page.getByRole("button", { name: "Search Candidate Evidence" }).click();
    await expect(
      page.getByText(
        "No current indexed match was found. This does not mean the candidate lacks the capability.",
      ),
    ).toBeVisible();
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
