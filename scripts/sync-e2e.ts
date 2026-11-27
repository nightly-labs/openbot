import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createInviteUrl, parseInviteUrl } from "@openbot/contracts/invite-links";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentNotificationLevelsSnapshot,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type SidebarPinsSnapshot,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import {
  encodeTeamCapabilitiesV10,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  AGENTS_SYNC_COLLECTION,
  CHANNELS_SYNC_COLLECTION,
  CONVERSATION_READS_SYNC_COLLECTION,
  CRM_CUSTOMERS_SYNC_COLLECTION,
  HIDDEN_AGENTS_SYNC_COLLECTION,
  NOTIFICATION_LEVELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  ROUTINES_SYNC_COLLECTION,
  SIDEBAR_LAYOUT_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  type SyncCollectionSpec,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import {
  decodeSyncServerMessage,
  SYNC_CAPABILITY,
  type SyncKeyVersion,
  type SyncServerMessage,
} from "@openbot/contracts/team-protocol/sync-v1";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v8";
import { TEAM_ABSENT_CAPABILITIES_HEADER, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { createSyncClient, type SyncClient } from "@openbot/team-client/sync-client";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { type CrmHandle, createCrm } from "../src/backend/crm/crm";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import type { AgentAccessState } from "../src/main/agent-access-store";
import { AgentNotificationLevelStore } from "../src/main/agent-notification-level-store";
import { SidebarPinStore } from "../src/main/sidebar-pin-store";
import type { TeamApiAgentAccess, TeamApiBrowser, TeamApiOptions } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sync");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 15_000;
const COLLECTION = CHANNELS_SYNC_COLLECTION.name;
const CAPABILITIES = [
  TEAM_OPEN_PROVIDERS_CAPABILITY,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  AGENT_HIDDEN_CAPABILITY,
  SIDEBAR_PINS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  SIDEBAR_FOLDERS_CAPABILITY,
  WORKFLOWS_CAPABILITY,
  CRM_CAPABILITY,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
  "sidebar-layout",
];
const SYNC_CAPABILITIES = [...CAPABILITIES, SYNC_CAPABILITY];
const without = (...removed: string[]) => SYNC_CAPABILITIES.filter((capability) => !removed.includes(capability));

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function record(value: unknown, label: string): DynamicRecord {
  assert.ok(isDynamicRecord(value), `${label} is not an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} is not text.`);
  return String(value);
}

function fakeCodexSource(gate: string, release: string): string {
  return `#!/usr/bin/env node
const { existsSync, watch } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const GATE = ${JSON.stringify(gate)};
const RELEASE = ${JSON.stringify(release)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const whenReleased = (finish) => {
  let done = false;
  const once = () => {
    if (done || !existsSync(RELEASE)) return;
    done = true;
    watcher.close();
    finish();
  };
  const watcher = watch(GATE, once);
  once();
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
    case "thread/name/set": return write({ id: message.id, result: {} });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return whenReleased(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      });
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
    }
    newline = buffer.indexOf("\\n");
  }
});
`;
}

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

let accessLevels: AgentAccessState = { revision: 0, everyone: {}, roles: [] };
const accessListeners = new Set<(serverId: string, state: AgentAccessState) => void>();
const agentAccess: TeamApiAgentAccess = {
  get: () => accessLevels,
  levels: () => accessLevels,
  subscribe: (listener) => {
    accessListeners.add(listener);
    return () => accessListeners.delete(listener);
  },
  set: () => Effect.die(new Error("Not used by this check.")),
  copyAgent: () => Effect.die(new Error("Not used by this check.")),
};

const root = await mkdtemp(join(tmpdir(), "openbot-sync-"));
const fakeCodex = join(root, "codex");
const turnGate = join(root, "turn-gate");
const turnRelease = join(turnGate, "release");
mkdirSync(join(root, "home", ".codex"), { recursive: true });
mkdirSync(turnGate, { recursive: true });
process.env.HOME = join(root, "home");
process.env.CODEX_HOME = join(root, "home", ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
writeFileSync(fakeCodex, fakeCodexSource(turnGate, turnRelease), { mode: 0o755 });
const userData = join(root, "user-data");
const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const pins = new SidebarPinStore(join(userData, "sidebar-pins.json"));
const levels = new AgentNotificationLevelStore(join(userData, "agent-notification-levels.json"));
const sockets: WebSocket[] = [];
let server: TeamApiServer | null = null;
let agents: AgentService | null = null;
let workflows: WorkflowsHandle | null = null;
let crm: CrmHandle | null = null;
let port = 0;

type Received = { type: string; sync: SyncServerMessage | null };
type Diff = { upserts: Map<string, { version: string; value: unknown }>; deletes: string[]; messages: number };

interface SyncSocket {
  readonly socket: WebSocket;
  readonly received: Received[];
  readonly closed: Promise<number>;
  send(value: unknown): void;
  next<T extends SyncServerMessage>(match: (message: SyncServerMessage) => message is T): Promise<T>;
  until(match: (entry: Received) => boolean, from: number): Promise<number>;
  diff(collection?: string): Promise<Diff>;
  settled(collection: string): Promise<Diff>;
  close(): Promise<number>;
}

async function openSync(
  token: string,
  capabilities: readonly string[],
  onSync?: (message: SyncServerMessage) => void,
): Promise<SyncSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  const received: SyncSocket["received"] = [];
  const queue: SyncServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener("message", (message) => {
    const value = JSON.parse(String(message.data));
    const sync = decodeSyncServerMessage(value);
    received.push({ type: text(record(value, "event").type, "event type"), sync });
    if (sync && onSync) onSync(sync);
    else if (sync) queue.push(sync);
    for (const wake of [...waiters]) wake();
  });
  const closed = new Promise<number>((resolveClose) =>
    socket.addEventListener("close", (event) => resolveClose(event.code), { once: true }),
  );
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities }));
  const next = <T extends SyncServerMessage>(match: (message: SyncServerMessage) => message is T): Promise<T> =>
    new Promise<T>((resolveNext) => {
      const take = () => {
        const found = queue.find(match);
        if (!found) return false;
        queue.splice(queue.indexOf(found), 1);
        waiters.delete(wake);
        resolveNext(found);
        return true;
      };
      const wake = () => void take();
      if (!take()) waiters.add(wake);
    });
  const until = (match: (entry: Received) => boolean, from: number): Promise<number> =>
    new Promise<number>((resolveUntil) => {
      const take = () => {
        const index = received.findIndex((entry, at) => at >= from && match(entry));
        if (index < 0) return false;
        waiters.delete(wake);
        resolveUntil(index);
        return true;
      };
      const wake = () => void take();
      if (!take()) waiters.add(wake);
    });
  return {
    socket,
    received,
    closed,
    send: (value) => socket.send(JSON.stringify(value)),
    next,
    until,
    async diff(collection = COLLECTION) {
      const upserts = new Map<string, { version: string; value: unknown }>();
      const deletes: string[] = [];
      let messages = 0;
      for (;;) {
        const message = await next(changesOf(collection));
        messages += 1;
        for (const upsert of message.upserts) upserts.set(upsert.key, { version: upsert.version, value: upsert.value });
        deletes.push(...message.deletes);
        if (message.synced) return { upserts, deletes: deletes.sort(), messages };
      }
    },
    async settled(collection) {
      const id = randomUUID();
      socket.send(JSON.stringify({ type: "sync-barrier", id }));
      await next((message): message is Barrier => message.type === "sync-barrier" && message.id === id);
      const upserts = new Map<string, { version: string; value: unknown }>();
      const deletes = new Set<string>();
      const pending = queue.filter(changesOf(collection));
      for (const message of pending) {
        queue.splice(queue.indexOf(message), 1);
        for (const upsert of message.upserts) {
          deletes.delete(upsert.key);
          upserts.set(upsert.key, { version: upsert.version, value: upsert.value });
        }
        for (const key of message.deletes) {
          upserts.delete(key);
          deletes.add(key);
        }
      }
      return { upserts, deletes: [...deletes].sort(), messages: pending.length };
    },
    async close() {
      socket.close();
      return closed;
    },
  };
}

