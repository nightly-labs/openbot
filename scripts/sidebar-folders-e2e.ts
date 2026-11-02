// Checks sidebar folders through the frozen sidebar-folders-v1 Team API contract. First a store on a
// temporary profile loads a layout file that an older version damaged, and keeps every folder. Then a
// real `TeamApiServer` runs on loopback with the real team, agent, access and sidebar stores. A member
// sends what a current desktop client sends, and the frozen codec reads each request and reply. A
// socket with the capability must get `sidebar-folders-changed` with the parents; a socket without it
// must get `sidebar-layout-changed` without them, as the released route answers too.
// The agent service is not initialized, so no provider CLI starts.
// Run: `bun scripts/sidebar-folders-e2e.ts`.
// Writes .openbot-build/sidebar-folders-e2e/report.json.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SIDEBAR_FOLDER_LEVELS,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import {
  SIDEBAR_FOLDERS_CODECS,
  SIDEBAR_FOLDERS_ROUTES,
  sidebarFoldersEvent,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/sidebar-folders-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "sidebar-folders-electron-boundary",
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
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");

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
    "The desktop and iPhone sidebars. This check drives the host contract only; the Sidebar stories show the desktop tree.",
    "Instance transfer. Its export file has no field for the parents, so a moved instance gets its folders at the top level.",
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

const root = await mkdtemp(join(tmpdir(), "openbot-sidebar-folders-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  access: InstanceType<typeof AgentAccessStore>;
  sidebar: SidebarLayoutStore;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
}

let host: Host | null = null;
const sockets: WebSocket[] = [];

/** Starts the host on the profile, as the app does at each launch. */
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
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
    agentAccess: access,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, access, sidebar, server, team, port };
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

/** One request from a desktop client of `protocol`, which sends the capabilities of that protocol. */
async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; protocol?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const protocol = input.protocol ?? TEAM_PROTOCOL_V9;
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(protocol).join(","),
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

