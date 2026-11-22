import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentAccessChange,
  decodeWorkflowFoldersSnapshot,
  WORKFLOW_FOLDER_LIMITS,
  type WorkflowFolderAction,
  type WorkflowFoldersSnapshot,
  type WorkflowGraph,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_ACCESS_CODECS, AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import { teamCapabilitiesForProtocol, teamCapabilityHeaders } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import {
  WORKFLOW_FOLDERS_CAPABILITY,
  WORKFLOW_FOLDERS_CODECS,
  WORKFLOW_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
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
import { WORKFLOW_FOLDERS_FILE, WorkflowFoldersStore } from "../src/backend/workflow-folders-store";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { WorkflowFoldersService } from "../src/main/workflow-folders-service";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-folders-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;

plugin({
  name: "workflow-folders-electron-boundary",
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
    "WebRTC: the clients use HTTP and the event socket, not a WebRTC data channel.",
    "The desktop and web client screens: this check drives the host routes only.",
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

function storedFile(path: string) {
  const file = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isDynamicRecord(file), `${path} is not an object.`);
  return file;
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
  answerHttpSignIn: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-workflow-folders-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const foldersPath = join(userData, WORKFLOW_FOLDERS_FILE);

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

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
  const folders = new WorkflowFoldersStore(foldersPath);
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(folders.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const workflows = await Effect.runPromise(
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
      changed: (workflowId) => agents.notifyWorkflowsChanged(workflowId),
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  folders.onChanged(() => agents.notifyWorkflowFoldersChanged());
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
      rotateWorkflowSecret: () => Effect.die(new Error("No webhook secret rotates in this check.")),
    },
    workflowFolders: new WorkflowFoldersService({ store: folders, workflows }),
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, workflows, server, team, port };
}

async function stopHost(): Promise<void> {
  for (const socket of sockets.splice(0)) socket.close();
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

async function call(
  path: string,
  input: { token?: string; body?: unknown; protocol?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const protocol = input.protocol ?? TEAM_PROTOCOL_V10;
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    ...teamCapabilityHeaders(protocol, teamCapabilitiesForProtocol(protocol)),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method: "POST",
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function wire(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = WORKFLOW_FOLDERS_CODECS.get(path);
  assert.ok(codec, `No workflow-folders-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call(path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

async function read(token: string): Promise<WorkflowFoldersSnapshot> {
  const response = await wire(WORKFLOW_FOLDERS_ROUTES.read, token, {});
  assert.equal(response.status, 200, `The read returned ${response.status}: ${JSON.stringify(response.body)}`);
  return decodeWorkflowFoldersSnapshot(response.body);
}

async function act(token: string, action: WorkflowFolderAction): Promise<WorkflowFoldersSnapshot> {
  const response = await wire(WORKFLOW_FOLDERS_ROUTES.actions, token, action);
  assert.equal(response.status, 200, `${action.type} returned ${response.status}: ${JSON.stringify(response.body)}`);
  return decodeWorkflowFoldersSnapshot(response.body);
}

async function refused(token: string, body: unknown, status: number, message: string) {
  const response = await call(WORKFLOW_FOLDERS_ROUTES.actions, { token, body });
  assert.equal(response.status, status, `The action returned ${response.status}: ${JSON.stringify(response.body)}`);
  assert.ok(JSON.stringify(response.body).includes(message), JSON.stringify(response.body));
  return { status: response.status, body: response.body };
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call(TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  assert.ok(isDynamicRecord(response.body) && typeof response.body.sessionToken === "string", "No session token.");
  return response.body.sessionToken;
}

async function setLevels(ownerToken: string, everyone: AgentAccessChange["everyone"]) {
  const codec = AGENT_ACCESS_CODECS.get(AGENT_ACCESS_ROUTES.set);
  assert.ok(codec);
  const body: AgentAccessChange = { revision: 0, everyone, roles: [] };
  codec.request(body);
  const response = await call(AGENT_ACCESS_ROUTES.set, { token: ownerToken, body });
  assert.equal(response.status, 200, `Saving the roles returned ${response.status}.`);
}

interface EventSocket {
  socket: WebSocket;
  types: string[];
  next(types: readonly string[]): Promise<string>;
}

async function openEvents(token: string, capabilities: readonly string[]): Promise<EventSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  const types: string[] = [];
  const waiting = new Set<(type: string) => void>();
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (!isDynamicRecord(value) || typeof value.type !== "string") return;
    types.push(value.type);
    for (const listener of waiting) listener(value.type);
  });
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  const next = (wanted: readonly string[]) =>
    new Promise<string>((resolveType, reject) => {
      const listener = (type: string) => {
        if (!wanted.includes(type)) return;
        waiting.delete(listener);
        resolveType(type);
      };
      waiting.add(listener);
      socket.addEventListener("close", (event) => reject(new Error(`The event socket closed: ${event.code}.`)), {
        once: true,
      });
    });
  const snapshot = next(["runtime-snapshot"]);
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: ["agent-runtime-snapshots", ...capabilities],
    }),
  );
  await snapshot;
  return { socket, types, next };
}

const agentGraph = (agentId: string | null): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Start." } },
    ...(agentId
      ? [{ id: "agent", kind: "agent" as const, at: { x: 300, y: 0 }, fields: { agentId, text: "Hi." } }]
      : []),
  ],
  edges: agentId ? [{ id: "edge", from: "prompt", to: "agent", type: "text" as const }] : [],
  strokes: [],
});

async function hostWorkflow(title: string, agentId: string | null): Promise<string> {
  const { workflows } = current();
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph: agentGraph(agentId) }),
  );
  assert.ok(saved.ok, `Saving ${title} conflicted.`);
  return created.summary.id;
}

try {
  host = await startHost();
  const ownerToken = await login(OWNER);

  const setup = await step(
    "setup: an owner, a member, agents at manage, none and view, and four workflows",
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
      const invite = await runCauseEffect(team.createInvite("member"));
      const joined = await call(TEAM_API_ROUTES.join.server, { body: { inviteToken: invite.token, ...MEMBER } });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      await setLevels(ownerToken, { [closed]: "none", [viewer]: "view" });
      return {
        workflows: {
          open: await hostWorkflow("Open flow", open),
          closed: await hostWorkflow("Closed flow", closed),
          viewer: await hostWorkflow("Viewer flow", viewer),
          plain: await hostWorkflow("Plain flow", null),
        },
      };
    },
  );
  const ids = setup.workflows;
  const memberToken = await login(MEMBER);

  await step("read: a new host has no folders at revision 0", async () => {
    const empty = await read(ownerToken);
    assert.deepEqual(empty, { revision: 0, folders: [], placement: {} });
    return empty;
  });

  const ownerEvents = await openEvents(ownerToken, [WORKFLOWS_CAPABILITY, WORKFLOW_FOLDERS_CAPABILITY]);
  const oldEvents = await openEvents(ownerToken, [WORKFLOWS_CAPABILITY]);
  const memberEvents = await openEvents(memberToken, [WORKFLOWS_CAPABILITY, WORKFLOW_FOLDERS_CAPABILITY]);

  const created = await step("create: the owner makes a folder with two workflows; the revision goes up", async () => {
    const event = ownerEvents.next(["workflow-folders-changed"]);
    const memberEvent = memberEvents.next(["workflow-folders-changed"]);
    const snapshot = await act(ownerToken, {
      type: "create",
      id: "folder-a",
      name: "Launch",
      workflowIds: [ids.open, ids.closed],
    });
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(snapshot.folders, [{ id: "folder-a", name: "Launch" }]);
    assert.deepEqual(snapshot.placement, { [ids.open]: "folder-a", [ids.closed]: "folder-a" });
    assert.equal(await event, "workflow-folders-changed");
    assert.equal(await memberEvent, "workflow-folders-changed");
    return snapshot;
  });

  await step("event: a client without the capability gets no workflow-folders-changed event", async () => {
    const next = oldEvents.next(["workflow-folders-changed", "workflows-changed"]);
    await runCauseEffect(current().workflows.rename({ workflowId: ids.plain, title: "Plain flow 2" }));
    assert.equal(await next, "workflows-changed");
    assert.ok(!oldEvents.types.includes("workflow-folders-changed"), JSON.stringify(oldEvents.types));
    return oldEvents.types.filter((type) => type !== "runtime-snapshot");
  });

  await step("read: the member sees the folders and the placement of workflows that it can see", async () => {
    const snapshot = await read(memberToken);
    assert.equal(snapshot.revision, created.revision);
    assert.deepEqual(snapshot.folders, created.folders);
    assert.deepEqual(snapshot.placement, { [ids.open]: "folder-a" });
    const owner = await read(ownerToken);
    assert.equal(Object.keys(owner.placement).length, 2);
    return { member: snapshot.placement, owner: owner.placement };
  });

  await step(
    "rename and create: a member changes its own folder, not a folder with a workflow that it cannot see",
    async () => {
      const hidden = await refused(
        memberToken,
        { type: "rename", folderId: "folder-a", name: "Launch 2" },
        404,
        sourceText("error.workflow.missing"),
      );
      const event = ownerEvents.next(["workflow-folders-changed"]);
      const added = await act(memberToken, { type: "create", id: "folder-b", name: "Idea" });
      assert.equal(added.revision, 2);
      await event;
      const renamed = await act(memberToken, { type: "rename", folderId: "folder-b", name: "Ideas" });
      assert.equal(renamed.revision, 3);
      assert.deepEqual(renamed.folders, [
        { id: "folder-a", name: "Launch" },
        { id: "folder-b", name: "Ideas" },
      ]);
      return { hidden: hidden.status, folders: renamed.folders };
    },
  );

  await step("place: the member moves a workflow without agents into a folder", async () => {
    const snapshot = await act(memberToken, { type: "place", workflowIds: [ids.plain], folderId: "folder-b" });
    assert.equal(snapshot.revision, 4);
    assert.equal(snapshot.placement[ids.plain], "folder-b");
    const again = await act(memberToken, { type: "place", workflowIds: [ids.plain], folderId: "folder-b" });
    assert.equal(again.revision, 4, "An action with no change must keep the revision.");
    return { revision: again.revision, placement: again.placement };
  });

  await step("manage: the member cannot place a workflow of an agent that it can only view", async () => {
    const viewOnly = await refused(
      memberToken,
      { type: "place", workflowIds: [ids.viewer], folderId: "folder-b" },
      403,
      sourceText("error.team.agentManageDenied"),
    );
    const createWith = await refused(
      memberToken,
      { type: "create", id: "folder-c", name: "Mine", workflowIds: [ids.viewer] },
      403,
      sourceText("error.team.agentManageDenied"),
    );
    const hidden = await refused(
      memberToken,
      { type: "place", workflowIds: [ids.closed], folderId: null },
      404,
      sourceText("error.workflow.missing"),
    );
    assert.equal((await read(ownerToken)).revision, 4);
    return { viewOnly: viewOnly.status, createWith: createWith.status, hidden: hidden.status };
  });

  await step("refusals: unknown workflow, unknown folder, bad name and extra keys", async () => {
    const unknownWorkflow = await refused(
      ownerToken,
      { type: "place", workflowIds: ["missing-workflow"], folderId: "folder-a" },
      404,
      sourceText("error.workflow.missing"),
    );
    const unknownFolder = await refused(
      ownerToken,
      { type: "rename", folderId: "missing-folder", name: "X" },
      404,
      sourceText("error.backend.libraryFolderGone"),
    );
    const placeUnknownFolder = await refused(
      ownerToken,
      { type: "place", workflowIds: [ids.open], folderId: "missing-folder" },
      404,
      sourceText("error.backend.libraryFolderGone"),
    );
    const blank = await refused(
      ownerToken,
      { type: "rename", folderId: "folder-a", name: "   " },
      400,
      sourceText("error.backend.libraryFolderName", { limit: WORKFLOW_FOLDER_LIMITS.name }),
    );
    const extra = await refused(ownerToken, { type: "delete", folderId: "folder-a", extra: true }, 400, "");
    assert.equal((await read(ownerToken)).revision, 4);
    return {
      unknownWorkflow: unknownWorkflow.status,
      unknownFolder: unknownFolder.status,
      placeUnknownFolder: placeUnknownFolder.status,
      blank: blank.status,
      extra: extra.status,
    };
  });

  await step("place null: the owner takes a workflow out of its folder", async () => {
    const snapshot = await act(ownerToken, { type: "place", workflowIds: [ids.closed], folderId: null });
    assert.equal(snapshot.revision, 5);
    assert.equal(snapshot.placement[ids.closed], undefined);
    return snapshot.placement;
  });

  await step("delete: the folder and its placements go; the workflows stay", async () => {
    const snapshot = await act(ownerToken, { type: "delete", folderId: "folder-a" });
    assert.equal(snapshot.revision, 6);
    assert.deepEqual(
      snapshot.folders.map((folder) => folder.id),
      ["folder-b"],
    );
    assert.equal(snapshot.placement[ids.open], undefined);
    const listed = await runCauseEffect(current().workflows.list());
    assert.ok(listed.some((summary) => summary.id === ids.open));
    return snapshot;
  });

  await step("prune: a deleted workflow leaves the placement on the next read", async () => {
    const deleted = await call(WORKFLOWS_ROUTES.delete, { token: ownerToken, body: { workflowId: ids.plain } });
    assert.equal(deleted.status, 200, `The delete returned ${deleted.status}.`);
    const snapshot = await read(ownerToken);
    assert.equal(snapshot.placement[ids.plain], undefined);
    assert.equal(snapshot.revision, 6);
    return snapshot;
  });

  await step("hidden folder: a member does not see or delete a folder of workflows that it cannot see", async () => {
    const made = await act(ownerToken, { type: "create", id: "folder-h", name: "Private", workflowIds: [ids.closed] });
    assert.equal(made.revision, 7);
    const member = await read(memberToken);
    assert.deepEqual(
      member.folders.map((folder) => folder.id),
      ["folder-b"],
    );
    assert.equal(member.placement[ids.closed], undefined);
    const deleted = await refused(
      memberToken,
      { type: "delete", folderId: "folder-h" },
      404,
      sourceText("error.workflow.missing"),
    );
    const owner = await read(ownerToken);
    assert.equal(owner.revision, 7);
    assert.ok(owner.folders.some((folder) => folder.id === "folder-h"));
    return { member: member.folders, deleted: deleted.status };
  });

  await step("old client: a client without the capability gets an update-required refusal", async () => {
    const response = await call(WORKFLOW_FOLDERS_ROUTES.read, {
      token: ownerToken,
      body: {},
      protocol: TEAM_PROTOCOL_V9,
    });
    assert.equal(response.status, 400);
    assert.ok(JSON.stringify(response.body).includes(sourceText("error.team.workflowFoldersUnsupported")));
    return response.status;
  });

  const beforeRestart = await read(ownerToken);
  await step("persistence: the folders are the same after the store opens again", async () => {
    await stopHost();
    host = await startHost();
    const token = await login(OWNER);
    const snapshot = await read(token);
    assert.deepEqual(snapshot, beforeRestart);
    const file = storedFile(foldersPath);
    assert.equal(file.version, 1);
    return { snapshot, version: file.version };
  });

  await step("corrupt file: the host sets it aside and starts with no folders", async () => {
    await stopHost();
    writeFileSync(foldersPath, "{ not json");
    host = await startHost();
    const token = await login(OWNER);
    const snapshot = await read(token);
    assert.deepEqual(snapshot, { revision: 0, folders: [], placement: {} });
    const aside = readdirSync(userData).filter((name) => name.startsWith(`${WORKFLOW_FOLDERS_FILE}.corrupt-`));
    assert.equal(aside.length, 1, JSON.stringify(readdirSync(userData)));
    assert.equal(readFileSync(join(userData, aside[0] ?? ""), "utf8"), "{ not json");
    return { aside };
  });

  await step("file without a version: the host sets it aside as damaged", async () => {
    await stopHost();
    writeFileSync(foldersPath, JSON.stringify({ revision: 3, folders: [{ id: "old", name: "Old" }], placement: {} }));
    host = await startHost();
    const token = await login(OWNER);
    const snapshot = await read(token);
    assert.deepEqual(snapshot, { revision: 0, folders: [], placement: {} });
    return snapshot;
  });

  await step("newer file: the host keeps it and writes to a separate file", async () => {
    await stopHost();
    const newer = JSON.stringify({ version: 2, revision: 9, folders: [], placement: {}, future: true });
    writeFileSync(foldersPath, newer);
    host = await startHost();
    const token = await login(OWNER);
    assert.equal((await read(token)).revision, 0);
    const snapshot = await act(token, { type: "create", id: "folder-new", name: "After downgrade" });
    assert.equal(snapshot.revision, 1);
    assert.equal(readFileSync(foldersPath, "utf8"), newer);
    const fallback = `${foldersPath}.v1`;
    assert.ok(existsSync(fallback), "No fallback file.");
    const written = storedFile(fallback);
    assert.equal(written.version, 1);
    assert.equal(written.revision, 1);
    return { fallback: written };
  });

  report.passed = true;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await stopHost();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"}: ${join(OUT, "report.json")}\n`);
}
