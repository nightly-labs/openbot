// Run against repository Storybook, with synthetic conversations only:
// bun scripts/codex-plan-notice-e2e.ts --storybook=<url> --browser-executable=<path>
// Failure cases: an accepted turn or an unknown gate must not show a hard limit;
// a refused turn must still show it, and dismissal must preserve the draft.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const executablePath = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> for the repository Storybook.");
const out = resolve(import.meta.dirname, "../.openbot-build/codex-plan-notice-e2e");
mkdirSync(out, { recursive: true });
const report: { passed: boolean; cases: string[]; error?: string } = { passed: false, cases: [] };
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
try {
  const page = await browser.newPage();
  for (const [story, limited] of [
    ["spent-plan-with-accepted-turn", false],
    ["spent-plan-without-local-gate", false],
    ["usage-limit-reached", true],
  ] as const) {
    await page.goto(`${storybook}/iframe.html?id=conversation-conversation--${story}&viewMode=story`);
    const editor = page.getByRole("textbox", { name: "Message Chief" });
    await editor.waitFor();
    assert.equal(await editor.isEditable(), true, "The composer remains editable.");
    const notice = page.getByRole("alert").filter({ hasText: "Usage limit reached" });
    if (limited) {
      await notice.waitFor();
      await editor.fill("Keep this draft");
      await notice.getByRole("button", { name: "Dismiss error" }).click();
      await notice.waitFor({ state: "hidden" });
      assert.equal(await editor.innerText(), "Keep this draft");
    } else {
      assert.equal(await notice.count(), 0, "A spent plan alone is not a provider refusal.");
    }
    report.cases.push(story);
    await page.screenshot({ path: resolve(out, `${story}.png`) });
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  writeFileSync(resolve(out, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
