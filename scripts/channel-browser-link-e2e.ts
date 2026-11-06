// Run with: bun scripts/channel-browser-link-e2e.ts --storybook=http://127.0.0.1:6006
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url>.");
const output = resolve(import.meta.dirname, "../.openbot-build/channel-browser-link-e2e");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const report: { passed: boolean; error?: string } = { passed: false };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${storybook}/iframe.html?id=conversation-channelbrowserlink--link&viewMode=story`);
  await page.getByText("Browser test", { exact: true }).first().click();
  await page.getByRole("link", { name: "OpenBot documentation" }).click();
  const panel = page.getByRole("complementary", { name: "Browser previews" });
  const tab = panel.getByRole("button", { name: "Open https://openbot.run/docs" });
  await tab.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await panel.getByRole("button", { name: "Open Agent private page" }).count(), 0);
  await tab.click();
  const address = page.getByRole("combobox", { name: "Browser address" });
  await address.waitFor({ state: "visible" });
  assert.equal(await address.inputValue(), "https://openbot.run/docs");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser.close();
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
