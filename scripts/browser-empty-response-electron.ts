import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow, session } from "electron";
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

const SHARED_PARTITION = "persist:openbot-browser";
const proxyOrSiteText = sourceText("error.backend.browserSystemProxyOrSiteClosed");

const cases: string[] = [];
const observed: Record<string, string> = {};
const closer = createServer((socket) => {
  socket.on("error", () => socket.destroy());
  socket.once("data", () => socket.destroy());
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
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
    const closerPort = await listen(closer);
    const closingSite = `http://127.0.0.1:${closerPort}/`;
    await app.whenReady();
    phase("electron-ready");
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;

    phase("direct-site-closes");
    const direct = await failureText(() => runCauseEffect(host.open(closingSite)));
    observed.directSite = direct;
    assert.match(direct, /ERR_EMPTY_RESPONSE/u, `A site that closed with no proxy gave another error: ${direct}`);
    assert(!direct.includes(proxyOrSiteText), "A site that closed with no proxy got the proxy text.");
    recordCases("direct-site-close-keeps-chromium-error");

    phase("proxy-closes");
    await session
      .fromPartition(SHARED_PARTITION, { cache: true })
      .setProxy({ mode: "fixed_servers", proxyRules: `http://127.0.0.1:${closerPort}` });
    const httpsOpen = await failureText(() => runCauseEffect(host.open("https://example.com/")));
    observed.proxyHttpsOpen = httpsOpen;
    assert.equal(httpsOpen, proxyOrSiteText, `An HTTPS open through a closing proxy gave: ${httpsOpen}`);
    recordCases("https-open-through-closing-proxy-names-proxy");
    const httpOpen = await failureText(() => runCauseEffect(host.open("http://openbot-proxy-check.example/")));
    observed.proxyHttpOpen = httpOpen;
    assert.equal(httpOpen, proxyOrSiteText, `An HTTP open through a closing proxy gave: ${httpOpen}`);
    recordCases("http-open-through-closing-proxy-names-proxy");
    const kept = host.listTabs().find((tab) => tab.url === "https://example.com/");
    assert(kept, "The tab of the failed HTTPS open is missing.");
    const reload = await failureText(() => runCauseEffect(host.loadUrl(kept.id, "https://example.org/")));
    observed.proxyLoadUrl = reload;
    assert.equal(reload, proxyOrSiteText, `An address bar load through a closing proxy gave: ${reload}`);
    recordCases("address-bar-load-through-closing-proxy-names-proxy");

    phase("loopback-skips-proxy");
    const loopback = await failureText(() => runCauseEffect(host.open(closingSite)));
    observed.loopbackWithProxy = loopback;
    assert.match(loopback, /ERR_EMPTY_RESPONSE/u, `A loopback site with a proxy set gave another error: ${loopback}`);
    assert(!loopback.includes(proxyOrSiteText), "A loopback site that the proxy does not route got the proxy text.");
    recordCases("unproxied-site-close-keeps-chromium-error");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      platform: process.platform,
      cases,
      observed,
      scope:
        "Owned hidden native process and temporary profile. A loopback TCP server closes each connection after the first bytes; it acts as a closing site and, through session.setProxy, as a closing HTTP proxy. BrowserHost open and loadUrl. No network and no provider calls.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, observed, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    await new Promise<void>((resolve) => closer.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("The closing server has no port."));
      else resolve(address.port);
    });
  });
}

async function failureText(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("The page load did not fail.");
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
