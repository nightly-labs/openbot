import { spawnSync } from "node:child_process";
import { REALTIME_VOICE_SDP_LIMIT } from "@openbot/contracts/ipc";
import {
  REALTIME_VOICE_AGENT_SELECTION_ROUTE,
  REALTIME_VOICE_AGENT_SETTINGS_CAPABILITY,
  REALTIME_VOICE_CAPABILITY,
  REALTIME_VOICE_CONFIGURATION_ROUTE,
  REALTIME_VOICE_ROUTES,
  REALTIME_VOICE_SELECTION_CAPABILITY,
  REALTIME_VOICE_SELECTION_ROUTE,
} from "@openbot/contracts/team-protocol/realtime-voice-v1";
import { RealtimeVoiceService, takeRealtimeVoiceApiKey } from "../src/main/realtime-voice-service";
// Checks member access to agents through the agent-access-v1 Team API contract. A real
// `TeamApiServer` runs on loopback with the real team, agent, mailbox, sidebar and roles stores on a
// temporary profile. The owner sets roles; a member signs in as a current desktop client does. The
// host must hide a `none` agent, refuse a write that the level does not permit, refuse a stale
// revision, tell the member's event socket about each change, and keep the roles after a restart.
// The server-audit-v1 log records each roles change with its actor, for owners and admins only.
// The agent service is not initialized, so no provider CLI starts.
// Run: `bun scripts/agent-access-e2e.ts`.
// Writes .openbot-build/agent-access-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentAccessChange,
  type AgentAccessSnapshot,
  decodeAgentAccessSnapshot,
  decodeServerAuditLog,
  type ServerAuditLog,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import {
  AGENT_ACCESS_CAPABILITY,
  AGENT_ACCESS_CODECS,
  AGENT_ACCESS_ROUTES,
  agentAccessEvent,
} from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_MEMORY_INCLUSION_ROUTE } from "@openbot/contracts/team-protocol/agent-memories-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import {
  SERVER_AUDIT_CAPABILITY,
  SERVER_AUDIT_CODECS,
  SERVER_AUDIT_ROUTES,
} from "@openbot/contracts/team-protocol/server-audit-v1";
import { TEAM_PROTOCOL_V7 } from "@openbot/contracts/team-protocol/v7";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-access-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const REALTIME_KEY = "e2e-realtime-host-secret-never-return";
const OFFER = "v=0\r\no=fixture-offer\r\n";
const ANSWER = "v=0\r\no=fixture-answer\r\n";
let providerCalls = 0;
let providerReply = async () => new Response(ANSWER);
const realtimeFetch: typeof fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    providerCalls += 1;
    assert.equal(String(url), "https://api.openai.com/v1/realtime/calls");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${REALTIME_KEY}`);
    assert.ok(init?.body instanceof FormData);
    const session = record(JSON.parse(String(init.body.get("session"))), "provider session");
    assert.equal(session.tools, undefined, "The audio interface must not have tools.");
    const input = record(record(session.audio, "audio").input, "audio input");
    assert.equal(record(input.turn_detection, "VAD").create_response, false);
    return providerReply();
  },
  { preconnect: fetch.preconnect },
);

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "agent-access-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => HOST_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { TeamApiServer } = await import("../src/main/team-api-server");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");
const { SERVER_AUDIT_FILE, ServerAuditStore, memberAuditName, serverAuditNames } = await import(
  "../src/main/server-audit-store"
);
const { TeamStore } = await import("../src/main/team-store");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "A message or an interrupt to a `chat` agent. Both start a provider CLI, which this check does not run; the step sends a queue cancel, which is also a `chat` write.",
  ],
  steps: [],
};

/** Runs one check. `summarize` keeps session tokens out of the report. */
async function step<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check waits for its reply or event, and a missing event must fail.
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

/** A value that `JSON.parse` gives: the wire body of a response, a frame or a fixture. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonObject {
  assert.ok(isRecord(value), `${label} is not an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} is not text.`);
  return String(value);
}

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
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
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
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

const root = await mkdtemp(join(tmpdir(), "openbot-agent-access-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  access: InstanceType<typeof AgentAccessStore>;
  audit: InstanceType<typeof ServerAuditStore>;
  port: number;
  realtime: RealtimeVoiceService;
}

let host: Host | null = null;
const sockets: WebSocket[] = [];

/** Starts the host on the profile, as the app does at each launch. The stores keep their files. */
async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const audit = new ServerAuditStore(join(userData, SERVER_AUDIT_FILE));
  await runCauseEffect(audit.load());
  // As the app wires it: the roles store records each save in the audit log.
  const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE), {
    audit: (serverId, before, after, actor) =>
      audit.recordAgentAccess(serverId, actor, before, after, () =>
        serverAuditNames(team.listMembers(), agents.listAgents()),
      ),
  });
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const realtime = new RealtimeVoiceService({ mode: "api-key", apiKey: REALTIME_KEY, fetch: realtimeFetch });
  const server = new TeamApiServer({
    realtimeVoice: realtime,
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
    agentAccess: access,
    serverAudit: audit,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, server, team, access, audit, port, realtime };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  await runCauseEffect(stopping.realtime.close());
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

/** One request from a current desktop client, which advertises agent-access-v1. */
async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; protocol?: number; capabilities?: readonly string[] } = {},
): Promise<{ status: number; body: unknown }> {
  const protocol = input.protocol ?? TEAM_PROTOCOL_V7;
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: (input.capabilities ?? teamCapabilitiesForProtocol(protocol)).join(","),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

/** A roles request through the frozen codec, in both directions. */
async function access(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = AGENT_ACCESS_CODECS.get(path);
  assert.ok(codec, `No agent-access-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

