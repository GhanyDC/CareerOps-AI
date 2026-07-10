import { expect, test } from "@playwright/test";

test("renders the foundation homepage", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Engineering foundation active" })).toBeVisible();
  await expect(page.getByText(/review, approval, and submission are manual/i)).toBeVisible();
});

test("returns a non-sensitive liveness response", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});
