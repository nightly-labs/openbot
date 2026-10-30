// Checks the workflows-v1 Team API grant. A real `TeamApiServer` runs on loopback with the real team,
// agent, mailbox, sidebar, roles and workflow stores on a temporary profile. The owner sets agent
// levels; a member signs in as a current desktop client does. Each request and answer goes through the
// frozen codec. The host must hide a workflow that names a closed agent (but show the owner one whose
// agent was deleted), refuse a run without the chat level and a change, rename or delete without the
// manage level, keep the messaging place of an output to an owner or admin, keep the webhook URL and
// secret from a member, clip step texts, drop the step of an agent that is hidden now and refuse its
// retry, hide a
// workflow of a local-only provider, refuse a workflow too large for one frame, and tell the member's
// event socket about a change. The codec carries kinds and statuses that this app does not know, and
// the client shows a workflow with such a node read-only; a member reads the graph of an old version.
// Agent steps answer through stand-ins, so no provider CLI starts and no model turn is sent.
// Run: `bun scripts/workflow-team-api-e2e.ts`.
// Writes .openbot-build/workflow-team-api-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentAccessChange, WorkflowDetail, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_ACCESS_CODECS, AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V7 } from "@openbot/contracts/team-protocol/v7";
import {
  WORKFLOW_STEP_TEXT_LIMIT,
  WORKFLOWS_CAPABILITY,
  WORKFLOWS_CODECS,
  WORKFLOWS_ROUTES,
  workflowsEvent,
} from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowVersions,
} from "@openbot/team-client/workflow-decoding";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-team-api-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const WEBHOOK_URL = "https://relay.example.test/hooks/e2e";
const SECRET = "whsec-e2e-not-a-real-secret";
const LONG_ANSWER = "a".repeat(40_000);

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "workflow-team-api-electron-boundary",
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
    "A real agent turn: agent steps answer through stand-ins, so no provider CLI or model runs.",
    "The relay webhook URL and secret: the host-events service is a stand-in, as the relay is outside this check.",
    "WebRTC: the member uses HTTP and the event socket; the frame budget is checked on the HTTP answer.",
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

function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} is not a list.`);
  return value;
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

const root = await mkdtemp(join(tmpdir(), "openbot-workflow-team-api-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  workflows: WorkflowsHandle;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
}

let host: Host | null = null;
const sockets: WebSocket[] = [];
/** The agent whose deliveries fail, so its step keeps an error. */
let failingAgent = "";

/** Starts the host on the profile, as the app does at each launch, with stand-ins for agent turns. */
async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const deliveries = new Map<string, string>();
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      delivery: (deliveryId) => {
        const agentId = deliveries.get(deliveryId);
        if (agentId === undefined) return null;
        return agentId === failingAgent
          ? { status: "failed", turnId: null, error: "The agent step failed in the e2e." }
          : { status: "completed", turnId: `turn-${deliveryId}`, error: null };
      },
      turnAnswer: () => LONG_ANSWER,
      sendHandoff: ({ agentId, idempotencyKey }) =>
        Effect.sync(() => {
          const deliveryId = `delivery-${idempotencyKey}`;
          deliveries.set(deliveryId, agentId);
          return deliveryId;
        }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this check." }),
      notify: () => {},
      // No messaging connection exists here, so an output to a place fails with its sentence.
      connectionOn: () => false,
      post: () => Effect.succeed({ posted: true as const }),
      // As the app does: an agent event, so the member's socket hears it.
      changed: (workflowId) => agents.notifyWorkflowsChanged(workflowId),
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
    agentAccess: access,
    workflows: {
      ...workflows,
      // The relay gives a webhook trigger its URL; here each one gets a fixed URL.
      get: (workflowId) =>
        workflows.get(workflowId).pipe(
          Effect.map(
            (detail): WorkflowDetail => ({
              ...detail,
              triggers: detail.triggers.map((trigger) =>
                trigger.type === "webhook" ? { ...trigger, webhookUrl: WEBHOOK_URL } : trigger,
              ),
            }),
          ),
        ),
      rotateWorkflowSecret: () => Effect.succeed({ secret: SECRET }),
    },
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, workflows, server, team, port };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await Effect.runPromise(stopping.workflows.close()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

/** One request from a desktop client. `capabilities` is what the client advertises. */
async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[] } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V7),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: (input.capabilities ?? teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7)).join(","),
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

/** A workflows request through the frozen codec, in both directions. */
async function wire(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = WORKFLOWS_CODECS.get(path);
  assert.ok(codec, `No workflows-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

