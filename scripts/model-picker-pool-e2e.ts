import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/model-picker-pool-e2e");
const t = translateFor("en");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const storybook = option("storybook");
const browserExecutable = option("browser-executable");
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

const POOL = t("provider.account.poolChip");
const POOL_ENTRY = "Claude";
const RESERVED_ENTRY = "Claude · Reserved";
const TEAM_ENTRY = "Claude · team@example.com";
const OWN_ENTRY = "Claude · person@example.com";
const OPUS = "Claude Opus 5.5";
const SONNET = "Claude Sonnet 5";

interface PickerState {
  trigger: string;
  entries?: string[];
}

interface Report {
  accountLeftOut?: { start: PickerState; onLeftOutAccount: PickerState; backInPool: PickerState };
  ownSignInLeftOut?: { start: PickerState; inPool: PickerState; onOwnSignIn: PickerState };
  screenshots: string[];
  passed: boolean;
}

const report: Report = { screenshots: [], passed: false };
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const triggerPrefix = `${t("provider.picker.agentModel")}: `;
const trigger = (page: Page) => page.getByRole("button", { name: new RegExp(`^${literal(triggerPrefix)}`) });
const rail = (page: Page) => page.getByRole("tablist", { name: t("provider.picker.providers") });

async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${id}&viewMode=story`);
  await trigger(page).waitFor();
}

async function triggerSummary(page: Page): Promise<string> {
  return ((await trigger(page).getAttribute("aria-label")) ?? "").slice(triggerPrefix.length);
}

async function openPicker(page: Page, shot: string): Promise<PickerState> {
  const summary = await triggerSummary(page);
  await trigger(page).click();
  await rail(page).waitFor();
  const labels = await rail(page)
    .getByRole("tab")
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label") ?? ""));
  const path = resolve(OUT, `${shot}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
  return { trigger: summary, entries: labels.map((label) => label.split(": ")[0] ?? label) };
}

async function chooseModel(page: Page, entry: string, model: string): Promise<PickerState> {
  if (!(await rail(page).isVisible())) await trigger(page).click();
  const tab = rail(page).getByRole("tab", { name: new RegExp(`^${literal(entry)}: `) });
  await tab.click();
  await page
    .locator(`[id="${await tab.getAttribute("aria-controls")}"]`)
    .getByRole("option", { name: new RegExp(`^${literal(model)}`) })
    .click();
  await rail(page).waitFor({ state: "hidden" });
  return { trigger: await triggerSummary(page) };
}

function onEntry(state: PickerState, name: string): boolean {
  return state.trigger.split(" · ").includes(name);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });

  await openStory(page, "conversation-providermodelpicker--pool-with-account-left-out");
  const start = await openPicker(page, "account-left-out-open");
  assert.ok(onEntry(start, POOL), `The agent starts in the pool: ${start.trigger}`);
  assert.ok(start.entries?.includes(POOL_ENTRY), `The pool has its entry: ${start.entries}`);
  assert.ok(start.entries?.includes(RESERVED_ENTRY), `The account out of the pool has an entry: ${start.entries}`);
  assert.ok(!start.entries?.includes(TEAM_ENTRY), `An account in the pool has no entry: ${start.entries}`);
  assert.ok(!start.entries?.includes(OWN_ENTRY), `The own sign-in in the pool has no entry: ${start.entries}`);
  const onLeftOutAccount = await chooseModel(page, RESERVED_ENTRY, SONNET);
  assert.ok(
    onEntry(onLeftOutAccount, "Reserved") && !onEntry(onLeftOutAccount, POOL),
    `A model on the account out of the pool moves the agent to that account: ${onLeftOutAccount.trigger}`,
  );
  const backInPool = await chooseModel(page, POOL_ENTRY, OPUS);
  assert.ok(
    onEntry(backInPool, POOL) && !onEntry(backInPool, "Reserved"),
    `A model on the pool entry gives the agent to the pool: ${backInPool.trigger}`,
  );
  report.accountLeftOut = { start, onLeftOutAccount, backInPool };

  await openStory(page, "conversation-providermodelpicker--pool-with-own-sign-in-left-out");
  const ownStart = await openPicker(page, "own-sign-in-left-out-open");
  assert.ok(
    onEntry(ownStart, "person@example.com") && !onEntry(ownStart, POOL),
    `The agent starts on the own sign-in out of the pool: ${ownStart.trigger}`,
  );
  assert.ok(ownStart.entries?.includes(POOL_ENTRY), `The pool has its entry: ${ownStart.entries}`);
  assert.ok(ownStart.entries?.includes(OWN_ENTRY), `The own sign-in out of the pool has an entry: ${ownStart.entries}`);
  assert.ok(!ownStart.entries?.includes(TEAM_ENTRY), `An account in the pool has no entry: ${ownStart.entries}`);
  const inPool = await chooseModel(page, POOL_ENTRY, SONNET);
  assert.ok(
    onEntry(inPool, POOL) && !onEntry(inPool, "person@example.com"),
    `The pool entry moves the agent off the own sign-in: ${inPool.trigger}`,
  );
  const onOwnSignIn = await chooseModel(page, OWN_ENTRY, OPUS);
  assert.ok(
    onEntry(onOwnSignIn, "person@example.com") && !onEntry(onOwnSignIn, POOL),
    `A model on the own sign-in entry moves the agent to it: ${onOwnSignIn.trigger}`,
  );
  report.ownSignInLeftOut = { start: ownStart, inPool, onOwnSignIn };

  report.passed = true;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${resolve(OUT, "report.json")}\n`);
  await browser.close();
}
