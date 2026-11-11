// Checks member access to MCP servers through the Team API (`mcp-member-access-v1`). A real
// `TeamApiServer` runs on loopback with the real team store, the real MCP server store and the real
// owners store on a temporary profile. The MCP sign-in and the relay are recording stand-ins, so no
// browser and no provider CLI start.
//
// A member on a released client is still refused. A member on a current client reads the list, adds a
// server, and changes, signs in, signs out and removes it. The host refuses the member each change and
// each sign-in of a server that the owner added, also through a row of the member on the owner's
// address. Provider sign-ins stay with owners and admins. Who added each server stays after a restart.
// Run: `bun run test:mcp-member-access`.
// Writes .openbot-build/mcp-member-access-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig, McpSignInState, TestMcpServerInput } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { MCP_MEMBER_ACCESS_CAPABILITY, teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { MCP_SIGN_IN_APP_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-app-v1";
import { MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
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
import type { TeamApiBrowser, TeamApiMcpSignIns, TeamApiSignInRelay } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-member-access-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const OWNER_URL = "https://mcp.trello.com/v1";
const MEMBER_URL = "https://mcp.notion.com/mcp";

// The main process imports Electron for its windows and IPC. No check here opens a window.
plugin({
  name: "mcp-member-access-electron-boundary",
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
const { MCP_SERVER_OWNERS_FILE, McpServerOwnersStore } = await import("../src/main/mcp-server-owners-store");
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
    "The real sign-in in a browser. The MCP sign-in and the relay are recording stand-ins here.",
    "The desktop and web client screens. `serverCanManageMcp` decides what they offer; this check covers the host.",
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

/** What the stand-ins were asked to do, in order. */
const calls: string[] = [];
const signIns: TeamApiMcpSignIns = {
  start: (input: TestMcpServerInput) => Effect.sync(() => void calls.push(`start ${input.config.url}`)),
  status: () => ({ tabId: null, result: null }),
  cancel: (url) => void calls.push(`cancel ${url}`),
  signOut: (input) =>
    Effect.sync((): McpSignInState[] => {
      calls.push(`sign-out ${input.mcpServerId}`);
      return [];
    }),
  list: () => [],
  app: () => ({ redirectUrl: null, app: null }),
  saveApp: (input) =>
    Effect.sync(() => {
      calls.push(`save-app ${input.mcpServerId}`);
      return { redirectUrl: null, app: { clientId: input.clientId, secretSaved: false, scope: input.scope } };
    }),
  removeApp: (input) =>
    Effect.sync(() => {
      calls.push(`remove-app ${input.mcpServerId}`);
      return { redirectUrl: null, app: null };
    }),
};
const relay: TeamApiSignInRelay = {
  startMcp: (memberId, input) =>
    Effect.sync(() => {
      calls.push(`relay ${input.config.url}`);
      return { flowId: `flow-${memberId}`, expiresAt: Date.now() + 60_000 };
    }),
  startProvider: unused,
  startProviderAccount: unused,
  startLink: () => assert.fail("Not used by this check."),
  status: () => assert.fail("Not used by this check."),
  complete: unused,
  cancel: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-member-access-"));
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
  const owners = new McpServerOwnersStore(join(userData, MCP_SERVER_OWNERS_FILE));
  await runCauseEffect(owners.load());
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
    mcpServerOwners: owners,
    mcpSignIns: signIns,
    signInRelay: relay,
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
/** A released client: the current list without `mcp-member-access-v1`. */
const RELEASED = CURRENT.filter((capability) => capability !== MCP_MEMBER_ACCESS_CAPABILITY);

/** One protocol 9 request. A current client sends `mcp-member-access-v1`. */
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

function httpServer(name: string, url: string, id = ""): McpServerConfig {
  return {
    id,
    name,
    transport: "http",
    enabled: false,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url,
    headers: [],
  };
}

function servers(body: unknown): McpServerConfig[] {
  assert.ok(Array.isArray(body), "The MCP list is not an array.");
  return body;
}

async function save(token: string, config: McpServerConfig): Promise<McpServerConfig> {
  const response = await call("POST", MCP_ROUTES.save, { token, body: { config } });
  assert.equal(response.status, 200, `Save returned ${response.status}: ${JSON.stringify(response.body)}`);
  const saved = servers(response.body).find((server) => server.name === config.name);
  assert.ok(saved, `${config.name} is not in the list.`);
  return saved;
}

const NOT_YOURS = sourceText("error.team.mcpServerNotYours");
const ADMIN_REQUIRED = sourceText("error.team.adminRequired");

/** Asserts that the host refused with 403 and `message`. */
function refused(response: { status: number; body: unknown }, message: string, label: string): void {
  assert.equal(response.status, 403, `${label}: expected 403, got ${response.status}.`);
  assert.equal(JSON.stringify(response.body).includes(message), true, `${label}: ${JSON.stringify(response.body)}`);
}

try {
  host = await startHost();
  const ownerToken = await login(OWNER);
  const memberToken = await step("setup: an owner and a member sign in", async () => {
    const invite = await runCauseEffect(current().team.createInvite("member"));
    const joined = await call("POST", TEAM_API_ROUTES.join.server, { body: { inviteToken: invite.token, ...MEMBER } });
    assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
    return login(MEMBER);
  });
  const memberId = current()
    .team.listMembers()
    .find((member) => member.username === MEMBER.username)?.id;
  assert.ok(memberId, "The member is not in the team.");

  const ownerRow = await step("the owner adds Trello", () => save(ownerToken, httpServer("trello", OWNER_URL)));

  await step("a member on a released client is refused, as before", async () => {
    const list = await call("GET", MCP_ROUTES.list, { token: memberToken, capabilities: RELEASED });
    refused(list, ADMIN_REQUIRED, "list");
    const added = await call("POST", MCP_ROUTES.save, {
      token: memberToken,
      capabilities: RELEASED,
      body: { config: httpServer("notion", MEMBER_URL) },
    });
    refused(added, ADMIN_REQUIRED, "save");
    return { list: list.status, save: added.status };
  });

  const memberRow = await step("a member on a current client reads the list and adds Notion", async () => {
    const list = await call("GET", MCP_ROUTES.list, { token: memberToken });
    assert.equal(list.status, 200, `List returned ${list.status}.`);
    assert.deepEqual(
      servers(list.body).map((server) => server.name),
      ["trello"],
    );
    return save(memberToken, httpServer("notion", MEMBER_URL));
  });

  await step("the member changes, turns on, and signs in their own server", async () => {
    const renamed = await save(memberToken, { ...memberRow, name: "notion-work" });
    assert.equal(renamed.id, memberRow.id);
    const toggled = await call("POST", MCP_ROUTES.toggle, {
      token: memberToken,
      body: { mcpServerId: memberRow.id, enabled: true },
    });
    assert.equal(toggled.status, 200, `Toggle returned ${toggled.status}: ${JSON.stringify(toggled.body)}`);
    const started = await call("POST", MCP_SIGN_IN_ROUTES.start, {
      token: memberToken,
      body: { config: { ...renamed, enabled: true } },
    });
    assert.equal(started.status, 200, `Sign-in returned ${started.status}: ${JSON.stringify(started.body)}`);
    const relayed = await call("POST", SIGN_IN_RELAY_ROUTES.mcpStart, {
      token: memberToken,
      body: { config: { ...renamed, enabled: true } },
    });
    assert.equal(relayed.status, 200, `Relay returned ${relayed.status}: ${JSON.stringify(relayed.body)}`);
    const app = await call("POST", MCP_SIGN_IN_APP_ROUTES.save, {
      token: memberToken,
      body: { mcpServerId: memberRow.id, clientId: "member-app", clientSecret: null, scope: "" },
    });
    assert.equal(app.status, 200, `Sign-in app returned ${app.status}: ${JSON.stringify(app.body)}`);
    const signedOut = await call("POST", MCP_SIGN_IN_ROUTES.signOut, {
      token: memberToken,
      body: { mcpServerId: memberRow.id },
    });
    assert.equal(signedOut.status, 200, `Sign-out returned ${signedOut.status}.`);
    assert.deepEqual(calls, [
      `start ${MEMBER_URL}`,
      `relay ${MEMBER_URL}`,
      `save-app ${memberRow.id}`,
      `sign-out ${memberRow.id}`,
    ]);
    return { calls: [...calls] };
  });

  await step("the host refuses the member each change and sign-in of the owner's server", async () => {
    calls.length = 0;
    const tries = {
      edit: await call("POST", MCP_ROUTES.save, { token: memberToken, body: { config: { ...ownerRow, name: "x" } } }),
      toggle: await call("POST", MCP_ROUTES.toggle, {
        token: memberToken,
        body: { mcpServerId: ownerRow.id, enabled: true },
      }),
      remove: await call("POST", MCP_ROUTES.remove, { token: memberToken, body: { mcpServerId: ownerRow.id } }),
      signIn: await call("POST", MCP_SIGN_IN_ROUTES.start, { token: memberToken, body: { config: ownerRow } }),
      cancel: await call("POST", MCP_SIGN_IN_ROUTES.cancel, { token: memberToken, body: { url: OWNER_URL } }),
      signOut: await call("POST", MCP_SIGN_IN_ROUTES.signOut, {
        token: memberToken,
        body: { mcpServerId: ownerRow.id },
      }),
      relay: await call("POST", SIGN_IN_RELAY_ROUTES.mcpStart, { token: memberToken, body: { config: ownerRow } }),
      app: await call("POST", MCP_SIGN_IN_APP_ROUTES.remove, {
        token: memberToken,
        body: { mcpServerId: ownerRow.id },
      }),
    };
    for (const [label, response] of Object.entries(tries)) refused(response, NOT_YOURS, label);
    assert.deepEqual(calls, [], "A refused call reached the sign-in.");
    const list = servers((await call("GET", MCP_ROUTES.list, { token: ownerToken })).body);
    assert.deepEqual(list.find((server) => server.id === ownerRow.id)?.name, "trello", "The owner's row changed.");
    return Object.fromEntries(Object.entries(tries).map(([label, response]) => [label, response.status]));
  });

  await step("a member's own row on the owner's address cannot sign in or sign out that address", async () => {
    const shared = await save(memberToken, httpServer("trello-mine", OWNER_URL));
    const signIn = await call("POST", MCP_SIGN_IN_ROUTES.start, { token: memberToken, body: { config: shared } });
    refused(signIn, NOT_YOURS, "sign-in");
    const signOut = await call("POST", MCP_SIGN_IN_ROUTES.signOut, {
      token: memberToken,
      body: { mcpServerId: shared.id },
    });
    refused(signOut, NOT_YOURS, "sign-out");
    const removed = await call("POST", MCP_ROUTES.remove, { token: memberToken, body: { mcpServerId: shared.id } });
    assert.equal(removed.status, 200, `Removing the member's own row returned ${removed.status}.`);
    assert.deepEqual(calls, [], "A refused call reached the sign-in.");
    return { signIn: signIn.status, signOut: signOut.status, remove: removed.status };
  });

  await step("a provider sign-in stays with owners and admins", async () => {
    const provider = await call("POST", SIGN_IN_RELAY_ROUTES.providerStart, {
      token: memberToken,
      body: { provider: "codex" },
    });
    refused(provider, ADMIN_REQUIRED, "provider");
    return { provider: provider.status };
  });

  await step("who added each server stays after a restart; the owner still changes any row", async () => {
    await stopHost();
    host = await startHost();
    const member = await login(MEMBER);
    const owner = await login(OWNER);
    const own = await call("POST", MCP_ROUTES.toggle, {
      token: member,
      body: { mcpServerId: memberRow.id, enabled: false },
    });
    assert.equal(own.status, 200, `The member's toggle returned ${own.status}.`);
    refused(
      await call("POST", MCP_ROUTES.remove, { token: member, body: { mcpServerId: ownerRow.id } }),
      NOT_YOURS,
      "remove after restart",
    );
    const ownerRemoves = await call("POST", MCP_ROUTES.remove, { token: owner, body: { mcpServerId: memberRow.id } });
    assert.equal(ownerRemoves.status, 200, `The owner's removal returned ${ownerRemoves.status}.`);
    const file = JSON.parse(await readFile(join(userData, MCP_SERVER_OWNERS_FILE), "utf8"));
    assert.equal(file.version, 1);
    assert.equal(file.owners[memberRow.id], undefined, "A removed row keeps its owner.");
    assert.equal(
      file.owners[ownerRow.id],
      current()
        .team.listMembers()
        .find((m) => m.role === "owner")?.id,
    );
    return { owners: Object.keys(file.owners).length };
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
