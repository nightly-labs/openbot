// Checks hide and restore of an agent through the released agent-hidden-v1 Team API contract. A
// real `TeamApiServer` runs on loopback with the real team, agent, mailbox and sidebar stores on a
// temporary profile. The owner and a member send what a current desktop client sends, and the
// frozen agent-hidden-v1 codec reads each reply. A member's event socket must receive each change.
// A hidden agent keeps working: it answers a message and the routine timer runs its routine, each
// through a fake Codex app-server, so no real provider CLI starts. The first host does not initialize
// the agent service. It leaves what an earlier version leaves: a hidden agent, and no receipt of the
// one-time step that turns off the routines of such an agent. Each later host initializes the service
// as the app does. The clock moves with `setSystemTime` to make a routine occurrence come due.
// Run: `bun scripts/agent-hide-restore-e2e.ts`.
// Writes .openbot-build/agent-hide-restore-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, type HiddenAgentsSnapshot } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import {
  AGENT_HIDDEN_CAPABILITY,
  AGENT_HIDDEN_CODECS,
  AGENT_HIDDEN_ROUTES,
  agentHiddenEvent,
} from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V7 } from "@openbot/contracts/team-protocol/v7";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentService as AgentServiceType } from "../src/backend/agent-service";
import type { MailboxStore as MailboxStoreType } from "../src/backend/mailbox-store";
import type { OpenBotDatabase as OpenBotDatabaseType } from "../src/backend/openbot-database";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-hide-restore-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const DAY = "2031-05-05";
const at = (time: string) => new Date(`${DAY}T${time}:00.000Z`);

