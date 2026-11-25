import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/side-panel-panes-e2e");
const STORY = "app--playground";
const LISTED = ["Browser", "Files", "Threads", "Agent settings"];
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

const PAGE = "OpenBot documentation";
const PANE_NAMES = ["Browser", "Files", "Threads", "Agent settings", "Side question", "Page"];
const PAGE_TABS = ".conversation-panel > .side-panel-header .side-panel-page-tab";
const MAIN_HEADER = ".conversation-panel > .side-panel-header";
const MAIN_TABS = `${MAIN_HEADER} .side-panel-tab-select`;
const SPLITS = "section[aria-label='Panel groups']";
const splitTabs = (index: number) => `${SPLITS} > .side-split:nth-of-type(${index}) .side-panel-tab-select`;
const splitHeader = (index: number) => `${SPLITS} > .side-split:nth-of-type(${index}) .side-panel-header`;

function paneTabs(page: Page, selector = MAIN_TABS): Promise<string[]> {
  return page.evaluate(
    ([names, tabs]) =>
      [...document.querySelectorAll(tabs)]
        .map((tab) => ({ tab, name: tab.closest(".side-panel-page-tab") ? "Page" : (tab.textContent ?? "") }))
        .filter(({ name }) => names.includes(name))
        .map(({ tab, name }) => `${name}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
    [PANE_NAMES, selector] as const,
  );
}

async function tabsBecome(page: Page, expected: string[], selector = MAIN_TABS): Promise<string[]> {
  await page
    .waitForFunction(
      ([names, want, tabs]) =>
        JSON.stringify(
          [...document.querySelectorAll(tabs)]
            .map((tab) => ({ tab, name: tab.closest(".side-panel-page-tab") ? "Page" : (tab.textContent ?? "") }))
            .filter(({ name }) => names.includes(name))
            .map(({ tab, name }) => `${name}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
        ) === JSON.stringify(want),
      [PANE_NAMES, expected, selector] as const,
      { timeout: WAIT_MS },
    )
    .catch(() => undefined);
  return paneTabs(page, selector);
}

const OPEN_MENU_ITEMS = "[role=menu][data-expanded] [role=menuitem].side-panel-menu-item";

async function menuClosed(page: Page): Promise<void> {
  await page.locator("[role=menu]").first().waitFor({ state: "detached", timeout: WAIT_MS });
}

async function moveMenu(page: Page, header: string): Promise<string[]> {
  await page.locator(header).getByRole("button", { name: "More actions", exact: true }).click();
  const items = page.locator(OPEN_MENU_ITEMS);
  await items.first().waitFor();
  return (await items.allInnerTexts()).map((text) => text.trim());
}

async function moveSelected(page: Page, header: string, action: string): Promise<void> {
  await moveMenu(page, header);
  await page.locator(OPEN_MENU_ITEMS).filter({ hasText: action }).click();
  await menuClosed(page);
}

async function recordPageVisibility(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browser = window.openbot.browser;
    const setVisible = browser.setVisible.bind(browser);
    document.documentElement.dataset.e2ePageVisibility = "";
    browser.setVisible = (request) => {
      document.documentElement.dataset.e2ePageVisibility += request.visible ? "1" : "0";
      return setVisible(request);
    };
  });
}

function pageVisibility(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.e2ePageVisibility ?? "");
}

function pageVisibilityEnds(page: Page, last: "0" | "1"): Promise<boolean> {
  return page
    .waitForFunction((want) => document.documentElement.dataset.e2ePageVisibility?.endsWith(want) === true, last, {
      timeout: WAIT_MS,
    })
    .then(() => true)
    .catch(() => false);
}

async function menuPlacedFrames(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll<HTMLElement>("[data-popper-positioner]")].some(
        (positioner) => positioner.style.transform !== "",
      ),
    null,
    { timeout: WAIT_MS },
  );
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
      ),
  );
}