async function readAccess(token: string): Promise<AgentAccessSnapshot> {
  const response = await access(AGENT_ACCESS_ROUTES.read, token, {});
  assert.equal(response.status, 200, `Reading the roles returned ${response.status}.`);
  return decodeAgentAccessSnapshot(response.body);
}

async function setAccess(token: string, change: AgentAccessChange) {
  return access(AGENT_ACCESS_ROUTES.set, token, change);
}

/**
 * Reads the audit log through the frozen server-audit-v1 codec, in both directions. The capability
 * comes after the full protocol 7 and 8 lists, so only a protocol 9 client sends it.
 */
async function readAudit(
  token: string,
  capabilities?: readonly string[],
): Promise<{ status: number; log: ServerAuditLog | null }> {
  const codec = SERVER_AUDIT_CODECS.get(SERVER_AUDIT_ROUTES.read);
  assert.ok(codec, "No server-audit-v1 codec for the read route.");
  codec.request({});
  const response = await call("POST", SERVER_AUDIT_ROUTES.read, {
    token,
    body: {},
    protocol: TEAM_PROTOCOL_V9,
    ...(capabilities ? { capabilities } : {}),
  });
  if (response.status !== 200) return { status: response.status, log: null };
  return { status: 200, log: decodeServerAuditLog(codec.response(response.status, response.body)) };
}

/** The name that the audit log keeps for a member of this host. */
function auditName(memberId: string): string {
  const member = current()
    .team.listMembers()
    .find((value) => value.id === memberId);
  assert.ok(member, `No member ${memberId}.`);
  return memberAuditName(member).name;
}

/** Each entry as `<kind> <role or Everyone> <agent or member> <from>-><to>`, newest first. */
function auditLines(log: ServerAuditLog): string[] {
  return log.entries.map(({ change }) => {
    switch (change.kind) {
      case "agent-level":
        return `agent-level ${change.role?.name ?? "Everyone"} ${change.agent.name} ${change.from}->${change.to}`;
      case "role-member":
        return `role-member ${change.role.name} ${change.member.name} ${change.added ? "added" : "removed"}`;
      case "role-created":
      case "role-deleted":
        return `${change.kind} ${change.role.name}`;
      default:
        return change.kind;
    }
  });
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

async function listedIds(token: string): Promise<string[]> {
  const listed = await call("GET", TEAM_API_ROUTES.agents.all, { token });
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body));
  return listed.body.map((agent) => text(record(agent, "agent").id, "agent id")).sort();
}