type Changes = Extract<SyncServerMessage, { type: "sync-changes" }>;
type Unavailable = Extract<SyncServerMessage, { type: "sync-unavailable" }>;
type Barrier = Extract<SyncServerMessage, { type: "sync-barrier" }>;

function changesOf(collection: string) {
  return (message: SyncServerMessage): message is Changes =>
    message.type === "sync-changes" && message.collection === collection;
}

function isChangeFor(entry: Received, collection: string): boolean {
  return entry.sync?.type === "sync-changes" && entry.sync.collection === collection;
}

function subscribe(socket: SyncSocket, collection: string): Promise<Diff> {
  socket.send({ type: "sync-subscribe", collection, have: [], more: false });
  return socket.diff(collection);
}

async function unavailable(socket: SyncSocket, collection: string, send = true): Promise<void> {
  if (send) socket.send({ type: "sync-subscribe", collection, have: [], more: false });
  await socket.next(
    (message): message is Unavailable => message.type === "sync-unavailable" && message.collection === collection,
  );
}

async function quiet(socket: SyncSocket, from: number, collection: string): Promise<void> {
  const id = randomUUID();
  socket.send({ type: "sync-barrier", id });
  await socket.next((message): message is Barrier => message.type === "sync-barrier" && message.id === id);
  assert.ok(
    !socket.received.slice(from).some((entry) => isChangeFor(entry, collection)),
    `A ${collection} change reached a subscriber that it is not for.`,
  );
}

async function pushedFirst(socket: SyncSocket, from: number, collection: string, eventType: string) {
  const eventAt = await socket.until((entry) => entry.type === eventType, from);
  const syncAt = socket.received.findIndex((entry, at) => at >= from && isChangeFor(entry, collection));
  assert.ok(
    syncAt >= from && syncAt < eventAt,
    `The ${eventType} event arrived before the ${collection} change: ${socket.received
      .slice(from)
      .map((entry) => entry.type)
      .join(", ")}.`,
  );
  return { syncAt: syncAt - from, eventAt: eventAt - from };
}

async function arrived(socket: SyncSocket, from: number, eventType: string): Promise<number> {
  return (await socket.until((entry) => entry.type === eventType, from)) - from;
}

function rowsOf<Entity>(spec: SyncCollectionSpec<Entity>, items: unknown): Map<string, unknown> {
  assert.ok(Array.isArray(items), `The HTTP ${spec.name} response is not a list.`);
  return new Map(items.map((item) => [spec.key(spec.decode(item)), item] as const));
}

function sameRows<Entity>(spec: SyncCollectionSpec<Entity>, diff: Diff, http: Map<string, unknown>): void {
  assert.deepEqual([...diff.upserts.keys()].sort(), [...http.keys()].sort(), `The ${spec.name} keys differ from HTTP.`);
  for (const [key, entry] of diff.upserts) {
    assert.ok(isDeepStrictEqual(entry.value, http.get(key)), `The synced ${spec.name} row ${key} differs from HTTP.`);
    assert.equal(spec.key(spec.decode(entry.value)), key, `The ${spec.name} row ${key} has a different key.`);
  }
}

function upsertKeys(diff: Diff): string[] {
  return [...diff.upserts.keys()].sort();
}

type HttpBody = DynamicRecord | unknown[] | string | number | boolean | null;

function isHttpBody(value: unknown): value is HttpBody {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isDynamicRecord(value)
  );
}

async function ok(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  capabilities: readonly string[] = CAPABILITIES,
): Promise<HttpBody> {
  const response = await call(method, path, { token, body, capabilities });
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${method} ${path} returned ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assert.ok(isHttpBody(response.body), `${method} ${path} returned a body that is not JSON.`);
  return response.body;
}

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[] } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
  };
  const lists = encodeTeamCapabilitiesV10(input.capabilities ?? CAPABILITIES);
  headers[TEAM_CAPABILITIES_HEADER] = lists.capabilities.join(",");
  if (lists.absent.length) headers[TEAM_ABSENT_CAPABILITIES_HEADER] = lists.absent.join(",");
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

async function saveChannel(
  token: string,
  channelId: string,
  update: boolean,
  draft: { name: string; members: string[] },
): Promise<void> {
  const saved = await call("POST", CHANNEL_ROUTES.command, {
    token,
    body: {
      type: "save",
      operationId: randomUUID(),
      channelId,
      update,
      draft: {
        name: draft.name,
        title: "",
        instructions: "",
        members: draft.members.map((agentId) => ({ agentId })),
        leadAgentId: null,
      },
    },
  });
  assert.equal(saved.status, 200, `Channel save returned ${saved.status}: ${JSON.stringify(saved.body)}`);
}

async function listChannels(token: string): Promise<Map<string, unknown>> {
  const listed = await call("GET", CHANNEL_ROUTES.list, { token });
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body));
  return new Map(listed.body.map((row) => [text(record(row, "channel").id, "channel id"), row] as const));
}

function setAccess(state: AgentAccessState): void {
  accessLevels = state;
  for (const listener of accessListeners) listener(team.getIdentity()?.serverId ?? "", accessLevels);
}

function addAgentMessage(agentId: string): void {
  const threadId = agentStore.ensureThreadIdNow(agentId);
  const at = new Date().toISOString();
  const messageId = `message-${agentId}`;
  database.connection
    .prepare(
      `INSERT OR IGNORE INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, '', NULL, ?, ?, 1)`,
    )
    .run(threadId, agentId, at, at);
  database.connection
    .prepare(
      `INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal,
         message_json, last_event_sequence, group_start, group_first, group_id, turn_rank)
       VALUES (?, ?, NULL, 'assistant', 'completed', NULL, ?, 1, ?, 1, ?, 1, ?, 0)`,
    )
    .run(
      threadId,
      messageId,
      at,
      JSON.stringify({ id: messageId, author: "assistant", status: "completed", text: "Ready.", createdAt: at }),
      at,
      `message:${messageId}`,
    );
}

