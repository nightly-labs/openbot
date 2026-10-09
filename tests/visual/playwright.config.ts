import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.visual.spec.ts",
  outputDir: "../../.openbot-build/visual/results",
  snapshotPathTemplate: "../../src/renderer/stories/assets/visual-baselines/{platform}/{arg}{ext}",
  globalSetup: "./storybook.ts",
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  updateSnapshots: "none",
  timeout: 90_000,
  reporter: [
    ["./reporter.ts"],
    ["list"],
    ["html", { outputFolder: "../../.openbot-build/visual/report", open: "never" }],
    ["json", { outputFile: "../../.openbot-build/visual/results.json" }],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 1200, height: 850 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    contextOptions: { reducedMotion: "reduce" },
    trace: "off",
    screenshot: "only-on-failure",
  },
  expect: { timeout: 15_000, toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.001 } },
});