async function toggleBox(page: Page): Promise<string> {
  return page.locator(".side-panel-toggle").evaluate((button) => {
    const box = button.getBoundingClientRect();
    return `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
  });
}

async function sampleWhileSwitching(page: Page): Promise<{ toggle: string[]; headerGaps: number[] }> {
  return page.evaluate(
    () =>
      new Promise<{ toggle: string[]; headerGaps: number[] }>((resolve) => {
        const panel = document.querySelector(".conversation-panel");
        const padding = () => (panel ? getComputedStyle(panel).paddingInlineEnd : "");
        const boxes = new Set<string>();
        const headerGaps: number[] = [];
        let last = padding();
        let changed = false;
        let still = 0;
        const read = () => {
          const button = document.querySelector(".side-panel-toggle");
          if (button) {
            const box = button.getBoundingClientRect();
            boxes.add(`${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);
          }
          const header = panel?.querySelector(":scope > .side-panel-header");
          if (panel && header) {
            const chatEdge = panel.getBoundingClientRect().right - Number.parseFloat(padding());
            headerGaps.push(Math.round(header.getBoundingClientRect().left - chatEdge));
          }
          const current = padding();
          changed ||= current !== last;
          still = current === last ? still + 1 : 0;
          last = current;
          if (changed && still >= 5) resolve({ toggle: [...boxes], headerGaps });
          else requestAnimationFrame(read);
        };
        document.querySelector<HTMLElement>(".side-panel-toggle")?.click();
        requestAnimationFrame(read);
      }),
  );
}

async function chatWidth(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector("[role=textbox][aria-label^='Message ']")?.getBoundingClientRect().width ?? 0,
  );
}

async function shows(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .waitFor({ timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
}

function same(actual: string[], expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function addPane(page: Page, name: string): Promise<string[]> {
  const merged = !(await headerActions(page)).includes("Add pane");
  await page
    .locator(MAIN_HEADER)
    .getByRole("button", { name: merged ? "More actions" : "Add pane", exact: true })
    .click();
  const items = page.locator(OPEN_MENU_ITEMS);
  await items.first().waitFor();
  const listed = await items.allInnerTexts();
  await items.filter({ hasText: name }).first().click();
  await menuClosed(page);
  return listed.map((text) => text.trim());
}

async function closeTab(page: Page, name: string): Promise<void> {
  await page.locator(`.side-panel-tab-close[title="Close ${name}"]`).click();
}

function pageTabs(page: Page): Promise<string[]> {
  return page
    .locator(`${PAGE_TABS} .side-panel-tab-select`)
    .evaluateAll((tabs) =>
      tabs.map((tab) => `${tab.textContent ?? ""}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`),
    );
}

async function pagesBecome(page: Page, count: number, selected: number): Promise<string[]> {
  await page
    .waitForFunction(
      ([tabs, want, index]) => {
        const items = [...document.querySelectorAll(`${tabs} .side-panel-tab-select`)];
        return items.length === want && items[index]?.getAttribute("aria-selected") === "true";
      },
      [PAGE_TABS, count, selected] as const,
      { timeout: WAIT_MS },
    )
    .catch(() => undefined);
  return pageTabs(page);
}

async function closePage(page: Page): Promise<void> {
  await page.locator(`${MAIN_HEADER} .side-panel-page-tab .side-panel-tab-close`).first().click();
}

const MERGED_ACTIONS = ["Add pane", "More actions", "Maximize side panel", "Restore side panel"];

async function headerActions(page: Page): Promise<string[]> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  const labels = await page
    .locator(`${MAIN_HEADER} .side-panel-actions > button`)
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  return labels.filter((label) => MERGED_ACTIONS.includes(label));
}

async function closeOpenMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => document.activeElement?.closest("[role=menu]") != null, null, { timeout: WAIT_MS });
  await page.keyboard.press("Escape");
  await menuClosed(page);
}

