// Checks the panes of the desktop side panel after #4805 (one pane registry). Drives the real `App`
// in the `App/Playground` story of a running Storybook: the launcher and the Add menu list the panes
// in registry order, each pane opens from them, a closed tab gives its place to the tab next to it,
// collapse and reopen keep the tabs, Maximize and Restore, each agent keeps its own tabs, the side
// question opens from the composer and its question is deleted on close, and the pane list shows when
// the last tab closes.
//
// `bun scripts/side-panel-panes-e2e.ts --storybook=<url> [--browser-executable=<path>]`
// Writes .openbot-build/side-panel-panes-e2e/report.json and a screenshot of each state, and exits
// non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/side-panel-panes-e2e");
const STORY = "app--playground";
/** The panes that the Chief agent of the story lists, in the order of `SIDE_PANEL_PANES`. */
const LISTED = ["Browser", "Files", "Agent settings", "Voice"];
const WAIT_MS = 15_000;

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
const report: { passed: boolean; checks: typeof checks; errors: string[]; error?: string } = {
  passed: false,
  checks,
  errors: [],
};

/** The tab names of the panes. The Browser pane adds the tabs of its pages to the same tab list. */
const PANE_NAMES = ["Browser", "Files", "Agent settings", "Voice", "Side question"];

/** The pane tabs of the side panel, as "Name" or "Name*" for the selected tab. */
function paneTabs(page: Page): Promise<string[]> {
  return page.evaluate(
    (names) =>
      [...document.querySelectorAll(".side-panel-tabs .side-panel-tab-select")]
        .filter((tab) => names.includes(tab.textContent ?? ""))
        .map((tab) => `${tab.textContent ?? ""}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
    PANE_NAMES,
  );
}

/** Waits until the pane tabs are `expected`, and returns the tabs at the end of the wait. */
async function tabsBecome(page: Page, expected: string[]): Promise<string[]> {
  await page
    .waitForFunction(
      ([names, want]) =>
        JSON.stringify(
          [...document.querySelectorAll(".side-panel-tabs .side-panel-tab-select")]
            .filter((tab) => names.includes(tab.textContent ?? ""))
            .map((tab) => `${tab.textContent ?? ""}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
        ) === JSON.stringify(want),
      [PANE_NAMES, expected] as const,
      { timeout: WAIT_MS },
    )
    .catch(() => undefined);
  return paneTabs(page);
}

