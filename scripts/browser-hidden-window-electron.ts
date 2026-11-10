// The Electron side of `browser-hidden-window-e2e.ts`. A `BrowserHost` runs on a main window that is
// never shown, as in a local server or with OpenBot closed to the tray. Each agent tab must still
// draw: the page runs `requestAnimationFrame`, a screenshot returns, and the live view gets a frame.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
const THREAD_ID = "fixture-thread";
const STATE_WAIT_MS = 10_000;

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><meta charset="utf-8"><title>page</title><h1>Hidden window</h1>');
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
    const origin = `http://127.0.0.1:${address.port}`;
    await app.whenReady();
    phase("electron-ready");
    // The main window of a local server: never shown.
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;
    const open = async (): Promise<{ tabId: string; contents: WebContents }> => {
      const tab = await runCauseEffect(host.open(`${origin}/page-${++sequence}`, THREAD_ID, "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing fixture contents.");
      return { tabId: tab.id, contents };
    };

    phase("cases");
    // The first tab moves the views to the background window; the second is mounted there.
    for (const name of ["first-tab", "second-tab"]) {
      const { tabId, contents } = await open();
      await withDeadline(
        contents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => resolve(true)))"),
        "The page ran no animation frame.",
      );
      recordCases(`${name}-animation-frame`);
      const image = await withDeadline(runCauseEffect(host.screenshot(tabId)), "The screenshot did not return.");
      assert(image.startsWith("data:image/"), "The screenshot gave no image.");
      recordCases(`${name}-screenshot`);
      let frames = 0;
      const stop = await runCauseEffect(
        host.startView(tabId, () => {
          frames += 1;
        }),
      );
      await contents.executeJavaScript("document.body.style.background = 'rgb(200, 40, 40)'");
      await waitUntil(() => frames > 0, "The live view got no frame.");
      await Effect.runPromise(stop());
      recordCases(`${name}-live-view-frame`);
    }

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      platform: process.platform,
      ozonePlatform: app.commandLine.getSwitchValue("ozone-platform") || null,
      cases,
      scope:
        "Owned native process with a main window that is never shown, a temporary profile, and a loopback page. BrowserHost calls only. No provider calls.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, reason: redactText(String(error)) }, null, 2)}\n`,
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

/** Waits for a promise that never settles when the page does not draw. */
async function withDeadline<Value>(promise: Promise<Value>, message: string): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${message} (phase ${currentPhase})`)), STATE_WAIT_MS);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Checks a state again after each turn of the event loop, until it holds. */
async function waitUntil(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + STATE_WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${message} (phase ${currentPhase})`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function phase(name: string): void {
  currentPhase = name;
  // Machine-readable: phase receipts contain no page data.
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}