async function runHeaderAction(page: Page, name: string): Promise<void> {
  if ((await headerActions(page)).includes(name)) {
    await page.locator(MAIN_HEADER).getByRole("button", { name, exact: true }).click();
    return;
  }
  await page.locator(MAIN_HEADER).getByRole("button", { name: "More actions", exact: true }).click();
  await page.locator(OPEN_MENU_ITEMS).filter({ hasText: name }).first().click();
  await menuClosed(page);
}

async function offersHeaderAction(page: Page, name: string): Promise<boolean> {
  const labels = await headerActions(page);
  if (labels.includes(name)) return true;
  if (!labels.includes("More actions")) return false;
  await page.locator(MAIN_HEADER).getByRole("button", { name: "More actions", exact: true }).click();
  await page.locator(OPEN_MENU_ITEMS).first().waitFor();
  const items = (await page.locator(OPEN_MENU_ITEMS).allInnerTexts()).map((text) => text.trim());
  await closeOpenMenu(page);
  return items.includes(name);
}

async function openPage(page: Page, count: number): Promise<void> {
  await page.locator(".browser-pane-view").getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: /^New browser tab/ }).click();
  await menuClosed(page);
  await pagesBecome(page, count, count - 1);
}

async function closeLastPages(page: Page, from: number, to: number): Promise<void> {
  for (let count = from; count > to; count -= 1) {
    await page.locator(PAGE_TABS).last().locator(".side-panel-tab-close").click();
    await page
      .locator(PAGE_TABS)
      .nth(count - 1)
      .waitFor({ state: "detached", timeout: WAIT_MS });
  }
}

async function choosePageTabs(page: Page, item: string, from: "tab" | "more"): Promise<void> {
  if (from === "tab") {
    await page.locator(MAIN_HEADER).getByRole("tab", { name: "Browser", exact: true }).click({ button: "right" });
  } else {
    await page.locator(MAIN_HEADER).getByRole("button", { name: "More actions", exact: true }).click();
  }
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  await menuClosed(page);
}

function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 4;
}

function groupHeights(page: Page): Promise<number[]> {
  return page.evaluate(
    (splits) =>
      [...document.querySelectorAll(`${splits} > .side-split`)].map((group) =>
        Math.round(group.getBoundingClientRect().height),
      ),
    SPLITS,
  );
}

async function groupHeightsChange(page: Page, lowerBefore: number): Promise<number[]> {
  await page.waitForFunction(
    ([splits, before]) => {
      const lower = document.querySelector(`${splits} > .side-split:nth-of-type(2)`);
      return lower !== null && Math.abs(Math.round(lower.getBoundingClientRect().height) - before) > 4;
    },
    [SPLITS, lowerBefore] as const,
    { timeout: WAIT_MS },
  );
  return groupHeights(page);
}

function splitAreaHeight(page: Page): Promise<number> {
  return page.evaluate(
    (splits) => Math.round(document.querySelector(splits)?.getBoundingClientRect().height ?? 0),
    SPLITS,
  );
}

async function splitAreaChange(page: Page, before: number): Promise<number> {
  await page.waitForFunction(
    ([splits, height]) =>
      Math.abs(Math.round(document.querySelector(splits)?.getBoundingClientRect().height ?? 0) - height) > 4,
    [SPLITS, before] as const,
    { timeout: WAIT_MS },
  );
  return splitAreaHeight(page);
}

function savedSplitLayout(page: Page): Promise<{ areas?: Record<string, number>; lower?: number | null }> {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem("openbot:side-split-layout") ?? "{}"));
}

