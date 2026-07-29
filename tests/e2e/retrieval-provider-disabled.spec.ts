import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

import { authTestClient, getAuthTestHelpers } from "../support/auth.test-instance";
import { cleanupAuthenticationUser } from "./cleanup";

async function createAuthenticatedUser(context: BrowserContext) {
  const helpers = await getAuthTestHelpers();
  const user = helpers.createUser({
    email: `retrieval-disabled-${randomUUID()}@example.test`,
    name: "Retrieval Disabled Provider User",
    emailVerified: true,
  });
  await helpers.saveUser(user);
  const login = await helpers.login({ userId: user.id });
  await context.addCookies(login.cookies);
  return user;
}

test("keeps current lexical retrieval available when semantic indexing is disabled", async ({
  context,
  page,
}) => {
  const user = await createAuthenticatedUser(context);
  const marker = randomUUID();
  try {
    const profile = await authTestClient.candidateProfile.create({ data: { userId: user.id } });
    const experience = await authTestClient.experience.create({
      data: {
        userId: user.id,
        candidateProfileId: profile.id,
        title: "Lexical Retrieval Engineer",
        experienceType: "EMPLOYMENT",
      },
    });
    const evidence = await authTestClient.evidenceItem.create({
      data: {
        userId: user.id,
        sourceType: "EXPERIENCE",
        sourceExperienceId: experience.id,
        claim: `Maintained PostgreSQL lexical retrieval ${marker}.`,
        evidenceStrength: "DIRECT",
      },
    });

    await page.goto(`/evidence/${evidence.id}`);
    await page.getByRole("button", { name: "Index or reindex Evidence" }).click();
    await expect(page.getByText("Retrieval indexing completed with state Disabled.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Lexical current")).toBeVisible();
    await expect(page.getByText("Stored semantic not current")).toBeVisible();

    await page.goto("/retrieval");
    await page.getByLabel("Search query").fill(`PostgreSQL lexical retrieval ${marker}`);
    await page.getByRole("button", { name: "Search Candidate Evidence" }).click();
    await expect(page.getByText("Semantic channel: unavailable; lexical only")).toBeVisible();
    const card = page
      .getByRole("region", { name: "Retrieved Candidate Evidence" })
      .locator(".record-card")
      .filter({ hasText: evidence.claim });
    await expect(card).toBeVisible();
    await expect(card.getByText("Lexical", { exact: true })).toBeVisible();
    await expect(card.getByText("Semantic", { exact: true })).toHaveCount(0);
  } finally {
    await cleanupAuthenticationUser(user.id);
  }
});
