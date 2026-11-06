// Checks that the right side panel of the web client has the layout and the behavior of the desktop
// panel (#2550). Drives the `Web/Workspace/Connected` and `App/Playground` stories of a running
// Storybook side by side at common desktop widths: default state, the pane list, the Agent settings
// tab and pane, Maximize and Restore, a resize, and Delete on a tab. At a phone width the web client
// alone is checked: an open pane takes the full width under the chat header, which keeps its panel
// button, and the tab row does not cover it.
//
// `bun scripts/web-side-panel-e2e.ts --storybook=<url> [--browser-executable=<path>]`
// Writes .openbot-build/web-side-panel-e2e/report.json and a screenshot of each client, width and
// state, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/web-side-panel-e2e");
const STORIES = { web: "web-workspace--connected", desktop: "app--playground" } as const;
type Client = keyof typeof STORIES;
const DESKTOP_WIDTHS = [1280, 1024];
const PHONE_WIDTH = 390;
const HEIGHT = 800;
const RESIZE_BY = 100;
/**
 * The parts of the panel, and the chat header beside it, that both clients draw with the same markup.
 * The chat and the composer are left out: the height of the composer follows its content.
 */
const PARTS = [
  ".conversation-header",
  ".side-panel-header",
  ".side-panel-tab",
  ".settings-panel",
  ".right-panel-resizer",
] as const;

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

interface Part {
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/** The box and the visible style of each part that shows. */
async function measure(page: Page): Promise<Record<string, Part>> {
  return page.evaluate((selectors) => {
    const parts: Record<string, Part> = {};
    for (const selector of selectors) {
      const element = document.querySelector(`.conversation-panel ${selector}`);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || box.width === 0) continue;
      parts[selector] = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        style: [style.font, style.color, style.backgroundColor, style.borderRadius, style.padding].join(" | "),
      };
    }
    return parts;
  }, PARTS);
}

/** The parts that differ between the two clients. */
function differences(web: Record<string, Part>, desktop: Record<string, Part>) {
  const found: Record<string, { web?: Part; desktop?: Part }> = {};
  for (const selector of PARTS) {
    const a = web[selector];
    const b = desktop[selector];
    if (JSON.stringify(a) !== JSON.stringify(b))
      found[selector] = { ...(a ? { web: a } : {}), ...(b ? { desktop: b } : {}) };
  }
  return found;
}

/** Waits until the animations of the panel and of the chat beside it end. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const panel = document.querySelector(".conversation-panel");
    if (!panel) return;
    const running = [panel, ...panel.querySelectorAll(":scope > *")].flatMap((element) =>
      element
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY),
    );
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function open(browser: Browser, client: Client, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: HEIGHT }, locale: "en-US" });
  await page.goto(`${storybook}/iframe.html?id=${STORIES[client]}&viewMode=story`);
  await page.locator(".side-panel-toggle").first().waitFor({ timeout: 120_000 });
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await settled(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Agent settings" }).click();
  // The settings pane loads on first use.
  await page.locator(".conversation-panel .settings-panel").waitFor({ timeout: 60_000 });
  await settled(page);
}

/** One client at one desktop width, through the states that both clients have. */
async function desktopStates(browser: Browser, client: Client, width: number) {
  const page = await open(browser, client, width);
  const toggle = page.locator(".side-panel-toggle").first();
  const states: Record<string, Record<string, Part>> = {};
  try {
    const closed = {
      expanded: await toggle.getAttribute("aria-expanded"),
      header: await page.locator(".side-panel-header").count(),
    };
    states.closed = await measure(page);

    await toggle.click();
    await page.locator(".side-panel-launcher").waitFor();
    await shot(page, `${client}-${width}-launcher`);
    const launcher = await page.locator(".side-panel-launch").allInnerTexts();

    await openSettings(page);
    states.settings = await measure(page);
    await shot(page, `${client}-${width}-settings`);

    await page.getByRole("button", { name: "Maximize" }).click();
    await settled(page);
    states.maximized = await measure(page);
    const panelWidth = await page.locator(".conversation-panel").evaluate((element) => element.clientWidth);
    await shot(page, `${client}-${width}-maximized`);
    await page.getByRole("button", { name: "Restore" }).click();
    await settled(page);

    const before = await page.locator(".conversation-panel .settings-panel").evaluate((element) => element.clientWidth);
    const handle = await page.locator(".conversation-panel .right-panel-resizer").boundingBox();
    assert.ok(handle, `${client}: the settings pane has no resize handle.`);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - RESIZE_BY, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await settled(page);
    states.resized = await measure(page);
    const after = await page.locator(".conversation-panel .settings-panel").evaluate((element) => element.clientWidth);
    await page.locator(".conversation-panel .right-panel-resizer").focus();
    await page.keyboard.press("End");
    await settled(page);
    const minimumChatWidth = await page
      .locator(".conversation-panel .conversation-header")
      .evaluate((element) => element.clientWidth);

    // Delete closes the focused tab, and the focus goes to the pane list that takes its place.
    await page.locator(".side-panel-tab-select").first().focus();
    await page.keyboard.press("Delete");
    await page.locator(".side-panel-launcher").waitFor();
    // The pane list takes the focus after it renders.
    const focusAfterDelete = await page
      .waitForFunction(() => document.activeElement?.classList.contains("side-panel-launch"), undefined, {
        timeout: 10_000,
      })
      .then(() => true)
      .catch(() => false);
    await toggle.click();
    await page.locator(".side-panel-header").waitFor({ state: "detached" });
    const closedAgain = await toggle.getAttribute("aria-expanded");

    return {
      closed,
      launcher,
      states,
      panelWidth,
      resize: { before, after },
      minimumChatWidth,
      focusAfterDelete,
      closedAgain,
    };
  } finally {
    await page.close();
  }
}

