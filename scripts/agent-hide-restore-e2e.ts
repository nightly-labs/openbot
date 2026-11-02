// Checks hide and restore of an agent through the released agent-hidden-v1 Team API contract. A
// real `TeamApiServer` runs on loopback with the real team, agent, mailbox and sidebar stores on a
// temporary profile. The owner and a member send what a current desktop client sends, and the
// frozen agent-hidden-v1 codec reads each reply. A member's event socket must receive each change.
// The agent service is not initialized, so no provider CLI starts and its routine timer never arms;
// the clock moves with `setSystemTime` to make a routine occurrence come due while the agent is hidden.
// Run: `bun scripts/agent-hide-restore-e2e.ts`.
// Writes .openbot-build/agent-hide-restore-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, HiddenAgentsSnapshot } from "@openbot/contracts/ipc";
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
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-hide-restore-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const DAY = "2031-05-05";
const at = (time: string) => new Date(`${DAY}T${time}:00.000Z`);

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
    "Delivery of a message after restore. It starts a provider CLI, which this check does not run; the step checks that the hidden refusal is gone from the queue state instead.",
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

const root = await mkdtemp(join(tmpdir(), "openbot-agent-hide-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
  /** The agent service events since the host started. */
  events: AgentEvent[];
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
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const events: AgentEvent[] = [];
  agents.on("event", (event) => events.push(event));
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
  return { database, agents, server, team, port, events };
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

try {
  setSystemTime(at("09:00"));
  host = await startHost();
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
    return { hiddenAt: received.agents[0]?.hiddenAt, hostEvents: types };
  });

  await step("hidden: the agent keeps its data and refuses new messages", async () => {
    const listed = await call("GET", TEAM_API_ROUTES.agents.all, { token: setup.memberToken });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body));
    assert.ok(
      listed.body.some((agent) => record(agent, "agent").id === setup.agentId),
      "A hidden agent left /v1/agents.",
    );
    assert.equal(current().agents.listRoutines(setup.agentId).length, 1, "A hidden agent lost its routine.");
    const sent = await call("POST", TEAM_API_ROUTES.agent.messages(setup.agentId), {
      token: setup.memberToken,
      body: { text: "Are you there?" },
    });
    assert.ok(sent.status >= 400, `A hidden agent accepted a message: ${sent.status}.`);
    // The refusal is not an `HttpError`, so the dispatcher answers 500 and logs it as unexpected.
    if (sent.status >= 500)
      report.findings.push(
        `POST /v1/agents/:id/messages to a hidden agent answers ${sent.status}, not 4xx, and the host logs it as an unexpected error.`,
      );
    assert.ok(
      JSON.stringify(sent.body).includes(sourceText("error.backend.recipientHidden")),
      `The refusal does not name the hidden agent: ${JSON.stringify(sent.body)}.`,
    );
    assert.equal(current().agents.listQueue(setup.agentId).deliveries.length, 0, "A refused message was queued.");
    return { messageStatus: sent.status };
  });

  await step("owner: hiding again answers the same list and sends no event", async () => {
    const before = current().events.length;
    const response = await hidden(AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: setup.agentId, hidden: true });
    assert.equal(response.status, 200);
    assert.deepEqual(hiddenIds(response.body), [setup.agentId]);
    assert.equal(current().events.length, before, "A request with no change sent an event.");
    return { unchanged: true };
  });

  await step("restart: the agent stays hidden while its routine comes due", async () => {
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
    assert.equal(agents.listRoutines(setup.agentId)[0]?.trigger.nextRunAt, at("10:00").toISOString());
    socket = await openEvents(setup.memberToken);
    return { hidden: hiddenIds(read.body) };
  });

  await step("owner: restore skips the occurrences missed while hidden, and accepts work again", async () => {
    const { agents } = current();
    const event = nextHiddenEvent(socket);
    const response = await hidden(AGENT_HIDDEN_ROUTES.set, ownerToken, { agentId: setup.agentId, hidden: false });
    assert.equal(response.status, 200);
    assert.deepEqual(hiddenIds(response.body), []);
    assert.deepEqual((await event).agents, []);
    const [routine] = agents.listRoutines(setup.agentId);
    assert.ok(routine);
    assert.equal(routine.active, true);
    assert.equal(routine.missedPolicy, "run-once", "The routine asks to replay one missed run.");
    assert.equal(routine.trigger.nextRunAt, at("12:00").toISOString(), "Restore did not skip the hidden time.");
    // The 10:00 and 11:00 occurrences are recorded as one missed record. Neither is queued as work.
    const runs = agents.listRoutineRuns({ agentId: setup.agentId, routineId: setup.routineId }, true);
    assert.equal(runs.length, 1, `Restore made more than one run: ${JSON.stringify(runs.map((run) => run.status))}.`);
    const [missed] = runs;
    assert.equal(missed?.deliveryId, null, "Restore replayed an occurrence from the hidden time.");
    assert.equal(missed?.missed?.count, 2, "The record does not count the two hidden occurrences.");
    assert.equal(agents.listQueue(setup.agentId).deliveries.length, 0, "Restore queued work from the hidden time.");
    return { nextRunAt: routine.trigger.nextRunAt, missed: missed?.missed, status: missed?.status };
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
