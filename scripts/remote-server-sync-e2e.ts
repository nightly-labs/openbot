import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type AgentEvent,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelPage,
  type ChannelSummary,
  type ClientAgentSummary,
  type ConversationMessage,
  type ConversationPage,
  decodeChannelPage,
  decodeChannelSummaries,
  IPC_ENDPOINTS,
  type QueueSnapshot,
  type Routine,
  type SidebarPinsSnapshot,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import { SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  AGENTS_SYNC_COLLECTION,
  CHANNELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  ROUTINES_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-logs";
import { SYNC_CAPABILITY, type SyncServerMessage, syncName } from "@openbot/contracts/team-protocol/sync-v1";
import { WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { createFormat, translateFor } from "@openbot/i18n";
import { decodeRemoteWorkflowList } from "@openbot/team-client/workflow-decoding";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import {
  decodeAgentSummaries,
  decodeQueueSnapshot,
  decodeRoutines,
  decodeSidebarPinsFromHost,
} from "../src/main/remote-agent-decoding";
import type { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { SidebarPinStore } from "../src/main/sidebar-pin-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-server-sync-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const CHANNELS = CHANNELS_SYNC_COLLECTION.name;

delete process.env.ELECTRON_RENDERER_URL;

const rendererSends: { channel: string; payload: unknown }[] = [];

plugin({
  name: "remote-server-sync-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class RecordingWindow {
          static getAllWindows() {
            return [];
          }
          readonly webContents = {
            isDestroyed: () => false,
            isLoadingMainFrame: () => false,
            mainFrame: { isDestroyed: () => false, detached: false },
            send: (channel: string, payload: unknown) => rendererSends.push({ channel, payload }),
          };
          isDestroyed() {
            return false;
          }
          isFocused() {
            return false;
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {
          static isSupported() {
            return false;
          }
        },
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const realFetch = globalThis.fetch;
const httpCalls = new Map<string, number>();
const legacyPorts = new Set<string>();

function callKey(port: string | number, method: string, path: string): string {
  return `${port} ${method} ${path}`;
}

function httpCallCount(port: string | number, method: string, path: string): number {
  return httpCalls.get(callKey(port, method, path)) ?? 0;
}

async function withoutSync(response: Response): Promise<Response> {
  const body = await response.json();
  const capabilities = isDynamicRecord(body) && Array.isArray(body.capabilities) ? body.capabilities : null;
  assert.ok(isDynamicRecord(body) && capabilities, "The compatibility answer has no capability list.");
  const stripped = { ...body, capabilities: capabilities.filter((capability) => capability !== SYNC_CAPABILITY) };
  return new Response(JSON.stringify(stripped), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const call = callKey(url.port, method, url.pathname);
    httpCalls.set(call, (httpCalls.get(call) ?? 0) + 1);
    const response = await realFetch(input, init);
    return url.pathname === TEAM_API_ROUTES.compatibility && legacyPorts.has(url.port)
      ? withoutSync(response)
      : response;
  },
  { preconnect: realFetch.preconnect },
);

const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { REMOTE_SYNC_CONVERSATION_ROWS, syncedOrRequest } = await import("../src/main/remote-server-sync");
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { createRendererForwarders } = await import("../src/main/renderer-forwarders");
const { BrowserWindow } = await import("electron");
const mainWindow = new BrowserWindow();

type Manager = InstanceType<typeof RemoteServerManager>;

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The WebRTC path. test:remote-sync-webrtc checks the sync frames as event-control and event, and the event-reset resubscribe; this check uses the WebSocket event stream.",
    "The bound IPC handlers (agent:channels:list, agent list, pins, routines, workflows, queue, latest conversation page and latest channel page reads). The check runs the same expressions (synced copy, else HTTP) on the same manager; the handlers need the full app dependency graph.",
    "The renderer refresh on agent:sync-changed. No renderer runs; the check records the event that main sends to the window.",
    "The renderer reload of the released events. Main forwards them unchanged; the check counts HTTP list calls in main only.",
  ],
  steps: [],
};

async function step<T>(
  name: string,
  run: () => Promise<T>,
  describe: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: describe(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-remote-sync-"));
const userData = join(root, "user-data");
const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  answerPermission: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
  answerHttpSignIn: unused,
};
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};
const centralAccount = { createTeamAuthTicket: unused, getEmail: () => "e2e@example.invalid" };

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const pins = new SidebarPinStore(join(userData, "sidebar-pins.json"));
const managers: Manager[] = [];
let agents: AgentService | undefined;
let workflows: WorkflowsHandle | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;

const proxySockets = new Set<Socket>();
let proxyBlocked = false;
let hostPort = 0;
const proxy = createServer((client) => {
  if (proxyBlocked) {
    client.destroy();
    return;
  }
  const upstream = connect(hostPort, "127.0.0.1");
  const end = () => {
    client.destroy();
    upstream.destroy();
    proxySockets.delete(client);
    proxySockets.delete(upstream);
  };
  proxySockets.add(client);
  proxySockets.add(upstream);
  for (const socket of [client, upstream]) {
    socket.on("error", end);
    socket.on("close", end);
  }
  client.pipe(upstream);
  upstream.pipe(client);
});

function blockProxy(): void {
  proxyBlocked = true;
  for (const socket of [...proxySockets]) socket.destroy();
  proxySockets.clear();
}

function listen(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => {
      const address = proxy.address();
      if (address === null || typeof address === "string") reject(new Error("The proxy has no port."));
      else resolvePort(address.port);
    });
  });
}

async function wire<Result>(
  path: string,
  init: { method: string; body?: unknown; token?: string },
  decode: (value: unknown) => Result,
): Promise<Result> {
  const headers = new Headers({
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
  });
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  const response = await realFetch(`http://127.0.0.1:${hostPort}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${path} failed: ${text}`);
  return decode(text ? JSON.parse(text) : null);
}

function decodeSessionToken(value: unknown): string {
  assert.ok(isDynamicRecord(value) && isString(value.sessionToken), "The login returned no session.");
  return value.sessionToken;
}

function recordSync(manager: Manager): SyncServerMessage[] {
  const received: SyncServerMessage[] = [];
  const receive = manager.sync.receive.bind(manager.sync);
  manager.sync.receive = (serverId, message) => {
    received.push(message);
    receive(serverId, message);
  };
  return received;
}

function until<T>(manager: Manager, read: () => T | null | undefined): Promise<T> {
  return new Promise((resolveValue) => {
    const check = () => {
      const value = read();
      if (value === null || value === undefined) return;
      manager.off("changed", check);
      manager.off("syncChanged", check);
      clearInterval(poll);
      resolveValue(value);
    };
    manager.on("changed", check);
    manager.on("syncChanged", check);
    const poll = setInterval(check, 25);
    check();
  });
}

function readChannels(manager: Manager, serverId: string): ChannelSummary[] | Promise<ChannelSummary[]> {
  return (
    manager.sync.channels.values(serverId) ??
    runCauseEffect(manager.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries))
  );
}

