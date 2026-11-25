import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord as isRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_CREATE_OPERATION_CAPABILITY } from "@openbot/contracts/team-protocol/agent-create-operation-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { TEAM_PROTOCOL_V8 } from "@openbot/contracts/team-protocol/v8";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import {
  decodeTeamProtocolV9WebRtcHttpRequest,
  encodeTeamProtocolV9WebRtcHttpRequest,
} from "@openbot/contracts/team-protocol/v9-webrtc-adapter";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceType } from "../src/backend/agent-service";
import type { MailboxStore as MailboxStoreType } from "../src/backend/mailbox-store";
import type { OpenBotDatabase as OpenBotDatabaseType } from "../src/backend/openbot-database";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-create-retry-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;

const root = await mkdtemp(join(tmpdir(), "openbot-agent-create-retry-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
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
      appendFileSync(LOG, JSON.stringify({ turnId, text }) + "\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
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
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");

plugin({
  name: "agent-create-retry-electron-boundary",
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
    "A real provider. A fake Codex app-server answers each turn.",
    "A lost answer on a real network. The checks send the retry themselves, as a client does after a failed request.",
    "A host crash after the agent is saved and before its initial message is stored: a retry then makes a second agent.",
  ],
  steps: [],
};

async function step<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
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
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
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
  importSignIn: unused,
};

interface Host {
  database: OpenBotDatabaseType;
  agents: AgentServiceType;
  mailbox: MailboxStoreType;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
  events: AgentEvent[];
}

let host: Host | null = null;

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(team.initialize());
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({
    store: agentStore,
    mailbox,
    browser: agentBrowser,
    sidebarLayout: sidebar,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
  });
  const events: AgentEvent[] = [];
  agents.on("event", (event) => events.push(event));
  await runCauseEffect(agents.initialize());
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, mailbox, server, team, port, events };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

function turns(): { turnId: string; text: string }[] {
  let log = "";
  try {
    log = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitFor<T>(read: () => T | null | undefined | false | Promise<T | null>): Promise<T> {
  for (;;) {
    const value = await read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
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

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  assert.ok(isRecord(response.body) && typeof response.body.sessionToken === "string", "Sign-in gave no token.");
  return response.body.sessionToken;
}

async function create(
  token: string,
  marker: string,
  operationId?: unknown,
): Promise<{ status: number; id: string | null }> {
  const response = await call("POST", TEAM_API_ROUTES.agents.all, {
    token,
    body: {
      name: `Retry ${marker}`,
      description: "Checks retried creates.",
      avatarSeed: `retry-${marker}`,
      avatarHue: null,
      initialMessage: `Say hello. ${marker}`,
      ...(operationId === undefined ? {} : { operationId }),
    },
  });
  const id = isRecord(response.body) && typeof response.body.id === "string" ? response.body.id : null;
  return { status: response.status, id };
}

function agentIds(): string[] {
  return current()
    .agents.listAgents()
    .map((agent) => agent.id);
}

async function settled(agentId: string) {
  const { agents } = current();
  return waitFor(async () => {
    const conversation = await runCauseEffect(agents.readConversation(agentId));
    const answered = conversation.messages.some((message) => message.author === "assistant");
    return answered && conversation.activeTurnId === null && agents.listQueue(agentId).deliveries.length === 0
      ? conversation
      : null;
  });
}

async function sentFor(agentId: string, marker: string): Promise<{ messages: number; turns: number }> {
  const conversation = await settled(agentId);
  return {
    messages: conversation.messages.filter((message) => message.author === "user" && message.text.includes(marker))
      .length,
    turns: turns().filter((turn) => turn.text.includes(marker)).length,
  };
}

try {
  host = await startHost();
  const ownerToken = await login(OWNER);
  const memberToken = await step(
    "setup: an owner and a member",
    async () => {
      const invite = await runCauseEffect(current().team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      return login(MEMBER);
    },
    () => ({ member: MEMBER.username }),
  );

  await step("the host advertises agent-create-operation-v1", async () => {
    const response = await call("GET", TEAM_API_ROUTES.compatibility);
    assert.ok(isRecord(response.body) && Array.isArray(response.body.capabilities), "No capability list.");
    assert.ok(
      response.body.capabilities.includes(AGENT_CREATE_OPERATION_CAPABILITY),
      "The host does not advertise it.",
    );
    return { advertised: true };
  });

  await step("the protocol 9 codecs of the clients and the host keep operationId", async () => {
    const id = crypto.randomUUID();
    const body = { name: "codec", description: "", avatarSeed: "codec", avatarHue: null, initialMessage: "codec" };
    const options = { preserveSemanticTags: true, agentCreateModel: true };
    const http = JSON.parse(
      teamHttpCodec(TEAM_PROTOCOL_V9).encodeRequest("POST", "/v1/agents", { ...body, operationId: id }, options),
    );
    const hostHttp = teamHttpCodec(TEAM_PROTOCOL_V9).decodeRequest("POST", "/v1/agents", http, options);
    const frame = encodeTeamProtocolV9WebRtcHttpRequest("POST", "/v1/agents", { ...body, operationId: id }, options);
    const hostFrame = decodeTeamProtocolV9WebRtcHttpRequest("POST", "/v1/agents", frame, options);
    for (const value of [http, hostHttp, frame, hostFrame])
      assert.ok(isRecord(value) && value.operationId === id, "A protocol 9 codec dropped operationId.");
    const v8 = teamHttpCodec(TEAM_PROTOCOL_V8).decodeRequest(
      "POST",
      "/v1/agents",
      { ...body, operationId: id },
      options,
    );
    assert.equal(v8.operationId, undefined, "The protocol 8 codec carried operationId.");
    assert.throws(
      () => encodeTeamProtocolV9WebRtcHttpRequest("POST", "/v1/agents", { ...body, operationId: "not-a-uuid" }),
      "A malformed operationId did not fail closed.",
    );
    return { kept: 4, protocol8: "dropped" };
  });

  await step("a client keeps an operation id only for the next retry, for 10 minutes", async () => {
    const ids = retryOperationIds(() => crypto.randomUUID());
    const write = ["server", "agent"];
    const first = ids(write);
    first.failed();
    assert.equal(ids(write).id, first.id, "A retry after a failure got a new id.");
    assert.notEqual(ids(write).id, first.id, "A write after a successful retry kept the old id.");
    const failed = ids(write);
    failed.failed();
    ids(["server", "other agent"]);
    assert.notEqual(ids(write).id, failed.id, "A retry after another write kept the old id.");
    const late = ids(write);
    late.failed();
    const now = Date.now;
    Date.now = () => now() + 10 * 60_000;
    try {
      assert.notEqual(ids(write).id, late.id, "A retry after 10 minutes kept the old id.");
    } finally {
      Date.now = now;
    }
    return { retry: "same id", afterSuccess: "new id", afterOtherWrite: "new id", after10Minutes: "new id" };
  });

  const operationId = crypto.randomUUID();
  const first = await step("two creates at the same time and a third after them give one agent", async () => {
    const before = agentIds().length;
    const parallel = await Promise.all([
      create(ownerToken, "first", operationId),
      create(ownerToken, "first", operationId),
    ]);
    const again = await create(ownerToken, "first", operationId);
    const results = [...parallel, again];
    assert.deepEqual(
      results.map((result) => result.status),
      [201, 201, 201],
    );
    const ids = new Set(results.map((result) => result.id));
    assert.equal(ids.size, 1, `The host gave ${ids.size} agents for one operationId.`);
    const [id] = ids;
    assert.ok(id);
    const sent = await sentFor(id, "first");
    assert.equal(agentIds().length - before, 1, "The host made more than one agent.");
    assert.deepEqual(sent, { messages: 1, turns: 1 }, "The host sent the initial message more than once.");
    return { id, newAgents: agentIds().length - before, ...sent };
  });

  await step("the same operationId from a different member makes that member's own agent", async () => {
    const result = await create(memberToken, "member", operationId);
    assert.equal(result.status, 201);
    assert.ok(result.id && result.id !== first.id, "The member got the owner's agent.");
    return { id: result.id, ...(await sentFor(result.id, "member")) };
  });

  const recreated = await step("after a delete, the same operationId makes a new agent", async () => {
    await runCauseEffect(current().agents.deleteAgent(first.id));
    const result = await create(ownerToken, "recreated", operationId);
    assert.equal(result.status, 201);
    assert.ok(result.id && result.id !== first.id, "The host answered with the deleted agent.");
    const sent = await sentFor(result.id, "recreated");
    assert.deepEqual(sent, { messages: 1, turns: 1 });
    return { id: result.id, ...sent };
  });

  await step("after a restart, the same operationId gives the same agent", async () => {
    await stopHost();
    host = await startHost();
    const token = await login(OWNER);
    const before = agentIds().length;
    const result = await create(token, "restart", operationId);
    assert.equal(result.status, 201);
    assert.equal(result.id, recreated.id, "The key did not survive the restart.");
    assert.equal(agentIds().length, before, "The retry after a restart made an agent.");
    assert.equal(turns().filter((turn) => turn.text.includes("restart")).length, 0, "The retry sent a message.");
    return { id: result.id };
  });

  await step("an operationId that is not a UUID v4 is refused and makes no agent", async () => {
    const token = await login(OWNER);
    const before = agentIds().length;
    const statuses = [];
    for (const invalid of ["not-a-uuid", 7, "00000000-0000-1000-8000-000000000000"])
      statuses.push((await create(token, "invalid", invalid)).status);
    assert.deepEqual(statuses, [400, 400, 400]);
    assert.equal(agentIds().length, before);
    return { statuses };
  });

  await step("creates without operationId each make an agent, as the released route does", async () => {
    const token = await login(OWNER);
    const results = [await create(token, "plain"), await create(token, "plain")];
    assert.deepEqual(
      results.map((result) => result.status),
      [201, 201],
    );
    assert.notEqual(results[0]?.id, results[1]?.id);
    return { agents: results.length };
  });

  report.passed = true;
} finally {
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
