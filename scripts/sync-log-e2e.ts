import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createInviteUrl, parseInviteUrl } from "@openbot/contracts/invite-links";
import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelMessage,
  type ConversationMessage,
  decodeChannelPage,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import {
  encodeTeamCapabilitiesV10,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import { SYNC_SNAPSHOT_KEY, type SyncLogSpec } from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-logs";
import {
  decodeSyncServerMessage,
  SYNC_CAPABILITY,
  type SyncLogRow,
  type SyncServerMessage,
  syncName,
} from "@openbot/contracts/team-protocol/sync-v1";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v8";
import { TEAM_ABSENT_CAPABILITIES_HEADER, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { createSyncClient, type SyncClient, type SyncLog } from "@openbot/team-client/sync-client";
import { channelPageFromSync, conversationPageFromSync } from "@openbot/team-client/sync-pages";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { AgentAccessState } from "../src/main/agent-access-store";
import type { TeamApiAgentAccess, TeamApiBrowser, TeamApiOptions } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sync");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const CAPABILITIES = [
  TEAM_OPEN_PROVIDERS_CAPABILITY,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  AGENT_HIDDEN_CAPABILITY,
  MESSAGE_DELETE_CAPABILITY,
  TEAM_CONVERSATION_UNREAD_CAPABILITY,
  TEAM_HISTORY_EXTENT_CAPABILITY,
];
const SYNC_CAPABILITIES = [...CAPABILITIES, SYNC_CAPABILITY];
const BASE_TIME = Date.UTC(2026, 10, 25, 10, 0, 0);
const CHANNEL_SEED = 102;
const BULK_CHANGES = 1_001;

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

function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} is not a list.`);
  return value.map((item: unknown) => item);
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

const root = await mkdtemp(join(tmpdir(), "openbot-sync-log-"));
const userData = join(root, "user-data");
const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const sockets: WebSocket[] = [];
let server: TeamApiServer | null = null;
let agents: AgentService | null = null;
const clients: SyncClient[] = [];
let port = 0;

type LogChanges = Extract<SyncServerMessage, { type: "sync-log-changes" }>;
type LogPage = Extract<SyncServerMessage, { type: "sync-log-page" }>;
type Unavailable = Extract<SyncServerMessage, { type: "sync-unavailable" }>;
type Barrier = Extract<SyncServerMessage, { type: "sync-barrier" }>;

interface LogSocket {
  send(value: unknown): void;
  next<T extends SyncServerMessage>(match: (message: SyncServerMessage) => message is T): Promise<T>;
  take<T extends SyncServerMessage>(match: (message: SyncServerMessage) => message is T): T[];
  barrier(): Promise<void>;
}

interface LogWindow {
  rows: SyncLogRow[];
  deletes: string[];
  cursor: string;
  reset: boolean;
  olderCursor: string | null;
  messages: number;
}

async function openSync(token: string, onSync?: (message: SyncServerMessage) => void): Promise<LogSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  const queue: SyncServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener("message", (message) => {
    const sync = decodeSyncServerMessage(JSON.parse(String(message.data)));
    if (sync && onSync) onSync(sync);
    else if (sync) queue.push(sync);
    for (const wake of [...waiters]) wake();
  });
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  socket.send(
    JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities: SYNC_CAPABILITIES }),
  );
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
  return {
    send: (value) => socket.send(JSON.stringify(value)),
    next,
    take(match) {
      const found = queue.filter(match);
      for (const message of found) queue.splice(queue.indexOf(message), 1);
      return found;
    },
    async barrier() {
      const id = randomUUID();
      socket.send(JSON.stringify({ type: "sync-barrier", id }));
      await next((message): message is Barrier => message.type === "sync-barrier" && message.id === id);
    },
  };
}

function changesOf(log: string) {
  return (message: SyncServerMessage): message is LogChanges =>
    message.type === "sync-log-changes" && message.log === log;
}

function unavailableOf(log: string) {
  return (message: SyncServerMessage): message is Unavailable =>
    message.type === "sync-unavailable" && message.collection === log;
}

async function logWindow(socket: LogSocket, log: string): Promise<LogWindow> {
  const rows: SyncLogRow[] = [];
  const deletes: string[] = [];
  let reset = false;
  let messages = 0;
  for (;;) {
    const message = await socket.next(changesOf(log));
    messages += 1;
    reset ||= message.reset;
    rows.push(...message.rows);
    deletes.push(...message.deletes);
    if (message.synced)
      return { rows, deletes, cursor: message.cursor, reset, olderCursor: message.olderCursor, messages };
  }
}

function subscribeLog(socket: LogSocket, log: string, limit: number, after: string | null = null): Promise<LogWindow> {
  socket.send({ type: "sync-log-subscribe", log, after, limit });
  return logWindow(socket, log);
}

async function olderPage(
  socket: LogSocket,
  log: string,
  before: string,
  limit: number,
): Promise<{ rows: SyncLogRow[]; olderCursor: string | null }> {
  const id = randomUUID();
  socket.send({ type: "sync-log-older", log, id, before, limit });
  const rows: SyncLogRow[] = [];
  for (;;) {
    const page = await socket.next(
      (message): message is LogPage => message.type === "sync-log-page" && message.log === log && message.id === id,
    );
    rows.push(...page.rows);
    if (page.done) return { rows, olderCursor: page.olderCursor };
  }
}

async function unavailable(socket: LogSocket, log: string, send = true): Promise<void> {
  if (send) socket.send({ type: "sync-log-subscribe", log, after: null, limit: 10 });
  await socket.next(unavailableOf(log));
}

class LogView {
  readonly rows = new Map<string, SyncLogRow>();
  cursor = "";

  apply(window: Pick<LogWindow, "rows" | "deletes" | "reset" | "cursor">): void {
    if (window.reset) this.rows.clear();
    for (const key of window.deletes) this.rows.delete(key);
    for (const row of window.rows) this.rows.set(row.key, row);
    this.cursor = window.cursor;
  }

  ordered(): SyncLogRow[] {
    return [...this.rows.values()].sort((left, right) =>
      left.order === right.order ? (left.key < right.key ? -1 : 1) : left.order < right.order ? -1 : 1,
    );
  }
}

async function follow(socket: LogSocket, log: string, view: LogView, done: (seen: LogChanges[]) => boolean) {
  const seen: LogChanges[] = [];
  while (!done(seen)) {
    const message = await socket.next(changesOf(log));
    seen.push(message);
    view.apply(message);
  }
  await socket.barrier();
  for (const message of socket.take(changesOf(log))) {
    seen.push(message);
    view.apply(message);
  }
  return seen;
}

function changedKeys(seen: readonly LogChanges[]): { rows: string[]; deletes: string[]; reset: boolean } {
  return {
    rows: [...new Set(seen.flatMap((message) => message.rows.map((row) => row.key)))].sort(),
    deletes: [...new Set(seen.flatMap((message) => message.deletes))].sort(),
    reset: seen.some((message) => message.reset),
  };
}

function sameAsHttp<Entity>(spec: SyncLogSpec<Entity>, rows: readonly SyncLogRow[], http: readonly unknown[]): void {
  const httpKeys = http.map((item) => spec.key(spec.decode(item)));
  assert.deepEqual(
    rows.map((row) => row.key),
    httpKeys,
    `The ${spec.name} rows are not the HTTP messages in the HTTP order.`,
  );
  rows.forEach((row, index) => {
    assert.ok(isDeepStrictEqual(row.value, http[index]), `The ${spec.name} row ${row.key} differs from HTTP.`);
    assert.equal(spec.key(spec.decode(row.value)), row.key, `The ${spec.name} row ${row.key} has a different key.`);
  });
  const sorted = [...rows].sort((left, right) => (left.order < right.order ? -1 : left.order > right.order ? 1 : 0));
  assert.deepEqual(
    sorted.map((row) => row.key),
    httpKeys,
    `The ${spec.name} order strings do not sort the rows in the HTTP order.`,
  );
}

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
  };
  const lists = encodeTeamCapabilitiesV10(CAPABILITIES);
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

async function ok(method: string, path: string, token: string, body?: unknown): Promise<DynamicRecord | null> {
  const response = await call(method, path, { token, body });
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${method} ${path} returned ${response.status}: ${JSON.stringify(response.body)}`,
  );
  return response.body === null ? null : record(response.body, `${method} ${path}`);
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

