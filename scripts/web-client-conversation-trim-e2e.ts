// Checks that the web client releases the older pages of a conversation that is not open, and that
// the whole history still loads with no gap when the user opens it again (plan 007). Drives the real
// web workspace in the `Web/Workspace/LongConversation` story of a running Storybook, with the bench
// host of `src/renderer/src/preview/bench-web-runtime.ts` and its 160 seeded messages.
//
// `bun scripts/web-client-conversation-trim-e2e.ts --storybook=<url> [--browser-executable=<path>]`
// Writes .openbot-build/web-client-conversation-trim-e2e/report.json and reopened-top.png (the reopened
// conversation at its oldest message), and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/web-client-conversation-trim-e2e");
const STORY = "web-workspace--long-conversation";
const SCROLL_ROUNDS = 40;

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const storybook = option("storybook")?.replace(/\/$/, "");
const browserExecutable = option("browser-executable");
assert.ok(storybook, "Pass --storybook=<url> from `bun run storybook`.");

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: { passed: boolean; checks: typeof checks; error?: string } = { passed: false, checks };

async function idle(page: Page): Promise<void> {
  await page.evaluate("globalThis.openbotWebBench.idle()");
}

async function olderReads(page: Page): Promise<number> {
  const calls = await page.evaluate("({ ...globalThis.openbotWebBench.calls })");
  assert.ok(isDynamicRecord(calls), "The bench call counts are not an object.");
  const value = calls.conversationOlder;
  return isNumber(value) ? value : 0;
}

async function agentName(page: Page, key: "open" | "other"): Promise<string> {
  const name = await page.evaluate(`globalThis.openbotWebBench.agentNames.${key}`);
  assert.ok(isString(name) && name.length > 0, `The bench has no ${key} agent name.`);
  return name;
}

async function visible(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text)
    .first()
    .isVisible()
    .catch(() => false);
}

/** Scrolls the open conversation up until `top` shows. Returns the texts seen on the way. */
async function scrollToTop(
  page: Page,
  watch: string[],
  top = "Question 0:",
): Promise<{ reachedTop: boolean; seen: string[] }> {
  const seen = new Set<string>();
  const anchor = await page.locator(".conversation-scroll").first().boundingBox();
  assert.ok(anchor, "The conversation has no scroll area.");
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  for (let round = 0; round < SCROLL_ROUNDS; round += 1) {
    for (const text of watch) if (await visible(page, text)) seen.add(text);
    if (await visible(page, top)) return { reachedTop: true, seen: [...seen] };
    await page.mouse.wheel(0, -4000);
    await idle(page);
  }
  return { reachedTop: await visible(page, top), seen: [...seen] };
}

async function openAgent(page: Page, name: string): Promise<void> {
  // The chat list names each agent button "<name>, <role>. <preview>".
  await page
    .getByRole("navigation", { name: "Chat list" })
    .getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) })
    .first()
    .click();
  await idle(page);
}

const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
  await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 300_000 });
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.getByText("Question 158:").first().waitFor({ timeout: 120_000 });
  await idle(page);
  const open = await agentName(page, "open");
  const other = await agentName(page, "other");

  const first = await scrollToTop(page, []);
  const firstOlderReads = await olderReads(page);
  check("the first scroll reaches the oldest message", first.reachedTop, first);
  check("the first scroll reads older pages", firstOlderReads >= 2, { olderReads: firstOlderReads });

  await openAgent(page, other);
  await openAgent(page, open);
  await page.getByText("Question 158:").first().waitFor({ timeout: 60_000 });
  await idle(page);

  await page.evaluate("globalThis.openbotWebBench.resetCalls()");
  const second = await scrollToTop(page, ["Question 100:"]);
  const secondOlderReads = await olderReads(page);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "reopened-top.png") });
  check("the older pages of a closed conversation are released and read again", secondOlderReads >= 1, {
    olderReads: secondOlderReads,
  });
  check("the second scroll reaches the oldest message, with no gap", second.reachedTop, second);
  check("a middle page loads during the second scroll", second.seen.includes("Question 100:"), second);

  // A short conversation gets more than one page of messages while it is not open.
  await openAgent(page, other);
  await openAgent(page, open);
  await page.evaluate('globalThis.openbotWebBench.append(60, "Later")');
  await openAgent(page, other);
  await page.getByText("Later 59:").first().waitFor({ timeout: 60_000 });
  await idle(page);
  const reopened = await scrollToTop(page, ["Later 5:"], "Later 0:");
  check("messages that arrived while a short conversation was closed load with no gap", reopened.reachedTop, reopened);
  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