const root = await mkdtemp(join(tmpdir(), "openbot-agent-hide-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

/** A Codex app-server with the methods that the service calls. Each turn is logged and answers "Done.". */
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
      // The process id tells the turns of one host from those of the host before a restart.
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

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "agent-hide-electron-boundary",
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

const report: { passed: boolean; findings: string[]; unverified: string[]; steps: Step[] } = {
  passed: false,
  findings: [],
  unverified: [
    "A real provider. A fake Codex app-server answers each turn.",
    "A profile that a released version wrote. The first host of this check makes the hidden agent and writes no receipt of the one-time routine step.",
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
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
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

interface Host {
  database: OpenBotDatabaseType;
  agents: AgentServiceType;
  mailbox: MailboxStoreType;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
  /** The agent service events since the host started. */
  events: AgentEvent[];
}

let host: Host | null = null;
const sockets: WebSocket[] = [];

/**
 * Starts the host on the profile. The stores keep their files. `stores-only` does not initialize the
 * agent service, so the one-time routine step does not run and no routine timer arms.
 */
async function startHost(mode: "app" | "stores-only" = "app"): Promise<Host> {
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
  if (mode === "app") await runCauseEffect(agents.initialize());
  else {
    await runCauseEffect(agentStore.initialize());
    await runCauseEffect(mailbox.initialize());
  }
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

/** One request from a current desktop client, which advertises agent-hidden-v1. */
async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V7),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7).join(","),
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

/** A hidden-agents request through the frozen codec, in both directions. */
async function hidden(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = AGENT_HIDDEN_CODECS.get(path);
  assert.ok(codec, `No agent-hidden-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

function hiddenIds(body: unknown): string[] {
  const agents = record(body, "hidden agents").agents;
  assert.ok(Array.isArray(agents));
  return agents.map((agent) => text(record(agent, "hidden agent").agentId, "agent id"));
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

/** Opens a member's event socket that declares agent-hidden-v1, and waits for its first snapshot. */
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
      capabilities: ["agent-runtime-snapshots", AGENT_HIDDEN_CAPABILITY],
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

function nextHiddenEvent(socket: WebSocket) {
  return nextMessage(socket, (value) => agentHiddenEvent(value));
}

function snapshotIds(snapshot: HiddenAgentsSnapshot): string[] {
  return snapshot.agents.map((agent) => agent.agentId);
}

/** The turns that the fake provider started. */
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

/** Waits for a state of the service. The step deadline bounds a state that never comes. */
async function waitFor<T>(read: () => T | null | undefined | false): Promise<T> {
  for (;;) {
    const value = read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 25));
  }
}

try {
  setSystemTime(at("09:00"));
  host = await startHost("stores-only");
  const ownerToken = await login(OWNER);

  const setup = await step(
    "setup: an owner, a member with an event socket, and an agent with a routine",
    async () => {
      const { agents } = current();
      const agent = await runCauseEffect(
        agents.createAgentProfile({
          name: "Night watch",
          description: "Checks the logs.",
          avatarSeed: "hide",
          avatarHue: null,
        }),
      );
      const invite = await runCauseEffect(current().team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      const routine = agents.createRoutine(
        {
          agentId: agent.id,
          name: "Hourly log check",
          instruction: "Check the logs.",
          active: true,
          timezone: "UTC",
          schedule: { kind: "custom", expression: "0 * * * *" },
          missedPolicy: "run-once",
        },
        { recordConversationEvent: false },
      );
      assert.equal(routine.trigger.nextRunAt, at("10:00").toISOString());
      const memberToken = await login(MEMBER);
      const read = await hidden(AGENT_HIDDEN_ROUTES.read, memberToken, {});
      assert.equal(read.status, 200);
      assert.deepEqual(hiddenIds(read.body), []);
      return { agentId: agent.id, routineId: routine.id, memberToken };
    },
    ({ agentId, routineId }) => ({ agentId, routineId }),
  );
  let socket = await openEvents(setup.memberToken);
  const routineOf = () => current().agents.listRoutines(setup.agentId)[0];
  const runsOf = () => current().agents.listRoutineRuns({ agentId: setup.agentId, routineId: setup.routineId }, true);

  await step("member: cannot hide an agent, and the request changes nothing", async () => {
    const refused = await hidden(AGENT_HIDDEN_ROUTES.set, setup.memberToken, { agentId: setup.agentId, hidden: true });
    assert.equal(refused.status, 403);
    assert.ok(
      JSON.stringify(refused.body).includes(sourceText("error.team.membersCannotHideAgents")),
      "The refusal does not name the reason.",
    );
    assert.deepEqual(snapshotIds(current().agents.listHiddenAgents()), []);
    return { status: refused.status };
  });

  await step("owner: hide reaches the member's socket and the host's events", async () => {
    const before = current().events.length;
    const event = nextHiddenEvent(socket);
    const response = await hidden(AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: setup.agentId, hidden: true });
    assert.equal(response.status, 200);
    assert.deepEqual(hiddenIds(response.body), [setup.agentId]);
    const received = await event;
    assert.deepEqual(
      received.agents.map((agent) => agent.agentId),
      [setup.agentId],
    );
    const types = current()
      .events.slice(before)
      .map((entry) => entry.type);
    assert.ok(types.includes("hidden-agents-changed") && types.includes("agents-changed"));
    const read = await hidden(AGENT_HIDDEN_ROUTES.read, setup.memberToken, {});
    assert.deepEqual(hiddenIds(read.body), [setup.agentId], "The member does not read the hidden agent.");
    const listed = await call("GET", TEAM_API_ROUTES.agents.all, { token: setup.memberToken });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body));
    assert.ok(
      listed.body.some((agent) => record(agent, "agent").id === setup.agentId),
      "A hidden agent left /v1/agents.",
    );
    assert.equal(routineOf()?.active, true, "The hide turned the routine off.");
    return { hiddenAt: received.agents[0]?.hiddenAt, hostEvents: types };
  });

  await step("owner: hiding again answers the same list and sends no event", async () => {
    const before = current().events.length;
    const response = await hidden(AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: setup.agentId, hidden: true });
    assert.equal(response.status, 200);
    assert.deepEqual(hiddenIds(response.body), [setup.agentId]);
    assert.equal(current().events.length, before, "A request with no change sent an event.");
    return { unchanged: true };
  });

  await step("update: the routines of an agent hidden by an earlier version go off, and none runs", async () => {
    socket.close();
    await stopHost();
    // Two occurrences come due while the app is closed and the agent is hidden.
    setSystemTime(at("11:30"));
    host = await startHost();
    const { agents } = current();
    assert.deepEqual(snapshotIds(agents.listHiddenAgents()), [setup.agentId]);
    const read = await hidden(AGENT_HIDDEN_ROUTES.read, setup.memberToken, {});
    assert.equal(read.status, 200, "The member's session did not survive the restart.");
    assert.deepEqual(hiddenIds(read.body), [setup.agentId]);
    assert.equal(routineOf()?.active, false, "The update left the routine on.");
    assert.equal(agents.nextRoutineDueAt(), null, "The timer plans a routine that is off.");
    assert.equal(runsOf().length, 0, "The update made a routine run.");
    assert.equal(turns().length, 0, "The update started a turn.");
    socket = await openEvents(setup.memberToken);
    return { hidden: hiddenIds(read.body), routineActive: routineOf()?.active };
  });

  await step("hidden: the agent answers a message", async () => {
    const { agents, mailbox } = current();
    const sent = await call("POST", TEAM_API_ROUTES.agent.messages(setup.agentId), {
      token: setup.memberToken,
      body: { text: "Are you there?" },
    });
    assert.ok(sent.status < 300, `A hidden agent refused a message: ${sent.status} ${JSON.stringify(sent.body)}.`);
    const turn = await waitFor(() => turns().find((entry) => entry.text.includes("Are you there?")));
    const deliveryId = await waitFor(() => agents.listQueue(setup.agentId).deliveries[0]?.id);
    const status = await waitFor(() => {
      const delivery = mailbox.getDelivery(deliveryId)?.delivery;
      return delivery && !["queued", "starting", "running"].includes(delivery.status) ? delivery.status : null;
    });
    assert.equal(status, "completed", "The turn of the hidden agent did not complete.");
    assert.deepEqual(snapshotIds(agents.listHiddenAgents()), [setup.agentId], "The message put the agent back.");
    return { messageStatus: sent.status, turnId: turn.turnId, delivery: status };
  });

  await step("hidden: the routine that the user turns on again runs at its time", async () => {
    current().agents.updateRoutine(
      { agentId: setup.agentId, routineId: setup.routineId, active: true },
      { recordConversationEvent: false },
    );
    assert.equal(routineOf()?.trigger.nextRunAt, at("12:00").toISOString());
    assert.equal(current().agents.nextRoutineDueAt(), at("12:00").toISOString(), "The timer does not plan it.");
    socket.close();
    await stopHost();
    // The occurrence comes due while the app is closed. The start runs it, as for a visible agent.
    setSystemTime(at("12:30"));
    const before = turns().length;
    host = await startHost();
    assert.equal(routineOf()?.active, true, "The one-time step ran a second time.");
    const run = await waitFor(() => runsOf().find((entry) => entry.status === "succeeded"));
    assert.equal(run.scheduledFor, at("12:00").toISOString());
    const turn = turns().slice(before).at(-1);
    assert.ok(turn?.text.includes("Check the logs."), "The provider did not get the routine.");
    assert.deepEqual(snapshotIds(current().agents.listHiddenAgents()), [setup.agentId]);
    assert.equal(routineOf()?.trigger.nextRunAt, at("13:00").toISOString());
    socket = await openEvents(setup.memberToken);
    return { run: run.status, scheduledFor: run.scheduledFor, turnId: turn?.turnId };
  });

  await step("owner: restore puts the agent back in the list and changes no routine", async () => {
    const { agents } = current();
    const before = routineOf();
    const runs = runsOf().length;
    const started = turns().length;
    const event = nextHiddenEvent(socket);
    const response = await hidden(AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: setup.agentId, hidden: false });
    assert.equal(response.status, 200);
    assert.deepEqual(hiddenIds(response.body), []);
    assert.deepEqual((await event).agents, []);
    const routine = routineOf();
    assert.ok(routine && before);
    assert.equal(routine.active, true);
    assert.equal(routine.trigger.nextRunAt, before.trigger.nextRunAt, "Restore moved the routine.");
    assert.equal(runsOf().length, runs, "Restore made a routine run.");
    assert.equal(turns().length, started, "Restore started a turn.");
    assert.equal(agents.nextRoutineDueAt(), at("13:00").toISOString());
    return { nextRunAt: routine.trigger.nextRunAt, runs };
  });

  await step("restart: the restore persists", async () => {
    socket.close();
    await stopHost();
    host = await startHost();
    assert.deepEqual(snapshotIds(current().agents.listHiddenAgents()), []);
    const read = await hidden(AGENT_HIDDEN_ROUTES.read, setup.memberToken, {});
    assert.deepEqual(hiddenIds(read.body), []);
    return { hidden: [] };
  });

  report.passed = true;
} finally {
  setSystemTime();
  for (const socket of sockets) socket.close();
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
