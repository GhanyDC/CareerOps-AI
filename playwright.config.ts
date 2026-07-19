import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Database-backed workflows share one application server and transaction adapter.
  // Serial workers keep local release verification deterministic, matching CI.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "cross-env NODE_ENV=test BETTER_AUTH_TRUSTED_ORIGINS= DEVELOPMENT_IDENTITY_ENABLED=false DEVELOPMENT_SEED_ENABLED=false BETTER_AUTH_SECRET=careerops-e2e-auth-secret-0123456789 BETTER_AUTH_URL=http://127.0.0.1:3100 AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3100 GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=e2e-google-secret npm run start -- --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