function refusal(body: unknown): string {
  return JSON.stringify(body);
}

/** Opens a member's event socket that declares agent-access-v1, and waits for its first snapshot. */
async function openEvents(token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  const snapshot = nextMessage(socket, (value) =>
    isRecord(value) && value.type === "runtime-snapshot" ? value : null,
  );
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: ["agent-runtime-snapshots", AGENT_ACCESS_CAPABILITY],
    }),
  );
  await snapshot;
  return socket;
}

/** Waits for the first socket message that `pick` accepts. */
function nextMessage<T>(socket: WebSocket, pick: (value: unknown) => T | null): Promise<T> {
  return new Promise((resolveMessage, reject) => {
    const onMessage = (event: MessageEvent) => {
      const picked = pick(JSON.parse(String(event.data)));
      if (picked === null) return;
      socket.removeEventListener("message", onMessage);
      resolveMessage(picked);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", (event) => reject(new Error(`The event socket closed: ${event.code}.`)), {
      once: true,
    });
  });
}

/** The next agent list frame, as the ids of its agents. The released wire calls it `bots-changed`. */
function nextAgentsChanged(socket: WebSocket): Promise<string[]> {
  return nextMessage(socket, (value) => {
    if (!isRecord(value) || value.type !== "bots-changed" || !Array.isArray(value.bots)) return null;
    return value.bots.map((agent) => text(record(agent, "agent").id, "agent id")).sort();
  });
}