function ids(channels: readonly ChannelSummary[]): string[] {
  return channels.map((channel) => channel.id).sort();
}

function byId(channels: readonly ChannelSummary[]): ChannelSummary[] {
  return [...channels].sort((left, right) => (left.id < right.id ? -1 : 1));
}

function channelUpserts(messages: readonly SyncServerMessage[]): { keys: string[]; deletes: string[] } {
  const changes = messages.flatMap((message) =>
    message.type === "sync-changes" && message.collection === CHANNELS ? [message] : [],
  );
  return {
    keys: changes.flatMap((message) => message.upserts.map((upsert) => upsert.key)).sort(),
    deletes: changes.flatMap((message) => message.deletes),
  };
}

function syncChangedSends(serverId: string, name = CHANNELS): number {
  return rendererSends.filter(
    (send) =>
      send.channel === IPC_ENDPOINTS.agent.syncChanged.channel &&
      isDynamicRecord(send.payload) &&
      send.payload.serverId === serverId &&
      send.payload.name === name,
  ).length;
}

interface DesktopRead<Value> {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  synced(manager: Manager, serverId: string): Value | null;
  http(manager: Manager, serverId: string): Effect.Effect<Value, RemoteWorkflowError>;
}

function readThroughSync<Value>(read: DesktopRead<Value>, manager: Manager, serverId: string): Promise<Value> {
  return runCauseEffect(syncedOrRequest(read.synced(manager, serverId), () => read.http(manager, serverId)));
}

function readOverHttp<Value>(read: DesktopRead<Value>, manager: Manager, serverId: string): Promise<Value> {
  return runCauseEffect(read.http(manager, serverId));
}