/** A sidebar-folders-v1 request through the frozen codec, in both directions. */
async function folders(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = SIDEBAR_FOLDERS_CODECS.get(path);
  assert.ok(codec, `No sidebar-folders-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

/** An action that the host must accept. Returns the layout it answers. */
async function act(token: string, action: JsonObject): Promise<SidebarLayoutSnapshot> {
  const response = await folders(SIDEBAR_FOLDERS_ROUTES.actions, token, action);
  assert.equal(
    response.status,
    200,
    `${String(action.type)} returned ${response.status}: ${JSON.stringify(response.body)}.`,
  );
  return layoutOf(response.body);
}

/** An action that the host must refuse. The layout must stay as it was. */
async function refuse(token: string, action: JsonObject, reason: string): Promise<{ status: number; error: string }> {
  const before = current().sidebar.getSnapshot();
  const response = await folders(SIDEBAR_FOLDERS_ROUTES.actions, token, action);
  assert.ok(response.status >= 400, `${reason}: the host accepted it.`);
  assert.deepEqual(current().sidebar.getSnapshot(), before, `${reason}: the refused action changed the layout.`);
  const error = text(record(response.body, "refusal").error, "refusal text");
  if (response.status >= 500)
    report.findings.push(
      `${reason}: answers ${response.status} with "${error}". The released /v1/sidebar-layout/actions route answers its own refusals the same way.`,
    );
  return { status: response.status, error };
}

function layoutOf(body: unknown): SidebarLayoutSnapshot {
  const decoded = sidebarFoldersEvent({ type: "sidebar-folders-changed", layout: body });
  assert.ok(decoded, "The layout does not decode.");
  return decoded.layout;
}

function parentOf(layout: SidebarLayoutSnapshot, sectionId: string): string | undefined {
  return layout.sections.find((section) => section.id === sectionId)?.parentId;
}

function sectionIdNamed(layout: SidebarLayoutSnapshot, name: string): string {
  const section = layout.sections.find((candidate) => candidate.name === name);
  assert.ok(section, `No folder named ${name}.`);
  return section.id;
}

/** Each folder comes after its parent in `order`, and its folders come before the next sibling. */
function assertTreeOrder(layout: SidebarLayoutSnapshot): void {
  const parents = new Map(
    layout.sections.flatMap((section) => (section.parentId ? [[section.id, section.parentId]] : [])),
  );
  for (const [childId, parentId] of parents) {
    const child = layout.order.indexOf(childId);
    const parent = layout.order.indexOf(parentId);
    assert.ok(parent >= 0 && parent < child, `${childId} is not after its parent in the order.`);
    // Everything between the parent and the child is inside the parent.
    for (const between of layout.order.slice(parent + 1, child)) {
      let ancestor = parents.get(between);
      while (ancestor && ancestor !== parentId) ancestor = parents.get(ancestor);
      assert.equal(ancestor, parentId, `${between} is between ${parentId} and its folder ${childId}.`);
    }
  }
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

/** A member's event socket. It records each message, so a step can check what did not arrive. */
interface EventSocket {
  socket: WebSocket;
  received: unknown[];
}

/** Opens an event socket that declares the capabilities of `protocol`, and waits for its first snapshot. */
async function openEvents(token: string, protocol: number): Promise<EventSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  const received: unknown[] = [];
  socket.addEventListener("message", (event) => received.push(JSON.parse(String(event.data))));
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
      capabilities: ["agent-runtime-snapshots", ...teamCapabilitiesForProtocol(protocol)],
    }),
  );
  await snapshot;
  return { socket, received };
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

/** The first `sidebar-folders-changed` whose layout has a folder named `name`. */
function foldersEventWith(events: EventSocket, name: string) {
  return nextMessage(events.socket, (value) => {
    const event = sidebarFoldersEvent(value);
    return event?.layout.sections.some((section) => section.name === name) ? event : null;
  });
}

/** The first `sidebar-layout-changed` whose layout has a folder named `name`. */
function legacyEventWith(events: EventSocket, name: string) {
  return nextMessage(events.socket, (value) => {
    if (!isRecord(value) || value.type !== "sidebar-layout-changed") return null;
    const layout = record(value.layout, "legacy layout");
    return sectionsOf(layout).some((section) => section.name === name) ? layout : null;
  });
}

function sectionsOf(layout: JsonObject): JsonObject[] {
  assert.ok(Array.isArray(layout.sections), "The layout has no sections.");
  return layout.sections.map((section) => record(section, "section"));
}

try {
  await step("store: a file that an older version edited loads with every folder and chat", async () => {
    const path = join(root, "damaged", "sidebar-layout.json");
    const [top, orphan, loopA, loopB, kept] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const agentId = randomUUID();
    mkdirSync(join(root, "damaged"), { recursive: true });
    // An older version keeps `parentId` but does not maintain it: a deleted parent, and a loop.
    const file = {
      version: 2,
      revision: 7,
      sections: [
        { id: kept, name: "Kept", parentId: top },
        { id: top, name: "Top" },
        { id: orphan, name: "Orphan", parentId: randomUUID() },
        { id: loopA, name: "Loop A", parentId: loopB },
        { id: loopB, name: "Loop B", parentId: loopA },
      ],
      order: [SIDEBAR_PEOPLE_SECTION_ID, kept, orphan, loopA, top, loopB, SIDEBAR_UNASSIGNED_SECTION_ID],
      agentAssignments: { [agentId]: loopA },
      agentOrder: [agentId],
    };
    writeFileSync(path, JSON.stringify(file));
    const store = new SidebarLayoutStore(path);
    await runCauseEffect(store.initialize());
    const loaded = store.getSnapshot();
    assert.equal(loaded.revision, 7, "The file was reset.");
    assert.deepEqual(
      loaded.sections.map((section) => section.id).sort(),
      [top, orphan, loopA, loopB, kept].sort(),
      "A folder was lost.",
    );
    assert.equal(loaded.agentAssignments[agentId], loopA, "A chat lost its folder.");
    assert.equal(parentOf(loaded, kept), top, "A valid parent was dropped.");
    assert.equal(parentOf(loaded, orphan), undefined, "A folder kept a parent that does not exist.");
    assert.ok(
      parentOf(loaded, loopA) === undefined || parentOf(loaded, loopB) === undefined,
      "The loop is still in the layout.",
    );
    assertTreeOrder(loaded);
    // The file is written again only on a change, so the damaged file stays as the user left it.
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), file, "Loading rewrote the file.");
    return { order: loaded.order.length, sections: loaded.sections.length };
  });

  host = await startHost();

  const setup = await step(
    "setup: an owner, a member with two event sockets, and two agents",
    async () => {
      const { agents } = current();
      const create = (name: string, avatarSeed: string) =>
        runCauseEffect(agents.createAgentProfile({ name, description: "Sidebar check.", avatarSeed, avatarHue: null }));
      const shown = await create("Planner", "shown");
      const closed = await create("Ledger", "closed");
      const invite = await runCauseEffect(current().team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      const serverId = current().team.getIdentity()?.serverId;
      assert.ok(serverId, "The host has no server id.");
      const all = new Set([shown.id, closed.id]);
      // The member cannot see `Ledger`, so the sidebar must refuse to place it for them.
      await Effect.runPromise(
        current().access.set(serverId, { revision: 0, everyone: { [closed.id]: "none" }, roles: [] }, all, all, null),
      );
      const memberToken = await login(MEMBER);
      return { shownId: shown.id, closedId: closed.id, memberToken };
    },
    ({ shownId, closedId }) => ({ shownId, closedId }),
  );
  const capable = await openEvents(setup.memberToken, TEAM_PROTOCOL_V9);
  const legacy = await openEvents(setup.memberToken, TEAM_PROTOCOL_V7);

  await step("gate: a client without sidebar-folders-v1 gets 400 and changes nothing", async () => {
    const before = current().sidebar.getSnapshot();
    for (const path of Object.values(SIDEBAR_FOLDERS_ROUTES)) {
      const body = path === SIDEBAR_FOLDERS_ROUTES.read ? {} : { type: "create", name: "Gate" };
      const response = await call("POST", path, { token: setup.memberToken, body, protocol: TEAM_PROTOCOL_V7 });
      assert.equal(response.status, 400, `${path} returned ${response.status}.`);
      assert.equal(record(response.body, "refusal").error, sourceText("error.team.sidebarFoldersUnsupported"));
    }
    assert.deepEqual(current().sidebar.getSnapshot(), before);
    return { status: 400 };
  });

  const tree = await step("member: three levels of folders, with each event on both sockets", async () => {
    const clients = sectionIdNamed(await act(setup.memberToken, { type: "create", name: "Clients" }), "Clients");
    const acme = sectionIdNamed(
      await act(setup.memberToken, { type: "create", name: "Acme Robotics", parentId: clients }),
      "Acme Robotics",
    );
    const launchEvent = foldersEventWith(capable, "Launch");
    const legacyLaunch = legacyEventWith(legacy, "Launch");
    const layout = await act(setup.memberToken, {
      type: "create",
      name: "Launch",
      parentId: acme,
      agentId: setup.shownId,
    });
    const launch = sectionIdNamed(layout, "Launch");
    const internal = sectionIdNamed(await act(setup.memberToken, { type: "create", name: "Internal" }), "Internal");
    assert.equal(parentOf(layout, acme), clients);
    assert.equal(parentOf(layout, launch), acme);
    assert.equal(layout.agentAssignments[setup.shownId], launch);
    const pushed = await launchEvent;
    assert.equal(parentOf(pushed.layout, launch), acme, "The capable socket did not get the parents.");
    const legacySections = sectionsOf(await legacyLaunch);
    assert.ok(
      legacySections.every((section) => !("parentId" in section)),
      "The socket without the capability got parentId.",
    );
    const read = await folders(SIDEBAR_FOLDERS_ROUTES.read, setup.memberToken, {});
    assert.equal(read.status, 200);
    const stored = layoutOf(read.body);
    assertTreeOrder(stored);
    assert.ok(stored.order.indexOf(launch) < stored.order.indexOf(internal), "A nested folder is not in tree order.");
    return { clients, acme, launch, internal };
  });

  await step("member: the host refuses a fourth level, a loop and a sibling in another folder", async () => {
    const tooDeep = await refuse(
      setup.memberToken,
      { type: "create", name: "Fourth", parentId: tree.launch },
      `create below level ${SIDEBAR_FOLDER_LEVELS}`,
    );
    const loop = await refuse(
      setup.memberToken,
      { type: "nest", sectionId: tree.clients, parentId: tree.acme, beforeSectionId: null },
      "nest a folder into its own folder",
    );
    const deepMove = await refuse(
      setup.memberToken,
      { type: "nest", sectionId: tree.clients, parentId: tree.internal, beforeSectionId: null },
      "nest a folder whose folders would go below the last level",
    );
    const otherFolder = await refuse(
      setup.memberToken,
      { type: "nest", sectionId: tree.internal, parentId: null, beforeSectionId: tree.launch },
      "nest before a folder of another parent",
    );
    return { tooDeep, loop, deepMove, otherFolder };
  });

  await step("member: an agent that the member cannot see gives 404 and changes nothing", async () => {
    const before = current().sidebar.getSnapshot();
    for (const action of [
      { type: "assign", agentId: setup.closedId, sectionId: tree.internal },
      { type: "create", name: "Hidden", agentId: setup.closedId },
      { type: "move-agent", agentId: setup.shownId, sectionId: tree.internal, beforeAgentId: setup.closedId },
    ]) {
      const response = await folders(SIDEBAR_FOLDERS_ROUTES.actions, setup.memberToken, action);
      assert.equal(response.status, 404, `${action.type} returned ${response.status}.`);
      assert.equal(record(response.body, "refusal").error, sourceText("error.team.agentNotFound"));
    }
    assert.deepEqual(current().sidebar.getSnapshot(), before);
    return { status: 404 };
  });

  await step("member: nest moves a folder with its folders, and back to the top", async () => {
    let layout = await act(setup.memberToken, {
      type: "nest",
      sectionId: tree.internal,
      parentId: tree.clients,
      beforeSectionId: tree.acme,
    });
    assert.equal(parentOf(layout, tree.internal), tree.clients);
    assert.ok(layout.order.indexOf(tree.internal) < layout.order.indexOf(tree.acme), "beforeSectionId was not kept.");
    assertTreeOrder(layout);
    layout = await act(setup.memberToken, {
      type: "nest",
      sectionId: tree.acme,
      parentId: null,
      beforeSectionId: null,
    });
    assert.equal(parentOf(layout, tree.acme), undefined);
    assert.equal(parentOf(layout, tree.launch), tree.acme, "The folder lost its own folder.");
    assert.equal(layout.agentAssignments[setup.shownId], tree.launch, "A chat moved out of its folder.");
    assertTreeOrder(layout);
    layout = await act(setup.memberToken, {
      type: "nest",
      sectionId: tree.acme,
      parentId: tree.clients,
      beforeSectionId: null,
    });
    assert.equal(parentOf(layout, tree.acme), tree.clients);
    assertTreeOrder(layout);
    return { order: layout.order };
  });

  await step("released route: the layout without parentId, and old actions keep the tree", async () => {
    const read = await call("GET", TEAM_API_ROUTES.sidebarLayout.state, {
      token: setup.memberToken,
      protocol: TEAM_PROTOCOL_V7,
    });
    assert.equal(read.status, 200);
    assert.ok(
      sectionsOf(record(read.body, "layout")).every((section) => !("parentId" in section)),
      "The released route answers parentId.",
    );
    // A released client cannot know about parents: its create goes to the top level.
    const created = await call("POST", TEAM_API_ROUTES.sidebarLayout.actions, {
      token: setup.memberToken,
      protocol: TEAM_PROTOCOL_V7,
      body: { type: "create", name: "Old client", parentId: tree.clients },
    });
    const afterCreate = current().sidebar.getSnapshot();
    if (created.status !== 200) {
      // A refusal of the unknown field is also safe: nothing was nested.
      assert.equal(created.status, 400, `The released create returned ${created.status}.`);
      assert.ok(afterCreate.sections.every((section) => section.name !== "Old client"));
    } else {
      const oldClient = sectionIdNamed(afterCreate, "Old client");
      assert.equal(parentOf(afterCreate, oldClient), undefined, "The released route nested a folder.");
    }
    // A rename from a released client keeps the parents that it cannot see.
    const renamed = await call("POST", TEAM_API_ROUTES.sidebarLayout.actions, {
      token: setup.memberToken,
      protocol: TEAM_PROTOCOL_V7,
      body: { type: "rename", sectionId: tree.launch, name: "Launch plan" },
    });
    assert.equal(renamed.status, 200);
    const afterRename = current().sidebar.getSnapshot();
    assert.equal(parentOf(afterRename, tree.launch), tree.acme, "A released rename dropped the parent.");
    return { releasedCreate: created.status };
  });

  await step("member: delete moves the folders and chats to the parent, or to no folder at the top", async () => {
    let layout = await act(setup.memberToken, { type: "delete", sectionId: tree.acme });
    assert.equal(parentOf(layout, tree.launch), tree.clients, "The folder of a deleted folder did not move up.");
    assert.equal(layout.agentAssignments[setup.shownId], tree.launch);
    layout = await act(setup.memberToken, { type: "delete", sectionId: tree.launch });
    assert.equal(layout.agentAssignments[setup.shownId], tree.clients, "The chat did not move to the parent.");
    layout = await act(setup.memberToken, { type: "delete", sectionId: tree.clients });
    assert.equal(layout.agentAssignments[setup.shownId], undefined, "A chat at the top kept a deleted folder.");
    assert.equal(parentOf(layout, tree.internal), undefined, "A folder kept a deleted parent.");
    assertTreeOrder(layout);
    return { sections: layout.sections.map((section) => section.name) };
  });

  await step("events: the capable socket got only sidebar-folders-changed", async () => {
    // One more change: each event before it has arrived when this one does.
    const last = foldersEventWith(capable, "Internal team");
    const legacyLast = legacyEventWith(legacy, "Internal team");
    await act(setup.memberToken, { type: "rename", sectionId: tree.internal, name: "Internal team" });
    await last;
    await legacyLast;
    const types = (events: EventSocket) =>
      events.received.flatMap((value) =>
        isRecord(value) && typeof value.type === "string" && value.type.startsWith("sidebar-") ? [value.type] : [],
      );
    assert.ok(!types(capable).includes("sidebar-layout-changed"), "The capable socket also got the old event.");
    assert.ok(!types(legacy).includes("sidebar-folders-changed"), "The old socket got the new event.");
    assert.ok(
      legacy.received.every(
        (value) =>
          !isRecord(value) ||
          value.type !== "sidebar-layout-changed" ||
          sectionsOf(record(value.layout, "legacy layout")).every((section) => !("parentId" in section)),
      ),
      "An old event carried parentId.",
    );
    return { capable: types(capable).length, legacy: types(legacy).length };
  });

  await step("restart: the folders and the parents persist", async () => {
    const before = current().sidebar.getSnapshot();
    for (const events of [capable, legacy]) events.socket.close();
    await stopHost();
    host = await startHost();
    assert.deepEqual(current().sidebar.getSnapshot(), before, "The layout changed after a restart.");
    const read = await folders(SIDEBAR_FOLDERS_ROUTES.read, setup.memberToken, {});
    assert.deepEqual(layoutOf(read.body), before);
    return { revision: before.revision };
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
