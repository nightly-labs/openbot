// Real Team API, agent/MCP SQLite stores, roles and an owned offline OAuth callback process.
// No Google service or user credential is accessed. Writes .openbot-build/google-connections-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseGoogleConnectionAssign, parseGoogleConnectionsSnapshot } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import {
  GOOGLE_CONNECTIONS_CODECS,
  GOOGLE_CONNECTIONS_ROUTES as R,
} from "@openbot/contracts/team-protocol/google-connections-v1";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { ConnectorAccessStore } from "../src/main/connector-access-store";
import { type GoogleAuthAttempt, startGoogleAuth } from "../src/main/google-auth-process";
import { GoogleConnectionsService } from "../src/main/google-connections-service";
import { GoogleConnectionsStore } from "../src/main/google-connections-store";
import { SignInRelayHost } from "../src/main/sign-in-relay-host";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const HOST_VERSION = "0.0.0-e2e";
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
const { TeamStore } = await import("../src/main/team-store");
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

const root = await mkdtemp(join(tmpdir(), "openbot-google-enrollment-"));
const out = resolve(import.meta.dirname, "../.openbot-build/google-connections-e2e");
const report: { passed: boolean; steps: string[]; unverified: string[] } = {
  passed: false,
  steps: [],
  unverified: [
    "Google consent/token exchange, a second real Google account, and desktop browser UI. The OAuth CLI is an offline fixture.",
  ],
};
const key = randomBytes(32);
const cipher = {
  encrypt: (text: string) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  },
  decrypt: (value: Buffer) => {
    const c = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
    c.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString("utf8");
  },
};
const userData = join(root, "user-data"),
  googleHome = join(root, "google"),
  cliRoot = join(root, "plugin"),
  cli = join(cliRoot, "dist/cli.js");
