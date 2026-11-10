// Checks that a host keeps 100 MCP servers and serves them over the Team API (`mcp-many-servers-v1`).
// A real `TeamApiServer` runs on loopback with the real team store and the real MCP server store on a
// temporary profile. The MCP sign-ins are a stand-in that lists every http row, so no browser starts.
//
// A released client, which does not send the capability, manages up to 32 servers as before. The host
// refuses it the 33rd server, and every list longer than 32, with an update message and before any
// change. A current client adds servers up to 100 and reads all of them, through the same codec that
// every transport uses. The host refuses the 101st server. The 100 rows stay after a restart.
// Run: `bun run test:mcp-many-servers`.
// Writes .openbot-build/mcp-many-servers-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { McpServerConfig, McpSignInState } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import {
  MCP_FROZEN_SERVERS_LIST_LIMIT,
  MCP_MANY_SERVERS_CAPABILITY,
  MCP_MANY_SERVERS_LIST_LIMIT,
} from "@openbot/contracts/team-protocol/mcp-many-servers-v1";
import { MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES, mcpResponse } from "@openbot/contracts/team-protocol/mcp-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
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
import type { TeamApiBrowser, TeamApiMcpSignIns } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-many-servers-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const STEP_DEADLINE_MS = 60_000;

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "mcp-many-servers-electron-boundary",
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
    "The WebRTC transports. They pass the same codec option as the HTTP transport, which this check drives.",
    "A real released client build. This check sends the current capability list without `mcp-many-servers-v1`.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check waits for its reply.
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
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

/** The sign-in state of every http row: none is signed in. */
const signIns: TeamApiMcpSignIns = {
  start: unused,
  status: () => ({ tabId: null, result: null }),
  cancel: () => undefined,
  signOut: () => Effect.sync((): McpSignInState[] => signInList()),
  list: () => signInList(),
  app: () => ({ redirectUrl: null, app: null }),
  saveApp: unused,
  removeApp: unused,
};

function signInList(): McpSignInState[] {
  return current()
    .agents.listMcpServers()
    .filter((server) => server.transport === "http")
    .map((server) => ({ mcpServerId: server.id, signedIn: false }));
}

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-many-servers-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
}

let host: Host | null = null;

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
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    mcpServers: agents,
    mcpSignIns: signIns,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, server, team, port };
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

const CURRENT = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9);
/** A released client: the current list without `mcp-many-servers-v1`. */
const RELEASED = CURRENT.filter((capability) => capability !== MCP_MANY_SERVERS_CAPABILITY);

/** One protocol 9 request. A current client sends `mcp-many-servers-v1`. */
async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[] } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: (input.capabilities ?? CURRENT).join(","),
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
  const body = response.body;
  assert.ok(typeof body === "object" && body !== null && "sessionToken" in body);
  return String(body.sessionToken);
}

function httpServer(index: number): McpServerConfig {
  return {
    id: "",
    name: `server-${String(index).padStart(3, "0")}`,
    transport: "http",
    enabled: false,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: `https://mcp-${index}.example.com/mcp`,
    headers: [],
  };
}

/** A list as a current client reads it: the codec of every transport, with the capability. */
function currentList(path: string, response: { status: number; body: unknown }): McpServerConfig[] {
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  const codec = teamSideRouteCodec(path);
  assert.ok(codec, `${path} has no side-route codec.`);
  // The codec throws on a list that it does not accept; the rows are then the decoded body.
  codec.response(path, response.status, response.body, { mcpManyServers: true });
  const rows = response.body;
  assert.ok(Array.isArray(rows), `${path} is not a list.`);
  return rows;
}

/** A list as a released client reads it: the frozen codec alone. */
function releasedList(path: string, response: { status: number; body: unknown }): unknown[] {
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  const codec = teamSideRouteCodec(path);
  assert.ok(codec, `${path} has no side-route codec.`);
  const decoded = codec.response(path, response.status, response.body);
  assert.ok(Array.isArray(decoded), `${path} is not a list.`);
  return decoded;
}

const NEEDS_UPDATE = sourceText("error.team.mcpServerListNeedsUpdate", { limit: MCP_FROZEN_SERVERS_LIST_LIMIT });

/** Asserts that the host refused a released client with 409 and the update message. */
function needsUpdate(response: { status: number; body: unknown }, label: string): void {
  assert.equal(response.status, 409, `${label}: expected 409, got ${response.status}.`);
  assert.equal(
    JSON.stringify(response.body).includes(NEEDS_UPDATE),
    true,
    `${label}: ${JSON.stringify(response.body)}`,
  );
}

