import { defineConfig } from "@playwright/test";

const live = process.env.OPENBOT_E2E_SUITE === "live";
const release = process.env.OPENBOT_E2E_SUITE === "release";

export default defineConfig({
  testDir: ".",
  testMatch: live ? "**/*.live.spec.ts" : release ? "**/*.spec.ts" : "**/*.scripted.spec.ts",
  outputDir: "../../.openbot-build/e2e/results",
  globalSetup: "./support/services.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? (process.platform === "darwin" ? 3 : 2) : 1,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  // Service startup is measured separately by globalSetup.
  globalTimeout: 900_000,
  reporter: [["./support/reporter.ts"]],
  projects: [{ name: "local", testIgnore: "**/*.host.scripted.spec.ts" }, { name: "host" }],
});
