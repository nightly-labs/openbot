import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol, teamCapabilityHeaders } from "@openbot/contracts/team-protocol/current";
import { optionalTeamEvent, optionalTeamEventToCurrent } from "@openbot/contracts/team-protocol/optional-events";
import { TEAMMATE_RESULT_TURN_CAPABILITY } from "@openbot/contracts/team-protocol/teammate-result-turn-v1";
import { decodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { createFormat, translateFor } from "@openbot/i18n";
import {
  agentEventCanNotify,
  notificationForAgentEvent,
  teammateTurnCompleted,
} from "@openbot/team-client/agent-notifications";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { plugin } from "bun";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/teammate-turn-notifications-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-teammate-turn-notifications-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const english = translateFor("en");

const shown: { title: string; body: string }[] = [];

plugin({
  name: "teammate-turn-notifications-electron-boundary",
  setup(build) {
    class Inert {}
    class RecordingNotification {
      readonly #record: { title: string; body: string };
      constructor(options: { title: string; body: string }) {
        this.#record = { title: options.title, body: options.body };
      }
      static isSupported() {
        return true;
      }
      on() {
        return this;
      }
      show() {
        shown.push(this.#record);
      }
      close() {}
    }
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => undefined },
        BrowserWindow: class UnfocusedWindow {
          static getAllWindows() {
            return [];
          }
          readonly webContents = {
            isDestroyed: () => false,
            isLoadingMainFrame: () => false,
            mainFrame: { isDestroyed: () => false, detached: false },
            send: () => undefined,
          };
          isDestroyed() {
            return false;
          }
          isFocused() {
            return false;
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: RecordingNotification,
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

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { createRendererForwarders } = await import("../src/main/renderer-forwarders");
const { PushNotificationService } = await import("../src/main/push-notifications");
const { BrowserWindow } = await import("electron");
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");

interface FakeTurn {
  answer?: string;
  calls?: {
    tool: "send_message";
    arguments: { recipientAgentIds: string[]; text: string; replyToMessageId?: string; expectsReply?: boolean };
  }[];
  ask?: "prompt" | "approval";
  gate?: string;
  request?: string;
}

const plan = (...turns: FakeTurn[]) => `<<PLAN${JSON.stringify(turns)}PLAN>>`;
const gates = join(root, "gates");
mkdirSync(gates, { recursive: true });
const openGate = (name: string) => writeFileSync(join(gates, name), "");

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const GATES = ${JSON.stringify(gates)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
const scripts = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turn) => {
  if (turn.script.gate && !fs.existsSync(path.join(GATES, turn.script.gate))) return setTimeout(() => finish(turn), 20);
  const item = { type: "agentMessage", id: "message-" + turn.turnId, text: turn.script.answer || "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId: turn.threadId, turnId: turn.turnId, item } });
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const id = "request-" + turn.turnId + "-" + turn.requests++;
  if (turn.ask) {
    const ask = turn.ask;
    turn.ask = null;
    waiting.set(id, turn);
    if (ask === "prompt")
      return write({ id, method: "item/tool/requestUserInput", params: { threadId: turn.threadId, turnId: turn.turnId, itemId: "ask-" + id, questions: [{ id: "q", header: "Choice", question: "Which server?", options: null }] } });
    return write({ id, method: "item/commandExecution/requestApproval", params: { threadId: turn.threadId, turnId: turn.turnId, itemId: "ask-" + id, command: "df -h", cwd: "/", reason: "Read the disk use." } });
  }
  const call = turn.calls.shift();
  if (!call) return finish(turn);
  waiting.set(id, turn);
  let args = call.arguments;
  if (turn.script.request) {
    const request = JSON.parse(fs.readFileSync(path.join(GATES, turn.script.request + ".json"), "utf8"));
    args = JSON.parse(JSON.stringify(args).replaceAll("$REQUESTER", request.agentId).replaceAll("$REQUEST", request.messageId));
  }
  write({ id, method: "item/tool/call", params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: args } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const current = text.split("--- current message ---").at(-1);
      const named = /<<PLAN([\\s\\S]*)PLAN>>/.exec(current);
      if (named && !current.includes("This replies to")) scripts.set(params.threadId, JSON.parse(named[1]));
      const script = (scripts.get(params.threadId) || []).shift() || {};
      return callNext({ threadId: params.threadId, turnId, script, ask: script.ask || null, calls: [...(script.calls || [])], requests: 0 });
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const report: {
  checks: { name: string; passed: boolean; detail?: unknown }[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = { checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function check(name: string, run: () => Promise<unknown>) {
  process.stdout.write(`- ${name}\n`);
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const service = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const manager = new RemoteServerManager(
  join(userData, "remote-servers.json"),
  { encrypt: (value: string) => Buffer.from(value, "utf8"), decrypt: (value: Buffer) => value.toString("utf8") },
  { createTeamAuthTicket: unused, getEmail: () => "e2e@example.invalid" },
  { appVersion: "0.0.0-e2e" },
);
const events: AgentEvent[] = [];
const hostEvents = new EventEmitter<{ event: [AgentEvent] }>();
const phoneSecret = crypto.getRandomValues(new Uint8Array(32));
const phoneKeys = pushNotificationKeys(phoneSecret);
const phoneShown: { title: string; body: string }[] = [];
const phoneWaiters: (() => void)[] = [];
const phone = new PushNotificationService({
  agents: {
    on: (_name, listener) => hostEvents.on("event", listener),
    off: (_name, listener) => hostEvents.off("event", listener),
    listAgents: () => service.listAgents(),
    readConversationPageFor: unused,
    readTask: () => {
      throw new Error("Previews are off in this check.");
    },
    getRuntimeSnapshot: () => {
      throw new Error("Not used by this check.");
    },
    listConversationReads: () => {
      throw new Error("Not used by this check.");
    },
  },
  store: { list: () => [], replace: () => Effect.void },
  send: (request) =>
    Effect.sync(() => {
      const text = openSealedLiveActivity(
        request.push.sealed,
        encodeLiveActivityBytes(phoneKeys.seal),
        encodeLiveActivityBytes(phoneKeys.tag),
      );
      assert.ok(text, "The phone cannot open the send.");
      const { title, body } = JSON.parse(text);
      phoneShown.push({ title, body });
      for (const resolve of phoneWaiters.splice(0)) resolve();
      return "sent" as const;
    }),
  hiddenAgentIds: () => new Set(),
  memberActive: () => true,
  lastUseElsewhere: () => null,
  atHostComputer: () => false,
  memberLevels: () => ({ server: null, agents: new Map() }),
  liveActivityShows: () => false,
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
});
const forwarders = createRendererForwarders({
  getMainWindow: () => mainWindow,
  getChatWindows: () => [],
  getAgentService: () => service,
  getHostService: () => null,
  getHostAnalytics: () => null,
  getRemoteServerManager: () => manager,
  showMainWindow: () => undefined,
  getTranslate: () => english,
  getFormat: () => createFormat("en"),
  desktopNotificationsEnabled: () => true,
  notificationPreviewEnabled: () => false,
  ownAgentNotificationLevels: () => new Map(),
});
const mainWindow = new BrowserWindow();
service.on("event", (event) => {
  events.push(event);
  forwarders.forwardAgentEvent(LOCAL_SERVER_ID, event);
  hostEvents.emit("event", event);
});

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

const idle = (agentId: string) => {
  const turns = (type: "turn-started" | "turn-completed") =>
    new Set(events.flatMap((event) => (event.type === type && event.agentId === agentId ? [event.turnId] : [])));
  const completed = turns("turn-completed");
  return (
    service.listQueue(agentId).deliveries.every((delivery) => ended(delivery.status)) &&
    [...turns("turn-started")].every((turnId) => completed.has(turnId))
  );
};

async function createAgent(name: string) {
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks which teammate turns notify.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s first turn`, () => idle(agent.id));
  return agent;
}

async function send(agentId: string, text: string): Promise<string> {
  const receipt = await runCauseEffect(service.sendMessage({ agentId, text, attachmentDraftIds: [] }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  return deliveryId;
}

const settled = (deliveryId: string) =>
  waitFor(`delivery ${deliveryId} to end`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return ended(status) ? status : null;
  });

const completions = (agentId: string, from: number) =>
  events
    .slice(from)
    .filter(
      (event): event is Extract<AgentEvent, { type: "turn-completed" }> =>
        event.type === "turn-completed" && event.agentId === agentId,
    );

const BARRIER = "Barrier";
const isBarrier = (notice: { title: string; body: string }) =>
  notice.title === BARRIER && notice.body === english("notification.needsBrowserStep");
let barriers = 0;
async function phoneBarrier(agentId: string): Promise<void> {
  const before = phoneShown.filter(isBarrier).length;
  hostEvents.emit("event", {
    type: "browser-takeover-requested",
    request: { requestId: `barrier-${++barriers}`, agentId, threadId: "barrier", turnId: "barrier", tabId: "tab" },
  });
  while (phoneShown.filter(isBarrier).length <= before) await new Promise<void>((done) => phoneWaiters.push(done));
}

const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
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
  importSignIn: unused,
};
const OWNER = { username: "owner-user", password: "owner-password-123" };
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
const server = new TeamApiServer({
  store: team,
  agents: service,
  mailbox,
  browser: teamBrowser,
  appVersion: "0.0.0-e2e",
  hiddenAgents: service,
  agentAccess: access,
});

interface RemoteClient {
  socket: WebSocket;
  shown: { title: string; body: string }[];
  turns: Set<string>;
}

async function openRemote(port: number, token: string, without: string | null): Promise<RemoteClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  const client: RemoteClient = { socket, shown: [], turns: new Set() };
  let ready: () => void = () => {};
  const snapshot = new Promise<void>((done) => {
    ready = done;
  });
  socket.addEventListener("message", (message) => {
    const value = JSON.parse(String(message.data));
    if (value?.type === "runtime-snapshot") ready();
    const optional = optionalTeamEvent(value, { agentTaskUiBlocks: true });
    const decoded = optional
      ? { kind: "known" as const, event: optionalTeamEventToCurrent(optional) }
      : decodeTeamProtocolV8BaseCurrentEvent(value);
    if (decoded.kind !== "known") return;
    const event = decoded.event;
    if (event.type === "turn-completed") client.turns.add(event.turnId);
    if (event.type !== "turn-completed" && event.type !== "prompt" && event.type !== "approval") return;
    if (!agentEventCanNotify(event) || teammateTurnCompleted(event)) return;
    const content = notificationForAgentEvent(event, service.listAgents(), english, "all");
    if (content) client.shown.push({ title: content.title, body: content.body });
  });
  await new Promise<void>((open, reject) => {
    socket.addEventListener("open", () => open(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: [
        "agent-runtime-snapshots",
        ...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).filter((capability) => capability !== without),
      ],
    }),
  );
  await snapshot;
  return client;
}

let current: RemoteClient | null = null;
let older: RemoteClient | null = null;
const remotes = () => {
  assert.ok(current && older, "The event sockets are not open.");
  return { current, older };
};

async function mark(barrierAgentId: string) {
  await phoneBarrier(barrierAgentId);
  const { current: now, older: before } = remotes();
  return {
    desktop: shown.length,
    phone: phoneShown.length,
    current: now.shown.length,
    older: before.shown.length,
    events: events.length,
  };
}

async function notificationsSince(from: Awaited<ReturnType<typeof mark>>, barrierAgentId: string) {
  await phoneBarrier(barrierAgentId);
  const ended = events.slice(from.events).flatMap((event) => (event.type === "turn-completed" ? [event.turnId] : []));
  const { current: now, older: before } = remotes();
  await waitFor("the remote completions", () =>
    [now, before].every((client) => ended.every((turnId) => client.turns.has(turnId))),
  );
  return {
    desktop: shown.slice(from.desktop),
    phone: phoneShown.slice(from.phone).filter((notice) => !isBarrier(notice)),
    current: now.shown.slice(from.current),
    older: before.shown.slice(from.older),
  };
}

function expectSeen(
  seen: Awaited<ReturnType<typeof notificationsSince>>,
  expected: { title: string; body: string }[],
  older: { title: string; body: string }[],
) {
  const order = (list: { title: string; body: string }[]) =>
    list.map((entry) => `${entry.title}: ${entry.body}`).sort();
  assert.deepEqual(
    { desktop: order(seen.desktop), phone: order(seen.phone), current: order(seen.current), older: order(seen.older) },
    { desktop: order(expected), phone: order(expected), current: order(expected), older: order(older) },
  );
}

const finished = english("notification.finished");

try {
  await runCauseEffect(service.initialize());
  await runCauseEffect(manager.initialize());
  await runCauseEffect(manager.setNotificationLevel(LOCAL_SERVER_ID, "all"));
  await runCauseEffect(team.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const port = await Effect.runPromise(server.start());
  const login = await fetch(`http://127.0.0.1:${port}${TEAM_API_ROUTES.auth.login}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
      [TEAM_APP_VERSION_HEADER]: "0.0.0-e2e",
      ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
    },
    body: JSON.stringify(OWNER),
  });
  assert.equal(login.status, 200, "The owner could not sign in.");
  const { sessionToken } = await login.json();
  current = await openRemote(port, sessionToken, null);
  older = await openRemote(port, sessionToken, TEAMMATE_RESULT_TURN_CAPABILITY);
  phone.start();
  phone.register(
    "phone-session",
    { memberId: "owner", protocol: 7, capabilities: new Set() },
    {
      platform: "android",
      value: {
        serverId: "phone-server-id",
        token: "e2e-token-".padEnd(40, "x"),
        secret: Buffer.from(phoneSecret).toString("base64url"),
        locale: "en",
        away: true,
        level: "all",
        mutedUntil: null,
        preview: false,
        sound: "default",
      },
    },
  );

  const barrier = await createAgent(BARRIER);
  const coordinator = await createAgent("Coordinator");
  const teammates: Awaited<ReturnType<typeof createAgent>>[] = [];
  for (const name of ["Porygon", "Machamp", "Hoothoot", "Dedenne", "Meowth", "Vespiquen"])
    teammates.push(await createAgent(name));

  await check("a coordinator and six teammates notify once, with the coordinator's answer", async () => {
    const start = events.length;
    const request = await send(
      coordinator.id,
      `Ask the team for a health report. ${plan({
        calls: [
          {
            tool: "send_message",
            arguments: {
              recipientAgentIds: teammates.map((agent) => agent.id),
              text: `Send your health report. ${plan({ answer: "Status: done\nResult: all checks pass.\nEvidence: none", gate: "reports" })}`,
            },
          },
        ],
        answer: "I asked the team.",
      })}`,
    );
    assert.equal(await settled(request), "completed");
    await waitFor("the end of the coordinator's own turn", () =>
      completions(coordinator.id, start).some((event) => event.origin === "user"),
    );
    const from = await mark(barrier.id);
    openGate("reports");
    const summary = await waitFor("the coordinator's answer with the reports", () =>
      completions(coordinator.id, from.events).find(
        (event) => event.status === "completed" && event.origin === "agent",
      ),
    );
    await waitFor("every agent to be idle", () => [coordinator, ...teammates].every((agent) => idle(agent.id)));
    for (const teammate of teammates)
      assert.equal(
        completions(teammate.id, from.events).filter((event) => event.status === "completed").length,
        1,
        `${teammate.name} ran its report turn.`,
      );
    const received = mailbox
      .listQueue(coordinator.id)
      .deliveries.filter((delivery) => delivery.turnId === summary.turnId)
      .map((delivery) => delivery.sender.kind === "agent" && delivery.sender.agentId);
    assert.deepEqual(
      new Set(received),
      new Set(teammates.map((agent) => agent.id)),
      "The coordinator's answer turn took each teammate's result.",
    );
    const seen = await notificationsSince(from, barrier.id);
    expectSeen(seen, [{ title: coordinator.name, body: finished }], []);
    return seen;
  });

  const teammate = teammates[0];
  assert.ok(teammate);
  await check("a message from the user to a teammate notifies", async () => {
    const from = await mark(barrier.id);
    assert.equal(await settled(await send(teammate.id, "How is the disk?")), "completed");
    const seen = await notificationsSince(from, barrier.id);
    const expected = [{ title: teammate.name, body: finished }];
    expectSeen(seen, expected, expected);
    return seen;
  });

  await check("a question and an approval in a teammate's turn for the coordinator notify", async () => {
    const [asker, approver] = teammates.slice(1, 3);
    assert.ok(asker && approver);
    const from = await mark(barrier.id);
    const request = await send(
      coordinator.id,
      `Ask two teammates. ${plan({
        calls: [
          {
            tool: "send_message",
            arguments: {
              recipientAgentIds: [asker.id],
              text: `Pick a server. ${plan({ ask: "prompt", answer: "Status: done\nResult: picked.\nEvidence: none" })}`,
            },
          },
          {
            tool: "send_message",
            arguments: {
              recipientAgentIds: [approver.id],
              text: `Check the disk. ${plan({ ask: "approval", answer: "Status: done\nResult: 40% used.\nEvidence: df -h" })}`,
            },
          },
        ],
        answer: "I asked them.",
      })}`,
    );
    assert.equal(await settled(request), "completed");
    const prompt = await waitFor("the teammate's question", () =>
      events.slice(from.events).find((event) => event.type === "prompt" && event.agentId === asker.id),
    );
    const approval = await waitFor("the teammate's approval", () =>
      events.slice(from.events).find((event) => event.type === "approval" && event.approval.agentId === approver.id),
    );
    assert.equal(prompt.type, "prompt");
    assert.equal(approval.type, "approval");
    await runCauseEffect(service.respondToPrompt({ requestId: prompt.requestId, answers: { q: ["One"] } }));
    await runCauseEffect(service.respondToApproval({ requestId: approval.approval.requestId, decision: "accept" }));
    await waitFor("the coordinator's answer with the results", () =>
      completions(coordinator.id, from.events).some(
        (event) => event.status === "completed" && event.origin === "agent",
      ),
    );
    await waitFor("every agent to be idle", () => [coordinator, asker, approver].every((agent) => idle(agent.id)));
    const seen = await notificationsSince(from, barrier.id);
    const coordinatorTurns = completions(coordinator.id, from.events).filter((event) => event.status === "completed");
    assert.ok(coordinatorTurns.length >= 2, "The coordinator answered with the results.");
    const expected = [
      ...coordinatorTurns.map(() => ({ title: coordinator.name, body: finished })),
      { title: asker.name, body: english("notification.needsInput") },
      { title: approver.name, body: english("notification.needsApproval") },
    ];
    expectSeen(seen, expected, [
      ...coordinatorTurns
        .filter((event) => event.origin === "user")
        .map(() => ({ title: coordinator.name, body: finished })),
      ...expected.slice(coordinatorTurns.length),
    ]);
    return seen;
  });

  await check("a routine run that asks a teammate notifies, and so does the answer with the result", async () => {
    const helper = teammates[3];
    assert.ok(helper);
    const routine = service.createRoutine(
      {
        agentId: coordinator.id,
        name: "Daily health",
        instruction: `Ask for the health report. ${plan({
          calls: [
            {
              tool: "send_message",
              arguments: {
                recipientAgentIds: [helper.id],
                text: `Send your health report. ${plan({ answer: "Status: done\nResult: healthy.\nEvidence: none", gate: "routine" })}`,
              },
            },
          ],
          answer: "I asked for the report.",
        })}`,
        active: false,
        timezone: "UTC",
        schedule: { kind: "custom", expression: "0 9 * * *" },
      },
      { recordConversationEvent: false },
    );
    const from = await mark(barrier.id);
    await runCauseEffect(service.testRoutine({ agentId: coordinator.id, routineId: routine.id }));
    await waitFor("the routine run", () =>
      completions(coordinator.id, from.events).some((event) => event.origin === "routine"),
    );
    openGate("routine");
    await waitFor("the coordinator's answer with the result", () =>
      completions(coordinator.id, from.events).some(
        (event) => event.status === "completed" && event.origin === "agent",
      ),
    );
    await waitFor("every agent to be idle", () => [coordinator, helper].every((agent) => idle(agent.id)));
    assert.equal(completions(helper.id, from.events).length, 1, "The teammate ran its report turn.");
    const seen = await notificationsSince(from, barrier.id);
    const run = { title: coordinator.name, body: finished };
    expectSeen(seen, [run, run], [run]);
    return seen;
  });

  async function nested(names: [number, number, number], gate: string, answerTurn: FakeTurn) {
    const [a, b, c] = names.map((index) => teammates[index]);
    assert.ok(a && b && c);
    const start = events.length;
    const request = await send(
      a.id,
      `Ask B. ${plan({
        calls: [
          {
            tool: "send_message",
            arguments: {
              recipientAgentIds: [b.id],
              text: `Check the fleet. ${plan(
                {
                  answer: "I asked C and wait for the reply.",
                  gate: `${gate}-b`,
                  calls: [
                    {
                      tool: "send_message",
                      arguments: {
                        recipientAgentIds: [c.id],
                        text: `Check the disk. ${plan({ answer: "Status: done\nResult: 40% used.\nEvidence: df -h", gate })}`,
                      },
                    },
                  ],
                },
                answerTurn,
              )}`,
            },
          },
        ],
        answer: "I asked B.",
      })}`,
    );
    assert.equal(await settled(request), "completed");
    await waitFor("the end of A's own turn", () => completions(a.id, start).some((event) => event.origin === "user"));
    const from = await mark(barrier.id);
    openGate(`${gate}-b`);
    await waitFor("A's answer with B's first reply", () =>
      completions(a.id, from.events).some((event) => event.status === "completed" && event.origin === "agent"),
    );
    const asked = service
      .listQueue(b.id)
      .deliveries.findLast((delivery) => delivery.sender.kind === "agent" && delivery.sender.agentId === a.id);
    assert.ok(asked, "B got A's request.");
    writeFileSync(join(gates, `${gate}-request.json`), JSON.stringify({ agentId: a.id, messageId: asked.messageId }));
    openGate(gate);
    await waitFor(
      "B's turn with C's answer",
      () => completions(b.id, start).filter((event) => event.status === "completed").length >= 2,
    );
    return { a, b, c, from };
  }

  await check("A asks B and B asks C: only A's answers notify", async () => {
    const { a, b, c, from } = await nested([4, 5, 0], "nested", {
      answer: "I sent C's result to A.",
      request: "nested-request",
      calls: [
        {
          tool: "send_message",
          arguments: {
            recipientAgentIds: ["$REQUESTER"],
            replyToMessageId: "$REQUEST",
            expectsReply: false,
            text: "Status: done\nResult: C reports 40% disk use.\nEvidence: C's reply",
          },
        },
      ],
    });
    await waitFor(
      "A's answer with B's result",
      () =>
        completions(a.id, from.events).filter((event) => event.status === "completed" && event.origin === "agent")
          .length >= 2,
    );
    await waitFor("every agent to be idle", () => [a, b, c].every((agent) => idle(agent.id)));
    const passedOn = completions(b.id, from.events).filter((event) => event.status === "completed");
    assert.equal(passedOn.at(-1)?.answersAgent, true, "B's turn with C's answer goes to A.");
    const seen = await notificationsSince(from, barrier.id);
    const fromA = { title: a.name, body: finished };
    expectSeen(seen, [fromA, fromA], []);
    return seen;
  });

  await check("B gives C's answer to the user and not to A: B's answer notifies", async () => {
    const { a, b, c, from } = await nested([1, 2, 3], "nested-user", { answer: "C reports 40% disk use." });
    await waitFor("every agent to be idle", () => [a, b, c].every((agent) => idle(agent.id)));
    const seen = await notificationsSince(from, barrier.id);
    expectSeen(
      seen,
      [
        { title: a.name, body: finished },
        { title: b.name, body: finished },
      ],
      [],
    );
    return seen;
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  for (const client of [current, older]) client?.socket.close();
  await Effect.runPromise(server.stop()).catch(() => {});
  await runCauseEffect(phone.dispose()).catch(() => {});
  await runCauseEffect(manager.stop()).catch(() => {});
  await runCauseEffect(service.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
