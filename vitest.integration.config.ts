import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/integration/**/*.test.ts"],
    passWithNoTests: false,
    setupFiles: ["dotenv/config"],
    testTimeout: 10_000,
  },
});
