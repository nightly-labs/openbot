import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/side-panel-panes-e2e");
const STORY = "app--playground";
const LISTED = ["Browser", "Files", "Agent settings"];
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

const PANE_NAMES = ["Browser", "Files", "Agent settings", "Side question"];

function paneTabs(page: Page): Promise<string[]> {
  return page.evaluate(
    (names) =>
      [...document.querySelectorAll(".side-panel-tabs .side-panel-tab-select")]
        .filter((tab) => names.includes(tab.textContent ?? ""))
        .map((tab) => `${tab.textContent ?? ""}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
    PANE_NAMES,
  );
}

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

  await page.getByRole("tab", { name: "Files" }).click();
  const filesSelected = await tabsBecome(page, ["Files*", "Agent settings", "Browser"]);
  check("tab: a click selects its pane", same(filesSelected, ["Files*", "Agent settings", "Browser"]), filesSelected);

  await closeTab(page, "Files");
  const afterClose = await tabsBecome(page, ["Agent settings*", "Browser"]);
  check("close: the tab next to the closed tab shows", same(afterClose, ["Agent settings*", "Browser"]), afterClose);
  await closeTab(page, "Browser");
  const afterOther = await tabsBecome(page, ["Agent settings*"]);
  check("close: the selection stays when another tab closes", same(afterOther, ["Agent settings*"]), afterOther);

  await addPane(page, "Files");
  await tabsBecome(page, ["Agent settings", "Files*"]);
  await page.getByRole("tab", { name: "Agent settings" }).click();
  await tabsBecome(page, ["Agent settings*", "Files"]);
  await toggle.click();
  await page.locator(".side-panel-header").waitFor({ state: "detached", timeout: WAIT_MS });
  await toggle.click();
  const reopened = await tabsBecome(page, ["Agent settings*", "Files"]);
  check(
    "collapse: reopening shows the same tabs and selection",
    same(reopened, ["Agent settings*", "Files"]),
    reopened,
  );

  await page.getByRole("button", { name: "Maximize side panel" }).click();
  const maximized = await page.getByRole("button", { name: "Restore side panel" }).getAttribute("aria-pressed");
  await shot(page, "maximized");
  await page.getByRole("button", { name: "Restore side panel" }).click();
  const restored = await page.getByRole("button", { name: "Maximize side panel" }).getAttribute("aria-pressed");
  check("maximize: Maximize and Restore change the panel", maximized === "true" && restored === "false", {
    maximized,
    restored,
  });

  await page.getByRole("tab", { name: "Files" }).click();
  await tabsBecome(page, ["Agent settings", "Files*"]);
  await selectAgent(page, "Research");
  const researchBefore = await tabsBecome(page, []);
  const researchLauncher = await page
    .locator(".side-panel-launcher")
    .waitFor({ timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
  check("agents: the panel stays open when another agent opens", researchLauncher);
  await page.getByRole("button", { name: "Open Browser" }).click();
  await tabsBecome(page, ["Browser*"]);
  await selectAgent(page, "Chief");
  const chief = await tabsBecome(page, ["Agent settings", "Files*"]);
  await selectAgent(page, "Research");
  const research = await tabsBecome(page, ["Browser*"]);
  await selectAgent(page, "Chief");
  await tabsBecome(page, ["Agent settings", "Files*"]);
  check(
    "agents: each agent keeps its own tabs",
    researchBefore.length === 0 && same(chief, ["Agent settings", "Files*"]) && same(research, ["Browser*"]),
    { researchBefore, chief, research },
  );

  await toggle.click();
  await page.locator(".side-panel-header").waitFor({ state: "detached", timeout: WAIT_MS });
  await selectAgent(page, "Research");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Message Research", null, {
    timeout: WAIT_MS,
  });
  const researchClosed = (await page.locator(".side-panel-header").count()) === 0;
  await toggle.click();
  const researchReopened = await tabsBecome(page, ["Browser*"]);
  await selectAgent(page, "Chief");
  const chiefOpen = await tabsBecome(page, ["Agent settings", "Files*"]);
  check(
    "agents: the panel stays closed when another agent opens",
    researchClosed && same(researchReopened, ["Browser*"]) && same(chiefOpen, ["Agent settings", "Files*"]),
    { researchClosed, researchReopened, chiefOpen },
  );

  const composerAdd = page.getByRole("button", { name: "Add to prompt" });
  await composerAdd.click();
  const sideQuestionItem = page.getByRole("menuitem", { name: "Side question" });
  const sideQuestionListed = await sideQuestionItem
    .waitFor({ timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (sideQuestionListed) {
    await sideQuestionItem.click();
    const withQuestion = await tabsBecome(page, ["Agent settings", "Files", "Side question*"]);
    const box = page.getByRole("textbox", { name: "Ask a side question" });
    await box.fill("Which file did the agent change?");
    check(
      "side question: opens from the composer, and is not in the launcher",
      same(withQuestion, ["Agent settings", "Files", "Side question*"]),
      withQuestion,
    );
    await shot(page, "side-question");
    await closeTab(page, "Side question");
    const afterQuestion = await tabsBecome(page, ["Agent settings", "Files*"]);
    await composerAdd.click();
    await sideQuestionItem.click();
    await tabsBecome(page, ["Agent settings", "Files", "Side question*"]);
    const draftAfterClose = (await box.innerText()).trim();
    check(
      "side question: closing the tab deletes the question",
      same(afterQuestion, ["Agent settings", "Files*"]) && draftAfterClose === "",
      { afterQuestion, draftAfterClose },
    );
    await closeTab(page, "Side question");
    await tabsBecome(page, ["Agent settings", "Files*"]);
  } else {
    await page.keyboard.press("Escape");
    check("side question: the composer lists it", false);
  }

  await closeTab(page, "Files");
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
