// Opens the web app while the server of this computer is offline (#10209). The app of this worktree is
// the host, in a `bun run dev` stack; the web app at `/app` of the local Auth API reaches it through
// Signal. Signal holds the attempt of a host that is offline, so the web app must show the connect step,
// not "Loading" with Connect done. It stops the host's server and starts it again at the end. Pass the
// Auth API address that the stack log prints:
// `bun scripts/web-host-offline-e2e.ts --allow-mutations --auth-api=http://localhost:<port>
//  [--email=openbot-dev-host@example.com] [--browser-executable=<path>]`
//
// 1. The web app signs in as the host owner with the development code and loads the workspace.
// 2. The host stops its server. The web app loads the page again: it shows "Connecting to <name>", never
//    "Loading <name>", and its Details show Connect as the current step.
// 3. The host starts its server again. The web app loads the workspace without a user action.
// Writes .openbot-build/web-host-offline-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { HostStatus } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { chromium, type Page } from "playwright-core";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/web-host-offline-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 60_000;
const english = translateFor("en");
const authApi = argument("auth-api")?.replace(/\/$/, "");
assert.ok(authApi, "Pass --auth-api=<url> from the dev log.");
const email = argument("email") ?? "openbot-dev-host@example.com";
const browserExecutable = argument("browser-executable");

interface Report {
  serverName?: string;
  online?: { workspaceLoaded: boolean };
  offline?: {
    connectingShown: boolean;
    loadingShown: boolean;
    currentStep: string | null;
    loadStepDone: boolean;
  };
  back?: { workspaceLoaded: boolean };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const host = await connectChannelE2e("web-host-offline-e2e");
const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
const web = await browser.newPage({ viewport: { width: 1280, height: 800 } });
web.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
let stopped = false;

function hostStatus(): Promise<HostStatus> {
  return host.page.evaluate(() => window.openbot.host.getStatus());
}

async function shot(page: Page, label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

const chatList = () => web.getByRole("navigation", { name: english("sidebar.nav.label") });

try {
  let status = await hostStatus();
  assert.ok(status.configured && status.serverName, "Set up the server of this computer in the dev app first.");
  if (status.phase !== "online") {
    await host.page.evaluate(() => window.openbot.host.start());
    status = await waitFor(host.page, "the host publishes", hostStatus, (value) => value.phase === "online");
  }
  const name = status.serverName ?? "";
  report.serverName = name;

  await web.goto(`${authApi}/app`);
  await web.getByRole("textbox", { name: english("account.login.email") }).fill(email);
  await web.getByRole("button", { name: english("account.login.sendCode") }).click();
  const codeLine = web.getByText(/^Development code: /);
  await codeLine.waitFor({ timeout: UI_WAIT_MS });
  const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
  assert.ok(code && code.length === 8, "The page shows no development code.");
  await web.keyboard.type(code);
  await chatList().waitFor({ timeout: UI_WAIT_MS * 2 });
  report.online = { workspaceLoaded: true };
  await shot(web, "1-online");

  await host.page.evaluate(() => window.openbot.host.stop());
  stopped = true;
  await waitFor(host.page, "the host stops", hostStatus, (value) => value.phase === "idle");
  await web.reload();
  const connecting = english("server.connection.connecting", { name });
  const loading = english("server.connection.loading", { name });
  // The toast opens after the first-load wait. Its Details button is the only one on this screen.
  const details = web.getByRole("button", { name: english("server.connection.details") });
  await details.waitFor({ timeout: UI_WAIT_MS });
  const connectingShown = (await web.getByText(connecting, { exact: true }).count()) > 0;
  const loadingShown = (await web.getByText(loading, { exact: true }).count()) > 0;
  await shot(web, "2-offline");
  await details.click();
  const steps = web.getByRole("list", { name: english("server.status.steps") });
  await steps.waitFor({ timeout: UI_WAIT_MS });
  const currentStep = await steps.locator('li[aria-current="step"]').first().textContent();
  const loadStepDone =
    (await steps
      .getByRole("listitem")
      .filter({ hasText: english("server.status.stepLoad") })
      .getAttribute("data-status")) === "done";
  report.offline = { connectingShown, loadingShown, currentStep, loadStepDone };
  await shot(web, "3-offline-details");
  assert.ok(connectingShown, `The web app does not show "${connecting}".`);
  assert.ok(!loadingShown, `The web app shows "${loading}" for an offline host.`);
  assert.ok(currentStep?.startsWith(english("server.status.stepConnect")), "Connect is not the current step.");
  assert.ok(!loadStepDone, "The workspace load shows as done.");
  await web.keyboard.press("Escape");

  await host.page.evaluate(() => window.openbot.host.start());
  stopped = false;
  await waitFor(host.page, "the host publishes again", hostStatus, (value) => value.phase === "online");
  await chatList().waitFor({ timeout: UI_WAIT_MS * 2 });
  report.back = { workspaceLoaded: true };
  await shot(web, "4-back-online");
  report.passed = true;
} catch (error) {
  await shot(web, "failure-web").catch(() => undefined);
  throw error;
} finally {
  if (stopped) await host.page.evaluate(() => window.openbot.host.start()).catch(() => undefined);
  writeReport("web-host-offline-e2e", report);
  await browser.close();
  await host.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