/** Does a click at the middle of the element reach it, and not a part drawn over it? */
function reachable(element: Locator): Promise<boolean> {
  return element.evaluate((target) => {
    const box = target.getBoundingClientRect();
    return target.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
}

async function phone(browser: Browser) {
  const page = await open(browser, "web", PHONE_WIDTH);
  const toggle = page.locator(".side-panel-toggle").first();
  try {
    await toggle.click();
    await page.locator(".side-panel-launcher").waitFor();
    const launcher = await measure(page);
    const toggleReachable = await reachable(toggle);
    await shot(page, `web-${PHONE_WIDTH}-launcher`);

    await openSettings(page);
    const settings = await measure(page);
    const settingsToggleReachable = await reachable(toggle);
    await shot(page, `web-${PHONE_WIDTH}-settings`);

    await page.getByRole("button", { name: "Maximize" }).click();
    await settled(page);
    const maximized = await measure(page);
    await shot(page, `web-${PHONE_WIDTH}-maximized`);
    // A maximized pane covers the chat header, so its own button closes the panel.
    await page.locator(".side-panel-actions").getByRole("button", { name: "Close side panel" }).click();
    await page.locator(".side-panel-header").waitFor({ state: "detached" });
    return { launcher, toggleReachable, settings, settingsToggleReachable, maximized };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
try {
  mkdirSync(OUT, { recursive: true });
  for (const width of DESKTOP_WIDTHS) {
    const web = await desktopStates(browser, "web", width);
    const desktop = await desktopStates(browser, "desktop", width);
    for (const [client, result] of [
      ["web", web],
      ["desktop", desktop],
    ] as const) {
      check(
        `${client} ${width}: the panel starts closed`,
        result.closed.expanded === "false" && result.closed.header === 0,
        result.closed,
      );
      check(
        `${client} ${width}: the panel button opens the pane list`,
        result.launcher.includes("Open Agent settings"),
        result.launcher,
      );
      check(
        `${client} ${width}: a maximized pane covers the chat`,
        result.states.maximized?.[".settings-panel"]?.width === result.panelWidth &&
          result.states.maximized?.[".side-panel-header"]?.width === result.panelWidth &&
          result.states.maximized[".conversation-header"] === undefined,
        result.states.maximized,
      );
      check(
        `${client} ${width}: the resize handle widens the pane`,
        result.resize.after > result.resize.before && result.resize.after - result.resize.before <= RESIZE_BY,
        result.resize,
      );
      check(
        `${client} ${width}: the chat keeps at least 320px when the pane is widest`,
        result.minimumChatWidth >= 320,
        result.minimumChatWidth,
      );
      check(
        `${client} ${width}: Delete on the last tab moves the focus to the pane list`,
        result.focusAfterDelete === true,
      );
      check(`${client} ${width}: the panel button closes the panel`, result.closedAgain === "false");
    }
    for (const state of ["closed", "settings", "maximized", "resized"] as const) {
      const found = differences(web.states[state] ?? {}, desktop.states[state] ?? {});
      check(`${width} ${state}: web and desktop draw the same panel`, Object.keys(found).length === 0, found);
    }
  }

  const result = await phone(browser);
  const full = (part: Part | undefined) => part?.x === 0 && part.width === PHONE_WIDTH;
  const header = result.settings[".conversation-header"];
  const tabs = result.settings[".side-panel-header"];
  check(
    `web ${PHONE_WIDTH}: the panel button stays reachable over the pane list`,
    result.toggleReachable,
    result.launcher,
  );
  check(
    `web ${PHONE_WIDTH}: the chat header keeps the full width over an open pane`,
    full(header) && result.settingsToggleReachable,
    header,
  );
  check(
    `web ${PHONE_WIDTH}: the tab row is a full row under the chat header`,
    full(tabs) && header !== undefined && tabs?.y === header.y + header.height,
    tabs,
  );
  check(
    `web ${PHONE_WIDTH}: the pane takes the full width under the tab row`,
    full(result.settings[".settings-panel"]) &&
      tabs !== undefined &&
      result.settings[".settings-panel"]?.y === tabs.y + tabs.height,
    result.settings[".settings-panel"],
  );
  check(
    `web ${PHONE_WIDTH}: a maximized pane covers the chat header`,
    full(result.maximized[".side-panel-header"]) &&
      result.maximized[".side-panel-header"]?.y === 0 &&
      result.maximized[".conversation-header"] === undefined,
    result.maximized,
  );
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