async function hostChangeArrives<Value>(
  manager: Manager,
  serverId: string,
  port: string,
  read: DesktopRead<Value>,
  change: () => Promise<unknown>,
  arrived: (value: Value) => boolean,
) {
  const first = await until(manager, () => read.synced(manager, serverId));
  assert.deepStrictEqual(
    first,
    await readOverHttp(read, manager, serverId),
    `The synced ${read.name} differs from HTTP.`,
  );
  const callsBefore = httpCallCount(port, read.method, read.path);
  const eventsBefore = syncChangedSends(serverId, read.name);
  await change();
  const changed = await until(manager, () => {
    const value = read.synced(manager, serverId);
    return value !== null && arrived(value) ? value : null;
  });
  const callsAfterChange = httpCallCount(port, read.method, read.path) - callsBefore;
  const viaIpc = await readThroughSync(read, manager, serverId);
  const httpListCalls = httpCallCount(port, read.method, read.path) - callsBefore;
  assert.equal(httpListCalls, 0, `The ${read.name} change or the next read made an HTTP list call.`);
  assert.equal(callsAfterChange, 0);
  assert.deepStrictEqual(viaIpc, changed);
  assert.deepStrictEqual(
    changed,
    await readOverHttp(read, manager, serverId),
    `The changed ${read.name} differs from HTTP.`,
  );
  const syncChangedEvents = syncChangedSends(serverId, read.name) - eventsBefore;
  assert.ok(syncChangedEvents > 0, `Main did not send agent:sync-changed for ${read.name}.`);
  return { name: read.name, sameAsHttp: true, httpListCalls, syncChangedEvents };
}

function pageSyncChangedSends(serverId: string, names: readonly string[]): number {
  return names.reduce((total, name) => total + syncChangedSends(serverId, name), 0);
}

async function firstPageRead<Value>(manager: Manager, serverId: string, port: string, read: DesktopRead<Value>) {
  const before = httpCallCount(port, read.method, read.path);
  await readThroughSync(read, manager, serverId);
  const firstReadHttpCalls = httpCallCount(port, read.method, read.path) - before;
  assert.ok(firstReadHttpCalls >= 1, `The first ${read.name} read did not use HTTP.`);
  const synced = await until(manager, () => read.synced(manager, serverId));
  assert.deepStrictEqual(
    synced,
    await readOverHttp(read, manager, serverId),
    `The synced ${read.name} differs from HTTP.`,
  );
  return { name: read.name, firstReadHttpCalls, sameAsHttp: true };
}

async function syncedEqualsHttp<Value>(manager: Manager, serverId: string, read: DesktopRead<Value>) {
  const expected = await readOverHttp(read, manager, serverId);
  return until(manager, () => {
    const value = read.synced(manager, serverId);
    return value !== null && isDeepStrictEqual(value, expected) ? value : null;
  });
}

async function pageChangeArrives<Value>(
  manager: Manager,
  serverId: string,
  port: string,
  read: DesktopRead<Value>,
  metaName: string,
  change: string,
  run: () => Promise<unknown>,
) {
  const names = [read.name, metaName];
  const callsBefore = httpCallCount(port, read.method, read.path);
  const eventsBefore = pageSyncChangedSends(serverId, names);
  await run();
  const changed = await syncedEqualsHttp(manager, serverId, read);
  const viaIpc = await readThroughSync(read, manager, serverId);
  const httpPageCalls = httpCallCount(port, read.method, read.path) - callsBefore - 1;
  assert.equal(httpPageCalls, 0, `The ${change} on ${read.name} made an HTTP page call.`);
  assert.deepStrictEqual(viaIpc, changed);
  const syncChangedEvents = pageSyncChangedSends(serverId, names) - eventsBefore;
  assert.ok(syncChangedEvents > 0, `Main did not send agent:sync-changed for the ${change} on ${read.name}.`);
  return { change, sameAsHttp: true, httpPageCalls, syncChangedEvents };
}

async function joinedManager(file: string, apiPort: number, token: string): Promise<Manager> {
  const identity = team.getIdentity();
  assert.ok(identity, "The host has no identity.");
  const manager = new RemoteServerManager(join(userData, file), cipher, centralAccount, { appVersion: APP_VERSION });
  managers.push(manager);
  await runCauseEffect(manager.initialize());
  await runCauseEffect(manager.startEventConnections());
  await runCauseEffect(
    manager.connectDevelopmentServer({
      serverId: identity.serverId,
      serverName: identity.serverName,
      apiUrl: `http://127.0.0.1:${apiPort}`,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
      username: OWNER.username,
      sessionToken: token,
      role: "owner",
    }),
  );
  return manager;
}