const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "agent-home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar.json"));
const team = new TeamStore(join(userData, "team.json"));
const roles = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
const connectors = new ConnectorAccessStore(join(userData, "connectors.json"), (change) => {
  if (change.rules.some((r) => r.agentIds.some((id) => !agents.connectorProtectionAvailable(id))))
    throw new Error("Copy in progress.");
});
const agents = new AgentService({
  store: agentStore,
  mailbox,
  browser: agentBrowser,
  sidebarLayout: sidebar,
  connectorAccess: connectors,
});
const storePath = join(userData, "google.json");
const store = new GoogleConnectionsStore(storePath, cipher);
const relay = new SignInRelayHost({
  mcp: { startRelay: unused, relayStatus: () => ({ pageUrl: null, result: null }), cancel: () => {} },
  providers: { startRelay: unused, relayStatus: () => ({ pageUrl: null, result: null }), cancel: unused },
  accounts: { startRelay: unused, relayStatus: () => ({ pageUrl: null, result: null }), cancelSignIn: unused },
  receiveMcpGrant: () => false,
  printedLink: () => false,
});
const attempts = new Map<string, GoogleAuthAttempt>();
const google = new GoogleConnectionsService({
  store,
  agents,
  roles,
  connectors,
  relay,
  launch: async (config, profile) => {
    const attempt = await startGoogleAuth(config, profile);
    attempts.set(profile, attempt);
    return attempt;
  },
});
const server = new TeamApiServer({
  store: team,
  agents,
  mailbox,
  browser: teamBrowser,
  sidebarLayout: sidebar,
  appVersion: HOST_VERSION,
  agentAccess: roles,
  connectorAccess: connectors,
  connectorMcp: agents,
  mcpServers: agents,
  signInRelay: relay,
  googleConnections: google,
});
let port = 0;
async function call(path: string, token: string, body: unknown = {}, protocol = 9) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
      [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
      [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(protocol).join(","),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function login(username: string) {
  const response = await call(TEAM_API_ROUTES.auth.login, "", { username, password: "fixture-password-123" });
  assert.equal(response.status, 200);
  return String(response.body.sessionToken);
}
async function googleCall(path: string, token: string, body: unknown = {}) {
  const codec = GOOGLE_CONNECTIONS_CODECS.get(path);
  assert.ok(codec);
  codec.request(body);
  const response = await call(path, token, body);
  return { status: response.status, body: codec.response(response.status, response.body) };
}
async function connected(token: string, email: string, profileId: string | null = null) {
  await writeFile(join(googleHome, "next-email"), email);
  const started = await call(R.start, token, { profileId });
  assert.equal(started.status, 200);
  const id = String(started.body.profileId),
    flowId = String(started.body.flowId);
  const status = await call(R.status, token, { flowId });
  assert.equal(status.status, 200);
  const state = new URL(String(status.body.authorizeUrl)).searchParams.get("state");
  const complete = await call(R.complete, token, {
    flowId,
    query: new URLSearchParams({ state: state ?? "", code: "fixture-code" }).toString(),
  });
  assert.equal(complete.status, 200);
  const attempt = attempts.get(id);
  assert.ok(attempt);
  await attempt.done;
  const finished = await call(R.status, token, { flowId });
  assert.equal(finished.status, 200);
  assert.deepEqual(finished.body.result, { toolCount: 0, error: null });
  return { id, flowId };
}
try {
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(roles.load());
  await runCauseEffect(connectors.load());
  await runCauseEffect(store.load());
  await runCauseEffect(team.configure("Google Enrollment Fixture", "owner-user", "fixture-password-123"));
  const create = async (name: string) =>
    (
      await runCauseEffect(
        agents.createAgentProfile({
          name,
          description: "",
          avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
          avatarHue: null,
        }),
      )
    ).id;
  const nickAgent = await create("Nick private"),
    brittAgent = await create("Britt mail"),
    otherAgent = await create("Other existing"),
    deniedAgent = await create("Read only");
  await mkdir(join(cliRoot, "dist"), { recursive: true });
  await mkdir(join(googleHome, "nick-personal"), { recursive: true, mode: 0o700 });
  await writeFile(join(cliRoot, "package.json"), JSON.stringify({ name: "openbot-google-plugin", type: "module" }));
  const credential = {
    clientId: "fixture.apps.googleusercontent.com",
    clientSecret: "fixture-private-client",
    email: "nick@example.com",
    tokens: { refresh_token: "fixture-private-refresh" },
  };
  await writeFile(join(googleHome, "nick-personal/credentials.json"), JSON.stringify(credential), { mode: 0o600 });
  await writeFile(
    cli,
    `
 import {createServer} from 'node:http';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
 const home=process.env.OPENBOT_GOOGLE_HOME;const profile=process.argv[process.argv.indexOf('--profile')+1];const file=process.argv[process.argv.indexOf('--client')+1];const client=JSON.parse(await readFile(file,'utf8')).installed;const email=await readFile(join(home,'next-email'),'utf8');const state=randomBytes(32).toString('hex');
 const server=createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(u.searchParams.get('state')!==state){res.writeHead(400).end();return;}await mkdir(join(home,profile),{recursive:true,mode:0o700});await writeFile(join(home,profile,'credentials.json'),JSON.stringify({clientId:client.client_id,clientSecret:client.client_secret,email,tokens:{refresh_token:'fixture-private-refresh'}}),{mode:0o600});res.end('Connected');server.close();});
 server.listen(0,'127.0.0.1',()=>{const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:'http://127.0.0.1:'+server.address().port+'/oauth/callback',code_challenge_method:'S256',code_challenge:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',state,scope:['gmail.readonly','gmail.send','calendar.calendarlist.readonly','calendar.events',...(email==='unexpected-scope@example.com'?['drive']:[])].map(s=>'https://www.googleapis.com/auth/'+s).join(' ')}).toString();process.stderr.write(u.toString()+'\\n');});
 `,
  );
  const identity = team.getIdentity();
  assert.ok(identity);
  await Effect.runPromise(
    roles.set(
      identity.serverId,
      {
        revision: roles.get(identity.serverId).revision,
        everyone: {},
        roles: [{ id: "nick-role", name: "Nick", memberIds: [], agents: { [nickAgent]: "manage" } }],
      },
      new Set(agents.listAgents().map((a) => a.id)),
      new Set(agents.listAgents().map((a) => a.id)),
      null,
    ),
  );
  const command = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  const template = (
    await runCauseEffect(
      agents.saveMcpServer({
        config: {
          id: "",
          name: "Existing personal Google",
          transport: "stdio",
          enabled: true,
          command,
          args: [cli, "serve", "--profile", "nick-personal"],
          env: [{ key: "OPENBOT_GOOGLE_HOME", value: googleHome }],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      }),
    )
  )[0];
  assert.ok(template);
  await Effect.runPromise(
    connectors.set(
      {
        revision: 0,
        rules: [{ mcpServerId: template.id, agentIds: [nickAgent], roleIds: ["nick-role"], everyoneUse: false }],
      },
      () => Effect.void,
    ),
  );
  port = await Effect.runPromise(server.start());
  const owner = await login("owner-user");
  const invite = await runCauseEffect(team.createInvite("member"));
  assert.equal(
    (
      await call(TEAM_API_ROUTES.join.server, "", {
        inviteToken: invite.token,
        username: "britt-user",
        password: "fixture-password-123",
      })
    ).status,
    201,
  );
  const britt = await login("britt-user");
  const brittMember = team.listMembers().find((m) => m.username === "britt-user");
  assert.ok(brittMember);
  const strangerInvite = await runCauseEffect(team.createInvite("member"));
  await call(TEAM_API_ROUTES.join.server, "", {
    inviteToken: strangerInvite.token,
    username: "other-user",
    password: "fixture-password-123",
  });
  const stranger = await login("other-user");
  assert.equal((await call(R.state, "")).status, 401);
  assert.equal((await call(R.configure, britt, { mcpServerId: template.id })).status, 403);
  assert.equal((await call(R.configure, owner, { mcpServerId: template.id })).status, 200);
  assert.equal(parseGoogleConnectionsSnapshot((await googleCall(R.state, britt)).body).profiles.length, 0);
  assert.equal((await call(R.state, britt, {}, 8)).status, 400);
  report.steps.push(
    "Authenticated members can enroll; setup stays admin-only; old protocols do not advertise the optional capability; existing Nick account remains private and unchanged.",
  );
  const profile = await connected(britt, "britt@example.com");
  assert.equal((await call(R.status, stranger, { flowId: profile.flowId })).status, 404);
  assert.equal((await call(R.disconnect, stranger, { profileId: profile.id })).status, 404);
  assert.equal((await call(SIGN_IN_RELAY_ROUTES.status, britt, { flowId: profile.flowId })).status, 403);
  const foreign = relay.startReplay(brittMember.id, {
    key: "admin-fixture",
    status: () => ({ pageUrl: null, result: null }),
    cancel: () => Effect.void,
  });
  assert.equal((await call(R.status, britt, { flowId: foreign.flowId })).status, 404);
  assert.equal(
    (await call(R.complete, britt, { flowId: foreign.flowId, query: "state=wrong&code=fixture" })).status,
    404,
  );
  report.steps.push(
    "Regular member completes an owned browser callback. Other members cannot read or disconnect the profile, and Google endpoints cannot access administrator relay flows.",
  );
  const serverId = team.getIdentity()?.serverId;
  assert.ok(serverId);
  const current = roles.get(serverId);
  await Effect.runPromise(
    roles.set(
      serverId,
      { revision: current.revision, everyone: { [deniedAgent]: "view" }, roles: [] },
      new Set([deniedAgent]),
      new Set(agents.listAgents().map((a) => a.id)),
      null,
    ),
  );
  const snapshot = parseGoogleConnectionsSnapshot((await call(R.state, britt)).body);
  assert.equal(snapshot.profiles[0]?.eligibleAgentIds.includes(deniedAgent), false);
  assert.equal(
    snapshot.eligibleAgents.some((a) => a.id === nickAgent),
    false,
  );
  assert.equal((await call(R.assign, britt, { profileId: profile.id, agentId: deniedAgent })).status, 403);
  assert.equal((await call(R.assign, britt, { profileId: profile.id, agentId: ` ${brittAgent} ` })).status, 400);
  assert.throws(() =>
    parseGoogleConnectionAssign({ profileId: profile.id, agentId: brittAgent, newAgentName: "Injected creation" }),
  );
  assert.equal((await googleCall(R.assign, britt, { profileId: profile.id, agentId: brittAgent })).status, 200);
  const owned = store.read().profiles.find((p) => p.id === profile.id);
  assert.ok(owned?.mcpServerId);
  assert.equal(
    agents.enabledMcpServers(otherAgent).some((m) => m.id === owned.mcpServerId),
    false,
  );
  assert.equal(
    agents.enabledMcpServers(brittAgent).some((m) => m.id === owned.mcpServerId),
    true,
  );
  const otherMember = team.listMembers().find((m) => m.username === "other-user");
  assert.ok(otherMember);
  assert.equal(connectors.memberMaySeeAgent(otherMember, brittAgent, roles.levels(serverId)), false);
  assert.equal(connectors.memberMaySeeAgent(brittMember, brittAgent, roles.levels(serverId)), true);
  assert.equal((await call(R.assign, britt, { profileId: profile.id, agentId: otherAgent })).status, 200);
  assert.equal(connectors.allows(owned.mcpServerId, brittAgent), false);
  assert.equal(connectors.allows(owned.mcpServerId, otherAgent), true);
  assert.equal(connectors.memberMaySeeAgent(otherMember, brittAgent, roles.levels(serverId)), false);
  report.steps.push(
    "Manage permission and canonical IDs are enforced at the API. Actual SQLite MCP handoff reaches one selected existing agent; moving accounts preserves old history restrictions.",
  );
  const second = await connected(britt, "britt-work@example.com");
  assert.equal((await call(R.assign, britt, { profileId: second.id, agentId: otherAgent })).status, 403);
  // Concurrent requests for one profile serialize to a single final active agent.
  const moved = await Promise.all([
    call(R.assign, britt, { profileId: profile.id, agentId: brittAgent }),
    call(R.assign, britt, { profileId: profile.id, agentId: otherAgent }),
  ]);
  assert.ok(moved.every((r) => r.status === 200));
  assert.equal(connectors.snapshot([]).rules.find((r) => r.mcpServerId === owned.mcpServerId)?.agentIds.length, 1);
  report.steps.push(
    "Distinct personal profiles cannot take each other's connected agent; concurrent assignments leave exactly one active agent.",
  );
  await call(R.disconnect, britt, { profileId: profile.id });
  assert.equal(agents.listMcpServers().find((m) => m.id === owned.mcpServerId)?.enabled, false);
  await assert.rejects(stat(join(googleHome, profile.id, "credentials.json")));
  assert.equal(connectors.memberMaySeeAgent(otherMember, brittAgent, roles.levels(serverId)), false);
  const disconnected = parseGoogleConnectionsSnapshot((await call(R.state, britt)).body);
  assert.ok(disconnected.profiles.find((p) => p.id === profile.id)?.eligibleAgentIds.includes(brittAgent));
  // A fresh grant for the same Google account cannot silently create another profile.
  await writeFile(join(googleHome, "next-email"), "britt@example.com");
  const duplicate = await call(R.start, stranger, { profileId: null });
  assert.equal(duplicate.status, 200);
  const dupPage = await call(R.status, stranger, { flowId: duplicate.body.flowId });
  const dupState = new URL(dupPage.body.authorizeUrl).searchParams.get("state");
  await call(R.complete, stranger, {
    flowId: duplicate.body.flowId,
    query: new URLSearchParams({ state: dupState ?? "", code: "fixture" }).toString(),
  });
  await attempts.get(duplicate.body.profileId)?.done;
  const rejected = await call(R.status, stranger, { flowId: duplicate.body.flowId });
  assert.ok(rejected.body.result.error);
  assert.equal(store.read().profiles.find((p) => p.id === duplicate.body.profileId)?.connected, false);
  report.steps.push(
    "Disconnect disables actual MCP config and deletes tokens, while preserving private history; duplicate Google account enrollment is rejected even after disconnect.",
  );
  await connected(britt, "britt@example.com", profile.id);
  const acl = roles.get(serverId);
  await Effect.runPromise(
    roles.set(
      serverId,
      { revision: acl.revision, everyone: acl.everyone, roles: acl.roles.filter((r) => r.id !== owned.roleId) },
      new Set(agents.listAgents().map((a) => a.id)),
      new Set(agents.listAgents().map((a) => a.id)),
      null,
    ),
  );
  const reloadedRoles = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
  await runCauseEffect(reloadedRoles.load());
  await assert.rejects(
    Effect.runPromise(reloadedRoles.grantPersonalConnector(serverId, brittMember, owned.roleId, otherAgent)),
  );
  assert.equal((await call(R.assign, britt, { profileId: profile.id, agentId: otherAgent })).status, 403);
  const savedText = await readFile(storePath, "utf8");
  assert.equal(savedText.includes("fixture-private"), false);
  assert.equal(savedText.includes("britt@example.com"), false);
  const reloaded = new GoogleConnectionsStore(storePath, cipher);
  await runCauseEffect(reloaded.load());
  assert.equal(reloaded.read().profiles.find((p) => p.id === profile.id)?.ownerMemberId, brittMember.id);
  await writeFile(storePath, '{"version":1,"record":"broken"}');
  const damaged = new GoogleConnectionsStore(storePath, cipher);
  await runCauseEffect(damaged.load());
  assert.equal(damaged.closed, true);
  await assert.rejects(runCauseEffect(damaged.update((s) => s)));
  assert.deepEqual(
    (await readdir(googleHome)).filter((n) => n.startsWith(".signin-")),
    [],
  );
  report.steps.push(
    "Administrator role deletion survives restart and cannot be undone by member enrollment; encrypted ownership survives reload; corrupt state fails closed; owned auth client files are removed.",
  );
  await writeFile(join(googleHome, "next-email"), "unexpected-scope@example.com");
  assert.equal((await call(R.start, stranger, { profileId: null })).status, 400);
  assert.deepEqual(
    (await readdir(googleHome)).filter((n) => n.startsWith(".signin-")),
    [],
  );
  report.steps.push(
    "A Google-looking page that asks for an extra Drive permission is rejected before it can open or relay a grant.",
  );
  // Wrong callback state never reaches the owned listener; cancellation stops that process.
  await writeFile(join(googleHome, "next-email"), "cancel@example.com");
  const pending = await call(R.start, stranger, { profileId: null });
  assert.equal(pending.status, 200);
  assert.equal(
    (await call(R.complete, stranger, { flowId: pending.body.flowId, query: "state=wrong&code=fixture" })).status,
    400,
  );
  const cancel = await call(R.cancel, stranger, { flowId: pending.body.flowId });
  assert.equal(cancel.status, 200);
  const canceled = attempts.get(pending.body.profileId);
  assert.ok(canceled);
  assert.equal((await canceled.done).ok, false);
  assert.deepEqual(
    (await readdir(googleHome)).filter((n) => n.startsWith(".signin-")),
    [],
  );
  report.steps.push(
    "A mismatched OAuth state is refused before replay; cancel stops its real owned process and removes the temporary client file.",
  );
  report.passed = true;
} finally {
  await Effect.runPromise(server.stop()).catch(() => {});
  await Effect.runPromise(google.close()).catch(() => {});
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
