// Checks the private network route of remote connections against the desktop app and the web client.
// Start the stack with `bun run dev:test-client` or `bun run dev` (never `--shared`), then run
// `bun scripts/remote-network-route-e2e.ts --allow-mutations [--api=<url>] [--browser-executable=<path>]`.
// `--api` is the account service of the dev stack (default http://localhost:3100); the script signs
// in to its `/app` as the dev host user, so the web client connects to the host over WebRTC.
//
// It selects "Through OpenBot" in Settings › Mobile Connect on the desktop, and the web client
// connects. Then it selects "Private network". It checks that main saves each choice, that the host
// closes the connected peer, that the web client connects again, that each candidate of the host is a `host` candidate on
// a private address, and that the selected pair uses one of them. It puts back the route that was set
// before it started. Writes .openbot-build/remote-network-route-e2e/report.json and a screenshot.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { RemoteNetworkRoute } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { type Browser, chromium, type Page } from "playwright-core";
import { isPrivateNetworkAddress } from "../src/renderer/src/features/team/team-webrtc-private-network";
import { argument, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "remote-network-route-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const UI_WAIT_MS = 30_000;
const DEV_HOST_EMAIL = "openbot-dev-host@example.com";
const english = translateFor("en");
const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const browserExecutable = argument("browser-executable");

interface PeerState {
  index: number;
  state: RTCPeerConnectionState;
  hostCandidates: string[];
  selectedRemote: string | null;
}

interface Report {
  routeBefore?: RemoteNetworkRoute;
  openbot?: PeerState;
  firstPeerAfterChange?: RTCPeerConnectionState;
  private?: PeerState;
  /** The state of each web client peer connection when a check fails. */
  webPeers?: RTCPeerConnectionState[];
  pageErrors: { desktop: string[]; web: string[] };
  screenshots: string[];
  passed: boolean;
}

declare global {
  interface Window {
    __routeE2ePeers?: RTCPeerConnection[];
  }
}

const report: Report = { pageErrors: { desktop: [], web: [] }, screenshots: [], passed: false };
const session = await connectChannelE2e(NAME);
const desktop = session.page;
desktop.on("pageerror", (error) => report.pageErrors.desktop.push(error.stack ?? error.message));
let browser: Browser | null = null;
let web: Page | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routes = desktop.getByRole("radiogroup", { name: english("settings.mobileConnect.route.title") });
const routeNames = {
  openbot: new RegExp(`^${literal(english("settings.mobileConnect.route.openbot.title"))}`),
  private: new RegExp(`^${literal(english("settings.mobileConnect.route.private.title"))}`),
} satisfies Record<RemoteNetworkRoute, RegExp>;

/** Opens Settings › Mobile Connect and its route popover. Each visit of the tab reads the route from main again. */
async function openRoutes(): Promise<void> {
  await desktop
    .getByRole("navigation", { name: english("app.rail.label") })
    .getByRole("button", { name: english("app.rail.settings"), exact: true })
    .click();
  await desktop.getByRole("tab", { name: english("settings.tab.general.title"), exact: true }).click();
  await desktop.getByRole("tab", { name: english("settings.tab.mobileConnect.title"), exact: true }).click();
  await showRoutes();
}

/** The routes are in a popover under the route chip in the tab header. Opens it when it is closed. */
async function showRoutes(): Promise<void> {
  if (await routes.isVisible()) return;
  const chipLabel = literal(english("settings.mobileConnect.route.chipLabel", { route: "ROUTE" })).replace(
    "ROUTE",
    ".+",
  );
  await desktop.getByRole("button", { name: new RegExp(`^${chipLabel}$`) }).click();
  await routes.waitFor({ timeout: UI_WAIT_MS });
}

/** Selects a route by its card, as the user does, and waits until main saved it. */
async function selectRoute(route: RemoteNetworkRoute): Promise<void> {
  await showRoutes();
  const radio = routes.getByRole("radio", { name: routeNames[route] });
  // The radio input is hidden; the user clicks its card.
  if (!(await radio.isChecked()))
    await routes
      .getByRole("group")
      .filter({ has: desktop.getByRole("radio", { name: routeNames[route] }) })
      .click();
  await waitFor(
    desktop,
    `main saves the ${route} route`,
    () => desktop.evaluate(() => window.openbot.getRemoteNetworkRoute()),
    (state) => state.route === route,
    UI_WAIT_MS,
  );
  assert.ok(await radio.isChecked(), `The ${route} radio is not checked.`);
}

/** Signs in to the web client with the code that the development account service shows. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  await page.getByRole("button", { name: english("account.login.sendCode"), exact: true }).click();
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  await notice.waitFor({ timeout: UI_WAIT_MS });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  // The code field takes the focus when it shows.
  await page.keyboard.type(code);
}

/** Waits until the peer connection at `index`, or a later one, is connected, and reads its candidates. */
async function connectedPeer(page: Page, fromIndex: number): Promise<PeerState> {
  const handle = await page.waitForFunction(
    (from) => {
      const found = (window.__routeE2ePeers ?? []).findIndex(
        (pc, at) => at >= from && pc.connectionState === "connected",
      );
      // waitForFunction waits for a truthy value, and index 0 is not truthy.
      return found >= 0 ? { found } : null;
    },
    fromIndex,
    { timeout: WAIT_MS, polling: 250 },
  );
  const match = await handle.jsonValue();
  assert.ok(match, "waitForFunction resolved with no connected peer.");
  const index = match.found;
  return page.evaluate(async (at) => {
    const pc = window.__routeE2ePeers?.[at];
    if (!pc) throw new Error("The peer connection is missing.");
    const stats = await pc.getStats();
    const remote = new Map<string, string>();
    let selectedId: string | null = null;
    stats.forEach((entry) => {
      if (entry.type === "remote-candidate") remote.set(entry.id, `${entry.candidateType} ${entry.address ?? ""}`);
      if (entry.type === "transport" && entry.selectedCandidatePairId)
        selectedId = stats.get(entry.selectedCandidatePairId)?.remoteCandidateId ?? null;
    });
    return {
      index: at,
      state: pc.connectionState,
      hostCandidates: [...remote.values()],
      selectedRemote: selectedId ? (remote.get(selectedId) ?? null) : null,
    };
  }, index);
}

try {
  report.routeBefore = (await desktop.evaluate(() => window.openbot.getRemoteNetworkRoute())).route;
  await openRoutes();
  await selectRoute("openbot");

  // 1. The web client connects to the host through the default route.
  browser = await chromium.launch(browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    const peers: RTCPeerConnection[] = [];
    window.__routeE2ePeers = peers;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        peers.push(this);
      }
    };
  });
  web = await context.newPage();
  web.on("pageerror", (error) => report.pageErrors.web.push(error.stack ?? error.message));
  await signIn(web);
  report.openbot = await connectedPeer(web, 0);

  // 2. The owner selects the private network on the desktop.
  await selectRoute("private");
  mkdirSync(OUT, { recursive: true });
  const shot = resolve(OUT, "settings-private.png");
  await routes.screenshot({ path: shot });
  report.screenshots.push(shot);

  // 3. The host drops the peer, and the web client connects again on the private network only.
  report.private = await connectedPeer(web, report.openbot.index + 1);
  report.firstPeerAfterChange = await web.evaluate(
    (at) => window.__routeE2ePeers?.[at]?.connectionState ?? "closed",
    report.openbot.index,
  );
  assert.equal(report.firstPeerAfterChange, "closed", "The host kept the peer that connected through OpenBot.");
  assert.ok(report.private.hostCandidates.length > 0, "The host sent no candidates on the private route.");
  for (const candidate of report.private.hostCandidates) {
    const [type, address = ""] = candidate.split(" ");
    assert.equal(type, "host", `The host sent a ${type} candidate on the private route.`);
    assert.ok(isPrivateNetworkAddress(address), `The host sent the public address ${address} on the private route.`);
  }
  assert.ok(
    report.private.selectedRemote && report.private.hostCandidates.includes(report.private.selectedRemote),
    "The connection does not use a private host candidate.",
  );
  report.passed = true;
} finally {
  if (!report.passed && web) {
    const webPeers = await web
      .evaluate(() => (window.__routeE2ePeers ?? []).map((pc) => pc.connectionState))
      .catch(() => undefined);
    if (webPeers) report.webPeers = webPeers;
    mkdirSync(OUT, { recursive: true });
    const failure = resolve(OUT, "web-failure.png");
    if (
      await web.screenshot({ path: failure }).then(
        () => true,
        () => false,
      )
    )
      report.screenshots.push(failure);
  }
  await browser?.close().catch(() => undefined);
  const before = report.routeBefore;
  if (before)
    await desktop.evaluate((route) => window.openbot.setRemoteNetworkRoute({ route }), before).catch(() => undefined);
  writeReport(NAME, report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