try {
  assert.equal(INPUT_LIMITS.mcpServers, MCP_MANY_SERVERS_LIST_LIMIT, "The store and the wire limits differ.");
  host = await startHost();
  const token = await login(OWNER);
  const released = { token, capabilities: RELEASED };

  await step("a released client adds 32 servers and reads them with the frozen codec", async () => {
    for (let index = 1; index <= MCP_FROZEN_SERVERS_LIST_LIMIT; index += 1) {
      const saved = await call("POST", MCP_ROUTES.save, { ...released, body: { config: httpServer(index) } });
      releasedList(MCP_ROUTES.save, saved);
    }
    const list = releasedList(MCP_ROUTES.list, await call("GET", MCP_ROUTES.list, released));
    assert.equal(list.length, MCP_FROZEN_SERVERS_LIST_LIMIT);
    const signInRows = releasedList(
      MCP_SIGN_IN_ROUTES.list,
      await call("POST", MCP_SIGN_IN_ROUTES.list, { ...released, body: {} }),
    );
    assert.equal(signInRows.length, MCP_FROZEN_SERVERS_LIST_LIMIT);
    return { servers: list.length, signIns: signInRows.length };
  });

  await step("the host refuses a released client the 33rd server, before it saves", async () => {
    const extra = await call("POST", MCP_ROUTES.save, {
      ...released,
      body: { config: httpServer(MCP_FROZEN_SERVERS_LIST_LIMIT + 1) },
    });
    needsUpdate(extra, "save");
    assert.equal(
      current().agents.listMcpServers().length,
      MCP_FROZEN_SERVERS_LIST_LIMIT,
      "The refused save was stored.",
    );
    return { status: extra.status };
  });

  await step("a released client removes a server from 33, and gets the list of 32", async () => {
    const added = currentList(
      MCP_ROUTES.save,
      await call("POST", MCP_ROUTES.save, { token, body: { config: httpServer(MCP_FROZEN_SERVERS_LIST_LIMIT + 1) } }),
    );
    assert.equal(added.length, MCP_FROZEN_SERVERS_LIST_LIMIT + 1);
    needsUpdate(await call("GET", MCP_ROUTES.list, released), "list at 33");
    const extra = added.find((server) => server.name === httpServer(MCP_FROZEN_SERVERS_LIST_LIMIT + 1).name);
    assert.ok(extra, "The 33rd server is not in the list.");
    const removed = await call("POST", MCP_ROUTES.remove, { ...released, body: { mcpServerId: extra.id } });
    assert.equal(releasedList(MCP_ROUTES.remove, removed).length, MCP_FROZEN_SERVERS_LIST_LIMIT);
    return { status: removed.status };
  });

  const full = await step("a current client adds servers up to 100 and reads all of them", async () => {
    for (let index = MCP_FROZEN_SERVERS_LIST_LIMIT + 1; index <= MCP_MANY_SERVERS_LIST_LIMIT; index += 1) {
      currentList(MCP_ROUTES.save, await call("POST", MCP_ROUTES.save, { token, body: { config: httpServer(index) } }));
    }
    const list = await call("GET", MCP_ROUTES.list, { token });
    const rows = currentList(MCP_ROUTES.list, list);
    assert.equal(rows.length, MCP_MANY_SERVERS_LIST_LIMIT);
    // The frozen codec alone refuses this list: that is why a released client must not get it.
    assert.throws(() => mcpResponse(MCP_ROUTES.list, 200, list.body));
    const signInRows = await call("POST", MCP_SIGN_IN_ROUTES.list, { token, body: {} });
    assert.equal(currentList(MCP_SIGN_IN_ROUTES.list, signInRows).length, MCP_MANY_SERVERS_LIST_LIMIT);
    return rows;
  });

  await step("the host refuses the 101st server", async () => {
    const extra = await call("POST", MCP_ROUTES.save, {
      token,
      body: { config: httpServer(MCP_MANY_SERVERS_LIST_LIMIT + 1) },
    });
    const limit = sourceText("error.backend.mcpServerLimit", { limit: MCP_MANY_SERVERS_LIST_LIMIT });
    assert.equal(extra.status >= 400 && extra.status < 500, true, `Expected a refusal, got ${extra.status}.`);
    assert.equal(JSON.stringify(extra.body).includes(limit), true, JSON.stringify(extra.body));
    assert.equal(current().agents.listMcpServers().length, MCP_MANY_SERVERS_LIST_LIMIT);
    return { status: extra.status };
  });

  await step("a released client gets the update message on every list route, and changes nothing", async () => {
    const first = full[0];
    assert.ok(first, "The list is empty.");
    const tries = {
      list: await call("GET", MCP_ROUTES.list, released),
      edit: await call("POST", MCP_ROUTES.save, { ...released, body: { config: { ...first, name: "renamed" } } }),
      toggle: await call("POST", MCP_ROUTES.toggle, { ...released, body: { mcpServerId: first.id, enabled: true } }),
      remove: await call("POST", MCP_ROUTES.remove, { ...released, body: { mcpServerId: first.id } }),
      signIns: await call("POST", MCP_SIGN_IN_ROUTES.list, { ...released, body: {} }),
      signOut: await call("POST", MCP_SIGN_IN_ROUTES.signOut, { ...released, body: { mcpServerId: first.id } }),
    };
    for (const [label, response] of Object.entries(tries)) needsUpdate(response, label);
    const stored = current().agents.listMcpServers();
    assert.equal(stored.length, MCP_MANY_SERVERS_LIST_LIMIT);
    assert.deepEqual(
      stored.find((server) => server.id === first.id),
      first,
      "A refused call changed the row.",
    );
    return Object.fromEntries(Object.entries(tries).map(([label, response]) => [label, response.status]));
  });

  await step("the 100 servers stay after a restart", async () => {
    await stopHost();
    host = await startHost();
    const again = await login(OWNER);
    const rows = currentList(MCP_ROUTES.list, await call("GET", MCP_ROUTES.list, { token: again }));
    assert.deepEqual(
      rows.map((server) => server.id),
      full.map((server) => server.id),
    );
    return { servers: rows.length };
  });

  report.passed = true;
} finally {
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, steps: report.steps.length }, null, 2)}\n`);
}
process.exit(report.passed ? 0 : 1);
