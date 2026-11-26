import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { parseBrowserToolText } from "./browser-snapshot-text";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const FREEZE_MS = 3_000;
const STILL_WINDOW_MS = 2_500;
const STATE_DEADLINE_MS = 20_000;
const VIEW_BOUNDS = { x: 0, y: 0, width: 800, height: 600 };
const OWNERS = [{ id: "fixture-agent", threadId: "fixture-thread" }];

const TIMER_PAGE = `<!doctype html><meta charset="utf-8"><title>tick 0</title>
<main><p id="out">Idle timer page</p><button onclick="document.getElementById('out').textContent = 'activated'">Memory check</button></main>
<script>
  let ticks = 0;
  window.lifecycle = [];
  document.addEventListener("freeze", () => window.lifecycle.push("freeze"));
  document.addEventListener("resume", () => window.lifecycle.push("resume"));
  window.readTicks = () => ticks;
  setInterval(() => {
    ticks += 1;
    document.title = "tick " + ticks;
  }, 50);
</script>`;

const scriptSchema = z.object({
  status: z.literal("completed"),
  value: z.object({
    before: z.number(),
    after: z.number(),
    lifecycle: z.array(z.string()),
  }),
});

const cases: string[] = [];
const measurements: Record<string, number | string | boolean> = {};
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(TIMER_PAGE);
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;
let currentPhase = "entry";

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  phase("entry-start");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const timerUrl = `http://127.0.0.1:${address.port}/timer`;
    await app.whenReady();
    phase("electron-ready");
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const statePath = join(fixtureRoot, "tabs.json");
    const hostOptions = { tabSleep: { sweepMs: 100, awakeGraceMs: 10 * 60_000, freezeMs: FREEZE_MS } };
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), statePath, hostOptions);
    const host = browser;
    const params = (tool: string, args: DynamicToolCallParams["arguments"]): DynamicToolCallParams => ({
      namespace: "openbot_browser",
      tool,
      arguments: args,
      ownerAgentId: "fixture-agent",
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      callId: `idle-freeze-${++sequence}`,
    });
    const call = (target: BrowserHost, tool: string, args: DynamicToolCallParams["arguments"]) =>
      runCauseEffect(target.handleDynamicTool(params(tool, args)));

    phase("idle-selected-tab-freezes");
    const tab = await runCauseEffect(host.open(timerUrl, "fixture-thread", "fixture-agent"));
    assert.equal(host.activeTabId, tab.id, "The opened tab is not the selected tab.");
    const contents = timerContents(timerUrl);
    const openedTicks = ticks(contents);
    await waitForTicks(contents, (value) => value > openedTicks, "The new tab did not run its timer.");
    recordCases("new-tab-runs-timer");
    const frozenAfterMs = await waitForStill(contents, "The idle selected tab was not frozen.");
    measurements.freezeObservedMs = frozenAfterMs;
    measurements.frozenTicks = ticks(contents);
    recordCases("idle-unseen-selected-tab-freezes", "freeze-outlives-debugger-detach");

    phase("agent-call-thaws");
    const result = scriptSchema.parse(
      parseBrowserToolText(
        text(
          await call(host, "run_script", {
            tabId: tab.id,
            script: `
              const before = await evaluate("readTicks()");
              await sleep(500);
              const after = await evaluate("readTicks()");
              const lifecycle = await evaluate("window.lifecycle");
              return { before, after, lifecycle };
            `,
          }),
        ),
      ),
    );
    measurements.ticksDuringCall = result.value.after - result.value.before;
    measurements.lifecycle = result.value.lifecycle.join(",");
    assert(result.value.after > result.value.before, "The page timer did not run during the agent call.");
    assert(
      result.value.lifecycle.includes("freeze") && result.value.lifecycle.at(-1) === "resume",
      `The page did not see a freeze and a resume: ${result.value.lifecycle.join(",")}`,
    );
    recordCases("agent-call-thaws-tab", "page-sees-freeze-and-resume");
    const image = await runCauseEffect(host.screenshot(tab.id));
    assert(image.startsWith("data:image/") && image.length > 1_000, "The thawed tab gave no screenshot.");
    recordCases("thawed-tab-draws-screenshot");

    phase("idle-tab-freezes-again");
    measurements.refreezeObservedMs = await waitForStill(contents, "The tab was not frozen again after the call.");
    recordCases("tab-freezes-again-after-use");

    phase("shown-tab-stays-awake");
    await runCauseEffect(host.setVisible({ visible: true, bounds: VIEW_BOUNDS }));
    const shownTicks = ticks(contents);
    await waitForTicks(contents, (value) => value > shownTicks, "The shown tab did not thaw.");
    const awakeFrom = ticks(contents);
    const awakeUntil = Date.now() + FREEZE_MS + STILL_WINDOW_MS;
    await waitForTicks(
      contents,
      (value) => value > awakeFrom && Date.now() >= awakeUntil,
      "The shown selected tab was frozen.",
      awakeUntil + STATE_DEADLINE_MS,
    );
    recordCases("shown-selected-tab-stays-awake");
    await runCauseEffect(host.setVisible({ visible: false }));

    phase("restore-unwatched");
    await runCauseEffect(host.destroy());
    browser = undefined;
    const restored = new BrowserHost(window, join(fixtureRoot, "downloads"), statePath, hostOptions);
    browser = restored;
    await runCauseEffect(restored.restore(OWNERS));
    assert.equal(restored.activeTabId, tab.id, "The selected tab was not restored.");
    assert(
      !liveContents().some((item) => item.getURL() === timerUrl || item.isLoading()),
      "The restored selected tab loaded its page while no person watched it.",
    );
    recordCases("restore-keeps-unwatched-selected-tab-unloaded");
    await runCauseEffect(restored.setVisible({ visible: true, bounds: VIEW_BOUNDS }));
    const shown = await waitForContents(timerUrl, "The restored tab did not load when shown.");
    const shownFrom = ticks(shown);
    await waitForTicks(shown, (value) => value > shownFrom, "The restored shown tab did not run.");
    recordCases("restored-tab-loads-when-shown");
    await runCauseEffect(restored.setVisible({ visible: false }));
    const snapshot = parseBrowserToolText(text(await call(restored, "snapshot", { tabId: tab.id, image: "never" })));
    assert(
      z.object({ url: z.literal(timerUrl) }).safeParse(snapshot).success,
      "The agent snapshot of the restored tab failed.",
    );
    recordCases("restored-tab-answers-agent");

    phase("accessibility-cache-released");
    await assertAccessibilityReleased(shown);
    recordCases("snapshot-releases-accessibility-cache");
    const missing = await call(restored, "click", {
      tabId: tab.id,
      target: { kind: "role", role: "button", name: "Missing memory check", exact: true },
    });
    assert.equal(missing.success, false, "The missing button was not refused.");
    await assertAccessibilityReleased(shown);
    recordCases("failed-target-search-releases-accessibility-cache");
    const clicked = await call(restored, "click", {
      tabId: tab.id,
      target: { kind: "role", role: "button", name: "Memory check", exact: true },
    });
    assert.equal(clicked.success, true, text(clicked));
    assert.equal(await shown.executeJavaScript("document.getElementById('out').textContent"), "activated");
    await assertAccessibilityReleased(shown);
    recordCases("semantic-click-works-after-accessibility-release");

    phase("closed-popup-opener-unloads");
    const popupUrl = `${timerUrl}?popup`;
    await shown.executeJavaScript(
      `localStorage.setItem("idle-memory-fixture", "kept"); window.open(${JSON.stringify(popupUrl)}, "idle-memory-popup"); true`,
      true,
    );
    const popupContents = await waitForContents(popupUrl, "The popup did not load.");
    const popup = restored.listTabs().find((candidate) => candidate.openerTabId === tab.id);
    assert(popup, "The popup did not keep its opener.");
    await runCauseEffect(restored.releaseIdleTabs(new Set()));
    await runCauseEffect(restored.screenshot(tab.id));
    assert(!shown.isDestroyed() && !popupContents.isDestroyed(), "A connected popup or opener was unloaded.");
    recordCases("open-popup-keeps-opener-loaded");
    await runCauseEffect(restored.close(popup.id));
    await Promise.all([
      once(shown, "destroyed", { signal: AbortSignal.timeout(STATE_DEADLINE_MS) }),
      runCauseEffect(restored.releaseIdleTabs(new Set())),
    ]);
    assert(restored.listTabs().some((candidate) => candidate.id === tab.id && candidate.url === timerUrl));
    measurements.closedPopupOpenerUnloaded = shown.isDestroyed();
    recordCases("closed-popup-opener-unloads");
    await runCauseEffect(restored.screenshot(tab.id));
    const reloaded = await waitForContents(timerUrl, "The sleeping opener did not load again.");
    assert.equal(await reloaded.executeJavaScript('localStorage.getItem("idle-memory-fixture")'), "kept");
    recordCases("closed-popup-opener-restores-session");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      platform: process.platform,
      cases,
      measurements,
      scope:
        "Owned hidden native process, temporary profile, and a loopback timer page. BrowserHost idle sweep with a short freeze delay, run_script, screenshot, setVisible and restore. No provider calls.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, measurements, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