function same(actual: string[], expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function addPane(page: Page, name: string): Promise<string[]> {
  await page.getByRole("button", { name: "Add pane" }).click();
  const items = page.locator("[role=menuitem].side-panel-menu-item");
  await items.first().waitFor();
  const listed = await items.allInnerTexts();
  await items.filter({ hasText: name }).first().click();
  return listed.map((text) => text.trim());
}

async function closeTab(page: Page, name: string): Promise<void> {
  await page.locator(`.side-panel-tab-close[title="Close ${name}"]`).click();
}

async function selectAgent(page: Page, name: string): Promise<void> {
  await page.locator(".sidebar").getByText(name, { exact: true }).first().click();
  await page.locator(".conversation-header").getByText(name, { exact: true }).first().waitFor({ timeout: WAIT_MS });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => report.errors.push(error.stack ?? String(error)));
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`, { timeout: 120_000 });
  const toggle = page.locator(".conversation-header .side-panel-toggle");
  await toggle.waitFor({ timeout: 60_000 });

  // The launcher lists the panes that this chat can open, in registry order.
  await toggle.click();
  await page.locator(".side-panel-launcher").waitFor();
  const launcher = (await page.locator(".side-panel-launch").allInnerTexts()).map((text) => text.trim());
  check(
    "launcher: lists the available panes in registry order",
    same(
      launcher,
      LISTED.map((name) => `Open ${name}`),
    ),
    launcher,
  );
  await shot(page, "launcher");

  // A pane opens from the launcher, and the others from the Add menu.
  await page.getByRole("button", { name: "Open Files" }).click();
  check("launcher: opens Files", same(await tabsBecome(page, ["Files*"]), ["Files*"]));
  const addMenu = await addPane(page, "Agent settings");
  check(
    "Add: lists the closed panes in registry order",
    same(
      addMenu,
      LISTED.filter((name) => name !== "Files"),
    ),
    addMenu,
  );
  const withSettings = await tabsBecome(page, ["Files", "Agent settings*"]);
  await page.locator(".conversation-panel .settings-panel").waitFor({ timeout: WAIT_MS });
  check("Add: opens Agent settings and shows its content", same(withSettings, ["Files", "Agent settings*"]));
  await addPane(page, "Browser");
  const withBrowser = await tabsBecome(page, ["Files", "Agent settings", "Browser*"]);
  check("Add: opens Browser", same(withBrowser, ["Files", "Agent settings", "Browser*"]), withBrowser);
  await shot(page, "three-panes");

  // A click on a tab selects its pane.
  await page.getByRole("tab", { name: "Files" }).click();
  const filesSelected = await tabsBecome(page, ["Files*", "Agent settings", "Browser"]);
  check("tab: a click selects its pane", same(filesSelected, ["Files*", "Agent settings", "Browser"]), filesSelected);

  // The selected tab closes, and the tab next to it shows.
  await closeTab(page, "Files");
  const afterClose = await tabsBecome(page, ["Agent settings*", "Browser"]);
  check("close: the tab next to the closed tab shows", same(afterClose, ["Agent settings*", "Browser"]), afterClose);
  // A tab that is not selected closes, and the selection stays.
  await closeTab(page, "Browser");
  const afterOther = await tabsBecome(page, ["Agent settings*"]);
  check("close: the selection stays when another tab closes", same(afterOther, ["Agent settings*"]), afterOther);

  // Collapse and reopen keep the tabs and the selection.
  await addPane(page, "Voice");
  await tabsBecome(page, ["Agent settings", "Voice*"]);
  await page.getByRole("tab", { name: "Agent settings" }).click();
  await tabsBecome(page, ["Agent settings*", "Voice"]);
  await toggle.click();
  await page.locator(".side-panel-header").waitFor({ state: "detached", timeout: WAIT_MS });
  await toggle.click();
  const reopened = await tabsBecome(page, ["Agent settings*", "Voice"]);
  check(
    "collapse: reopening shows the same tabs and selection",
    same(reopened, ["Agent settings*", "Voice"]),
    reopened,
  );

  // Maximize and Restore.
  await page.getByRole("button", { name: "Maximize side panel" }).click();
  const maximized = await page.getByRole("button", { name: "Restore side panel" }).getAttribute("aria-pressed");
  await shot(page, "maximized");
  await page.getByRole("button", { name: "Restore side panel" }).click();
  const restored = await page.getByRole("button", { name: "Maximize side panel" }).getAttribute("aria-pressed");
  check("maximize: Maximize and Restore change the panel", maximized === "true" && restored === "false", {
    maximized,
    restored,
  });

  // Each agent has its own tabs. An agent change closes Agent settings and Files (`resetPanelsForAgent`),
  // so Voice shows during the change.
  await page.getByRole("tab", { name: "Voice" }).click();
  await tabsBecome(page, ["Agent settings", "Voice*"]);
  await selectAgent(page, "Research");
  const researchBefore = await tabsBecome(page, []);
  await toggle.click();
  await page.getByRole("button", { name: "Open Browser" }).click();
  await tabsBecome(page, ["Browser*"]);
  await selectAgent(page, "Chief");
  const chief = await tabsBecome(page, ["Agent settings", "Voice*"]);
  await selectAgent(page, "Research");
  const research = await tabsBecome(page, ["Browser*"]);
  await selectAgent(page, "Chief");
  await tabsBecome(page, ["Agent settings", "Voice*"]);
  check(
    "agents: each agent keeps its own tabs",
    researchBefore.length === 0 && same(chief, ["Agent settings", "Voice*"]) && same(research, ["Browser*"]),
    { researchBefore, chief, research },
  );

  // The side question opens from the composer. Closing its tab deletes the question.
  const composerAdd = page.getByRole("button", { name: "Add to prompt" });
  await composerAdd.click();
  const sideQuestionItem = page.getByRole("menuitem", { name: "Side question" });
  const sideQuestionListed = await sideQuestionItem
    .waitFor({ timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (sideQuestionListed) {
    await sideQuestionItem.click();
    const withQuestion = await tabsBecome(page, ["Agent settings", "Voice", "Side question*"]);
    const box = page.getByRole("textbox", { name: "Ask a side question" });
    await box.fill("Which file did the agent change?");
    check(
      "side question: opens from the composer, and is not in the launcher",
      same(withQuestion, ["Agent settings", "Voice", "Side question*"]),
      withQuestion,
    );
    await shot(page, "side-question");
    await closeTab(page, "Side question");
    const afterQuestion = await tabsBecome(page, ["Agent settings", "Voice*"]);
    await composerAdd.click();
    await sideQuestionItem.click();
    await tabsBecome(page, ["Agent settings", "Voice", "Side question*"]);
    const draftAfterClose = (await box.innerText()).trim();
    check(
      "side question: closing the tab deletes the question",
      same(afterQuestion, ["Agent settings", "Voice*"]) && draftAfterClose === "",
      { afterQuestion, draftAfterClose },
    );
    await closeTab(page, "Side question");
    await tabsBecome(page, ["Agent settings", "Voice*"]);
  } else {
    await page.keyboard.press("Escape");
    check("side question: the composer lists it", false);
  }

  // With no tab, the panel lists the panes.
  await closeTab(page, "Voice");
  await tabsBecome(page, ["Agent settings*"]);
  await page.locator(".side-panel-tab-select").first().focus();
  await page.keyboard.press("Delete");
  await page.locator(".side-panel-launcher").waitFor({ timeout: WAIT_MS });
  check("close: the pane list shows when the last tab closes", (await paneTabs(page)).length === 0);
  await shot(page, "empty");

  check("no page errors", report.errors.length === 0, report.errors);
  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser.close();
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
