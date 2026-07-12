import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-production",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
});
