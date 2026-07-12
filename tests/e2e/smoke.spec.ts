import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { cleanupCandidateEvidenceRun } from "./cleanup";

async function dashboardCount(page: import("@playwright/test").Page, label: string) {
  const text = await page
    .locator(".summary-card")
    .filter({ hasText: label })
    .locator("strong")
    .textContent();
  return Number(text);
}

test.describe.serial("candidate evidence workflow", () => {
  test("moves owned evidence from source records to an approved claim", async ({ page }) => {
    const suffix = randomUUID();
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
      await expect(page.getByLabel("Full name")).toHaveValue("Ghanymede Dela Cruz");

      await page.getByRole("link", { name: "Experiences" }).click();
      await page.getByRole("link", { name: "Add experience" }).click();
      await page.getByLabel("Title").fill(`E2E Experience ${suffix}`);
      await page.getByLabel("Organization").fill("CareerOps E2E");
      await page.getByLabel("Experience type").selectOption("INDEPENDENT_WORK");
      await page.getByLabel("Summary").fill("Created through the development identity seam.");
      await page.getByRole("button", { name: "Create experience" }).click();
      await expect(page.getByText("Experience saved.")).toBeVisible();

      await page.getByRole("link", { name: "Projects" }).click();
      await page.getByRole("link", { name: "Add project" }).click();
      await page.getByLabel("Project name").fill(`E2E Project ${suffix}`);
      await page.getByLabel("Candidate role").fill("Developer");
      await page
        .getByLabel("Short description")
        .fill("Created during the CareerOps E2E vertical slice.");
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page.getByText("Project saved.")).toBeVisible();

      await page.getByRole("link", { name: "Experiences" }).click();
      await page.getByRole("link", { name: new RegExp(`E2E Experience ${suffix}`) }).click();
      await page.getByRole("link", { name: "Add evidence from this experience" }).click();
      const evidenceClaim = `Built an isolated CareerOps workflow during E2E verification ${suffix}.`;
      await page.getByLabel("Atomic claim").fill(evidenceClaim);
      await page
        .getByLabel("Supporting context")
        .fill("This content remains inert text until reviewed.");
      await page.getByLabel("Resume").check();
      await page.getByRole("button", { name: "Create evidence" }).click();
      await expect(page.getByText("Evidence item saved.")).toBeVisible();

      await page.getByRole("button", { name: "Verify evidence" }).click();
      await expect(page.getByText("Evidence status updated and audited.")).toBeVisible();
      await expect(page.locator(".status").filter({ hasText: "Verified" })).toBeVisible();

      await page.getByRole("link", { name: "Create claim from evidence" }).click();
      const approvedClaim = `Implemented and verified the CareerOps evidence workflow ${suffix}.`;
      await page.getByLabel("Claim text").fill(approvedClaim);
      await page.getByLabel("Reviewer notes").fill("Explicitly reviewed in the E2E workflow.");
      await page.getByLabel("Resume").check();
      await page.getByRole("button", { name: "Create draft claim" }).click();
      await expect(page.getByText("Draft claim saved.")).toBeVisible();

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Approve claim" }).click();
      await expect(page.getByText("Claim status updated and audited.")).toBeVisible();
      await expect(page.locator(".status").filter({ hasText: "Approved" })).toBeVisible();

      await page.getByRole("link", { name: "Dashboard" }).click();
      expect(await dashboardCount(page, "Experiences")).toBe(initialExperiences + 1);
      expect(await dashboardCount(page, "Projects")).toBe(initialProjects + 1);
      expect(await dashboardCount(page, "Evidence items")).toBe(initialEvidence + 1);
      expect(await dashboardCount(page, "Approved claims")).toBe(initialApprovedClaims + 1);
    } finally {
      await cleanupCandidateEvidenceRun(suffix);
    }
  });
});

test("returns a non-sensitive liveness response", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});
