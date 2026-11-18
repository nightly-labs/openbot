// Checks that the browser message box does not cover the page while the agent asks the user to do a step
// on it, such as a CAPTCHA (#12206). It drives the real `BrowserDock` in a running Storybook and changes
// the island as the agent does.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/browser-dock-takeover-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/browser-dock-takeover-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserDockIsland } from "@openbot/contracts/ipc";
import { chromium, type Page } from "playwright-core";

declare global {
  interface Window {
    /** The channel of the Storybook preview, which changes the args of the open story. */
    __STORYBOOK_ADDONS_CHANNEL__?: {
      emit: (
        event: "updateStoryArgs",
        payload: { storyId: string; updatedArgs: { island: BrowserDockIsland | null } },
      ) => void;
    };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/browser-dock-takeover-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

const STORY = "conversation-browserdock";
const REQUEST: BrowserDockIsland = { kind: "activity", control: "request" };

interface Report {
  cases: string[];
  error?: string;
  passed: boolean;
}

const report: Report = { cases: [], passed: false };

async function openStory(page: Page, name: string): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${STORY}--${name}&viewMode=story`);
  await page.locator(".browser-dock").waitFor({ timeout: 60_000 });
}

/** Changes the island of the open story, as the host does when the agent's state changes. */
async function setIsland(page: Page, name: string, island: BrowserDockIsland | null): Promise<void> {
  await page.evaluate(
    ({ storyId, island }) => {
      const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel) throw new Error("Storybook has no channel.");
      channel.emit("updateStoryArgs", { storyId, updatedArgs: { island } });
    },
    { storyId: `${STORY}--${name}`, island },
  );
}

async function waitTucked(page: Page, tucked: boolean): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const dock = document.querySelector(".browser-dock");
      return dock?.getAttribute("data-phase") === (expected ? "hidden" : "open");
    },
    tucked,
    { timeout: 10_000 },
  );
}

/** Two frames, so the effects and the microtasks that a change scheduled have run. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))));

/** Waits until no motion of the dock runs, so a box that would open has started to open. */
async function settleMotion(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((motion) => motion.playState !== "running"));
  await settle(page);
}

/** True when a click on the page above the tab, where the open box would be, reaches the page. */
async function pageGetsClick(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const tab = document.querySelector(".browser-dock-tab");
    if (!tab) return false;
    const box = tab.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top - 40);
    return hit !== null && !hit.closest(".browser-dock");
  });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });

  // 1. A dock that opens on a step starts as the tab, and the page above the tab gets the clicks.
  await openStory(page, "page-request");
  await waitTucked(page, true);
  const tab = page.getByRole("button", { name: /needs you on this page/ });
  assert.ok(await tab.isVisible(), "The tab must say that the agent needs the user on the page.");
  assert.ok(await pageGetsClick(page), "The page above the tab must get the clicks.");
  assert.equal(
    await page.locator(".browser-dock-tab-avatar").getAttribute("data-unread"),
    "",
    "The tab must show the unread mark while the agent needs the user.",
  );
  await page.screenshot({ path: resolve(OUT, "step-tab.png") });
  report.cases.push("A dock that opens on a step starts as the tab, and the page above it gets the clicks.");

  // 2. The tab opens the box with I’m done, and the box stays open while the step goes on.
  await tab.click();
  await waitTucked(page, false);
  await page.getByRole("button", { name: "I’m done", exact: true }).waitFor();
  await settleMotion(page);
  assert.equal(await page.locator(".browser-dock").getAttribute("data-phase"), "open");
  await page.screenshot({ path: resolve(OUT, "step-open.png") });
  report.cases.push("The tab opens the box with I’m done, and the box stays open during the step.");

  // 3. An open box hides when a step starts, and shows again when the step ends.
  await openStory(page, "agent-acting");
  await waitTucked(page, false);
  await setIsland(page, "agent-acting", REQUEST);
  await waitTucked(page, true);
  assert.ok(await pageGetsClick(page), "The page above the tab must get the clicks during the step.");
  await setIsland(page, "agent-acting", null);
  await waitTucked(page, false);
  await page.getByRole("textbox", { name: /^Message to / }).waitFor();
  report.cases.push("An open box hides when a step starts and shows again when the step ends.");

  // 4. A box that the user hid stays hidden after the step.
  await openStory(page, "idle");
  await page.getByRole("button", { name: "Hide the message box" }).click();
  await waitTucked(page, true);
  await setIsland(page, "idle", REQUEST);
  await setIsland(page, "idle", null);
  await page.waitForFunction(() =>
    document.querySelector(".browser-dock-tab-label")?.textContent?.startsWith("Message"),
  );
  await settleMotion(page);
  assert.equal(await page.locator(".browser-dock").getAttribute("data-phase"), "hidden");
  report.cases.push("A box that the user hid stays hidden after the step.");

  // 5. A code card in a step shows the box. The page step after it hides the box, and the end shows it.
  await openStory(page, "secret-request");
  await waitTucked(page, false);
  await setIsland(page, "secret-request", REQUEST);
  await waitTucked(page, true);
  await setIsland(page, "secret-request", null);
  await waitTucked(page, false);
  report.cases.push("A page step after a code card hides the box, and the end of the step shows it.");

  // 6. When the user takes the page, the box stays as it is.
  await openStory(page, "user-control");
  await waitTucked(page, false);
  await page.getByRole("button", { name: "I’m done", exact: true }).waitFor();
  await settleMotion(page);
  assert.equal(await page.locator(".browser-dock").getAttribute("data-phase"), "open");
  report.cases.push("When the user takes the page, the box stays open with I’m done.");

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
