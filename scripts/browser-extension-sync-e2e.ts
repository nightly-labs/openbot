import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { AGENTS_SYNC_COLLECTION, CHANNELS_SYNC_COLLECTION } from "@openbot/contracts/team-protocol/sync-collections";
import {
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-logs";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { type RemoteRequestRecord, routeTemplate } from "@openbot/team-client/sync-profile";
import { chromium, type Locator, type Page } from "playwright-core";
import { argument, connectChannelE2e, WAIT_MS, writeReport } from "./channel-e2e-support";
import { delay, instrumentRemotePeer, literal, readSyncSink, signInDevHost } from "./remote-perf-support";

declare global {
  interface Window {
    __extensionSyncChannels?: RTCDataChannel[];
    __extensionSyncFrames?: { channel: number; direction: "sent" | "received"; type: string }[];
  }
}

const NAME = "browser-extension-sync-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const EXTENSION = resolve(import.meta.dirname, "../apps/browser-extension");
const MARK_PREFIX = "openbot:remote-";
const QUIET_MS = 1_500;
const english = translateFor("en");
const logger = createOpenBotLogger(NAME);
const authApi = argument("auth-api")?.replace(/\/$/, "");
assert.ok(authApi, "Pass --auth-api=<url> from the dev stack log.");
const browserExecutable = argument("browser-executable");
const run = crypto.randomUUID().slice(0, 6);
const channelName = `Extension sync ${run}`;
const channelText = `Extension sync message ${run}.`;
const offlineText = `Extension sync message while offline ${run}.`;
const onlineText = `Extension sync message after reconnect ${run}.`;

interface ChangeReport {
  change: string;
  visibleMs: number;
  routes: string[];
  listCalls: number;
}

interface Report {
  createdAt: string;
  authApi: string;
  initialRoutes: string[];
  reconnect: { visibleMs: number; routes: string[] } | null;
  changes: ChangeReport[];
  pageErrors: string[];
  passed: boolean;
  failure: string | null;
  diagnostics?: { peers: string[]; channels: string[]; frames: string[] } | null;
}

const report: Report = {
  createdAt: new Date().toISOString(),
  authApi,
  initialRoutes: [],
  reconnect: null,
  changes: [],
  pageErrors: [],
  passed: false,
  failure: null,
};
const routeKey = (record: RemoteRequestRecord) => `${record.method} ${record.route}`;
const rowButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${literal(name)}\\b`) }).first();

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}

async function waitMark(page: Page, name: string, after: number): Promise<void> {
  await page.waitForFunction(
    ({ mark, after }) =>
      performance.getEntriesByName(mark).some((entry) => performance.timeOrigin + entry.startTime >= after),
    { mark: `${MARK_PREFIX}${name}`, after },
    { timeout: WAIT_MS, polling: 100 },
  );
}

async function settleNetwork(page: Page, from: number): Promise<RemoteRequestRecord[]> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const sink = await readSyncSink(page);
    const mine = sink.records.filter((record) => record.startedAt >= from);
    const lastEnd = Math.max(from, ...mine.map((record) => record.endedAt));
    if (sink.open === 0 && (await pageNow(page)) - lastEnd >= QUIET_MS) return mine;
    if (Date.now() > deadline) throw new Error("The network of the extension did not become quiet.");
    await delay(100);
  }
}

async function expectNoListCalls(
  page: Page,
  label: string,
  listRoutes: readonly string[],
  change: () => Promise<void>,
  visible: () => Locator,
): Promise<void> {
  const from = await pageNow(page);
  await change();
  await visible().waitFor({ timeout: WAIT_MS });
  const visibleMs = Math.round((await pageNow(page)) - from);
  const routes = (await settleNetwork(page, from)).map(routeKey);
  const listCalls = routes.filter((route) =>
    listRoutes.some((listed) => route === listed || route.startsWith(`${listed}?`)),
  ).length;
  report.changes.push({ change: label, visibleMs, routes, listCalls });
  logger.info(`${label}: visible after ${visibleMs} ms, ${listCalls} list calls.`);
  assert.equal(listCalls, 0, `"${label}" made ${listCalls} HTTP calls to ${listRoutes.join(", ")}.`);
}

const host = await connectChannelE2e(NAME);
mkdirSync(OUT, { recursive: true });
const build = spawnSync("bun", ["run", "build", "--", "--mode", "development"], {
  cwd: EXTENSION,
  env: { ...process.env, VITE_OPENBOT_API_URL: authApi },
  stdio: "inherit",
});
assert.equal(build.status, 0, "The extension build failed.");
const dist = resolve(EXTENSION, "dist");
const profile = mkdtempSync(resolve(tmpdir(), "openbot-extension-sync-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  ...(browserExecutable ? { executablePath: browserExecutable } : { channel: "chromium" }),
  viewport: { width: 360, height: 720 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
await instrumentRemotePeer(context, 0);
await context.addInitScript(() => {
  const opened: RTCDataChannel[] = [];
  window.__extensionSyncChannels = opened;
  const frames: { channel: number; direction: "sent" | "received"; type: string }[] = [];
  window.__extensionSyncFrames = frames;
  const decoder = new TextDecoder();
  const text = (data: unknown): string =>
    typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? decoder.decode(data)
        : ArrayBuffer.isView(data)
          ? decoder.decode(data)
          : "";
  const syncTypes = (data: unknown): string[] => {
    const body = text(data);
    return [...body.matchAll(/"type":"(sync-[a-z-]+)"/g)].map((match) => match[1] ?? "");
  };
  const frameType = (data: unknown): string => `frame ${/"type":"([a-z-]+)"/.exec(text(data))?.[1] ?? "unknown"}`;
  const track = (channel: RTCDataChannel) => {
    const index = opened.push(channel) - 1;
    channel.addEventListener("message", (event) => {
      if (channel.label.endsWith("events"))
        frames.push({ channel: index, direction: "received", type: frameType(event.data) });
      for (const type of syncTypes(event.data)) frames.push({ channel: index, direction: "received", type });
    });
    const send = channel.send.bind(channel);
    channel.send = (data: string & Blob & ArrayBuffer & ArrayBufferView<ArrayBuffer>) => {
      if (channel.label.endsWith("events")) frames.push({ channel: index, direction: "sent", type: frameType(data) });
      for (const type of syncTypes(data)) frames.push({ channel: index, direction: "sent", type });
      send(data);
    };
  };
  const Counted = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Counted {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      this.addEventListener("datachannel", (event) => track(event.channel));
    }
    override createDataChannel(...input: Parameters<RTCPeerConnection["createDataChannel"]>): RTCDataChannel {
      const channel = super.createDataChannel(...input);
      track(channel);
      return channel;
    }
  };
});

const target = await host.page.evaluate(async () => {
  const agent = (await window.openbot.agent.listAgents())[0];
  if (!agent) throw new Error("The host has no agent.");
  return { agentId: agent.id, name: agent.name };
});
const renamedAgent = `${target.name} ${run}`;
let renamed = false;
let channelId: string | null = null;

function postHostChannelMessage(text: string): Promise<void> {
  return host.page.evaluate(
    async ({ channelId, text }) => {
      await window.openbot.agent.channelCommand({
        type: "send",
        operationId: crypto.randomUUID(),
        channelId,
        text,
        recipientAgentId: null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      });
    },
    { channelId: channelId ?? "", text },
  );
}

function connectedPeers(page: Page): Promise<number> {
  return page.evaluate(
    () => (window.__syncPerfPeers ?? []).filter((peer) => peer.connectionState === "connected").length,
  );
}

async function dropConnection(page: Page): Promise<number> {
  const before = await page.evaluate(() => (window.__syncPerfPeers ?? []).length);
  const closed = await page.evaluate(() => {
    const open = (window.__extensionSyncChannels ?? []).filter((channel) => channel.readyState === "open");
    for (const channel of open) channel.close();
    return open.length;
  });
  assert.ok(closed > 0, "The extension has no open data channel to close.");
  return before;
}

async function waitReconnected(page: Page, peersBefore: number): Promise<void> {
  await page.waitForFunction(
    (before) => {
      const peers = window.__syncPerfPeers ?? [];
      return peers.length > before && peers.at(-1)?.connectionState === "connected";
    },
    peersBefore,
    { timeout: WAIT_MS, polling: 100 },
  );
}

async function renameHostAgent(name: string): Promise<void> {
  await host.page.evaluate(({ agentId, name }) => window.openbot.agent.updateAgent({ agentId, name }), {
    agentId: target.agentId,
    name,
  });
}

let panel: Page | null = null;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: WAIT_MS }));
  const extensionId = new URL(worker.url()).host;

  const web = await context.newPage();
  await signInDevHost(web, authApi, OUT);
  await web.waitForFunction(() => !document.querySelector(".account-login-screen"), null, { timeout: 60_000 });
  await web.close();

  const page = await context.newPage();
  panel = page;
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  const openedAt = Date.now();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const signIn = page.getByRole("button", { name: english("extension.signIn.withWeb") });
  await signIn.waitFor({ timeout: WAIT_MS });
  const opened = context.waitForEvent("page", {
    predicate: (candidate) => candidate.url().includes("extension=") && !candidate.url().includes("silent=1"),
    timeout: WAIT_MS,
  });
  await signIn.click();
  const consent = await opened;
  await consent.getByRole("heading", { name: english("webClient.extension.title") }).waitFor({ timeout: 60_000 });
  await consent.waitForFunction(() => !document.querySelector(".app-loading"), null, { timeout: 60_000 });
  await consent.getByRole("button", { name: english("webClient.extension.allow") }).click();
  await page.getByRole("button", { name: english("extension.home.serverMenu") }).waitFor({ timeout: 60_000 });
  await rowButton(page, target.name).waitFor({ timeout: WAIT_MS });
  for (const collection of [AGENTS_SYNC_COLLECTION, CHANNELS_SYNC_COLLECTION])
    await waitMark(page, `sync:${collection.name}`, openedAt);
  report.initialRoutes = (await settleNetwork(page, 0)).map(routeKey);

  const agentList = [`GET ${routeTemplate(TEAM_API_ROUTES.agents.all)}`];
  await expectNoListCalls(
    page,
    `rename agent to "${renamedAgent}"`,
    agentList,
    async () => {
      renamed = true;
      await renameHostAgent(renamedAgent);
    },
    () => rowButton(page, renamedAgent),
  );
  await expectNoListCalls(
    page,
    `rename agent back to "${target.name}"`,
    agentList,
    async () => {
      await renameHostAgent(target.name);
      renamed = false;
    },
    () => rowButton(page, target.name),
  );

  await expectNoListCalls(
    page,
    `add channel "${channelName}"`,
    [`GET ${routeTemplate(CHANNEL_ROUTES.list)}`],
    async () => {
      channelId = await host.page.evaluate(async (name) => {
        const id = crypto.randomUUID();
        await window.openbot.agent.channelCommand({
          type: "save",
          operationId: crypto.randomUUID(),
          channelId: id,
          draft: { name, title: name, instructions: "", members: [], leadAgentId: null },
        });
        return id;
      }, channelName);
    },
    () => rowButton(page, channelName),
  );

  const channelOpenedAt = await pageNow(page);
  await rowButton(page, channelName).click();
  await page
    .getByRole("textbox", { name: english("extension.channel.ask", { name: channelName }) })
    .waitFor({ timeout: WAIT_MS });
  for (const name of [CHANNEL_MESSAGES_SYNC_LOG.name, CHANNEL_PAGE_META_SYNC_COLLECTION.name])
    await waitMark(page, `sync:${name}`, channelOpenedAt);
  await settleNetwork(page, channelOpenedAt);
  await expectNoListCalls(
    page,
    "post one channel message from the host",
    [`POST ${routeTemplate(CHANNEL_ROUTES.read)}`],
    () => postHostChannelMessage(channelText),
    () => page.getByText(channelText, { exact: true }).first(),
  );

  const droppedAt = await pageNow(page);
  const peersBefore = await dropConnection(page);
  await postHostChannelMessage(offlineText);
  await waitReconnected(page, peersBefore);
  await page.getByText(offlineText, { exact: true }).first().waitFor({ timeout: WAIT_MS });
  const visibleMs = Math.round((await pageNow(page)) - droppedAt);
  const reconnectRoutes = (await settleNetwork(page, droppedAt)).map(routeKey);
  report.reconnect = { visibleMs, routes: reconnectRoutes };
  logger.info(`reconnect: the offline message is visible after ${visibleMs} ms, ${reconnectRoutes.length} requests.`);
  assert.ok((await connectedPeers(page)) > 0, "The extension did not connect again.");
  await expectNoListCalls(
    page,
    "post one channel message from the host after the reconnect",
    [`POST ${routeTemplate(CHANNEL_ROUTES.read)}`],
    () => postHostChannelMessage(onlineText),
    () => page.getByText(onlineText, { exact: true }).first(),
  );
  await page.screenshot({ path: resolve(OUT, "extension-sync.png") });
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  report.diagnostics = await panel
    ?.evaluate(() => ({
      peers: (window.__syncPerfPeers ?? []).map((peer) => peer.connectionState),
      channels: (window.__extensionSyncChannels ?? []).map((channel) => `${channel.label}:${channel.readyState}`),
      frames: (window.__extensionSyncFrames ?? []).map((frame) => `${frame.channel} ${frame.direction} ${frame.type}`),
    }))
    .catch(() => null);
  await panel?.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  if (renamed) await renameHostAgent(target.name).catch(() => undefined);
  if (channelId)
    await host.page.evaluate((id) => window.openbot.agent.deleteChannel(id), channelId).catch(() => undefined);
  logger.info(`Report: ${writeReport(NAME, report)}`);
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  await host.close();
}