async function agentPage(
  token: string,
  agentId: string,
  limit: number,
  before: string | null = null,
): Promise<{ messages: unknown[]; olderCursor: string | null }> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before) query.set("before", before);
  const page = record(
    await ok("GET", `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?${query}`, token),
    "conversation page",
  );
  const olderCursor = record(page.pageInfo, "page info").olderCursor;
  return {
    messages: list(page.messages, "conversation page messages"),
    olderCursor: olderCursor === null ? null : text(olderCursor, "older cursor"),
  };
}

async function channelPage(
  token: string,
  channelId: string,
  beforeSequence?: number,
): Promise<{ messages: unknown[]; olderCursor: number | null }> {
  const page = record(
    await ok("POST", CHANNEL_ROUTES.read, token, {
      channelId,
      ...(beforeSequence === undefined ? {} : { beforeSequence }),
    }),
    "channel page",
  );
  const olderCursor = page.olderCursor;
  assert.ok(olderCursor === null || typeof olderCursor === "number", "The channel older cursor is not a number.");
  return { messages: list(page.messages, "channel page messages"), olderCursor };
}

async function saveChannel(token: string, channelId: string, members: string[]): Promise<void> {
  await ok("POST", CHANNEL_ROUTES.command, token, {
    type: "save",
    operationId: randomUUID(),
    channelId,
    update: false,
    draft: {
      name: channelId,
      title: "",
      instructions: "",
      members: members.map((agentId) => ({ agentId })),
      leadAgentId: null,
    },
  });
}