const syncMessagesAfter = (socket: SyncSocket, from: number) =>
  socket.received.slice(from).filter((entry) => entry.sync);

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(team.configure("Sync Host", OWNER.username, OWNER.password));
  const visibleAgent = await runCauseEffect(
    agentStore.createAgent({ name: "Visible", description: "", avatarSeed: "visible", avatarHue: null }),
  );
  const hiddenAgent = await runCauseEffect(
    agentStore.createAgent({ name: "Hidden", description: "", avatarSeed: "hidden", avatarHue: null }),
  );
  const spareAgent = await runCauseEffect(
    agentStore.createAgent({ name: "Spare", description: "", avatarSeed: "spare", avatarHue: null }),
  );
  const freshAgent = await runCauseEffect(
    agentStore.createAgent({ name: "Fresh", description: "", avatarSeed: "fresh", avatarHue: null }),
  );
  addAgentMessage(visibleAgent.id);
  addAgentMessage(spareAgent.id);
  await runCauseEffect(pins.load());
  await runCauseEffect(levels.load());
  const service = new AgentService({
    store: agentStore,
    mailbox,
    browser: agentBrowser,
    sidebarLayout: sidebar,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
  });
  agents = service;
  workflows = await Effect.runPromise(
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
  crm = await Effect.runPromise(createCrm({ database, changed: () => service.notifyCrmChanged() }));
  const createInvite: TeamApiOptions["createInvite"] = (input) =>
    Effect.gen(function* () {
      const identity = team.getIdentity();
      assert.ok(identity, "The host has no identity.");
      const invite = yield* team.createInvite(input.role, input.email, {});
      return {
        id: invite.id,
        role: input.role,
        expiresAt: invite.expiresAt,
        usedAt: null,
        inviteUrl: createInviteUrl(
          {
            apiUrl: `http://localhost:${port}`,
            serverId: identity.serverId,
            fingerprint: identity.fingerprint,
            token: invite.token,
          },
          { allowLocalDevelopmentApiUrl: true },
        ),
        email: invite.email,
        permanent: invite.permanent,
        useCount: invite.useCount,
      };
    });
  server = new TeamApiServer({
    store: team,
    agents: service,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    createInvite,
    agentAccess,
    channels: service.channels,
    hiddenAgents: service,
    sidebarPins: {
      snapshot: (memberId, hidden) => pins.snapshot(memberId, hidden),
      set: (memberId, items, hidden) => pins.set(memberId, items, hidden),
      seed: (memberId, items, hidden) => pins.seed(memberId, items, hidden),
      subscribe: (listener) => pins.subscribe(listener),
    },
    agentNotificationLevels: {
      snapshot: (memberId, hidden) => levels.snapshot(memberId, hidden),
      set: (memberId, input) => levels.set(memberId, input),
      setServer: (memberId, level) => levels.setServer(memberId, level),
      subscribe: (listener) => levels.subscribe(listener),
    },
    workflows: {
      ...workflows,
      rotateWorkflowSecret: () => Effect.die(new Error("No webhook secret rotates in this check.")),
    },
    crm,
  });
  port = await Effect.runPromise(server.start());
  const ownerToken = await login(OWNER);

  const memberToken = await step(
    "setup: a member joins, and the owner makes two channels with different agents",
    async () => {
      const created = await call("POST", TEAM_API_ROUTES.team.invites, { token: ownerToken, body: { role: "member" } });
      assert.equal(created.status, 201, `Invite creation returned ${created.status}.`);
      const link = parseInviteUrl(text(record(created.body, "invite").inviteUrl, "invite link"), {
        allowLocalDevelopmentApiUrl: true,
      });
      const joined = await call("POST", TEAM_API_ROUTES.join.server, { body: { inviteToken: link.token, ...MEMBER } });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      await saveChannel(ownerToken, "channel-visible", false, { name: "visible", members: [visibleAgent.id] });
      await saveChannel(ownerToken, "channel-hidden", false, { name: "hidden", members: [hiddenAgent.id] });
      return login(MEMBER);
    },
    () => ({ channels: 2 }),
  );

  const live = await openSync(memberToken, SYNC_CAPABILITIES);

  const ledger = await step(
    "subscribe: an empty client gets every visible channel, the same rows as the HTTP list, in one synced message",
    async () => {
      live.send({ type: "sync-subscribe", collection: COLLECTION, have: [], more: false });
      const diff = await live.diff();
      const listed = await listChannels(memberToken);
      assert.deepEqual([...diff.upserts.keys()].sort(), [...listed.keys()].sort());
      for (const [key, entry] of diff.upserts)
        assert.ok(isDeepStrictEqual(entry.value, listed.get(key)), `The synced row ${key} differs from the HTTP row.`);
      for (const [key, entry] of diff.upserts)
        assert.equal(CHANNELS_SYNC_COLLECTION.key(CHANNELS_SYNC_COLLECTION.decode(entry.value)), key);
      assert.deepEqual(diff.deletes, []);
      return new Map([...diff.upserts].map(([key, entry]) => [key, entry.version] as const));
    },
    (value) => ({ keys: [...value.keys()].sort() }),
  );

  await step("push: a new channel arrives as one upsert, before the channels-changed event", async () => {
    const before = live.received.length;
    await saveChannel(ownerToken, "channel-open", false, { name: "open", members: [] });
    const diff = await live.diff();
    assert.deepEqual([...diff.upserts.keys()], ["channel-open"]);
    assert.deepEqual(diff.deletes, []);
    const after = live.received.slice(before);
    const syncAt = after.findIndex((entry) => entry.sync?.type === "sync-changes");
    const eventAt = after.findIndex((entry) => entry.type === "channels-changed");
    assert.ok(syncAt >= 0, "No sync change arrived.");
    assert.ok(eventAt < 0 || syncAt < eventAt, "The channels-changed event arrived before the sync change.");
    for (const [key, entry] of diff.upserts) ledger.set(key, entry.version);
    return { syncAt, eventAt };
  });

  await step("update: a rename sends only the changed channel with a new version", async () => {
    const previous = ledger.get("channel-visible");
    await saveChannel(ownerToken, "channel-visible", true, { name: "visible-renamed", members: [visibleAgent.id] });
    const diff = await live.diff();
    assert.deepEqual([...diff.upserts.keys()], ["channel-visible"]);
    const version = diff.upserts.get("channel-visible")?.version;
    assert.ok(version && version !== previous, "The version did not change.");
    assert.equal(record(diff.upserts.get("channel-visible")?.value, "channel").name, "visible-renamed");
    ledger.set("channel-visible", version);
    return { previous, version };
  });

  await step("visibility: hiding an agent deletes only its channel from the member's view", async () => {
    setAccess({ revision: 1, everyone: { [hiddenAgent.id]: "none" }, roles: [] });
    const diff = await live.diff();
    assert.deepEqual(diff.deletes, ["channel-hidden"]);
    assert.deepEqual([...diff.upserts.keys()], []);
    ledger.delete("channel-hidden");
    const listed = await listChannels(memberToken);
    assert.ok(!listed.has("channel-hidden"), "The HTTP list still shows the hidden channel.");
    return { deletes: diff.deletes };
  });

  await step("barrier: the host answers a barrier after it sends all pending changes", async () => {
    const before = live.received.length;
    await saveChannel(ownerToken, "channel-open", true, { name: "open-renamed", members: [] });
    live.send({ type: "sync-barrier", id: "barrier-1" });
    await live.next(
      (message): message is Extract<SyncServerMessage, { type: "sync-barrier" }> =>
        message.type === "sync-barrier" && message.id === "barrier-1",
    );
    const after = live.received.slice(before);
    const changeAt = after.findIndex(
      (entry) =>
        entry.sync?.type === "sync-changes" && entry.sync.upserts.some((upsert) => upsert.key === "channel-open"),
    );
    const barrierAt = after.findIndex((entry) => entry.sync?.type === "sync-barrier");
    assert.ok(changeAt >= 0 && changeAt < barrierAt, "The barrier arrived before the change.");
    const diff = await live.diff();
    for (const [key, entry] of diff.upserts) ledger.set(key, entry.version);
    return { changeAt, barrierAt };
  });

  await step(
    "reconnect: a client that sends its versions gets only the changes it missed, and deletes only for keys it held",
    async () => {
      await live.close();
      await saveChannel(ownerToken, "channel-open", true, { name: "open-offline", members: [] });
      const removed = await call("POST", CHANNEL_ROUTES.delete, {
        token: ownerToken,
        body: { channelId: "channel-visible" },
      });
      assert.equal(removed.status, 204, `Channel delete returned ${removed.status}.`);
      await saveChannel(ownerToken, "channel-new", false, { name: "new", members: [] });
      const again = await openSync(memberToken, SYNC_CAPABILITIES);
      const have: SyncKeyVersion[] = [...ledger, ["channel-ghost", "0000000000000000"]];
      again.send({ type: "sync-subscribe", collection: COLLECTION, have: have.slice(0, 2), more: true });
      again.send({ type: "sync-subscribe", collection: COLLECTION, have: have.slice(2), more: false });
      const diff = await again.diff();
      assert.deepEqual([...diff.upserts.keys()].sort(), ["channel-new", "channel-open"]);
      assert.deepEqual(diff.deletes, ["channel-ghost", "channel-visible"]);
      assert.equal(diff.messages, 1);
      const unchanged = await openSync(memberToken, SYNC_CAPABILITIES);
      const current = [...(await listChannels(memberToken)).keys()];
      unchanged.send({
        type: "sync-subscribe",
        collection: COLLECTION,
        have: [...diff.upserts].map(([key, entry]) => [key, entry.version]),
        more: false,
      });
      const empty = await unchanged.diff();
      assert.equal(empty.upserts.size, 0);
      assert.deepEqual(empty.deletes, []);
      await unchanged.close();
      await again.close();
      return { upserts: [...diff.upserts.keys()].sort(), deletes: diff.deletes, current };
    },
  );

  await step(
    "client store: the team-client store syncs, shows a mutation at once, keeps it until the host confirms it, and resyncs after a reconnect",
    async () => {
      let socket: SyncSocket | null = null;
      const client: SyncClient = createSyncClient({
        send: async (message) => {
          assert.ok(socket, "The client sent before the socket opened.");
          socket.send(message);
        },
        onError: (error) => {
          throw error;
        },
      });
      const channels = client.collection(CHANNELS_SYNC_COLLECTION);
      const changed = () =>
        new Promise<void>((resolveChanged) => {
          const stop = channels.subscribe(() => {
            stop();
            resolveChanged();
          });
        });
      const synced = () =>
        new Promise<void>((resolveSynced) => {
          if (channels.status() === "synced") return resolveSynced();
          const stop = channels.subscribe(() => {
            if (channels.status() !== "synced") return;
            stop();
            resolveSynced();
          });
        });
      socket = await openSync(memberToken, SYNC_CAPABILITIES, (message) => client.receive(message));
      client.resubscribe();
      await synced();
      const listed = await listChannels(memberToken);
      assert.deepEqual(
        channels
          .values()
          .map((channel) => channel.id)
          .sort(),
        [...listed.keys()].sort(),
        "The store does not hold the HTTP list.",
      );
      const sorted = [...channels.values()].sort(CHANNELS_SYNC_COLLECTION.compare);
      assert.deepEqual(channels.values(), sorted, "The store is not in its sort order.");
      let shownDuringRun = "";
      const result = await channels.mutate({
        key: "channel-open",
        apply: (current) => (current ? { ...current, name: "open-optimistic" } : current),
        run: async () => {
          shownDuringRun = channels.get("channel-open")?.name ?? "";
          await saveChannel(ownerToken, "channel-open", true, { name: "open-confirmed", members: [] });
          return "saved";
        },
      });
      assert.equal(result, "saved");
      assert.equal(shownDuringRun, "open-optimistic", "The store did not show the mutation at once.");
      assert.equal(channels.get("channel-open")?.name, "open-confirmed", "The store lost the confirmed value.");
      const failed = await channels
        .mutate({
          key: "channel-open",
          apply: (current) => (current ? { ...current, name: "rolled-back" } : current),
          run: async () => {
            throw new Error("refused");
          },
        })
        .then(
          () => "resolved",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      assert.equal(failed, "refused");
      assert.equal(channels.get("channel-open")?.name, "open-confirmed", "A failed mutation stayed in the store.");
      client.pause();
      assert.equal(channels.status(), "stale");
      await socket.close();
      await saveChannel(ownerToken, "channel-new", true, { name: "new-offline", members: [] });
      socket = await openSync(memberToken, SYNC_CAPABILITIES, (message) => client.receive(message));
      const reloaded = changed();
      client.resubscribe();
      await reloaded;
      await synced();
      assert.equal(channels.get("channel-new")?.name, "new-offline", "The store missed a change made while offline.");
      await socket.close();
      client.dispose();
      return { values: channels.values().map((channel) => channel.name), shownDuringRun };
    },
  );

  await step("unknown collection: the host answers sync-unavailable and keeps the socket", async () => {
    const client = await openSync(memberToken, SYNC_CAPABILITIES);
    client.send({ type: "sync-subscribe", collection: "missing.v1", have: [], more: false });
    await client.next(
      (message): message is Extract<SyncServerMessage, { type: "sync-unavailable" }> =>
        message.type === "sync-unavailable" && message.collection === "missing.v1",
    );
    client.send({ type: "sync-barrier", id: "after-unavailable" });
    await client.next(
      (message): message is Extract<SyncServerMessage, { type: "sync-barrier" }> =>
        message.type === "sync-barrier" && message.id === "after-unavailable",
    );
    await client.close();
    return { unavailable: "missing.v1" };
  });

  await step("no channel chats: a sync client without channel-chats-v1 gets sync-unavailable", async () => {
    const client = await openSync(memberToken, [SYNC_CAPABILITY]);
    client.send({ type: "sync-subscribe", collection: COLLECTION, have: [], more: false });
    await client.next(
      (message): message is Extract<SyncServerMessage, { type: "sync-unavailable" }> =>
        message.type === "sync-unavailable" && message.collection === COLLECTION,
    );
    await client.close();
    return { unavailable: COLLECTION };
  });

  await step(
    "refusal: the host closes a socket that sends sync without sync-v1, or a malformed sync message",
    async () => {
      const old = await openSync(memberToken, [CHANNEL_CHATS_CAPABILITY]);
      old.send({ type: "sync-subscribe", collection: COLLECTION, have: [], more: false });
      const oldCode = await old.closed;
      const malformed = await openSync(memberToken, SYNC_CAPABILITIES);
      malformed.send({ type: "sync-subscribe", collection: "Bad Name", have: [], more: false });
      const malformedCode = await malformed.closed;
      assert.equal(oldCode, 1003);
      assert.equal(malformedCode, 1003);
      assert.ok(!old.received.some((entry) => entry.sync), "A client without sync-v1 got a sync message.");
      return { oldCode, malformedCode };
    },
  );

  const memberId = team.listMembers().find((candidate) => candidate.username === MEMBER.username)?.id;
  assert.ok(memberId, "The member has no ID.");
  const AGENTS = AGENTS_SYNC_COLLECTION.name;
  const READS = CONVERSATION_READS_SYNC_COLLECTION.name;
  const routinesOf = (agentId: string) => `${ROUTINES_SYNC_COLLECTION.name}:${agentId}`;
  const queueOf = (agentId: string) => `${QUEUE_SYNC_COLLECTION.name}:${agentId}`;
  const httpReads = async (token: string) =>
    rowsOf(
      CONVERSATION_READS_SYNC_COLLECTION,
      Object.entries(record(await ok("GET", TEAM_API_ROUTES.agents.conversationReads, token), "reads")).map(
        ([agentId, state]) => ({ ...record(state, "read state"), agentId }),
      ),
    );

  await step(
    "agents: subscribe matches GET /v1/agents, and a rename arrives before the agent list event (bots-changed on the v1 socket)",
    async () => {
      const socket = await openSync(memberToken, SYNC_CAPABILITIES);
      const diff = await subscribe(socket, AGENTS);
      sameRows(
        AGENTS_SYNC_COLLECTION,
        diff,
        rowsOf(AGENTS_SYNC_COLLECTION, await ok("GET", TEAM_API_ROUTES.agents.all, memberToken)),
      );
      assert.ok(!diff.upserts.has(hiddenAgent.id), "The member sees the hidden agent.");
      const before = socket.received.length;
      await ok("PATCH", TEAM_API_ROUTES.agent.one(visibleAgent.id), ownerToken, { name: "Visible renamed" });
      const order = await pushedFirst(socket, before, AGENTS, "bots-changed");
      const pushed = await socket.settled(AGENTS);
      assert.deepEqual(upsertKeys(pushed), [visibleAgent.id]);
      assert.equal(record(pushed.upserts.get(visibleAgent.id)?.value, "agent").name, "Visible renamed");
      await socket.close();
      return { keys: upsertKeys(diff), ...order };
    },
  );

  await step(
    "hidden agents: a hide reaches every viewer before the event; a hide of an agent the member cannot see reaches only the owner",
    async () => {
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      const member = await openSync(memberToken, SYNC_CAPABILITIES);
      const ownerRows = await subscribe(owner, HIDDEN_AGENTS_SYNC_COLLECTION.name);
      const memberRows = await subscribe(member, HIDDEN_AGENTS_SYNC_COLLECTION.name);
      sameRows(
        HIDDEN_AGENTS_SYNC_COLLECTION,
        memberRows,
        new Map([["snapshot", await ok("POST", AGENT_HIDDEN_ROUTES.read, memberToken, {})]]),
      );
      sameRows(
        HIDDEN_AGENTS_SYNC_COLLECTION,
        ownerRows,
        new Map([["snapshot", await ok("POST", AGENT_HIDDEN_ROUTES.read, ownerToken, {})]]),
      );
      let ownerFrom = owner.received.length;
      let memberFrom = member.received.length;
      await ok("POST", AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: visibleAgent.id, hidden: true });
      const memberOrder = await pushedFirst(
        member,
        memberFrom,
        HIDDEN_AGENTS_SYNC_COLLECTION.name,
        "hidden-agents-changed",
      );
      await pushedFirst(owner, ownerFrom, HIDDEN_AGENTS_SYNC_COLLECTION.name, "hidden-agents-changed");
      sameRows(
        HIDDEN_AGENTS_SYNC_COLLECTION,
        await member.settled(HIDDEN_AGENTS_SYNC_COLLECTION.name),
        new Map([["snapshot", await ok("POST", AGENT_HIDDEN_ROUTES.read, memberToken, {})]]),
      );
      await owner.settled(HIDDEN_AGENTS_SYNC_COLLECTION.name);
      ownerFrom = owner.received.length;
      memberFrom = member.received.length;
      await ok("POST", AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: hiddenAgent.id, hidden: true });
      const ownerPush = await owner.settled(HIDDEN_AGENTS_SYNC_COLLECTION.name);
      assert.deepEqual(upsertKeys(ownerPush), ["snapshot"]);
      await quiet(member, memberFrom, HIDDEN_AGENTS_SYNC_COLLECTION.name);
      await ok("POST", AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: hiddenAgent.id, hidden: false });
      await ok("POST", AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: visibleAgent.id, hidden: false });
      const restored = await owner.settled(HIDDEN_AGENTS_SYNC_COLLECTION.name);
      assert.deepEqual(record(restored.upserts.get("snapshot")?.value, "hidden agents").agents, []);
      const old = await openSync(memberToken, without(AGENT_HIDDEN_CAPABILITY));
      await unavailable(old, HIDDEN_AGENTS_SYNC_COLLECTION.name);
      await Promise.all([owner.close(), member.close(), old.close()]);
      return { memberOrder, ownerMessages: ownerPush.messages };
    },
  );

  for (const [snapshotSpec, routes, eventType, capability, input] of [
    [
      SIDEBAR_PINS_SYNC_COLLECTION,
      SIDEBAR_PINS_ROUTES,
      "sidebar-pins-changed",
      SIDEBAR_PINS_CAPABILITY,
      { items: [{ kind: "agent", id: visibleAgent.id }] },
    ],
    [
      NOTIFICATION_LEVELS_SYNC_COLLECTION,
      AGENT_NOTIFICATION_LEVELS_ROUTES,
      "agent-notification-levels-changed",
      AGENT_NOTIFICATION_LEVELS_CAPABILITY,
      { agentId: visibleAgent.id, level: "nothing" },
    ],
  ] as const) {
    const spec: SyncCollectionSpec<SidebarPinsSnapshot | AgentNotificationLevelsSnapshot> = snapshotSpec;
    await step(`${spec.name}: a member's change arrives before ${eventType} and only for that member`, async () => {
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      const member = await openSync(memberToken, SYNC_CAPABILITIES);
      await subscribe(owner, spec.name);
      sameRows(
        spec,
        await subscribe(member, spec.name),
        new Map([["snapshot", await ok("POST", routes.read, memberToken, {})]]),
      );
      const ownerFrom = owner.received.length;
      const memberFrom = member.received.length;
      await ok("POST", routes.set, memberToken, input);
      const order = await pushedFirst(member, memberFrom, spec.name, eventType);
      sameRows(
        spec,
        await member.settled(spec.name),
        new Map([["snapshot", await ok("POST", routes.read, memberToken, {})]]),
      );
      await quiet(owner, ownerFrom, spec.name);
      const old = await openSync(memberToken, without(capability));
      await unavailable(old, spec.name);
      await Promise.all([owner.close(), member.close(), old.close()]);
      return order;
    });
  }

  await step(
    "sidebar layout: folder and legacy clients get their own HTTP shape, and a change arrives before each event",
    async () => {
      const LAYOUT = SIDEBAR_LAYOUT_SYNC_COLLECTION.name;
      const legacyCapabilities = CAPABILITIES.filter((capability) => capability !== SIDEBAR_FOLDERS_CAPABILITY);
      const folders = await openSync(memberToken, SYNC_CAPABILITIES);
      const legacy = await openSync(memberToken, without(SIDEBAR_FOLDERS_CAPABILITY));
      const readFolders = async () =>
        new Map([["snapshot", await ok("POST", SIDEBAR_FOLDERS_ROUTES.read, memberToken, {})]]);
      const readLegacy = async () =>
        new Map([
          [
            "snapshot",
            await ok("GET", TEAM_API_ROUTES.sidebarLayout.state, memberToken, undefined, legacyCapabilities),
          ],
        ]);
      sameRows(SIDEBAR_LAYOUT_SYNC_COLLECTION, await subscribe(folders, LAYOUT), await readFolders());
      sameRows(SIDEBAR_LAYOUT_SYNC_COLLECTION, await subscribe(legacy, LAYOUT), await readLegacy());
      const foldersFrom = folders.received.length;
      const legacyFrom = legacy.received.length;
      await ok("POST", TEAM_API_ROUTES.sidebarLayout.actions, ownerToken, { type: "create", name: "Sync" });
      const foldersOrder = await pushedFirst(folders, foldersFrom, LAYOUT, "sidebar-folders-changed");
      const legacyOrder = await pushedFirst(legacy, legacyFrom, LAYOUT, "sidebar-layout-changed");
      sameRows(SIDEBAR_LAYOUT_SYNC_COLLECTION, await folders.settled(LAYOUT), await readFolders());
      sameRows(SIDEBAR_LAYOUT_SYNC_COLLECTION, await legacy.settled(LAYOUT), await readLegacy());
      await Promise.all([folders.close(), legacy.close()]);
      return { foldersOrder, legacyOrder };
    },
  );

  const reads = await openSync(memberToken, SYNC_CAPABILITIES);
  await step(
    "leak: GET conversation-reads and the sync rows leave out an agent that the member cannot see",
    async () => {
      const all = service.listConversationReads(memberId);
      assert.ok(hiddenAgent.id in all, "The service read state does not list the hidden agent.");
      const http = record(await ok("GET", TEAM_API_ROUTES.agents.conversationReads, memberToken), "reads");
      assert.ok(!(hiddenAgent.id in http), "GET conversation-reads shows the hidden agent.");
      const diff = await subscribe(reads, READS);
      assert.ok(!diff.upserts.has(hiddenAgent.id), "The conversation-reads rows show the hidden agent.");
      sameRows(CONVERSATION_READS_SYNC_COLLECTION, diff, await httpReads(memberToken));
      return { service: Object.keys(all).length, http: Object.keys(http).length, sync: diff.upserts.size };
    },
  );

  await step(
    "conversation reads: a member's read mark updates only that agent's row, only for that member",
    async () => {
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      await subscribe(owner, READS);
      const ownerFrom = owner.received.length;
      const from = reads.received.length;
      await ok("POST", TEAM_API_ROUTES.agent.conversationRead(visibleAgent.id), memberToken, {
        throughMessageId: `message-${visibleAgent.id}`,
      });
      const marked = await reads.diff(READS);
      assert.deepEqual(upsertKeys(marked), [visibleAgent.id]);
      assert.equal(record(marked.upserts.get(visibleAgent.id)?.value, "read").unreadCount, 0);
      await ok("POST", TEAM_API_ROUTES.agent.conversationUnread(visibleAgent.id), memberToken, {});
      const unread = await reads.diff(READS);
      assert.deepEqual(upsertKeys(unread), [visibleAgent.id]);
      assert.equal(record(unread.upserts.get(visibleAgent.id)?.value, "read").unreadCount, 1);
      assert.ok(
        isDeepStrictEqual(
          unread.upserts.get(visibleAgent.id)?.value,
          (await httpReads(memberToken)).get(visibleAgent.id),
        ),
        "The synced read row differs from HTTP.",
      );
      await reads.settled(READS);
      const syncAt = reads.received.findIndex((entry, at) => at >= from && isChangeFor(entry, READS));
      const eventAt = reads.received.findIndex((entry, at) => at >= from && entry.type === "conversation-invalidated");
      assert.ok(
        eventAt < 0 || syncAt < eventAt,
        "conversation-invalidated arrived before the conversation-reads change.",
      );
      await quiet(owner, ownerFrom, READS);
      await owner.close();
      return { syncAt: syncAt - from, eventAt: eventAt < 0 ? null : eventAt - from };
    },
  );

  await step(
    "routines: a scoped change reaches only the subscriber of that agent, before routines-changed",
    async () => {
      const visible = await openSync(memberToken, SYNC_CAPABILITIES);
      const spare = await openSync(memberToken, SYNC_CAPABILITIES);
      const readRoutines = async () =>
        rowsOf(ROUTINES_SYNC_COLLECTION, await ok("GET", TEAM_API_ROUTES.agent.routines(visibleAgent.id), memberToken));
      sameRows(ROUTINES_SYNC_COLLECTION, await subscribe(visible, routinesOf(visibleAgent.id)), await readRoutines());
      await subscribe(spare, routinesOf(spareAgent.id));
      const visibleFrom = visible.received.length;
      const spareFrom = spare.received.length;
      const created = record(
        await ok("POST", TEAM_API_ROUTES.agent.routines(visibleAgent.id), ownerToken, {
          name: "Sync check",
          instruction: "Say hello.",
          active: true,
          timezone: "UTC",
          schedule: { kind: "daily", time: "09:00" },
        }),
        "routine",
      );
      const order = await pushedFirst(visible, visibleFrom, routinesOf(visibleAgent.id), "routines-changed");
      const pushed = await visible.settled(routinesOf(visibleAgent.id));
      assert.deepEqual(upsertKeys(pushed), [text(created.id, "routine id")]);
      await quiet(spare, spareFrom, routinesOf(spareAgent.id));
      const all = await openSync(memberToken, SYNC_CAPABILITIES);
      sameRows(ROUTINES_SYNC_COLLECTION, await subscribe(all, routinesOf(visibleAgent.id)), await readRoutines());
      await unavailable(all, routinesOf(hiddenAgent.id));
      await Promise.all([visible.close(), spare.close(), all.close()]);
      return order;
    },
  );

  await step(
    "workflows: a new workflow reaches the owner and the member, the rows match HTTP, and a delete removes it",
    async () => {
      const WORKFLOWS = WORKFLOWS_SYNC_COLLECTION.name;
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      const member = await openSync(memberToken, SYNC_CAPABILITIES);
      const readWorkflows = async (token: string) =>
        rowsOf(
          WORKFLOWS_SYNC_COLLECTION,
          record(await ok("POST", WORKFLOWS_ROUTES.list, token, {}), "workflows").workflows,
        );
      sameRows(WORKFLOWS_SYNC_COLLECTION, await subscribe(owner, WORKFLOWS), await readWorkflows(ownerToken));
      sameRows(WORKFLOWS_SYNC_COLLECTION, await subscribe(member, WORKFLOWS), await readWorkflows(memberToken));
      const memberFrom = member.received.length;
      const detail = record(await ok("POST", WORKFLOWS_ROUTES.create, ownerToken, { title: "Sync check" }), "workflow");
      const workflowId = text(record(detail.summary, "workflow summary").id, "workflow id");
      const eventAt = await arrived(member, memberFrom, "workflows-changed");
      const ownerPush = await owner.settled(WORKFLOWS);
      const memberPush = await member.settled(WORKFLOWS);
      assert.ok(ownerPush.upserts.has(workflowId), "The owner did not get the new workflow.");
      assert.ok(memberPush.upserts.has(workflowId), "The member did not get the new workflow.");
      const memberHttp = await readWorkflows(memberToken);
      assert.ok(
        isDeepStrictEqual(memberPush.upserts.get(workflowId)?.value, memberHttp.get(workflowId)),
        "The synced workflow differs from HTTP.",
      );
      await ok("POST", WORKFLOWS_ROUTES.delete, ownerToken, { workflowId });
      await arrived(member, memberFrom + eventAt + 1, "workflows-changed");
      assert.deepEqual((await member.settled(WORKFLOWS)).deletes, [workflowId]);
      assert.deepEqual((await owner.settled(WORKFLOWS)).deletes, [workflowId]);
      const old = await openSync(memberToken, without(WORKFLOWS_CAPABILITY));
      await unavailable(old, WORKFLOWS);
      await Promise.all([owner.close(), member.close(), old.close()]);
      return { workflowId, eventAt, ownerMessages: ownerPush.messages };
    },
  );

  await step(
    "crm: an admin gets customer upserts and deletes that match HTTP, and a member gets sync-unavailable",
    async () => {
      const CUSTOMERS = CRM_CUSTOMERS_SYNC_COLLECTION.name;
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      const readCustomers = async () =>
        rowsOf(
          CRM_CUSTOMERS_SYNC_COLLECTION,
          record(await ok("POST", CRM_ROUTES.customers, ownerToken, {}), "customers").customers,
        );
      sameRows(CRM_CUSTOMERS_SYNC_COLLECTION, await subscribe(owner, CUSTOMERS), await readCustomers());
      const from = owner.received.length;
      const created = record(
        await ok("POST", CRM_ROUTES.apply, ownerToken, {
          kind: "customer-create",
          customer: { name: "Sync customer", currency: "EUR", statusId: "customer", notes: "" },
        }),
        "customer",
      );
      const customerId = text(created.id, "customer id");
      const eventAt = await arrived(owner, from, "crm-changed");
      const pushed = await owner.settled(CUSTOMERS);
      assert.deepEqual(upsertKeys(pushed), [customerId]);
      const http = await readCustomers();
      assert.ok(
        isDeepStrictEqual(pushed.upserts.get(customerId)?.value, http.get(customerId)),
        "The synced customer differs from HTTP.",
      );
      const deleteFrom = owner.received.length;
      await ok("POST", CRM_ROUTES.apply, ownerToken, { kind: "customer-delete", customerId });
      await arrived(owner, deleteFrom, "crm-changed");
      assert.deepEqual((await owner.settled(CUSTOMERS)).deletes, [customerId]);
      const member = await openSync(memberToken, SYNC_CAPABILITIES);
      await unavailable(member, CUSTOMERS);
      await Promise.all([owner.close(), member.close()]);
      return { customerId, eventAt };
    },
  );

  await step("queue: the snapshot row matches GET queue, and a hidden agent's queue is sync-unavailable", async () => {
    const socket = await openSync(memberToken, SYNC_CAPABILITIES);
    sameRows(
      QUEUE_SYNC_COLLECTION,
      await subscribe(socket, queueOf(visibleAgent.id)),
      new Map([["snapshot", await ok("GET", TEAM_API_ROUTES.agent.queue(visibleAgent.id), memberToken)]]),
    );
    await unavailable(socket, queueOf(hiddenAgent.id));
    await socket.close();
    return { agentId: visibleAgent.id };
  });

  await step(
    "agents: after a send through the Team API, a turn end and a read mark, every synced agent row equals GET /v1/agents",
    async () => {
      const socket = await openSync(memberToken, SYNC_CAPABILITIES);
      const rows = new Map(
        [...(await subscribe(socket, AGENTS)).upserts].map(([key, entry]) => [key, entry.value] as const),
      );
      const sortFields = (agentId: string) => {
        const row = record(rows.get(agentId), "synced agent");
        return { threadId: row.threadId, updatedAt: row.updatedAt, preview: row.preview };
      };
      const differentFields = (left: unknown, right: unknown) => {
        const synced = isDynamicRecord(left) ? left : {};
        const http = isDynamicRecord(right) ? right : {};
        return [...new Set([...Object.keys(synced), ...Object.keys(http)])].filter(
          (field) => !isDeepStrictEqual(synced[field], http[field]),
        );
      };
      const matchHttp = async (label: string) => {
        let differing: { agentId: string; fields: string[] }[] = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const pushed = await socket.settled(AGENTS);
          for (const [key, entry] of pushed.upserts) rows.set(key, entry.value);
          for (const key of pushed.deletes) rows.delete(key);
          const http = rowsOf(AGENTS_SYNC_COLLECTION, await ok("GET", TEAM_API_ROUTES.agents.all, memberToken));
          differing = [...new Set([...rows.keys(), ...http.keys()])]
            .filter((agentId) => !isDeepStrictEqual(rows.get(agentId), http.get(agentId)))
            .map((agentId) => ({ agentId, fields: differentFields(rows.get(agentId), http.get(agentId)) }));
          if (!differing.length) return;
        }
        assert.fail(`${label}: synced agent rows differ from HTTP: ${JSON.stringify(differing)}.`);
      };
      const changed = (before: DynamicRecord, after: DynamicRecord) =>
        Object.keys(after).filter((field) => !isDeepStrictEqual(before[field], after[field]));
      const agentEvent = (match: (event: AgentEvent) => boolean) =>
        new Promise<void>((resolveEvent) => {
          const listener = (event: AgentEvent) => {
            if (!match(event)) return;
            service.off("event", listener);
            resolveEvent();
          };
          service.on("event", listener);
        });
      const first = sortFields(freshAgent.id);
      assert.equal(first.threadId, null, "The fresh agent already has a thread.");
      const started = agentEvent((event) => event.type === "turn-started" && event.agentId === freshAgent.id);
      await ok("POST", TEAM_API_ROUTES.agent.messages(freshAgent.id), memberToken, { text: "Sync check." });
      await started;
      await matchHttp("send");
      const sent = sortFields(freshAgent.id);
      text(sent.threadId, "fresh agent thread");
      const completed = agentEvent((event) => event.type === "turn-completed" && event.agentId === freshAgent.id);
      const previewed = agentEvent(
        (event) =>
          event.type === "agents-changed" &&
          event.agents.some((agent) => agent.id === freshAgent.id && agent.preview === "Done."),
      );
      writeFileSync(turnRelease, "");
      await Promise.all([completed, previewed]);
      await matchHttp("turn end");
      const ended = sortFields(freshAgent.id);
      assert.equal(ended.preview, "Done.", "The turn end did not reach the synced preview.");
      await ok("POST", TEAM_API_ROUTES.agent.conversationRead(freshAgent.id), memberToken, { throughMessageId: null });
      await matchHttp("read mark");
      const read = sortFields(freshAgent.id);
      await socket.close();
      return {
        send: changed(first, sent),
        turnEnd: changed(sent, ended),
        readMark: changed(ended, read),
      };
    },
  );

  await step(
    "visibility: blocking an agent deletes its agent and read rows and ends its scoped subscriptions, for the member only",
    async () => {
      const member = await openSync(memberToken, SYNC_CAPABILITIES);
      const owner = await openSync(ownerToken, SYNC_CAPABILITIES);
      const scoped = await openSync(memberToken, SYNC_CAPABILITIES);
      assert.ok(
        (await subscribe(member, AGENTS)).upserts.has(spareAgent.id),
        "The member does not see the spare agent.",
      );
      assert.ok(
        (await subscribe(member, READS)).upserts.has(spareAgent.id),
        "The member has no read row for the spare agent.",
      );
      await subscribe(owner, AGENTS);
      await subscribe(scoped, routinesOf(spareAgent.id));
      await subscribe(scoped, queueOf(spareAgent.id));
      const ownerFrom = owner.received.length;
      const readsFrom = reads.received.length;
      setAccess({ revision: 2, everyone: { [hiddenAgent.id]: "none", [spareAgent.id]: "none" }, roles: [] });
      assert.deepEqual((await member.settled(AGENTS)).deletes, [spareAgent.id]);
      assert.deepEqual((await member.settled(READS)).deletes, [spareAgent.id]);
      assert.deepEqual((await reads.settled(READS)).deletes, [spareAgent.id]);
      await unavailable(scoped, routinesOf(spareAgent.id), false);
      await unavailable(scoped, queueOf(spareAgent.id), false);
      await quiet(owner, ownerFrom, AGENTS);
      const http = record(await ok("GET", TEAM_API_ROUTES.agents.conversationReads, memberToken), "reads");
      assert.ok(!(spareAgent.id in http), "GET conversation-reads shows the blocked agent.");
      await Promise.all([member.close(), owner.close(), scoped.close(), reads.close()]);
      return { readsFrom, deleted: spareAgent.id };
    },
  );

  await step(
    "mixed version: a client without sync-v1 gets every reload event and no sync message, and every HTTP read works",
    async () => {
      const owner = await openSync(ownerToken, CAPABILITIES);
      const from = owner.received.length;
      await saveChannel(ownerToken, "channel-mixed", false, { name: "mixed", members: [] });
      await owner.until((entry) => entry.type === "channels-changed", from);
      await ok("POST", SIDEBAR_PINS_ROUTES.set, ownerToken, { items: [{ kind: "agent", id: visibleAgent.id }] });
      await owner.until((entry) => entry.type === "sidebar-pins-changed", from);
      await ok("POST", WORKFLOWS_ROUTES.create, ownerToken, { title: "Mixed check" });
      await owner.until((entry) => entry.type === "workflows-changed", from);
      await ok("POST", TEAM_API_ROUTES.agent.routines(visibleAgent.id), ownerToken, {
        name: "Mixed check",
        instruction: "Say hello.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "daily", time: "09:00" },
      });
      await owner.until((entry) => entry.type === "routines-changed", from);
      assert.deepEqual(syncMessagesAfter(owner, 0), [], "A client without sync-v1 got a sync message.");
      const routes = [
        ["GET", TEAM_API_ROUTES.agents.all, undefined],
        ["GET", TEAM_API_ROUTES.agents.conversationReads, undefined],
        ["GET", CHANNEL_ROUTES.list, undefined],
        ["GET", TEAM_API_ROUTES.agent.routines(visibleAgent.id), undefined],
        ["GET", TEAM_API_ROUTES.agent.queue(visibleAgent.id), undefined],
        ["GET", TEAM_API_ROUTES.sidebarLayout.state, undefined],
        ["POST", AGENT_HIDDEN_ROUTES.read, {}],
        ["POST", SIDEBAR_PINS_ROUTES.read, {}],
        ["POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, {}],
        ["POST", SIDEBAR_FOLDERS_ROUTES.read, {}],
        ["POST", WORKFLOWS_ROUTES.list, {}],
        ["POST", CRM_ROUTES.customers, {}],
      ] as const;
      for (const [method, path, body] of routes) await ok(method, path, ownerToken, body);
      const events = owner.received.slice(from).map((entry) => entry.type);
      await owner.close();
      return { reads: routes.length, events: [...new Set(events)].sort() };
    },
  );

  report.passed = true;
} catch (error) {
  if (!report.steps.some((item) => !item.passed))
    report.steps.push({ name: "run", passed: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  if (server) await Effect.runPromise(server.stop());
  if (agents) await runCauseEffect(agents.stop());
  if (crm) await Effect.runPromise(crm.close());
  if (workflows) await Effect.runPromise(workflows.close());
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