async function assertAccessibilityReleased(contents: WebContents): Promise<void> {
  assert(contents.debugger.isAttached(), "The debugger detached before the accessibility check.");
  await assert.rejects(
    contents.debugger.sendCommand("Accessibility.getRootAXNode"),
    /Accessibility has not been enabled/u,
  );
}

function liveContents(): WebContents[] {
  return webContents.getAllWebContents().filter((item) => !item.isDestroyed());
}

function timerContents(url: string): WebContents {
  const contents = liveContents().find((item) => item.getURL() === url);
  assert(contents, "Missing the contents of the timer tab.");
  return contents;
}

function ticks(contents: WebContents): number {
  const value = /^tick (\d+)$/u.exec(contents.getTitle())?.[1];
  return value === undefined ? 0 : Number(value);
}

function nextTitle(contents: WebContents, untilMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      contents.off("page-title-updated", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, untilMs - Date.now()));
    contents.on("page-title-updated", done);
  });
}

async function waitForTicks(
  contents: WebContents,
  predicate: (value: number) => boolean,
  message: string,
  deadline = Date.now() + STATE_DEADLINE_MS,
): Promise<void> {
  while (!predicate(ticks(contents))) {
    if (Date.now() >= deadline) throw new Error(message);
    await nextTitle(contents, Math.min(deadline, Date.now() + 250));
  }
}

async function waitForStill(contents: WebContents, message: string): Promise<number> {
  const startedAt = Date.now();
  const deadline = startedAt + STATE_DEADLINE_MS;
  let value = ticks(contents);
  let stillSince = Date.now();
  while (Date.now() - stillSince < STILL_WINDOW_MS) {
    if (Date.now() >= deadline) throw new Error(message);
    await nextTitle(contents, Math.min(deadline, stillSince + STILL_WINDOW_MS));
    const current = ticks(contents);
    if (current !== value) {
      value = current;
      stillSince = Date.now();
    }
  }
  return stillSince - startedAt;
}

async function waitForContents(url: string, message: string): Promise<WebContents> {
  const deadline = Date.now() + STATE_DEADLINE_MS;
  for (;;) {
    const contents = liveContents().find((item) => item.getURL() === url && !item.isLoading());
    if (contents) return contents;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

function text(result: DynamicToolResult): string {
  const item = result.contentItems.find((content) => content.type === "inputText");
  assert(item?.type === "inputText", "Missing fixture tool text.");
  return item.text;
}

function phase(name: string): void {
  currentPhase = name;
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}