async function dragHandle(page: Page, name: string, distance: number): Promise<void> {
  const box = await page.getByRole("separator", { name, exact: true }).boundingBox();
  assert.ok(box, `${name} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance / 2);
  await page.mouse.move(x, y + distance);
  await page.mouse.up();
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
  const toggle = page.locator(".side-panel-toggle");
  await toggle.waitFor({ timeout: 60_000 });

  const closedToggle = await toggleBox(page);
  const opening = await sampleWhileSwitching(page);
  await page.locator(".side-panel-launcher").waitFor();
  const closing = await sampleWhileSwitching(page);
  await page.locator(".side-panel-launcher").waitFor({ state: "detached" });
  const reopening = await sampleWhileSwitching(page);
  await page.locator(".side-panel-launcher").waitFor();
  check(
    "toggle: keeps its place and size while the side panel opens and closes",
    [opening, closing, reopening].every((sample) => same(sample.toggle, [closedToggle])),
    { closedToggle, opening: opening.toggle, closing: closing.toggle, reopening: reopening.toggle },
  );
  check(
    "side panel header: comes in on the chat edge while the side panel opens",
    [opening, reopening].every(
      (sample) => sample.headerGaps.length > 1 && sample.headerGaps.every((gap) => Math.abs(gap) <= 1),
    ),
    { opening: opening.headerGaps, reopening: reopening.headerGaps },
  );
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
  const oneTab = await tabsBecome(page, ["Files", "Agent settings", "Browser*"]);
  const cards = await shows(page, ".conversation-panel .browser-preview-card");
  const oneTabPages = await pageTabs(page);
  check(
    "browser: by default the pages show as cards in one Browser tab",
    same(oneTab, ["Files", "Agent settings", "Browser*"]) && cards && oneTabPages.length === 0,
    { oneTab, cards, oneTabPages },
  );
  await shot(page, "pages-in-one-tab");
  await page.locator(".conversation-panel .browser-preview-open").first().click();
  const expanded = await shows(page, "#browser-expanded-panel:not([hidden])");
  await page.locator("#browser-expanded-panel .browser-hide").click();
  const backToCards = await shows(page, ".conversation-panel .browser-preview-card");
  check("browser: a card opens the page in the large browser view", expanded && backToCards, {
    expanded,
    backToCards,
  });
  await choosePageTabs(page, "Show pages as tabs", "tab");
  const withBrowser = await tabsBecome(page, ["Files", "Agent settings", "Page*"]);
  const paneView = await shows(page, ".conversation-panel .browser-pane-view:not([hidden])");
  const firstPages = await pageTabs(page);
  check(
    "browser: the page shows as its own tab with the live page, not a Browser tab",
    same(withBrowser, ["Files", "Agent settings", "Page*"]) && paneView && same(firstPages, [`${PAGE}*`]),
    { withBrowser, paneView, firstPages },
  );
  await page.locator(".browser-pane-view").getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: /^New browser tab/ }).click();
  await menuClosed(page);
  const twoPages = await pagesBecome(page, 2, 1);
  check(
    "browser: a new page opens a second page tab and selects it",
    twoPages.length === 2 && twoPages[0] === PAGE && twoPages[1]?.endsWith("*") === true,
    twoPages,
  );
  let openPages = 2;
  let crowdedActions = await headerActions(page);
  while (!same(crowdedActions, ["More actions"]) && openPages < 8) {
    openPages += 1;
    await openPage(page, openPages);
    crowdedActions = await headerActions(page);
  }
  await shot(page, "crowded-header");
  const crowdedWidths = await page.evaluate((header) => {
    const tabs = [...document.querySelectorAll<HTMLElement>(`${header} .side-panel-tab`)];
    const sized = (name: string) => {
      const tab = tabs.find((item) => item.querySelector(".side-panel-tab-label")?.textContent === name);
      const label = tab?.querySelector<HTMLElement>(".side-panel-tab-label");
      return { width: tab?.offsetWidth ?? 0, cut: label ? label.scrollWidth > label.clientWidth : true };
    };
    return { files: sized("Files"), settings: sized("Agent settings") };
  }, MAIN_HEADER);
  check(
    "header: a short tab gets only the width of its label when the tabs have no space",
    !crowdedWidths.files.cut &&
      crowdedWidths.files.width > 0 &&
      crowdedWidths.files.width < crowdedWidths.settings.width,
    crowdedWidths,
  );
  await page.locator(MAIN_HEADER).getByRole("button", { name: "More actions", exact: true }).click();
  await page.locator(OPEN_MENU_ITEMS).first().waitFor();
  const crowdedMenu = (await page.locator(OPEN_MENU_ITEMS).allInnerTexts()).map((text) => text.trim());
  await closeOpenMenu(page);
  check(
    "header: Add, More and Maximize become one menu when the tabs have no space",
    same(crowdedActions, ["More actions"]) &&
      crowdedMenu.includes("New browser tab") &&
      crowdedMenu.includes("Split down") &&
      crowdedMenu.includes("Maximize side panel"),
    { openPages, crowdedActions, crowdedMenu },
  );
  await closeLastPages(page, openPages, 2);
  await shot(page, "page-tabs");
  await page.locator(PAGE_TABS).first().locator(".side-panel-tab-select").click();
  const firstSelected = await pagesBecome(page, 2, 0);
  await page.locator(PAGE_TABS).nth(1).locator(".side-panel-tab-close").click();
  const afterPageClose = await pagesBecome(page, 1, 0);
  check(
    "browser: a click selects a page tab, and its close button closes only that page",
    firstSelected[0] === `${PAGE}*` && same(afterPageClose, [`${PAGE}*`]),
    { firstSelected, afterPageClose },
  );
  await shot(page, "three-panes");

  await page.getByRole("tab", { name: "Files" }).click();
  const filesSelected = await tabsBecome(page, ["Files*", "Agent settings", "Page"]);
  check("tab: a click selects its pane", same(filesSelected, ["Files*", "Agent settings", "Page"]), filesSelected);

  await closeTab(page, "Files");
  const afterClose = await tabsBecome(page, ["Agent settings*", "Page"]);
  check("close: the tab next to the closed tab shows", same(afterClose, ["Agent settings*", "Page"]), afterClose);
  await closePage(page);
  const afterOther = await tabsBecome(page, ["Agent settings*"]);
  check("close: the selection stays when another tab closes", same(afterOther, ["Agent settings*"]), afterOther);
  const roomyActions = await headerActions(page);
  check(
    "header: the separate buttons come back when the tabs have space again",
    same(roomyActions, ["Add pane", "Maximize side panel"]),
    roomyActions,
  );

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

  await runHeaderAction(page, "Maximize side panel");
  const maximized = await offersHeaderAction(page, "Restore side panel");
  await shot(page, "maximized");
  await runHeaderAction(page, "Restore side panel");
  const restored = await offersHeaderAction(page, "Maximize side panel");
  check("maximize: Maximize and Restore change the panel", maximized && restored, {
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
  await tabsBecome(page, ["Page*"]);
  await selectAgent(page, "Chief");
  const chief = await tabsBecome(page, ["Agent settings", "Files*"]);
  await selectAgent(page, "Research");
  const research = await tabsBecome(page, ["Page*"]);
  await selectAgent(page, "Chief");
  await tabsBecome(page, ["Agent settings", "Files*"]);
  check(
    "agents: each agent keeps its own tabs",
    researchBefore.length === 0 && same(chief, ["Agent settings", "Files*"]) && same(research, ["Page*"]),
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
  const researchReopened = await tabsBecome(page, ["Page*"]);
  await selectAgent(page, "Chief");
  const chiefOpen = await tabsBecome(page, ["Agent settings", "Files*"]);
  check(
    "agents: the panel stays closed when another agent opens",
    researchClosed && same(researchReopened, ["Page*"]) && same(chiefOpen, ["Agent settings", "Files*"]),
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

  const widthBefore = await chatWidth(page);
  await moveSelected(page, MAIN_HEADER, "Split down");
  const mainAfterSplit = await tabsBecome(page, ["Agent settings*"]);
  const splitAfterSplit = await tabsBecome(page, ["Files*"], splitTabs(1));
  const filesInSplit = await shows(page, `${SPLITS} .side-split-body .conversation-files-panel`);
  const widthAfterSplit = await chatWidth(page);
  check(
    "split: Split down moves the selected tab to a new group under the main group",
    same(mainAfterSplit, ["Agent settings*"]) && same(splitAfterSplit, ["Files*"]) && filesInSplit,
    { mainAfterSplit, splitAfterSplit, filesInSplit },
  );
  check("split: the chat keeps its width", widthBefore > 0 && widthAfterSplit === widthBefore, {
    widthBefore,
    widthAfterSplit,
  });
  await shot(page, "split-two");

  await addPane(page, "Browser");
  await addPane(page, "Threads");
  await tabsBecome(page, ["Agent settings", "Page", "Threads*"]);
  await moveSelected(page, MAIN_HEADER, "Split down");
  const mainThree = await tabsBecome(page, ["Agent settings", "Page*"]);
  const firstThree = await tabsBecome(page, ["Threads*"], splitTabs(1));
  const secondThree = await tabsBecome(page, ["Files*"], splitTabs(2));
  const widthAtMax = await chatWidth(page);
  await shot(page, "split-three");
  await recordPageVisibility(page);
  const splitMore = page.locator(splitHeader(1)).getByRole("button", { name: "More actions", exact: true });
  await splitMore.click();
  await page.locator(OPEN_MENU_ITEMS).first().waitFor();
  await menuPlacedFrames(page);
  await splitMore.click();
  await menuClosed(page);
  const besideSplitMenu = await pageVisibility(page);
  const mainMenuAtMax = await moveMenu(page, MAIN_HEADER);
  const hiddenUnderMainMenu = await pageVisibilityEnds(page, "0");
  check(
    "browser: a menu hides the page only while it covers the page",
    !besideSplitMenu.includes("0") && hiddenUnderMainMenu,
    { besideSplitMenu, underMainMenu: await pageVisibility(page) },
  );
  check(
    "split: the side panel holds three groups and offers no fourth",
    same(mainThree, ["Agent settings", "Page*"]) &&
      same(firstThree, ["Threads*"]) &&
      same(secondThree, ["Files*"]) &&
      !mainMenuAtMax.includes("Split down") &&
      widthAtMax === widthBefore,
    { mainThree, firstThree, secondThree, mainMenuAtMax, widthAtMax },
  );

  await page.locator(OPEN_MENU_ITEMS).filter({ hasText: "Move to group below" }).click();
  await menuClosed(page);
  const mainAfterDown = await tabsBecome(page, ["Agent settings*"]);
  const firstAfterDown = await tabsBecome(page, ["Threads", "Page*"], splitTabs(1));
  check(
    "split: Move to group below moves the tab into the next group",
    same(mainAfterDown, ["Agent settings*"]) && same(firstAfterDown, ["Threads", "Page*"]),
    { mainAfterDown, firstAfterDown },
  );

  const [upperBefore = 0, lowerBefore = 0] = await groupHeights(page);
  const areaBefore = await splitAreaHeight(page);
  await dragHandle(page, "Resize panel group 3", -60);
  const [upperDragged = 0, lowerDragged = 0] = await groupHeightsChange(page, lowerBefore);
  const areaAfterInner = await splitAreaHeight(page);
  const savedLower = await savedSplitLayout(page);
  check(
    "split: the handle between two groups resizes them, the area keeps its height, and the app saves the size",
    near(upperDragged, upperBefore - 60) &&
      near(lowerDragged, lowerBefore + 60) &&
      near(areaAfterInner, areaBefore) &&
      typeof savedLower.lower === "number",
    { upperBefore, lowerBefore, upperDragged, lowerDragged, areaBefore, areaAfterInner, savedLower },
  );

  await page.getByRole("separator", { name: "Resize panel group 3", exact: true }).dblclick();
  const [upperReset = 0, lowerReset = 0] = await groupHeightsChange(page, lowerDragged);
  const savedAfterReset = await savedSplitLayout(page);
  check(
    "split: a double-click on the handle gives the two groups the same height",
    near(upperReset, lowerReset) && savedAfterReset.lower === null,
    { upperReset, lowerReset, savedAfterReset },
  );

  await dragHandle(page, "Resize panel groups", -80);
  const areaGrown = await splitAreaChange(page, areaBefore);
  const savedArea = await savedSplitLayout(page);
  await page.getByRole("separator", { name: "Resize panel groups", exact: true }).dblclick();
  const areaReset = await splitAreaChange(page, areaGrown);
  check(
    "split: the handle above the groups resizes the area, saves it, and a double-click resets it",
    near(areaGrown, areaBefore + 80) && typeof savedArea.areas?.["2"] === "number" && near(areaReset, areaBefore),
    { areaBefore, areaGrown, savedArea, areaReset },
  );

  await moveSelected(page, splitHeader(2), "Move to group above");
  const mergedUp = await tabsBecome(page, ["Threads", "Page", "Files*"], splitTabs(1));
  const groupsAfterMerge = await page.locator(`${SPLITS} > .side-split`).count();
  check(
    "split: Move to group above moves the tab, and the empty group closes",
    same(mergedUp, ["Threads", "Page", "Files*"]) && groupsAfterMerge === 1,
    { mergedUp, groupsAfterMerge },
  );

  await moveSelected(page, splitHeader(1), "Move to group above");
  const mainAfterReturn = await tabsBecome(page, ["Agent settings", "Files*"]);
  const splitAfterReturn = await tabsBecome(page, ["Threads", "Page*"], splitTabs(1));
  check(
    "split: Move to group above returns a tab to the main group",
    same(mainAfterReturn, ["Agent settings", "Files*"]) && same(splitAfterReturn, ["Threads", "Page*"]),
    { mainAfterReturn, splitAfterReturn },
  );

  await page.locator(splitHeader(1)).getByRole("button", { name: "Close panel group" }).click();
  const groupClosed = await page
    .locator(SPLITS)
    .waitFor({ state: "detached", timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
  const mainAfterGroupClose = await tabsBecome(page, ["Agent settings", "Files*"]);
  check(
    "split: Close panel group closes its tabs and keeps the main group",
    groupClosed && same(mainAfterGroupClose, ["Agent settings", "Files*"]),
    { groupClosed, mainAfterGroupClose },
  );

  await closeTab(page, "Files");
  await tabsBecome(page, ["Agent settings*"]);
  await page.locator(".side-panel-tab-select").first().focus();
  await page.keyboard.press("Delete");
  await page.locator(".side-panel-launcher").waitFor({ timeout: WAIT_MS });
  check("close: the pane list shows when the last tab closes", (await paneTabs(page)).length === 0);

  await page.reload();
  await toggle.waitFor({ timeout: 60_000 });
  if ((await page.locator(".side-panel-launcher").count()) === 0) await toggle.click();
  await page.getByRole("button", { name: "Open Browser" }).click();
  const afterReload = await tabsBecome(page, ["Page*"]);
  await choosePageTabs(page, "Show pages in one tab", "more");
  const backToOneTab = await tabsBecome(page, ["Browser*"]);
  const cardsAgain = await shows(page, ".conversation-panel .browser-preview-card");
  check(
    "browser: the app keeps the page tabs choice after a reload, and More actions changes it back",
    same(afterReload, ["Page*"]) && same(backToOneTab, ["Browser*"]) && cardsAgain,
    { afterReload, backToOneTab, cardsAgain },
  );
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