function setAccess(state: AgentAccessState): void {
  accessLevels = state;
  for (const listener of accessListeners) listener(team.getIdentity()?.serverId ?? "", accessLevels);
}

function at(second: number): string {
  return new Date(BASE_TIME + second * 1000).toISOString();
}

function message(
  id: string,
  author: "user" | "assistant",
  second: number,
  body: string,
  turnId?: string,
  itemType?: string,
): ConversationMessage {
  return {
    id,
    author,
    text: body,
    createdAt: at(second),
    status: "completed",
    ...(turnId === undefined ? {} : { turnId }),
    ...(itemType === undefined ? {} : { itemType }),
    reactions: [],
    reaction: null,
  };
}

function entityText<Entity extends { text: string } | { message: { text: string } }>(
  spec: SyncLogSpec<Entity>,
  row: SyncLogRow | undefined,
): string {
  assert.ok(row, "The row is missing.");
  const entity = spec.decode(row.value);
  return "message" in entity ? entity.message.text : entity.text;
}

async function until(handle: Pick<SyncLog<unknown>, "subscribe">, ready: () => boolean): Promise<void> {
  if (ready()) return;
  await new Promise<void>((resolveReady) => {
    const stop = handle.subscribe(() => {
      if (!ready()) return;
      stop();
      resolveReady();
    });
  });
}

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(team.configure("Sync Log Host", OWNER.username, OWNER.password));
  const createAgent = (name: string) =>
    runCauseEffect(agentStore.createAgent({ name, description: "", avatarSeed: name.toLowerCase(), avatarHue: null }));
  const visibleAgent = await createAgent("Visible");
  const hiddenAgent = await createAgent("Hidden");
  const spareAgent = await createAgent("Spare");
  const bulkAgent = await createAgent("Bulk");
  const service = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  agents = service;
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
  });
  port = await Effect.runPromise(server.start());
  const ownerToken = await login(OWNER);

  const writeAgentMessages = (agentId: string, changedMessages: ConversationMessage[]) => {
    const threadId = agentStore.ensureThreadIdNow(agentId);
    database.persistConversationChanges({
      agentId,
      threadId,
      activeTurnId: null,
      changedMessages,
      eventType: "conversation.sync-log-e2e",
    });
    service.emit("event", {
      type: "conversation-invalidated",
      agentId,
      revision: database.readConversationRevision(agentId, threadId),
    });
  };
  const captureChannelMessages = (channelId: string, entries: readonly { id: string; body: string }[]) => {
    const store = service.channels.store;
    for (const entry of entries) {
      const item: ChannelMessage = {
        id: entry.id,
        channelId,
        sequence: 0,
        author: { kind: "member", id: "sync-log-writer", name: "Writer" },
        taskId: null,
        superseded: false,
        message: message(entry.id, "user", 1, entry.body),
      };
      store.captureMessage(store.get(channelId), item);
    }
    service.emit("event", { type: "channels-changed", channelId, revision: store.get(channelId).revision });
  };

  const agentLog = syncName(AGENT_MESSAGES_SYNC_LOG.name, visibleAgent.id);
  const channelLog = syncName(CHANNEL_MESSAGES_SYNC_LOG.name, "channel-visible");

  const memberToken = await step(
    "setup: a member joins; the visible agent has three turns; a channel has 102 messages",
    async () => {
      const created = await call("POST", TEAM_API_ROUTES.team.invites, { token: ownerToken, body: { role: "member" } });
      assert.equal(created.status, 201, `Invite creation returned ${created.status}.`);
      const link = parseInviteUrl(text(record(created.body, "invite").inviteUrl, "invite link"), {
        allowLocalDevelopmentApiUrl: true,
      });
      const joined = await call("POST", TEAM_API_ROUTES.join.server, { body: { inviteToken: link.token, ...MEMBER } });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      await saveChannel(ownerToken, "channel-visible", [visibleAgent.id]);
      await saveChannel(ownerToken, "channel-hidden", [hiddenAgent.id]);
      writeAgentMessages(visibleAgent.id, [
        message("u1", "user", 1, "First question.", "turn-1"),
        message("a1", "assistant", 3, "First answer.", "turn-1"),
        message("u2", "user", 4, "Second question.", "turn-2"),
        message("a2", "assistant", 5, "Second answer.", "turn-2"),
        message("u3", "user", 6, "Third question.", "turn-3"),
        message("a3", "assistant", 7, "Third answer.", "turn-3"),
      ]);
      writeAgentMessages(spareAgent.id, [message("s1", "user", 1, "Spare question.")]);
      writeAgentMessages(hiddenAgent.id, [message("h1", "user", 1, "Hidden question.")]);
      writeAgentMessages(bulkAgent.id, [message("b0", "user", 1, "Bulk question.")]);
      captureChannelMessages(
        "channel-visible",
        Array.from({ length: CHANNEL_SEED }, (_, index) => ({ id: `c${index}`, body: `Channel message ${index}.` })),
      );
      return login(MEMBER);
    },
    () => ({ agentMessages: 6, channelMessages: CHANNEL_SEED }),
  );

  const live = await openSync(memberToken);
  const agentView = new LogView();
  const channelView = new LogView();

  await step("latest: the agent window equals GET conversation-page, in the same order", async () => {
    const window = await subscribeLog(live, agentLog, 100);
    const http = await agentPage(memberToken, visibleAgent.id, 100);
    sameAsHttp(AGENT_MESSAGES_SYNC_LOG, window.rows, http.messages);
    assert.equal(window.reset, true, "The first window is not a reset.");
    assert.equal(window.olderCursor, null, "The full window has an older cursor.");
    assert.deepEqual(window.deletes, []);
    agentView.apply(window);
    return { rows: window.rows.length, messages: window.messages, cursor: window.cursor };
  });

  await step("latest: the channel window equals POST channels read, in the same order", async () => {
    const window = await subscribeLog(live, channelLog, 100);
    const http = await channelPage(memberToken, "channel-visible");
    sameAsHttp(CHANNEL_MESSAGES_SYNC_LOG, window.rows, http.messages);
    assert.equal(window.olderCursor, http.olderCursor === null ? null : String(http.olderCursor));
    assert.notEqual(window.olderCursor, null, "The channel window has no older cursor.");
    channelView.apply(window);
    return { rows: window.rows.length, olderCursor: window.olderCursor };
  });

  await step("older: each agent page equals the HTTP page, and the last page has olderCursor null", async () => {
    const pager = await openSync(memberToken);
    const window = await subscribeLog(pager, agentLog, 2);
    const first = await agentPage(memberToken, visibleAgent.id, 2);
    sameAsHttp(AGENT_MESSAGES_SYNC_LOG, window.rows, first.messages);
    let syncCursor = window.olderCursor;
    let httpCursor = first.olderCursor;
    const sizes = [window.rows.length];
    while (syncCursor !== null) {
      assert.notEqual(httpCursor, null, "Sync has an older page that HTTP does not have.");
      const page = await olderPage(pager, agentLog, syncCursor, 2);
      const http = await agentPage(memberToken, visibleAgent.id, 2, httpCursor);
      sameAsHttp(AGENT_MESSAGES_SYNC_LOG, page.rows, http.messages);
      sizes.push(page.rows.length);
      syncCursor = page.olderCursor;
      httpCursor = http.olderCursor;
    }
    assert.equal(httpCursor, null, "HTTP has an older page that sync does not have.");
    assert.equal(
      sizes.reduce((sum, size) => sum + size, 0),
      6,
    );
    return { pages: sizes };
  });

  await step("older: the older channel page equals the HTTP page, and its olderCursor is null", async () => {
    const before = channelView.ordered()[0];
    assert.ok(before, "The channel window is empty.");
    const http = await channelPage(memberToken, "channel-visible");
    assert.notEqual(http.olderCursor, null);
    const page = await olderPage(live, channelLog, String(http.olderCursor), 100);
    const older = await channelPage(memberToken, "channel-visible", http.olderCursor ?? undefined);
    sameAsHttp(CHANNEL_MESSAGES_SYNC_LOG, page.rows, older.messages);
    assert.equal(page.olderCursor, null);
    assert.equal(older.olderCursor, null);
    return { rows: page.rows.length };
  });

  const ownerCursor = await step(
    "since: a new agent message arrives as one row",
    async () => {
      writeAgentMessages(visibleAgent.id, [message("u4", "user", 8, "Fourth question.", "turn-4")]);
      const seen = await follow(live, agentLog, agentView, (messages) =>
        messages.some((item) => item.rows.some((row) => row.key === "u4")),
      );
      const keys = changedKeys(seen);
      assert.equal(keys.reset, false, `The new message came as a reset after ${seen.length} messages.`);
      assert.deepEqual(keys.rows, ["u4"]);
      assert.deepEqual(keys.deletes, []);
      sameAsHttp(
        AGENT_MESSAGES_SYNC_LOG,
        agentView.ordered(),
        (await agentPage(memberToken, visibleAgent.id, 100)).messages,
      );
      const owner = await openSync(ownerToken);
      return (await subscribeLog(owner, agentLog, 10)).cursor;
    },
    () => ({ rows: ["u4"] }),
  );

  await step("since: an edit arrives as the changed row only", async () => {
    writeAgentMessages(visibleAgent.id, [message("a2", "assistant", 5, "Second answer, edited.", "turn-2")]);
    const seen = await follow(live, agentLog, agentView, (messages) =>
      messages.some((item) => item.rows.some((row) => row.key === "a2")),
    );
    const keys = changedKeys(seen);
    assert.deepEqual(keys.rows, ["a2"]);
    assert.equal(entityText(AGENT_MESSAGES_SYNC_LOG, agentView.rows.get("a2")), "Second answer, edited.");
    sameAsHttp(
      AGENT_MESSAGES_SYNC_LOG,
      agentView.ordered(),
      (await agentPage(memberToken, visibleAgent.id, 100)).messages,
    );
    return keys;
  });

  await step("since: a message inserted mid-turn sorts inside its turn, before a newer answer", async () => {
    writeAgentMessages(visibleAgent.id, [message("c1", "assistant", 3.5, "Thinking.", "turn-1", "commentary")]);
    const seen = await follow(live, agentLog, agentView, (messages) =>
      messages.some((item) => item.rows.some((row) => row.key === "c1")),
    );
    const http = await agentPage(memberToken, visibleAgent.id, 100);
    const httpKeys = http.messages.map((item) => AGENT_MESSAGES_SYNC_LOG.key(AGENT_MESSAGES_SYNC_LOG.decode(item)));
    assert.ok(httpKeys.indexOf("c1") < httpKeys.indexOf("u2"), "HTTP does not show c1 inside turn 1.");
    assert.ok(httpKeys.indexOf("c1") < httpKeys.length - 1, "The inserted message is not in the middle.");
    sameAsHttp(AGENT_MESSAGES_SYNC_LOG, agentView.ordered(), http.messages);
    return { changed: changedKeys(seen).rows, order: httpKeys };
  });

  await step("since: a member reaction through HTTP arrives as the changed row", async () => {
    await ok("POST", TEAM_API_ROUTES.agent.reactions(visibleAgent.id), memberToken, { messageId: "u2", emoji: "👍" });
    const before = JSON.stringify(agentView.rows.get("u2")?.value);
    const seen = await follow(live, agentLog, agentView, (messages) =>
      messages.some((item) => item.rows.some((row) => row.key === "u2" && JSON.stringify(row.value) !== before)),
    );
    sameAsHttp(
      AGENT_MESSAGES_SYNC_LOG,
      agentView.ordered(),
      (await agentPage(memberToken, visibleAgent.id, 100)).messages,
    );
    return changedKeys(seen);
  });

  await step("since: a delete through HTTP arrives as a delete", async () => {
    await ok("POST", MESSAGE_DELETE_ROUTES.agent, ownerToken, { agentId: visibleAgent.id, messageId: "a3" });
    const seen = await follow(live, agentLog, agentView, (messages) =>
      messages.some((item) => item.deletes.includes("a3")),
    );
    const keys = changedKeys(seen);
    assert.ok(!keys.rows.includes("a3"), "The deleted message came back as a row.");
    assert.ok(!agentView.rows.has("a3"));
    sameAsHttp(
      AGENT_MESSAGES_SYNC_LOG,
      agentView.ordered(),
      (await agentPage(memberToken, visibleAgent.id, 100)).messages,
    );
    return keys;
  });

  await step("reconnect: a subscribe with after gets only the rows that changed while away", async () => {
    await live.barrier();
    live.take(changesOf(agentLog));
    live.send({ type: "sync-unsubscribe", collection: agentLog });
    await live.barrier();
    const away = agentView.cursor;
    writeAgentMessages(visibleAgent.id, [message("a1", "assistant", 3, "First answer, edited.", "turn-1")]);
    await live.barrier();
    const window = await subscribeLog(live, agentLog, 100, away);
    assert.equal(window.reset, false, "The reconnect was a reset.");
    assert.deepEqual(
      window.rows.map((row) => row.key),
      ["a1"],
    );
    assert.deepEqual(window.deletes, []);
    assert.notEqual(window.cursor, away);
    agentView.apply(window);
    sameAsHttp(
      AGENT_MESSAGES_SYNC_LOG,
      agentView.ordered(),
      (await agentPage(memberToken, visibleAgent.id, 100)).messages,
    );
    return { rows: window.rows.length, messages: window.messages };
  });

  await step("reset: an unknown cursor and a cursor of another viewer get the latest window", async () => {
    const results = [];
    for (const after of ["999999999.abcdefabcdef", "not-a-cursor", ownerCursor]) {
      const window = await subscribeLog(live, agentLog, 3, after);
      assert.equal(window.reset, true, `The cursor ${after === ownerCursor ? "of the owner" : after} did not reset.`);
      sameAsHttp(AGENT_MESSAGES_SYNC_LOG, window.rows, (await agentPage(memberToken, visibleAgent.id, 3)).messages);
      assert.notEqual(window.olderCursor, null);
      results.push(window.rows.length);
    }
    await subscribeLog(live, agentLog, 100, agentView.cursor);
    return { rows: results };
  });

  await step("reset: more than 1000 changed rows since the cursor give the latest window", async () => {
    const bulkLog = syncName(AGENT_MESSAGES_SYNC_LOG.name, bulkAgent.id);
    const first = await subscribeLog(live, bulkLog, 10);
    live.send({ type: "sync-unsubscribe", collection: bulkLog });
    await live.barrier();
    writeAgentMessages(
      bulkAgent.id,
      Array.from({ length: BULK_CHANGES }, (_, index) =>
        message(`b${index + 1}`, "user", 10 + index, `Bulk ${index}.`),
      ),
    );
    const window = await subscribeLog(live, bulkLog, 10, first.cursor);
    assert.equal(window.reset, true);
    sameAsHttp(AGENT_MESSAGES_SYNC_LOG, window.rows, (await agentPage(memberToken, bulkAgent.id, 10)).messages);
    live.send({ type: "sync-unsubscribe", collection: bulkLog });
    return { changed: BULK_CHANGES, rows: window.rows.length };
  });

  await step("since: a new channel message and a channel delete arrive", async () => {
    captureChannelMessages("channel-visible", [{ id: "c-new", body: "New channel message." }]);
    const added = await follow(live, channelLog, channelView, (messages) =>
      messages.some((item) => item.rows.some((row) => row.key === "c-new")),
    );
    assert.deepEqual(changedKeys(added).rows, ["c-new"]);
    await ok("POST", MESSAGE_DELETE_ROUTES.channel, ownerToken, { channelId: "channel-visible", messageId: "c101" });
    const removed = await follow(live, channelLog, channelView, (messages) =>
      messages.some((item) => item.deletes.includes("c101")),
    );
    const http = await channelPage(memberToken, "channel-visible");
    sameAsHttp(CHANNEL_MESSAGES_SYNC_LOG, channelView.ordered().slice(-http.messages.length), http.messages);
    return { added: changedKeys(added), removed: changedKeys(removed) };
  });

  await step("access: a hidden agent, its channel and an unknown agent are sync-unavailable", async () => {
    const watcher = await openSync(memberToken);
    const spareLog = syncName(AGENT_MESSAGES_SYNC_LOG.name, spareAgent.id);
    const spare = await subscribeLog(watcher, spareLog, 10);
    assert.equal(spare.rows.length, 1);
    setAccess({ revision: 1, everyone: { [hiddenAgent.id]: "none", [spareAgent.id]: "none" }, roles: [] });
    await unavailable(watcher, spareLog, false);
    await unavailable(watcher, syncName(AGENT_MESSAGES_SYNC_LOG.name, hiddenAgent.id));
    await unavailable(watcher, syncName(CHANNEL_MESSAGES_SYNC_LOG.name, "channel-hidden"));
    await unavailable(watcher, syncName(AGENT_MESSAGES_SYNC_LOG.name, "missing-agent"));
    await unavailable(watcher, syncName(CHANNEL_MESSAGES_SYNC_LOG.name, "missing-channel"));
    const owner = await openSync(ownerToken);
    const ownerHidden = await subscribeLog(owner, syncName(CHANNEL_MESSAGES_SYNC_LOG.name, "channel-hidden"), 10);
    return { unavailable: 5, ownerSeesHiddenChannel: ownerHidden.reset };
  });

  await step("client: createSyncClient().log shows the rows in order and keeps loaded older rows fresh", async () => {
    const clientSocket = await openSync(memberToken, (incoming) => client.receive(incoming));
    const client = createSyncClient({ send: async (outgoing) => clientSocket.send(outgoing) });
    clients.push(client);
    const handle = client.log(AGENT_MESSAGES_SYNC_LOG, visibleAgent.id, { limit: 2 });
    client.resubscribe();
    await until(handle, () => handle.status() === "synced");
    const latest = await agentPage(memberToken, visibleAgent.id, 2);
    const keys = (http: readonly unknown[]) =>
      http.map((item) => AGENT_MESSAGES_SYNC_LOG.key(AGENT_MESSAGES_SYNC_LOG.decode(item)));
    assert.deepEqual(
      handle.rows().map((entry) => entry.key),
      keys(latest.messages),
    );
    assert.equal(handle.hasOlder(), true);
    await handle.loadOlder(2);
    const loaded = await agentPage(memberToken, visibleAgent.id, 4);
    assert.deepEqual(
      handle.rows().map((entry) => entry.key),
      keys(loaded.messages),
    );
    const oldest = handle.rows()[0];
    assert.ok(oldest, "The client log is empty.");
    const current = oldest.entity;
    writeAgentMessages(visibleAgent.id, [{ ...current, text: `${current.text} Fresh.` }]);
    await until(handle, () => handle.get(oldest.key)?.entity.text === `${current.text} Fresh.`);
    const fresh = await agentPage(memberToken, visibleAgent.id, 4);
    assert.deepEqual(
      handle.rows().map((entry) => entry.key),
      keys(fresh.messages),
    );
    handle.rows().forEach((entry, index) => {
      assert.ok(isDeepStrictEqual(entry.entity, fresh.messages[index]), `The client row ${entry.key} differs.`);
    });
    return { latest: 2, loaded: handle.rows().length, refreshed: oldest.key };
  });

  const pageSocket = await openSync(memberToken, (incoming) => pageClient.receive(incoming));
  const pageClient = createSyncClient({ send: async (outgoing) => pageSocket.send(outgoing) });
  clients.push(pageClient);
  const agentRows = pageClient.log(AGENT_MESSAGES_SYNC_LOG, visibleAgent.id, { limit: 2 });
  const agentMeta = pageClient.collection(CONVERSATION_PAGE_META_SYNC_COLLECTION, visibleAgent.id);
  const channelRows = pageClient.log(CHANNEL_MESSAGES_SYNC_LOG, "channel-visible", { limit: 100 });
  const channelMeta = pageClient.collection(CHANNEL_PAGE_META_SYNC_COLLECTION, "channel-visible");
  const rebuiltAgentPage = (newer = 0) => {
    const meta = agentMeta.get(SYNC_SNAPSHOT_KEY);
    if (!meta) return null;
    const rows = agentRows.rows().map((entry) => entry.entity);
    return conversationPageFromSync(rows.slice(0, rows.length - newer), meta, agentRows.references(), {
      olderCursor: agentRows.olderCursor(),
      newerCount: newer,
    });
  };
  const rebuiltChannelPage = () => {
    const meta = channelMeta.get(SYNC_SNAPSHOT_KEY);
    if (!meta) return null;
    return channelPageFromSync(
      channelRows.rows().map((entry) => entry.entity),
      meta,
      { olderCursor: channelRows.olderCursor() },
    );
  };
  const httpAgentPage = async (limit: number, before: string | null = null) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set("before", before);
    const path = TEAM_API_ROUTES.agent.conversationPage(visibleAgent.id);
    const body = await ok("GET", `${path}?${query}`, memberToken);
    return record(teamHttpCodec(TEAM_PROTOCOL_V10).decodeResponse("GET", path, 200, body), "conversation page");
  };
  const pagesMatch = async (label: string) => {
    await pageClient.barrier();
    const agent = rebuiltAgentPage();
    assert.ok(agent, `${label}: the agent page cannot be rebuilt from sync.`);
    const agentHttp = await httpAgentPage(agentRows.rows().length);
    assert.deepEqual(agent, agentHttp, `${label}: the rebuilt agent page differs from HTTP.`);
    const channel = rebuiltChannelPage();
    assert.ok(channel, `${label}: the channel page cannot be rebuilt from sync.`);
    const channelHttp = decodeChannelPage(
      await ok("POST", CHANNEL_ROUTES.read, memberToken, { channelId: "channel-visible" }),
    );
    assert.deepEqual(channel, channelHttp, `${label}: the rebuilt channel page differs from HTTP.`);
    return {
      agentRows: agent.messages.length,
      revision: agent.revision,
      activeTurnId: agent.activeTurnId,
      references: Object.keys(agent.references),
      readThrough: agent.readState?.throughMessageId ?? null,
      channelRows: channel.messages.length,
    };
  };

  await step("page: the latest agent and channel pages rebuilt from sync equal the HTTP pages", async () => {
    pageClient.resubscribe();
    await until(agentRows, () => agentRows.status() === "synced");
    await until(agentMeta, () => agentMeta.status() === "synced");
    await until(channelRows, () => channelRows.status() === "synced");
    await until(channelMeta, () => channelMeta.status() === "synced");
    const result = await pagesMatch("first window");
    assert.equal(agentRows.hasOlder(), true, "The small agent window has no older page.");
    assert.notEqual(channelRows.olderCursor(), null, "The channel window has no older page.");
    return result;
  });

  await step("page: the pages still equal HTTP after a new agent message and a new channel message", async () => {
    writeAgentMessages(visibleAgent.id, [message("u5", "user", 20, "Fifth question.", "turn-5")]);
    captureChannelMessages("channel-visible", [{ id: "c-page", body: "Page channel message." }]);
    await until(agentRows, () => agentRows.get("u5") !== undefined);
    await until(channelRows, () => channelRows.get("c-page") !== undefined);
    return pagesMatch("new message");
  });

  await step("page: the agent page still equals HTTP after a member reaction", async () => {
    await ok("POST", TEAM_API_ROUTES.agent.reactions(visibleAgent.id), memberToken, { messageId: "u5", emoji: "👍" });
    await until(agentRows, () => (agentRows.get("u5")?.entity.reactions?.length ?? 0) > 0);
    return pagesMatch("reaction");
  });

  await step("page: an agent message with an agent reaction keeps the current names", async () => {
    const agentMessage: ConversationMessage = {
      ...message("a6", "assistant", 21, "Agent answer.", "turn-5"),
      source: "agent",
      senderAgentId: spareAgent.id,
    };
    writeAgentMessages(visibleAgent.id, [agentMessage]);
    await runCauseEffect(mailbox.setReaction(visibleAgent.id, "a6", { kind: "agent", agentId: spareAgent.id }, "👍"));
    writeAgentMessages(visibleAgent.id, [agentMessage]);
    await until(agentRows, () => (agentRows.get("a6")?.entity.reactions?.length ?? 0) > 0);
    const entity = agentRows.get("a6")?.entity;
    assert.equal(entity?.senderAgentId, spareAgent.id, "The synced message has no sender agent.");
    assert.deepEqual(entity?.reactions?.[0]?.actor, { kind: "agent", agentId: spareAgent.id });
    return pagesMatch("agent reaction");
  });

  await step("page: activeTurnId follows a turn start and a turn end", async () => {
    const threadId = agentStore.ensureThreadIdNow(visibleAgent.id);
    const setTurn = (activeTurnId: string | null) =>
      database.persistConversationChanges({
        agentId: visibleAgent.id,
        threadId,
        activeTurnId,
        changedMessages: [],
        eventType: "conversation.sync-log-e2e",
      });
    setTurn("turn-6");
    service.emit("event", { type: "turn-started", agentId: visibleAgent.id, threadId, turnId: "turn-6" });
    await until(agentMeta, () => agentMeta.get(SYNC_SNAPSHOT_KEY)?.activeTurnId === "turn-6");
    const started = await pagesMatch("turn start");
    setTurn(null);
    service.emit("event", {
      type: "turn-completed",
      agentId: visibleAgent.id,
      threadId,
      turnId: "turn-6",
      status: "completed",
    });
    await until(agentMeta, () => agentMeta.get(SYNC_SNAPSHOT_KEY)?.activeTurnId === null);
    return { started, ended: await pagesMatch("turn end") };
  });

  await step("page: readState follows a read mark through HTTP", async () => {
    const before = agentMeta.get(SYNC_SNAPSHOT_KEY)?.readState?.throughMessageId ?? null;
    await ok("POST", TEAM_API_ROUTES.agent.conversationRead(visibleAgent.id), memberToken, { throughMessageId: "u5" });
    await until(agentMeta, () => agentMeta.get(SYNC_SNAPSHOT_KEY)?.readState?.throughMessageId === "u5");
    const result = await pagesMatch("read mark");
    assert.notEqual(before, "u5", "The read mark did not change.");
    return result;
  });

  await step("page: a quoted reply to a message outside the window brings its reference", async () => {
    assert.equal(agentRows.get("u1"), undefined, "The quoted message is already in the window.");
    writeAgentMessages(visibleAgent.id, [
      { ...message("u7", "user", 30, "Quoted question.", "turn-7"), replyToMessageId: "u1" },
      { ...message("q2", "assistant", 4.5, "Older quoted answer.", "turn-2"), replyToMessageId: "u1" },
    ]);
    await until(agentRows, () => agentRows.get("u7") !== undefined && agentRows.references().has("u1"));
    const result = await pagesMatch("quoted reply");
    assert.deepEqual(result.references, ["u1"]);
    assert.equal(agentRows.get("q2"), undefined, "The older reply is in the latest window.");
    return result;
  });

  await step("page: an older agent page rebuilt from sync equals the HTTP older page and its references", async () => {
    await pageClient.barrier();
    const latest = await httpAgentPage(agentRows.rows().length);
    const olderCursor = text(record(latest.pageInfo, "page info").olderCursor, "older cursor");
    const newer = agentRows.rows().length;
    await agentRows.loadOlder(2);
    const older = rebuiltAgentPage(newer);
    assert.ok(older, "The older page cannot be rebuilt from sync.");
    const http = await httpAgentPage(2, olderCursor);
    assert.deepEqual(older, http, "The rebuilt older page differs from HTTP.");
    assert.ok(
      older.messages.some((item) => item.id === "q2"),
      "The older page does not hold the older reply.",
    );
    assert.deepEqual(Object.keys(older.references), ["u1"]);
    return {
      rows: older.messages.map((item) => item.id),
      references: Object.keys(older.references),
      olderCount: older.pageInfo.olderCount ?? 0,
    };
  });

  report.passed = true;
} catch (error) {
  if (!report.steps.some((item) => !item.passed))
    report.steps.push({ name: "run", passed: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  for (const each of clients) each.dispose();
  for (const socket of sockets) socket.close();
  if (server) await Effect.runPromise(server.stop());
  if (agents) await runCauseEffect(agents.stop());
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "log-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