/** The refusals that these checks expect. */
type RefusalKey =
  | "error.workflow.missing"
  | "error.workflow.versionMissing"
  | "error.workflow.tooLargeToSend"
  | "error.team.agentViewOnly"
  | "error.team.agentManageDenied"
  | "error.workflow.stepMissing"
  | "error.workflow.runMissing"
  | "error.team.adminRequired";

/** A request that must answer `status` with the sentence of `key`. */
async function refused(path: string, token: string, body: unknown, status: number, key: RefusalKey) {
  const response = await wire(path, token, body);
  assert.equal(response.status, status, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  assert.ok(JSON.stringify(response.body).includes(sourceText(key)), JSON.stringify(response.body));
  return response.status;
}

/** What a client makes of a 200 answer that a host sends: the frozen codec, then `decode`. */
function answer<T>(path: string, body: unknown, decode: (value: unknown) => T): T {
  const codec = WORKFLOWS_CODECS.get(path);
  assert.ok(codec, `No workflows-v1 codec for ${path}.`);
  return decode(codec.response(200, body));
}

async function ok(path: string, token: string, body: unknown): Promise<JsonObject> {
  const response = await wire(path, token, body);
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  return record(response.body, path);
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

let accessRevision = 0;
/** Sets the Everyone level of each agent, as the owner does in the roles settings. */
async function setLevels(ownerToken: string, everyone: AgentAccessChange["everyone"]) {
  const codec = AGENT_ACCESS_CODECS.get(AGENT_ACCESS_ROUTES.set);
  assert.ok(codec);
  const body: AgentAccessChange = { revision: accessRevision, everyone, roles: [] };
  codec.request(body);
  const response = await call("POST", AGENT_ACCESS_ROUTES.set, { token: ownerToken, body });
  assert.equal(response.status, 200, `Saving the roles returned ${response.status}.`);
  accessRevision += 1;
}

/** Opens a member's event socket that declares workflows-v1, and waits for its first snapshot. */
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
      capabilities: ["agent-runtime-snapshots", WORKFLOWS_CAPABILITY],
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

const at = (x: number) => ({ x, y: 0 });
const agentNode = (id: string, agentId: string): WorkflowNode => ({
  id,
  kind: "agent",
  at: at(300),
  fields: { agentId, text: "Say hello." },
});
const promptNode: WorkflowNode = { id: "prompt", kind: "prompt", at: at(0), fields: { text: "Start." } };
/** A prompt into one agent step. */
const agentGraph = (agentId: string): WorkflowGraph => ({
  nodes: [promptNode, agentNode("agent", agentId)],
  edges: [{ id: "edge", from: "prompt", to: "agent", type: "text" }],
  strokes: [],
});
const channelOutput = (placeId: string): WorkflowNode => ({
  id: "output",
  kind: "output",
  at: at(600),
  fields: { target: "channel", connectionId: "messaging-e2e", placeId },
});
const withOutput = (graph: WorkflowGraph, output: WorkflowNode): WorkflowGraph => ({
  ...graph,
  nodes: [...graph.nodes, output],
  edges: [...graph.edges, { id: "edge-output", from: "agent", to: output.id, type: "text" }],
});

/** Makes a workflow on the host, as the owner does on the computer that runs the server. */
async function hostWorkflow(title: string, graph: WorkflowGraph): Promise<{ id: string; revision: number }> {
  const { workflows } = current();
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok, `Saving ${title} conflicted.`);
  return { id: created.summary.id, revision: saved.revision };
}

/** Moves runs until the step of `nodeId` in the run ends. */
async function settled(runId: string, nodeId: string) {
  const { workflows } = current();
  for (;;) {
    await Effect.runPromise(workflows.sweep());
    const found = (await runCauseEffect(workflows.run(runId))).steps.find((candidate) => candidate.nodeId === nodeId);
    if (found && found.status !== "running") return found;
    await new Promise((done) => setImmediate(done));
  }
}

let requests = 0;
const requestId = () => `request-${++requests}`;

try {
  host = await startHost();
  const ownerToken = await login(OWNER);

  const setup = await step(
    "setup: an owner, a member, five agents with the levels manage, none, view, manage and chat",
    async () => {
      const { agents, team } = current();
      const create = async (name: string) =>
        (
          await runCauseEffect(
            agents.createAgentProfile({ name, description: name, avatarSeed: name.toLowerCase(), avatarHue: null }),
          )
        ).id;
      const open = await create("Open");
      const closed = await create("Closed");
      const viewer = await create("Viewer");
      const later = await create("Later");
      const chatter = await create("Chatter");
      const invite = await runCauseEffect(team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      const memberToken = await login(MEMBER);
      await setLevels(ownerToken, { [closed]: "none", [viewer]: "view", [chatter]: "chat" });
      return { ids: { open, closed, viewer, later, chatter }, memberToken };
    },
    ({ ids }) => ({ ids }),
  );
  const { open, closed, viewer, later, chatter } = setup.ids;
  const member = setup.memberToken;
  failingAgent = later;

  await step("compatibility: the host advertises workflows-v1", async () => {
    const response = await call("GET", TEAM_API_ROUTES.compatibility);
    const capabilities = list(record(response.body, "compatibility").capabilities, "capabilities");
    assert.ok(capabilities.includes(WORKFLOWS_CAPABILITY), JSON.stringify(capabilities));
    return { capability: WORKFLOWS_CAPABILITY };
  });

  await step("old client: a client without workflows-v1 is told the server is too old", async () => {
    const response = await call("POST", WORKFLOWS_ROUTES.list, {
      token: member,
      body: {},
      capabilities: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7).filter(
        (capability) => capability !== WORKFLOWS_CAPABILITY,
      ),
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.ok(JSON.stringify(response.body).includes(sourceText("error.workflow.serverTooOld")));
    return { status: response.status };
  });

  const ids = await step("list: the member's list leaves out the workflow of a closed agent", async () => {
    const created = await ok(WORKFLOWS_ROUTES.create, ownerToken, { title: "Open", graph: agentGraph(open) });
    const openId = text(record(created.summary, "summary").id, "workflow id");
    const closedWorkflow = await hostWorkflow("Closed", agentGraph(closed));
    const viewWorkflow = await hostWorkflow("Viewer", agentGraph(viewer));
    const owner = list((await ok(WORKFLOWS_ROUTES.list, ownerToken, {})).workflows, "owner list");
    const mine = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list");
    const titles = (rows: unknown[]) => rows.map((row) => text(record(row, "summary").title, "title")).sort();
    assert.deepEqual(titles(owner), ["Closed", "Open", "Viewer"]);
    assert.deepEqual(titles(mine), ["Open", "Viewer"]);
    return { open: openId, closed: closedWorkflow.id, viewer: viewWorkflow.id };
  });

  await step("none: the closed agent's workflow and its run answer as missing", async () => {
    const get = await refused(WORKFLOWS_ROUTES.get, member, { workflowId: ids.closed }, 404, "error.workflow.missing");
    const { run } = await runCauseEffect(
      current().workflows.startRun({ workflowId: ids.closed, requestId: requestId() }),
    );
    const stop = await refused(WORKFLOWS_ROUTES.stopRun, member, { runId: run.id }, 404, "error.workflow.missing");
    const read = await refused(WORKFLOWS_ROUTES.run, member, { runId: run.id }, 404, "error.workflow.missing");
    const status = (await runCauseEffect(current().workflows.run(run.id))).run.status;
    assert.notEqual(status, "stopping", "A member stopped a run they cannot see.");
    return { get, stop, read, runStatus: status };
  });

  await step("view: the member reads a view agent's workflow, and a change, a run or a delete is refused", async () => {
    const detail = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.viewer });
    const revision = Number(detail.revision);
    const save = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.viewer, baseRevision: revision, graph: { nodes: [promptNode], edges: [], strokes: [] } },
      403,
      "error.team.agentManageDenied",
    );
    const start = await refused(
      WORKFLOWS_ROUTES.startRun,
      member,
      { workflowId: ids.viewer, requestId: requestId() },
      403,
      "error.team.agentViewOnly",
    );
    const remove = await refused(
      WORKFLOWS_ROUTES.delete,
      member,
      { workflowId: ids.viewer },
      403,
      "error.team.agentManageDenied",
    );
    assert.equal((await runCauseEffect(current().workflows.get(ids.viewer))).revision, revision);
    return { save, start, remove };
  });

  await step(
    "chat: the member runs a chat agent's workflow, but a change, a rename or a delete is refused",
    async () => {
      const workflow = await hostWorkflow("Chatter", agentGraph(chatter));
      const save = await refused(
        WORKFLOWS_ROUTES.saveGraph,
        member,
        {
          workflowId: workflow.id,
          baseRevision: workflow.revision,
          graph: { nodes: [promptNode], edges: [], strokes: [] },
        },
        403,
        "error.team.agentManageDenied",
      );
      const rename = await refused(
        WORKFLOWS_ROUTES.rename,
        member,
        { workflowId: workflow.id, title: "Renamed" },
        403,
        "error.team.agentManageDenied",
      );
      const remove = await refused(
        WORKFLOWS_ROUTES.delete,
        member,
        { workflowId: workflow.id },
        403,
        "error.team.agentManageDenied",
      );
      const started = await ok(WORKFLOWS_ROUTES.startRun, member, { workflowId: workflow.id, requestId: requestId() });
      const ended = await settled(text(record(started.run, "run").id, "run id"), "agent");
      assert.equal(ended.status, "done");
      const kept = await runCauseEffect(current().workflows.get(workflow.id));
      assert.equal(kept.revision, workflow.revision);
      assert.equal(kept.summary.title, "Chatter");
      return { save, rename, remove, run: ended.status };
    },
  );

  await step("deleted agent: an owner still sees a workflow whose agent is gone; a member does not", async () => {
    const workflow = await hostWorkflow("Gone", agentGraph("deleted-agent"));
    const titles = async (token: string) =>
      list((await ok(WORKFLOWS_ROUTES.list, token, {})).workflows, "list").map((row) =>
        text(record(row, "summary").title, "title"),
      );
    assert.ok((await titles(ownerToken)).includes("Gone"), "The owner lost the workflow of a deleted agent.");
    assert.ok(!(await titles(member)).includes("Gone"), "The member sees the workflow of a deleted agent.");
    await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: workflow.id });
    const hidden = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: workflow.id },
      404,
      "error.workflow.missing",
    );
    await ok(WORKFLOWS_ROUTES.delete, ownerToken, { workflowId: workflow.id });
    return { owner: 200, member: hidden, deleted: 200 };
  });

  await step("change: a save that adds the closed agent answers as missing and keeps the graph", async () => {
    const detail = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open });
    const revision = Number(detail.revision);
    const graph: WorkflowGraph = {
      ...agentGraph(open),
      nodes: [...agentGraph(open).nodes, { ...agentNode("closed", closed), at: at(900) }],
    };
    const status = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: revision, graph },
      404,
      "error.workflow.missing",
    );
    assert.equal((await runCauseEffect(current().workflows.get(ids.open))).revision, revision);
    return { status, revision };
  });

  await step("place output: only an owner or admin adds one or moves it; a member keeps it", async () => {
    const before = Number((await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open })).revision);
    const posting = withOutput(agentGraph(open), channelOutput("C-first"));
    const denied = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: before, graph: posting },
      403,
      "error.team.adminRequired",
    );
    const owner = await ok(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: ids.open,
      baseRevision: before,
      graph: posting,
    });
    assert.equal(owner.ok, true);
    const moved = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      {
        workflowId: ids.open,
        baseRevision: Number(owner.revision),
        graph: withOutput(agentGraph(open), channelOutput("C-second")),
      },
      403,
      "error.team.adminRequired",
    );
    // The member moves a node; the output and its place stay as they are.
    const kept: WorkflowGraph = {
      ...posting,
      nodes: posting.nodes.map((node) => ({ ...node, at: { x: node.at.x, y: 40 } })),
    };
    const saved = await ok(WORKFLOWS_ROUTES.saveGraph, member, {
      workflowId: ids.open,
      baseRevision: Number(owner.revision),
      graph: kept,
    });
    assert.equal(saved.ok, true);
    return { denied, owner: 200, moved, kept: 200 };
  });

  await step("restore: a version that names the closed agent answers as missing", async () => {
    const restored = await hostWorkflow("Restore", agentGraph(closed));
    const [version] = await runCauseEffect(current().workflows.versions(restored.id));
    assert.ok(version, "The first save made no version.");
    // Within five minutes of the version, so the open graph makes no second version.
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: restored.id,
        baseRevision: restored.revision,
        graph: agentGraph(open),
      }),
    );
    assert.ok(saved.ok);
    await ok(WORKFLOWS_ROUTES.get, member, { workflowId: restored.id });
    const status = await refused(
      WORKFLOWS_ROUTES.restoreVersion,
      member,
      { workflowId: restored.id, versionId: version.id },
      404,
      "error.workflow.missing",
    );
    const graph = (await runCauseEffect(current().workflows.get(restored.id))).graph;
    assert.ok(!JSON.stringify(graph).includes(closed), "The restore put the closed agent back.");
    return { status };
  });

  await step("version graph: a member reads an old version, but not one that names the closed agent", async () => {
    const first = await hostWorkflow("Versions", agentGraph(open));
    const versions = decodeRemoteWorkflowVersions(
      await ok(WORKFLOWS_ROUTES.versions, member, { workflowId: first.id }),
    );
    const [version] = versions;
    assert.ok(version, "The first save made no version.");
    const read = await ok(WORKFLOWS_ROUTES.versionGraph, member, { workflowId: first.id, versionId: version.id });
    assert.deepEqual(read.graph, agentGraph(open));
    const closedWorkflow = await hostWorkflow("Versions closed", agentGraph(closed));
    const [closedVersion] = await runCauseEffect(current().workflows.versions(closedWorkflow.id));
    assert.ok(closedVersion);
    // The owner takes the closed agent out; its old version still names it.
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: closedWorkflow.id,
        baseRevision: closedWorkflow.revision,
        graph: agentGraph(open),
      }),
    );
    assert.ok(saved.ok);
    const hidden = await refused(
      WORKFLOWS_ROUTES.versionGraph,
      member,
      { workflowId: closedWorkflow.id, versionId: closedVersion.id },
      404,
      "error.workflow.versionMissing",
    );
    const missing = await refused(
      WORKFLOWS_ROUTES.versionGraph,
      member,
      { workflowId: first.id, versionId: "no-such-version" },
      404,
      "error.workflow.versionMissing",
    );
    return { read: 200, hidden, missing };
  });

  await step("open values: unknown kinds and statuses cross, and the client shows them read-only", async () => {
    const detail = {
      summary: {
        id: "w",
        title: "Newer",
        steps: 2,
        updatedAt: "2026-10-25T00:00:00.000Z",
        lastRun: { status: "paused", at: "2026-10-25T00:00:00.000Z" },
      },
      graph: {
        nodes: [
          { ...promptNode, extra: "dropped" },
          {
            id: "video",
            kind: "video",
            at: at(300),
            fields: { prompt: "A cat." },
            schedule: { kind: "daily", time: "09:00" },
          },
        ],
        edges: [
          { id: "to-video", from: "prompt", to: "video", type: "text" },
          { id: "audio", from: "prompt", to: "video", type: "audio" },
        ],
        strokes: [],
      },
      revision: 3,
      triggers: [{ nodeId: "video", type: "chat", nextDueAt: null, webhookUrl: null }],
    };
    const shown = answer(WORKFLOWS_ROUTES.get, detail, decodeRemoteWorkflowDetail);
    assert.equal(shown.needsNewerApp, true);
    assert.equal(shown.summary.lastRun?.status, "stopped");
    assert.deepEqual(
      shown.graph.nodes.map(({ id, kind, locked }) => ({ id, kind, locked })),
      [
        { id: "prompt", kind: "prompt", locked: undefined },
        { id: "video", kind: "note", locked: true },
      ],
    );
    assert.equal(shown.graph.nodes[1]?.schedule, undefined);
    assert.equal(shown.graph.nodes[1]?.fields.prompt, "A cat.", "The placeholder lost the node's settings.");
    assert.deepEqual(shown.graph.edges, []);
    assert.equal(shown.triggers[0]?.type, "manual");
    const known = answer(
      WORKFLOWS_ROUTES.get,
      { ...detail, graph: { nodes: [promptNode], edges: [], strokes: [] } },
      decodeRemoteWorkflowDetail,
    );
    assert.equal(known.needsNewerApp, undefined, "A graph of known kinds was marked read-only.");
    const newerRun = {
      id: "r",
      workflowId: "w",
      number: 1,
      triggerNodeId: null,
      source: "chat",
      status: "paused",
      error: null,
      startedAt: "2026-10-25T00:00:00.000Z",
      endedAt: null,
    };
    const run = answer(
      WORKFLOWS_ROUTES.run,
      {
        run: newerRun,
        steps: [
          {
            id: "s",
            workflowId: "w",
            runId: "r",
            nodeId: "prompt",
            attempt: 1,
            agentId: null,
            status: "queued",
            output: null,
            branch: null,
            error: null,
            startedAt: null,
            endedAt: null,
          },
        ],
      },
      decodeRemoteWorkflowRunDetail,
    );
    assert.deepEqual([run.run.source, run.run.status, run.steps[0]?.status], ["manual", "stopped", "stopped"]);
    // A name that is not a short lowercase id is still malformed.
    assert.throws(() => answer(WORKFLOWS_ROUTES.get, { ...detail, revision: -1 }, decodeRemoteWorkflowDetail));
    assert.throws(() =>
      answer(
        WORKFLOWS_ROUTES.run,
        { run: { ...newerRun, status: "Not a name" }, steps: [] },
        decodeRemoteWorkflowRunDetail,
      ),
    );
    // This host does not know the kind, so its save refuses it after the codec passes it.
    const target = await hostWorkflow("Newer save", { nodes: [promptNode], edges: [], strokes: [] });
    const save = await wire(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: target.id,
      baseRevision: target.revision,
      graph: { nodes: [promptNode, { id: "video", kind: "video", at: at(300), fields: {} }], edges: [], strokes: [] },
    });
    assert.equal(save.status, 400, JSON.stringify(save.body));
    assert.throws(() => WORKFLOWS_CODECS.get(WORKFLOWS_ROUTES.runs)?.request({ workflowId: "w", limit: 0 }));
    assert.throws(() => WORKFLOWS_CODECS.get(WORKFLOWS_ROUTES.runs)?.request({ workflowId: "w", limit: 51 }));
    return { placeholder: "note, locked", edges: 0, run: "manual/stopped", save: save.status };
  });

  await step("webhook: the URL goes to the owner only, and only the owner makes a new secret", async () => {
    const graph: WorkflowGraph = {
      nodes: [{ id: "hook", kind: "trigger", at: at(0), fields: { trigger: "webhook" } }, agentNode("agent", open)],
      edges: [{ id: "edge", from: "hook", to: "agent", type: "text" }],
      strokes: [],
    };
    const hook = await hostWorkflow("Webhook", graph);
    const urlOf = (detail: JsonObject) =>
      record(
        list(detail.triggers, "triggers").find((row) => record(row, "trigger").nodeId === "hook"),
        "trigger",
      ).webhookUrl;
    assert.equal(urlOf(await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: hook.id })), WEBHOOK_URL);
    assert.equal(urlOf(await ok(WORKFLOWS_ROUTES.get, member, { workflowId: hook.id })), null);
    const rotate = { workflowId: hook.id, nodeId: "hook" };
    const denied = await refused(WORKFLOWS_ROUTES.rotateWebhookSecret, member, rotate, 403, "error.team.adminRequired");
    const rotated = await ok(WORKFLOWS_ROUTES.rotateWebhookSecret, ownerToken, rotate);
    assert.equal(rotated.secret, SECRET);
    return { ownerUrl: "shown", memberUrl: null, memberRotate: denied, ownerRotate: 200 };
  });

  await step("run: a member's run crosses with its step output clipped to the wire limit", async () => {
    const started = await ok(WORKFLOWS_ROUTES.startRun, member, { workflowId: ids.open, requestId: requestId() });
    const runId = text(record(started.run, "run").id, "run id");
    const local = await settled(runId, "agent");
    assert.equal(local.output?.length, LONG_ANSWER.length);
    const read = await ok(WORKFLOWS_ROUTES.run, member, { runId });
    const agentStep = record(
      list(read.steps, "steps").find((row) => record(row, "step").nodeId === "agent"),
      "agent step",
    );
    assert.equal(text(agentStep.output, "output").length, WORKFLOW_STEP_TEXT_LIMIT);
    return { hostOutput: local.output?.length, wireOutput: WORKFLOW_STEP_TEXT_LIMIT };
  });

  await step("hidden now: a step of an agent that is hidden later does not cross", async () => {
    const workflow = await hostWorkflow("Later", agentGraph(later));
    const { run } = await runCauseEffect(
      current().workflows.startRun({ workflowId: workflow.id, requestId: requestId() }),
    );
    const ended = await settled(run.id, "agent");
    assert.equal(ended.status, "failed");
    assert.ok(ended.error);
    // The owner takes the agent out of the workflow and then closes it.
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: workflow.id,
        baseRevision: workflow.revision,
        graph: { nodes: [promptNode], edges: [], strokes: [] },
      }),
    );
    assert.ok(saved.ok);
    await setLevels(ownerToken, { [closed]: "none", [viewer]: "view", [chatter]: "chat", [later]: "none" });
    const nodesOf = (detail: JsonObject) =>
      list(detail.steps, "steps")
        .map((row) => text(record(row, "step").nodeId, "node id"))
        .sort();
    const mine = nodesOf(await ok(WORKFLOWS_ROUTES.run, member, { runId: run.id }));
    assert.deepEqual(mine, ["prompt"], "The member got the step of a hidden agent.");
    const ownerRead = await ok(WORKFLOWS_ROUTES.run, ownerToken, { runId: run.id });
    assert.deepEqual(nodesOf(ownerRead), ["agent", "prompt"]);
    const ownerStep = record(
      list(ownerRead.steps, "steps").find((row) => record(row, "step").nodeId === "agent"),
      "agent step",
    );
    assert.equal(ownerStep.error, ended.error, "The owner lost the step error.");
    const page = await ok(WORKFLOWS_ROUTES.runs, member, { workflowId: workflow.id, limit: 10 });
    assert.deepEqual(nodesOf(record(list(page.runs, "runs")[0], "run")), ["prompt"]);
    // The current graph has no agent now, but a retry runs the old run's graph and its agent.
    const retry = await refused(
      WORKFLOWS_ROUTES.retryStep,
      member,
      { stepId: ended.id, requestId: requestId() },
      404,
      "error.workflow.stepMissing",
    );
    const stop = await refused(WORKFLOWS_ROUTES.stopRun, member, { runId: run.id }, 404, "error.workflow.runMissing");
    return { member: mine, owner: ["agent", "prompt"], retry, stop };
  });

  await step("provider: a model step on a local-only provider answers as missing to a peer", async () => {
    const local = await hostWorkflow("Local model", {
      nodes: [
        promptNode,
        { id: "llm", kind: "llm", at: at(300), fields: { provider: "inception", model: "mercury", text: "Sum up." } },
      ],
      edges: [{ id: "edge", from: "prompt", to: "llm", type: "text" }],
      strokes: [],
    });
    const status = await refused(WORKFLOWS_ROUTES.get, member, { workflowId: local.id }, 404, "error.workflow.missing");
    const titles = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list").map((row) =>
      text(record(row, "summary").title, "title"),
    );
    assert.ok(!titles.includes("Local model"), "The member list has a workflow of a local-only provider.");
    // A local-only provider crosses to no peer, so the owner on another computer gets 404 as well.
    const remoteOwner = await refused(
      WORKFLOWS_ROUTES.get,
      ownerToken,
      { workflowId: local.id },
      404,
      "error.workflow.missing",
    );
    const llm = (await runCauseEffect(current().workflows.get(local.id))).graph.nodes.find((node) => node.id === "llm");
    assert.equal(llm?.fields.provider, "inception", "The host lost the model step settings.");
    return { member: status, remoteOwner, host: "settings kept" };
  });

  await step("event: a rename reaches the member's socket as workflows-changed", async () => {
    const socket = await openEvents(member);
    const changed = nextMessage(socket, (value) => {
      const event = workflowsEvent(value);
      return event && event.workflowId === ids.open ? event : null;
    });
    await ok(WORKFLOWS_ROUTES.rename, ownerToken, { workflowId: ids.open, title: "Open renamed" });
    return await changed;
  });

  await step("size: a workflow too large for one frame answers 413 with its own sentence", async () => {
    const nodes: WorkflowNode[] = Array.from({ length: 100 }, (_, index) => ({
      id: `text-${index}`,
      kind: "text",
      at: { x: index * 10, y: 0 },
      fields: { text: "b".repeat(20_000) },
    }));
    const huge = await hostWorkflow("Huge", { nodes, edges: [], strokes: [] });
    const status = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: huge.id },
      413,
      "error.workflow.tooLargeToSend",
    );
    const titles = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list").map((row) =>
      text(record(row, "summary").title, "title"),
    );
    assert.ok(titles.includes("Huge"), "The list left out a large workflow.");
    return { status };
  });

  await step("delete: the member deletes a workflow they can use", async () => {
    await ok(WORKFLOWS_ROUTES.delete, member, { workflowId: ids.open });
    const missing = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: ids.open },
      404,
      "error.workflow.missing",
    );
    return { deleted: 200, after: missing };
  });

  report.passed = true;
} finally {
  for (const socket of sockets) socket.close();
  await stopHost();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
}