try {
  host = await startHost();
  const ownerToken = await login(OWNER);

  const setup = await step(
    "setup: an owner, a member, and four agents; with no roles the member gets every agent",
    async () => {
      const { agents, team } = current();
      const create = async (name: string) =>
        (
          await runCauseEffect(
            agents.createAgentProfile({ name, description: name, avatarSeed: name.toLowerCase(), avatarHue: null }),
          )
        ).id;
      const legal = await create("Legal");
      const finance = await create("Finance");
      const ops = await create("Ops");
      const general = await create("General");
      const invite = await runCauseEffect(team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      const memberId = team.listMembers().find((member) => member.username === MEMBER.username)?.id;
      assert.ok(memberId, "The member is not in the team.");
      const memberToken = await login(MEMBER);
      const owner = await readAccess(ownerToken);
      assert.deepEqual(owner, { revision: 0, mine: owner.mine, everyone: {}, roles: [] });
      const mine = await readAccess(memberToken);
      assert.equal(mine.everyone, undefined, "A member reads the Everyone levels.");
      assert.equal(mine.roles, undefined, "A member reads the roles.");
      assert.deepEqual(
        Object.values(mine.mine),
        ["manage", "manage", "manage", "manage"],
        "With no roles a member must manage every agent.",
      );
      return { ids: { legal, finance, ops, general }, memberId, memberToken };
    },
    ({ ids, memberId }) => ({ ids, memberId }),
  );
  const { legal, finance, ops, general } = setup.ids;
  let socket = await openEvents(setup.memberToken);

  await step("member: cannot change the roles", async () => {
    const refused = await setAccess(setup.memberToken, { revision: 0, everyone: { [legal]: "none" }, roles: [] });
    assert.equal(refused.status, 403);
    assert.equal(current().access.get(current().team.getIdentity()?.serverId ?? "").revision, 0);
    return { status: refused.status };
  });

  const legalRole = { id: "legal", name: "Legal", agents: { [legal]: "chat" as const }, memberIds: [setup.memberId] };
  const restricted: AgentAccessChange = {
    revision: 0,
    // General is not listed, so Everyone keeps `manage` on it.
    everyone: { [legal]: "none", [finance]: "none", [ops]: "view" },
    roles: [legalRole],
  };

  await step("owner: a role change reaches the member's socket without the closed agent", async () => {
    const changed = nextMessage(socket, (value) => agentAccessEvent(value));
    const agentsChanged = nextAgentsChanged(socket);
    const saved = await setAccess(ownerToken, restricted);
    assert.equal(saved.status, 200, `Saving the roles returned ${saved.status}.`);
    assert.equal((await changed).revision, 1);
    const ids = await agentsChanged;
    assert.deepEqual(ids, [legal, ops, general].sort(), "The member's socket still lists the closed agent.");
    return { revision: 1, agents: ids.length };
  });

  await step("audit: the owner reads the roles change with its actor, newest first", async () => {
    const { status, log } = await readAudit(ownerToken);
    assert.equal(status, 200, `Reading the audit log returned ${status}.`);
    assert.ok(log);
    const ownerId = current()
      .team.listMembers()
      .find((member) => member.role === "owner")?.id;
    assert.ok(ownerId, "The host has no owner.");
    const ownerName = { id: ownerId, name: auditName(ownerId) };
    const memberName = auditName(setup.memberId);
    assert.deepEqual(auditLines(log), [
      "agent-level Legal Legal none->chat",
      "agent-level Everyone Ops manage->view",
      "agent-level Everyone Finance manage->none",
      "agent-level Everyone Legal manage->none",
      `role-member Legal ${memberName} added`,
      "role-created Legal",
    ]);
    for (const entry of log.entries) assert.deepEqual(entry.actor, ownerName, "An entry does not name the owner.");
    return { entries: log.entries.length, actor: ownerName.name };
  });

  await step("audit: a member is refused with 403, and a client with no server-audit-v1 gets 400", async () => {
    const member = await readAudit(setup.memberToken);
    assert.equal(member.status, 403, `A member read the audit log: ${member.status}.`);
    const older = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter((value) => value !== SERVER_AUDIT_CAPABILITY);
    const unsupported = await readAudit(ownerToken, older);
    assert.equal(unsupported.status, 400, `A client with no server-audit-v1 got ${unsupported.status}.`);
    return { member: member.status, noCapability: unsupported.status };
  });

  await step("member: reads the levels that apply to them, and the list leaves out the closed agent", async () => {
    const mine = await readAccess(setup.memberToken);
    assert.deepEqual(mine, { revision: 1, mine: { [legal]: "chat", [ops]: "view", [general]: "manage" } });
    assert.deepEqual(await listedIds(setup.memberToken), [legal, ops, general].sort());
    return mine;
  });

  await step("none: the closed agent's conversation answers 404", async () => {
    const response = await call("GET", TEAM_API_ROUTES.agent.conversation(finance), { token: setup.memberToken });
    assert.equal(response.status, 404);
    return { status: response.status };
  });

  await step("view: a write is refused with 403, and reading the conversation works", async () => {
    const sent = await call("POST", TEAM_API_ROUTES.agent.messages(ops), {
      token: setup.memberToken,
      body: { text: "Hello" },
    });
    assert.equal(sent.status, 403, `A message to a view agent returned ${sent.status}.`);
    assert.ok(refusal(sent.body).includes(sourceText("error.team.agentViewOnly")), refusal(sent.body));
    assert.equal(current().agents.listQueue(ops).deliveries.length, 0, "A refused message was queued.");
    const read = await call("GET", TEAM_API_ROUTES.agent.conversation(ops), { token: setup.memberToken });
    assert.equal(read.status, 200, `Reading a view agent returned ${read.status}.`);
    return { send: sent.status, read: read.status };
  });

  await step("chat: a chat write passes the check, and a settings change is refused", async () => {
    // An interrupt or a message starts the provider CLI, which this check does not run. A cancel of
    // a delivery that does not exist is a chat write that the queue refuses without a provider.
    const cancel = (agentId: string) =>
      call("POST", TEAM_API_ROUTES.agent.queueCancel(agentId), {
        token: setup.memberToken,
        body: { deliveryId: "delivery-e2e" },
      });
    const refused = await cancel(ops);
    assert.equal(refused.status, 403, `A cancel on a view agent returned ${refused.status}.`);
    const passed = await cancel(legal);
    assert.notEqual(passed.status, 403, `A cancel on a chat agent was refused: ${refusal(passed.body)}.`);
    assert.notEqual(passed.status, 404, `A cancel on a chat agent answered 404: ${refusal(passed.body)}.`);
    const patched = await call("PATCH", TEAM_API_ROUTES.agent.one(legal), {
      token: setup.memberToken,
      body: { name: "Legal 2" },
    });
    assert.equal(patched.status, 403, `PATCH on a chat agent returned ${patched.status}.`);
    assert.ok(refusal(patched.body).includes(sourceText("error.team.agentManageDenied")), refusal(patched.body));
    // The memory inclusion route names the agent in its body, not in its path.
    const included = await call("POST", AGENT_MEMORY_INCLUSION_ROUTE, {
      token: setup.memberToken,
      body: { agentId: legal, changes: [{ memoryId: "memory-e2e", inclusion: "essential", expectedRevision: 0 }] },
    });
    assert.equal(included.status, 403, `A memory inclusion change on a chat agent returned ${included.status}.`);
    assert.equal(
      current()
        .agents.listAgents()
        .find((agent) => agent.id === legal)?.name,
      "Legal",
    );
    return { viewCancel: refused.status, chatCancel: passed.status, patch: patched.status, inclusion: included.status };
  });

  await step("manage: the member changes an agent that Everyone does not list", async () => {
    const patched = await call("PATCH", TEAM_API_ROUTES.agent.one(general), {
      token: setup.memberToken,
      body: { name: "General 2" },
    });
    assert.equal(patched.status, 200, `PATCH on a manage agent returned ${patched.status}.`);
    assert.equal(
      current()
        .agents.listAgents()
        .find((agent) => agent.id === general)?.name,
      "General 2",
    );
    return { patch: patched.status };
  });

  await step("owner: sees and changes every agent, and reads every role", async () => {
    assert.deepEqual(await listedIds(ownerToken), [legal, finance, ops, general].sort());
    const patched = await call("PATCH", TEAM_API_ROUTES.agent.one(finance), {
      token: ownerToken,
      body: { name: "Finance 2" },
    });
    assert.equal(patched.status, 200);
    const owner = await readAccess(ownerToken);
    assert.equal(owner.revision, 1);
    assert.deepEqual(owner.everyone, restricted.everyone);
    assert.deepEqual(owner.roles, restricted.roles);
    return { agents: 4, revision: owner.revision };
  });

  await step("stale: a save with an old revision answers 409 and changes nothing", async () => {
    const stale = await setAccess(ownerToken, { revision: 0, everyone: {}, roles: [] });
    assert.equal(stale.status, 409, `A stale save returned ${stale.status}.`);
    assert.ok(refusal(stale.body).includes(sourceText("error.team.agentAccessStale")), refusal(stale.body));
    assert.equal((await readAccess(ownerToken)).revision, 1);
    return { status: stale.status };
  });

  await step("admin: a member made admin gets every agent, and back to member closes them again", async () => {
    const { team, server } = current();
    let agentsChanged = nextAgentsChanged(socket);
    await runCauseEffect(team.updateMember(setup.memberId, { role: "admin" }));
    server.agentAccessChanged();
    assert.deepEqual(await agentsChanged, [legal, finance, ops, general].sort());
    assert.deepEqual(await listedIds(setup.memberToken), [legal, finance, ops, general].sort());
    agentsChanged = nextAgentsChanged(socket);
    await runCauseEffect(team.updateMember(setup.memberId, { role: "member" }));
    server.agentAccessChanged();
    assert.deepEqual(await agentsChanged, [legal, ops, general].sort());
    return { admin: 4, member: 3 };
  });

  await step("restart: the roles and the audit log persist", async () => {
    socket.close();
    await stopHost();
    host = await startHost();
    const mine = await readAccess(setup.memberToken);
    assert.deepEqual(mine, { revision: 1, mine: { [legal]: "chat", [ops]: "view", [general]: "manage" } });
    const { log } = await readAudit(ownerToken);
    assert.ok(log, "The owner cannot read the audit log after a restart.");
    assert.equal(log.entries.length, 6, "The audit log did not persist.");
    socket = await openEvents(setup.memberToken);
    return { ...mine, auditEntries: log.entries.length };
  });

  await step("owner: taking the member out of the role closes the agent with no reload", async () => {
    const agentsChanged = nextAgentsChanged(socket);
    const saved = await setAccess(ownerToken, {
      ...restricted,
      revision: 1,
      roles: [{ ...legalRole, memberIds: [] }],
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await agentsChanged, [ops, general].sort());
    const response = await call("GET", TEAM_API_ROUTES.agent.conversation(legal), { token: setup.memberToken });
    assert.equal(response.status, 404);
    const { log } = await readAudit(ownerToken);
    const memberName = auditName(setup.memberId);
    assert.ok(log, "The owner cannot read the audit log.");
    assert.equal(log.entries.length, 7);
    assert.equal(auditLines(log)[0], `role-member Legal ${memberName} removed`);
    return { agents: 2, legal: response.status, audit: auditLines(log)[0] };
  });

  await step("delete: the next save drops the levels of a deleted agent, and logs nothing", async () => {
    const { agents, access, team } = current();
    await runCauseEffect(agents.deleteAgent(finance));
    const saved = await setAccess(ownerToken, { ...restricted, revision: 2, roles: [{ ...legalRole, memberIds: [] }] });
    assert.equal(saved.status, 200, `Saving the roles returned ${saved.status}.`);
    const stored = access.get(team.getIdentity()?.serverId ?? "");
    assert.equal(stored.revision, 3);
    assert.deepEqual(stored.everyone, { [legal]: "none", [ops]: "view" }, "The deleted agent kept its level.");
    // Nobody changed the level of the deleted agent, so the log has no entry for it.
    const { log } = await readAudit(ownerToken);
    assert.ok(log, "The owner cannot read the audit log.");
    assert.equal(log.entries.length, 7, `The save of a deleted agent's levels was logged: ${auditLines(log)[0]}.`);
    return { everyone: stored.everyone, auditEntries: log.entries.length };
  });

  await step("duplicate: the copy of a closed agent gets the levels of its source", async () => {
    const { access, team } = current();
    const response = await call("POST", `/v1/agents/${encodeURIComponent(legal)}/duplicate`, {
      token: ownerToken,
      body: { operationId: crypto.randomUUID() },
    });
    assert.equal(response.status, 201, `Duplicate returned ${response.status}: ${refusal(response.body)}`);
    // The released duplicate response keeps the name `bot`.
    const copy = text(record(record(response.body, "duplicate").bot, "bot").id, "copy id");
    const stored = access.get(team.getIdentity()?.serverId ?? "");
    assert.equal(stored.everyone[copy], "none", "Everyone can use the copy of a closed agent.");
    assert.equal(stored.roles[0]?.agents[copy], "chat", "The role did not get the copy.");
    assert.ok(!(await listedIds(setup.memberToken)).includes(copy), "The member sees the copy.");
    return { copy: stored.everyone[copy], role: stored.roles[0]?.agents[copy] };
  });

  await step("live voice: host key is removed before subprocess launch", async () => {
    const prior = process.env.OPENBOT_REALTIME_API_KEY;
    try {
      process.env.OPENBOT_REALTIME_API_KEY = REALTIME_KEY;
      assert.equal(takeRealtimeVoiceApiKey(), REALTIME_KEY);
      const child = spawnSync(
        process.execPath,
        ["-e", "process.stdout.write(String(process.env.OPENBOT_REALTIME_API_KEY === undefined))"],
        { encoding: "utf8" },
      );
      assert.equal(child.status, 0);
      assert.equal(child.stdout, "true", "A child process inherited the host-only key.");
    } finally {
      if (prior === undefined) delete process.env.OPENBOT_REALTIME_API_KEY;
      else process.env.OPENBOT_REALTIME_API_KEY = prior;
    }
    return { childKeyAbsent: true };
  });

  await step("live voice: real host enforces current roles, bounds and private provider failures", async () => {
    const voiceAgent = (
      await runCauseEffect(
        current().agents.createAgentProfile({
          name: "Voice",
          description: "Voice",
          avatarSeed: "voice",
          avatarHue: null,
        }),
      )
    ).id;
    const levels = current().access.get(current().team.getIdentity()?.serverId ?? "");
    let revision = levels.revision;
    const setVoiceLevel = async (level: "manage" | "chat" | "view" | "none") => {
      const saved = await setAccess(ownerToken, {
        revision,
        everyone: { ...levels.everyone, [voiceAgent]: level },
        roles: levels.roles,
      });
      assert.equal(saved.status, 200);
      revision += 1;
    };
    const connect = (agentId: string, token = setup.memberToken, sdp = OFFER) =>
      call("POST", REALTIME_VOICE_ROUTES.connect, { token, protocol: TEAM_PROTOCOL_V9, body: { agentId, sdp } });
    await setVoiceLevel("chat");
    const voiceSettings = (
      token: string,
      agentId: string | null,
      selected?: string | null,
      capabilities?: readonly string[],
    ) =>
      call("POST", selected === undefined ? REALTIME_VOICE_CONFIGURATION_ROUTE : REALTIME_VOICE_AGENT_SELECTION_ROUTE, {
        token,
        protocol: TEAM_PROTOCOL_V9,
        body: { agentId, ...(selected === undefined ? {} : { voice: selected }) },
        capabilities,
      });
    const readable = await voiceSettings(setup.memberToken, voiceAgent);
    assert.equal(readable.status, 200);
    assert.equal(record(readable.body, "voice settings").canManage, false);
    assert.equal((await voiceSettings(setup.memberToken, voiceAgent, "ash")).status, 403);
    assert.equal((await voiceSettings(setup.memberToken, null, "cedar")).status, 403);
    await setVoiceLevel("manage");
    assert.equal((await voiceSettings(setup.memberToken, voiceAgent, "ash")).status, 200);
    assert.equal(record((await voiceSettings(ownerToken, voiceAgent)).body, "override").voice, "ash");
    assert.equal((await voiceSettings(ownerToken, voiceAgent, "cove")).status, 400);
    assert.equal((await voiceSettings(ownerToken, voiceAgent, null)).status, 200);
    assert.equal(
      (
        await voiceSettings(
          ownerToken,
          voiceAgent,
          "ash",
          teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter((c) => c !== REALTIME_VOICE_AGENT_SETTINGS_CAPABILITY),
        )
      ).status,
      400,
    );
    await setVoiceLevel("none");
    assert.equal((await voiceSettings(setup.memberToken, voiceAgent)).status, 403);
    await setVoiceLevel("chat");
    const status = await call("POST", REALTIME_VOICE_ROUTES.status, {
      token: setup.memberToken,
      protocol: TEAM_PROTOCOL_V9,
      body: {},
    });
    assert.equal(status.status, 200);
    assert.equal(record(status.body, "voice status").enabled, true);
    const setting = (token: string, enabled: unknown) =>
      call("POST", REALTIME_VOICE_ROUTES.settings, { token, protocol: TEAM_PROTOCOL_V9, body: { enabled } });
    assert.equal((await setting(setup.memberToken, false)).status, 403);
    assert.equal((await setting(ownerToken, "false")).status, 400);
    assert.equal((await setting(ownerToken, false)).status, 200);
    assert.ok((await connect(voiceAgent)).status >= 400);
    assert.equal((await setting(ownerToken, true)).status, 200);
    const selectVoice = (token: string, voice: string, capabilities?: readonly string[]) =>
      call("POST", REALTIME_VOICE_SELECTION_ROUTE, {
        token,
        protocol: TEAM_PROTOCOL_V9,
        body: { voice },
        capabilities,
      });
    assert.equal((await selectVoice(setup.memberToken, "cedar")).status, 403);
    assert.equal((await selectVoice(ownerToken, "cove")).status, 400);
    assert.equal(
      (
        await selectVoice(
          ownerToken,
          "cedar",
          teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter(
            (capability) => capability !== REALTIME_VOICE_SELECTION_CAPABILITY,
          ),
        )
      ).status,
      400,
    );
    const selectedVoice = await selectVoice(ownerToken, "cedar");
    assert.equal(selectedVoice.status, 200);
    assert.equal(record(selectedVoice.body, "saved voice").voice, "cedar");
    assert.equal((await setting(ownerToken, false)).status, 200);
    const enabledAgain = await setting(ownerToken, true);
    assert.equal(record(enabledAgain.body, "voice after toggle").voice, "cedar");
    const allowed = await connect(voiceAgent);
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.deepEqual(allowed.body, { sdp: ANSWER });
    const beforeDenied = providerCalls;
    await setVoiceLevel("view");
    assert.equal((await connect(voiceAgent)).status, 403);
    await setVoiceLevel("none");
    assert.ok([403, 404].includes((await connect(voiceAgent)).status));
    const tooLarge = await connect(voiceAgent, setup.memberToken, `v=0${"x".repeat(REALTIME_VOICE_SDP_LIMIT)}`);
    assert.equal(tooLarge.status, 400);
    assert.equal(providerCalls, beforeDenied, "An unauthorized or oversized offer reached OpenAI.");
    const old = await call("POST", REALTIME_VOICE_ROUTES.status, {
      token: setup.memberToken,
      protocol: TEAM_PROTOCOL_V7,
      body: {},
    });
    assert.equal(old.status, 400);
    assert.equal(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7).includes(REALTIME_VOICE_CAPABILITY), false);
    const noAuth = await call("POST", REALTIME_VOICE_ROUTES.status, { protocol: TEAM_PROTOCOL_V9, body: {} });
    assert.equal(noAuth.status, 401);
    await setVoiceLevel("chat");
    providerReply = async () => new Response(REALTIME_KEY, { status: 500 });
    const failed = await connect(voiceAgent, ownerToken);
    assert.ok(failed.status >= 400);
    assert.equal(JSON.stringify(failed.body).includes(REALTIME_KEY), false);
    providerReply = async () =>
      new Response("x", { headers: { "content-length": String(REALTIME_VOICE_SDP_LIMIT + 1) } });
    assert.ok((await connect(voiceAgent, ownerToken)).status >= 400);
    providerReply = async () => {
      await setVoiceLevel("none");
      return new Response(ANSWER);
    };
    const revoked = await connect(voiceAgent);
    assert.ok(revoked.status >= 400, "A handshake returned SDP after access was revoked.");
    assert.equal(JSON.stringify(revoked.body).includes(ANSWER), false);
    providerReply = async () => new Response(ANSWER);
    assert.equal(JSON.stringify(status.body).includes(REALTIME_KEY), false);
    return {
      chatAllowed: true,
      viewAndHiddenDenied: true,
      revokedAnswerWithheld: true,
      providerErrorsPrivate: true,
      oversizedRejected: true,
      oldProtocolDisabled: true,
      unauthenticated: noAuth.status,
    };
  });

  await step("voice context: an incomplete handoff persists once across host restart", async () => {
    const agent = await runCauseEffect(
      current().agents.createAgentProfile({
        name: "Voice context",
        description: "Voice context",
        avatarSeed: "voice-context",
        avatarHue: null,
      }),
    );
    const entries = [
      { role: "user", kind: "delegation-context", text: "A contextual summary, not exact spoken words." },
    ] satisfies import("../src/backend/agent/voice-context").VoiceContextEntry[];
    current().agents.recordVoiceContext(agent.id, "handoff-retry", entries);
    current().agents.recordVoiceContext(agent.id, "handoff-retry", entries);
    await stopHost();
    host = await startHost();
    const ownerId = current()
      .team.listMembers()
      .find((member) => member.role === "owner")?.id;
    assert.ok(ownerId);
    const conversation = await runCauseEffect(current().agents.readConversationFor(agent.id, ownerId));
    const notes = conversation.messages.filter((message) => message.itemType === "voice-context");
    assert.equal(notes.length, 1);
    assert.ok(notes[0]?.text.includes("not exact spoken words"));
    const startup = await runCauseEffect(current().agents.voiceSessionContext(agent.id, ownerId));
    assert.ok(startup.includes('"name":"Voice context"'));
    assert.ok(startup.includes("not exact spoken words"));
    return { persistedOnce: true, labelledContext: true };
  });

  report.passed = true;
} finally {
  for (const socket of sockets) socket.close();
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
