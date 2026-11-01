// Checks link previews in the real conversation component rendered by Storybook.
// Run with: bun scripts/message-link-preview-e2e.ts --storybook=http://127.0.0.1:6006
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url>.");
const output = resolve(import.meta.dirname, "../.openbot-build/message-link-preview-e2e");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 600 }, locale: "en-US" });
  await page.goto(`${storybook}/iframe.html?id=conversation-richmessagetext--link-preview&viewMode=story`);
  const link = page.getByRole("link", { name: "OpenBot documentation" });
  await link.hover();
  const preview = page.getByRole("tooltip");
  await preview.waitFor({ state: "visible" });
  assert.match(await preview.innerText(), /OpenBot documentation/);
  assert.match(await preview.innerText(), /openbot\.run\/docs/);
  const bounds = await preview.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "Preview stays within the viewport.");
  await preview.hover();
  assert.equal(await preview.isVisible(), true, "Preview remains visible when hovered.");
  await page.screenshot({ path: resolve(output, "hover.png") });
  report.checks.push("hover shows a viewport-bounded, hoverable preview");
  await page.keyboard.press("Tab");
  await link.focus();
  await preview.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  report.checks.push("keyboard focus opens the preview and Escape closes it");
  assert.equal(await link.getAttribute("href"), "https://openbot.run/docs");
  await link.click();
  assert.ok(page.url().includes("iframe.html"), "The link uses the application's open handler.");
  report.checks.push("activation keeps the existing link handler");
  await page.goto(`${storybook}/iframe.html?id=conversation-richmessagetext--markdown-link-preview&viewMode=story`);
  await page.getByRole("link", { name: "OpenBot documentation" }).hover();
  await preview.waitFor({ state: "visible" });
  assert.match(await preview.innerText(), /openbot\.run\/docs/);
  report.checks.push("a Markdown link in a message shows its destination");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser.close();
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