try {
  const setup = await step(
    "Start a host with one channel, pins and workflows, and join it through a proxy",
    async () => {
      await runCauseEffect(sidebar.initialize());
      await runCauseEffect(pins.load());
      await runCauseEffect(agentStore.initialize());
      await runCauseEffect(mailbox.initialize());
      await runCauseEffect(team.initialize());
      const agent = await runCauseEffect(
        agentStore.createAgent({
          name: "Sync fixture",
          description: "Synthetic agent for the remote sync check",
          avatarSeed: "remote-sync",
          avatarHue: null,
        }),
      );
      const service = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
      agents = service;
      const workflowHandle = await Effect.runPromise(
        createWorkflows({
          store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
          runs: new WorkflowRunStore({ database }),
          github: new WorkflowGitHubStore({ database }),
          githubApp: () => null,
          delivery: () => null,
          turnAnswer: () => null,
          sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this check.") }),
          stopDelivery: () => Effect.void,
          generateText: () => Effect.fail({ message: "No model step runs in this check." }),
          generateMedia: () => Effect.fail({ message: "No media step runs in this check." }),
          filePath: () => Effect.succeed(null),
          notify: () => {},
          connectionOn: () => false,
          post: () => Effect.die(new Error("No post runs in this check.")),
          changed: (workflowId) => service.notifyWorkflowsChanged(workflowId),
          rearm: () => {},
          timezone: () => "UTC",
        }),
      );
      workflows = workflowHandle;
      await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
      const ownerId = team.getOwnerMemberId();
      assert.ok(ownerId, "The host has no owner.");
      const actor = { id: ownerId, name: "Owner" };
      const createChannel = async (name: string) =>
        (
          await runCauseEffect(
            service.channels.command(
              {
                type: "save",
                operationId: randomUUID(),
                channelId: randomUUID(),
                draft: { name, title: "", instructions: "", members: [{ agentId: agent.id }], leadAgentId: agent.id },
              },
              actor,
            ),
          )
        ).id;
      const first = await createChannel("First room");
      server = new TeamApiServer({
        store: team,
        agents: service,
        mailbox,
        browser: teamBrowser,
        sidebarLayout: sidebar,
        appVersion: APP_VERSION,
        channels: service.channels,
        sidebarPins: {
          snapshot: (memberId, hidden) => pins.snapshot(memberId, hidden),
          set: (memberId, items, hidden) => pins.set(memberId, items, hidden),
          seed: (memberId, items, hidden) => pins.seed(memberId, items, hidden),
          subscribe: (listener) => pins.subscribe(listener),
        },
        workflows: {
          ...workflowHandle,
          rotateWorkflowSecret: () => Effect.die(new Error("No webhook secret rotates in this check.")),
        },
      });
      hostPort = await Effect.runPromise(server.start());
      const proxyPort = await listen();
      const token = await wire("/v1/auth/login", { method: "POST", body: OWNER }, decodeSessionToken);
      const manager = await joinedManager("remote-servers.json", proxyPort, token);
      const received = recordSync(manager);
      const forwarders = createRendererForwarders({
        getMainWindow: () => mainWindow,
        getChatWindows: () => [],
        chatWindowTarget: () => null,
        getAgentService: () => null,
        getHostService: () => null,
        getHostAnalytics: () => null,
        getRemoteServerManager: () => manager,
        showMainWindow: () => undefined,
        getTranslate: () => translateFor("en"),
        getFormat: () => createFormat("en"),
        desktopNotificationsEnabled: () => false,
        notificationPreviewEnabled: () => false,
        ownAgentNotificationLevels: () => new Map(),
      });
      manager.on("syncChanged", forwarders.forwardSyncChanged);
      const serverId = team.getIdentity()?.serverId;
      assert.ok(serverId);
      return { manager, received, serverId, token, proxyPort, first, createChannel, agentId: agent.id };
    },
    ({ serverId, proxyPort, first, agentId }) => ({ serverId, proxyPort, hostPort, firstChannel: first, agentId }),
  );
  const { manager, received, serverId, token, proxyPort, first, createChannel, agentId } = setup;
  const proxyKey = String(proxyPort);
  const proxyListCalls = () => httpCallCount(proxyKey, "GET", CHANNEL_ROUTES.list);
  const noBody = () => null;
  const agentList: DesktopRead<ClientAgentSummary[]> = {
    name: AGENTS_SYNC_COLLECTION.name,
    method: "GET",
    path: TEAM_API_ROUTES.agents.all,
    synced: (target, id) => target.sync.agents.values(id),
    http: (target, id) => target.request(id, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
  };
  const pinList: DesktopRead<SidebarPinsSnapshot> = {
    name: SIDEBAR_PINS_SYNC_COLLECTION.name,
    method: "POST",
    path: SIDEBAR_PINS_ROUTES.read,
    synced: (target, id) => target.sync.sidebarPins.value(id),
    http: (target, id) =>
      target.request(id, SIDEBAR_PINS_ROUTES.read, decodeSidebarPinsFromHost, { method: "POST", body: {} }),
  };
  const routineList: DesktopRead<Routine[]> = {
    name: syncName(ROUTINES_SYNC_COLLECTION.name, agentId),
    method: "GET",
    path: TEAM_API_ROUTES.agent.routines(agentId),
    synced: (target, id) => target.sync.routines.values(id, agentId),
    http: (target, id) => target.request(id, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
  };
  const workflowList: DesktopRead<WorkflowSummary[]> = {
    name: WORKFLOWS_SYNC_COLLECTION.name,
    method: "POST",
    path: WORKFLOWS_ROUTES.list,
    synced: (target, id) => target.sync.workflows.values(id),
    http: (target, id) =>
      target.request(id, WORKFLOWS_ROUTES.list, decodeRemoteWorkflowList, { method: "POST", body: {} }),
  };
  const queueRead: DesktopRead<QueueSnapshot> = {
    name: syncName(QUEUE_SYNC_COLLECTION.name, agentId),
    method: "GET",
    path: TEAM_API_ROUTES.agent.queue(agentId),
    synced: (target, id) => target.sync.queues.value(id, agentId),
    http: (target, id) => target.request(id, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot),
  };

  await step("After the first sync, reads use the synced copy and make no HTTP list call", async () => {
    const synced = await until(manager, () => manager.sync.channels.values(serverId));
    assert.deepEqual(ids(synced), [first], "The first sync does not hold the host channel.");
    const before = proxyListCalls();
    const reads = await Promise.all([1, 2, 3].map(() => readChannels(manager, serverId)));
    assert.equal(proxyListCalls(), before, "A read after the first sync made an HTTP list call.");
    const host = await wire(CHANNEL_ROUTES.list, { method: "GET", token }, decodeChannelSummaries);
    for (const read of reads) assert.deepEqual(byId(read), byId(host), "The synced copy differs from the HTTP list.");
    const events = syncChangedSends(serverId);
    assert.ok(events > 0, "Main did not send agent:sync-changed to the window.");
    return {
      channels: synced.length,
      httpListCallsBefore: before,
      httpListCallsAfter: proxyListCalls(),
      sameAsHttp: true,
      syncChangedEvents: events,
    };
  });

  await step("A channel change on the host reaches the client", async () => {
    const before = proxyListCalls();
    const eventsBefore = syncChangedSends(serverId);
    const second = await createChannel("Second room");
    const synced = await until(manager, () => {
      const values = manager.sync.channels.values(serverId);
      return values?.some((channel) => channel.id === second) ? values : null;
    });
    assert.deepEqual(ids(synced), [first, second].sort());
    assert.equal(proxyListCalls(), before, "The change made an HTTP list call in main.");
    assert.ok(syncChangedSends(serverId) > eventsBefore, "Main did not send agent:sync-changed for the change.");
    return { channels: synced.length, httpListCalls: proxyListCalls() - before };
  });

  await step("Offline, then online: the client resubscribes and gets only the diff", async () => {
    blockProxy();
    await until(manager, () => (manager.sync.channels.values(serverId) === null ? true : null));
    const third = await createChannel("Third room");
    const before = proxyListCalls();
    received.length = 0;
    proxyBlocked = false;
    await runCauseEffect(manager.wake());
    const synced = await until(manager, () => {
      const values = manager.sync.channels.values(serverId);
      return values?.some((channel) => channel.id === third) ? values : null;
    });
    assert.equal(synced.length, 3);
    const diff = channelUpserts(received);
    assert.deepEqual(diff.keys, [third], "The resubscribe did not send only the new channel.");
    assert.deepEqual(diff.deletes, []);
    assert.equal(proxyListCalls(), before, "The reconnect made an HTTP list call in main.");
    return { channels: synced.length, upserts: diff.keys.length, deletes: diff.deletes.length };
  });

  await step(
    "agents.v1: the synced list equals the desktop HTTP list, and a rename arrives with no HTTP list call",
    () =>
      hostChangeArrives(
        manager,
        serverId,
        proxyKey,
        agentList,
        () =>
          wire(TEAM_API_ROUTES.agent.one(agentId), { method: "PATCH", body: { name: "Sync renamed" }, token }, noBody),
        (list) => list.some((agent) => agent.id === agentId && agent.name === "Sync renamed"),
      ),
  );

  await step(
    "sidebar-pins.v1: the synced pins equal the desktop HTTP pins, and a new pin arrives with no HTTP read",
    () =>
      hostChangeArrives(
        manager,
        serverId,
        proxyKey,
        pinList,
        () =>
          wire(
            SIDEBAR_PINS_ROUTES.set,
            { method: "POST", body: { items: [{ kind: "agent", id: agentId }] }, token },
            noBody,
          ),
        (snapshot) => snapshot.items.some((item) => item.id === agentId),
      ),
  );

  await step(
    "routines.v1 (scoped): the first read opens the scope over HTTP, then a new routine arrives with no HTTP list call",
    async () => {
      const before = httpCallCount(proxyKey, routineList.method, routineList.path);
      const first = await readThroughSync(routineList, manager, serverId);
      assert.equal(
        httpCallCount(proxyKey, routineList.method, routineList.path) - before,
        1,
        "The first routines read did not use HTTP.",
      );
      const result = await hostChangeArrives(
        manager,
        serverId,
        proxyKey,
        routineList,
        () =>
          wire(
            TEAM_API_ROUTES.agent.routines(agentId),
            {
              method: "POST",
              body: {
                name: "Sync check",
                instruction: "Say hello.",
                active: true,
                timezone: "UTC",
                schedule: { kind: "daily", time: "09:00" },
              },
              token,
            },
            noBody,
          ),
        (list) => list.some((routine) => routine.name === "Sync check"),
      );
      return { ...result, firstReadRoutines: first.length, firstReadHttpCalls: 1 };
    },
  );

  await step(
    "workflows.v1: the synced list equals the desktop HTTP list, and a new workflow arrives with no HTTP list call",
    () =>
      hostChangeArrives(
        manager,
        serverId,
        proxyKey,
        workflowList,
        () => wire(WORKFLOWS_ROUTES.create, { method: "POST", body: { title: "Sync check" }, token }, noBody),
        (list) => list.some((workflow) => workflow.title === "Sync check"),
      ),
  );

  await step(
    "queue.v1 (scoped): the synced snapshot equals the desktop HTTP snapshot, and a cancel arrives as queue-changed with no HTTP queue read",
    async () => {
      const hostAgents = agents;
      assert.ok(hostAgents, "The host has no agent service.");
      const receipt = await runCauseEffect(
        mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agentId], text: "Queued for the sync check." }),
      );
      const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === agentId);
      assert.ok(delivery, "The host did not queue the message.");
      const before = httpCallCount(proxyKey, queueRead.method, queueRead.path);
      const first = await readThroughSync(queueRead, manager, serverId);
      assert.equal(
        httpCallCount(proxyKey, queueRead.method, queueRead.path) - before,
        1,
        "The first queue read did not use HTTP.",
      );
      assert.ok(first.deliveries.some((candidate) => candidate.id === delivery.id));
      const queueEvents: QueueSnapshot[] = [];
      const recordQueue = (eventServerId: string, event: AgentEvent) => {
        if (eventServerId === serverId && event.type === "queue-changed") queueEvents.push(event.snapshot);
      };
      const cancelled = (snapshot: QueueSnapshot) =>
        snapshot.deliveries.some((candidate) => candidate.id === delivery.id && candidate.status === "cancelled");
      manager.on("agent", recordQueue);
      const result = await hostChangeArrives(
        manager,
        serverId,
        proxyKey,
        queueRead,
        () => runCauseEffect(hostAgents.cancelQueuedMessage(agentId, delivery.id)),
        cancelled,
      );
      await until(manager, () => (queueEvents.some(cancelled) ? true : null));
      manager.off("agent", recordQueue);
      return { ...result, firstReadHttpCalls: 1, queueChangedEvents: queueEvents.length };
    },
  );

  const hostService = agents;
  assert.ok(hostService, "The host has no agent service.");
  const baseTime = Date.now();
  let messageClock = 0;
  const conversationMessage = (id: string, author: "user" | "assistant", text: string): ConversationMessage => {
    messageClock += 1;
    return {
      id,
      author,
      text,
      createdAt: new Date(baseTime + messageClock * 1000).toISOString(),
      status: "completed",
      reactions: [],
      reaction: null,
    };
  };
  const writeAgentMessages = (changedMessages: ConversationMessage[]) => {
    const threadId = agentStore.ensureThreadIdNow(agentId);
    database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: null,
      changedMessages,
      eventType: "conversation.remote-sync-e2e",
    });
    hostService.emit("event", {
      type: "conversation-invalidated",
      agentId,
      revision: database.readConversationRevision(agentId, threadId),
    });
  };
  const captureChannelMessage = (channelId: string, id: string, text: string) => {
    const store = hostService.channels.store;
    store.captureMessage(store.get(channelId), {
      id,
      channelId,
      sequence: 0,
      author: { kind: "member", id: "remote-sync-writer", name: "Writer" },
      taskId: null,
      superseded: false,
      message: conversationMessage(id, "user", text),
    });
    hostService.emit("event", { type: "channels-changed", channelId, revision: store.get(channelId).revision });
  };
  const conversationRead: DesktopRead<ConversationPage> = {
    name: syncName(AGENT_MESSAGES_SYNC_LOG.name, agentId),
    method: "GET",
    path: TEAM_API_ROUTES.agent.conversationPage(agentId),
    synced: (target, id) => target.sync.latestConversationPage(id, agentId),
    http: (target, id) =>
      target.readAgentConversationPage(agentId, { type: "latest" }, REMOTE_SYNC_CONVERSATION_ROWS, id),
  };
  const conversationMeta = syncName(CONVERSATION_PAGE_META_SYNC_COLLECTION.name, agentId);
  const channelRead: DesktopRead<ChannelPage> = {
    name: syncName(CHANNEL_MESSAGES_SYNC_LOG.name, first),
    method: "POST",
    path: CHANNEL_ROUTES.read,
    synced: (target, id) => target.sync.channelPages.latest(id, first),
    http: (target, id) =>
      target.request(id, CHANNEL_ROUTES.read, decodeChannelPage, { method: "POST", body: { channelId: first } }),
  };
  const channelMeta = syncName(CHANNEL_PAGE_META_SYNC_COLLECTION.name, first);

  await step(
    "agent-messages.v1: the latest conversation page equals the desktop HTTP page; a new message, an edit, a reaction and a delete arrive with no HTTP page call",
    async () => {
      const question = conversationMessage("sync-u1", "user", "Sync question.");
      const answer = conversationMessage("sync-a1", "assistant", "Sync answer.");
      writeAgentMessages([question, answer]);
      const pageEvents: ConversationPage[] = [];
      const recordPage = (eventServerId: string, event: AgentEvent) => {
        if (eventServerId === serverId && event.type === "conversation-page" && event.page.agentId === agentId)
          pageEvents.push(event.page);
      };
      manager.on("agent", recordPage);
      const opened = await firstPageRead(manager, serverId, proxyKey, conversationRead);
      const second = conversationMessage("sync-a2", "assistant", "Second answer.");
      const changes = [
        await pageChangeArrives(
          manager,
          serverId,
          proxyKey,
          conversationRead,
          conversationMeta,
          "new message",
          async () => writeAgentMessages([second]),
        ),
        await pageChangeArrives(manager, serverId, proxyKey, conversationRead, conversationMeta, "edit", async () =>
          writeAgentMessages([{ ...second, text: "Second answer, edited." }]),
        ),
        await pageChangeArrives(manager, serverId, proxyKey, conversationRead, conversationMeta, "reaction", () =>
          runCauseEffect(
            manager.request(serverId, TEAM_API_ROUTES.agent.reactions(agentId), noBody, {
              method: "POST",
              body: { agentId, messageId: question.id, emoji: "👍" },
            }),
          ),
        ),
        await pageChangeArrives(manager, serverId, proxyKey, conversationRead, conversationMeta, "delete", () =>
          runCauseEffect(
            manager.request(serverId, MESSAGE_DELETE_ROUTES.agent, noBody, {
              method: "POST",
              body: { agentId, messageId: second.id },
            }),
          ),
        ),
      ];
      manager.off("agent", recordPage);
      assert.ok(pageEvents.length > 0, "Main did not send conversation-page for the synced changes.");
      const final = conversationRead.synced(manager, serverId);
      assert.ok(final, "The conversation page is not synced.");
      assert.ok(!final.messages.some((message) => message.id === second.id), "The deleted message is still shown.");
      return {
        firstReadHttpCalls: opened.firstReadHttpCalls,
        sameAsHttp: opened.sameAsHttp,
        messages: final.messages.length,
        changes,
        conversationPageEvents: pageEvents.length,
      };
    },
  );

  await step(
    "channel-messages.v1: the latest channel page equals the desktop HTTP page; a new message and a delete arrive with no HTTP page call",
    async () => {
      captureChannelMessage(first, "sync-channel-1", "First channel message.");
      const opened = await firstPageRead(manager, serverId, proxyKey, channelRead);
      const changes = [
        await pageChangeArrives(manager, serverId, proxyKey, channelRead, channelMeta, "new message", async () =>
          captureChannelMessage(first, "sync-channel-2", "Second channel message."),
        ),
        await pageChangeArrives(manager, serverId, proxyKey, channelRead, channelMeta, "delete", () =>
          runCauseEffect(
            manager.request(serverId, MESSAGE_DELETE_ROUTES.channel, noBody, {
              method: "POST",
              body: { channelId: first, messageId: "sync-channel-2" },
            }),
          ),
        ),
      ];
      const final = channelRead.synced(manager, serverId);
      assert.ok(final, "The channel page is not synced.");
      return {
        firstReadHttpCalls: opened.firstReadHttpCalls,
        sameAsHttp: opened.sameAsHttp,
        messages: final.messages.length,
        changes,
      };
    },
  );

  await step("Message logs: offline, then online, the client gets only the diff", async () => {
    blockProxy();
    await until(manager, () =>
      conversationRead.synced(manager, serverId) === null && channelRead.synced(manager, serverId) === null
        ? true
        : null,
    );
    const offlineAnswer = conversationMessage("sync-offline", "assistant", "Written while offline.");
    writeAgentMessages([offlineAnswer]);
    captureChannelMessage(first, "sync-channel-offline", "Channel message written while offline.");
    const conversationCalls = httpCallCount(proxyKey, conversationRead.method, conversationRead.path);
    const channelCalls = httpCallCount(proxyKey, channelRead.method, channelRead.path);
    received.length = 0;
    proxyBlocked = false;
    await runCauseEffect(manager.wake());
    const conversation = await syncedEqualsHttp(manager, serverId, conversationRead);
    const channel = await syncedEqualsHttp(manager, serverId, channelRead);
    const logChanges = (log: string) =>
      received.flatMap((message) => (message.type === "sync-log-changes" && message.log === log ? [message] : []));
    const diff = (log: string) => {
      const changes = logChanges(log);
      return {
        messages: changes.length,
        resets: changes.filter((change) => change.reset).length,
        rows: [...new Set(changes.flatMap((change) => change.rows.map((row) => row.key)))],
        deletes: changes.flatMap((change) => change.deletes),
      };
    };
    const conversationDiff = diff(conversationRead.name);
    const channelDiff = diff(channelRead.name);
    assert.equal(conversationDiff.resets, 0, "The agent log was reset on reconnect.");
    assert.deepEqual(conversationDiff.rows, [offlineAnswer.id], "The agent log did not send only the new message.");
    assert.equal(channelDiff.resets, 0, "The channel log was reset on reconnect.");
    assert.deepEqual(channelDiff.rows, ["sync-channel-offline"], "The channel log did not send only the new message.");
    const conversationHttpCalls =
      httpCallCount(proxyKey, conversationRead.method, conversationRead.path) - conversationCalls - 1;
    const channelHttpCalls = httpCallCount(proxyKey, channelRead.method, channelRead.path) - channelCalls - 1;
    assert.equal(conversationHttpCalls, 0, "The reconnect made an HTTP conversation page call in main.");
    assert.equal(channelHttpCalls, 0, "The reconnect made an HTTP channel page call in main.");
    return {
      conversation: {
        ...conversationDiff,
        messagesShown: conversation.messages.length,
        httpPageCalls: conversationHttpCalls,
      },
      channel: { ...channelDiff, messagesShown: channel.messages.length, httpPageCalls: channelHttpCalls },
    };
  });

  await step("A host without sync-v1 still works through HTTP", async () => {
    legacyPorts.add(String(hostPort));
    const legacy = await joinedManager("remote-servers-legacy.json", hostPort, token);
    const legacyReceived = recordSync(legacy);
    await until(legacy, () => (legacy.supportsCapability(serverId, CHANNEL_CHATS_CAPABILITY) ? true : null));
    assert.equal(legacy.supportsCapability(serverId, SYNC_CAPABILITY), false, "The host still advertises sync-v1.");
    const hostKey = String(hostPort);
    const before = httpCallCount(hostKey, "GET", CHANNEL_ROUTES.list);
    const read = await readChannels(legacy, serverId);
    assert.equal(httpCallCount(hostKey, "GET", CHANNEL_ROUTES.list) - before, 1, "The read did not use the HTTP list.");
    assert.equal(legacy.sync.channels.values(serverId), null, "A host without sync-v1 has a synced copy.");
    assert.equal(legacyReceived.length, 0, "A host without sync-v1 sent sync messages.");
    assert.deepEqual(ids(read), ids(manager.sync.channels.values(serverId) ?? []));
    const viaHttp = async <Value>(list: DesktopRead<Value>) => {
      const callsBefore = httpCallCount(hostKey, list.method, list.path);
      const value = await readThroughSync(list, legacy, serverId);
      assert.equal(
        httpCallCount(hostKey, list.method, list.path) - callsBefore,
        1,
        `The ${list.name} read did not use HTTP.`,
      );
      assert.equal(list.synced(legacy, serverId), null, `A host without sync-v1 has a synced ${list.name}.`);
      assert.deepStrictEqual(
        value,
        await readOverHttp(list, manager, serverId),
        `The HTTP ${list.name} of a host without sync-v1 differs from the desktop HTTP value.`,
      );
      return list.name;
    };
    const httpReads = [
      await viaHttp(agentList),
      await viaHttp(pinList),
      await viaHttp(routineList),
      await viaHttp(workflowList),
      await viaHttp(queueRead),
      await viaHttp(conversationRead),
      await viaHttp(channelRead),
    ];
    assert.equal(legacyReceived.length, 0, "A host without sync-v1 sent sync messages.");
    return { channels: read.length, httpListCalls: 1, httpReads, syncMessages: legacyReceived.length };
  });

  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  for (const manager of managers) await runCauseEffect(manager.stop()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  blockProxy();
  proxy.close();
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  if (workflows) await Effect.runPromise(workflows.close()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
