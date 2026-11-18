// Two hosts exchange an agent message and a file through the Team API (`remote-agent-bridge-v1`).
// Run: `bun scripts/remote-agent-bridge-e2e.ts`
// Writes .openbot-build/remote-agent-bridge-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { encodeTeamCapabilitiesV10, teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import {
  REMOTE_AGENT_BRIDGE_CAPABILITY,
  REMOTE_AGENT_BRIDGE_ROUTES,
} from "@openbot/contracts/team-protocol/remote-agent-bridge-v1";
import { TEAM_PROTOCOL_V8 } from "@openbot/contracts/team-protocol/v8";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { TEAM_ABSENT_CAPABILITIES_HEADER, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { Effect } from "effect";
import { type DeliveryPromptSources, deliveryPromptInput } from "../src/backend/agent/delivery-content";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type DeliveryContext, MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RemoteAgentBridgeError } from "../src/backend/remote-agent-bridge";
import {
  bridgeServeConfigured,
  mergeBridgeServeConfig,
  RemoteAgentBridgeReach,
  tailscaleWebKey,
} from "../src/main/remote-agent-bridge-reach";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-agent-bridge-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const secrets = new Set<string>();

function isMessageJsonRow(value: unknown): value is { message_json: string } {
  return isDynamicRecord(value) && typeof value.message_json === "string";
}

function inviteCode(body: unknown): string {
  assert.ok(isDynamicRecord(body) && isString(body.code));
  return body.code;
}

function inviteFields(body: unknown): { code: string; inviteId: string } {
  assert.ok(isDynamicRecord(body) && isString(body.code) && isString(body.inviteId));
  return { code: body.code, inviteId: body.inviteId };
}

function linkTokenFromRow(row: unknown): string {
  assert.ok(isDynamicRecord(row));
  const bytes = row.token_ciphertext;
  assert.ok(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array);
  const token = Buffer.from(bytes).toString("utf8");
  remember(token);
  return token;
}

function readJsonRecord(value: string): DynamicRecord | null {
  const parsed = JSON.parse(value);
  return isDynamicRecord(parsed) ? parsed : null;
}

function senderKind(message: DynamicRecord | null): string | null {
  if (!message || !isDynamicRecord(message.sender) || typeof message.sender.kind !== "string") return null;
  return message.sender.kind;
}

plugin({
  name: "remote-agent-bridge-electron-boundary",
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
  name: string;
  database: OpenBotDatabase;
  store: AgentStore;
  mailbox: MailboxStore;
  agents: AgentService;
  server: InstanceType<typeof TeamApiServer>;
  port: number;
  agentId: string;
}

interface Step {
  name: string;
  passed: boolean;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "WebRTC when the peer has no http address. A non-http reach fails and does not wake a hosted server.",
    "The desktop, web, and phone screens. This check covers the host routes.",
  ],
  steps: [],
};

async function step(name: string, run: () => Promise<void>): Promise<void> {
  process.stdout.write(`- ${name}\n`);
  try {
    await run();
    report.steps.push({ name, passed: true });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    report.steps.push({ name, passed: false, error });
    throw cause;
  }
}

async function startHost(name: string): Promise<Host> {
  const root = await mkdtemp(join(tmpdir(), "openbot-remote-agent-bridge-"));
  const userData = join(root, "user-data");
  const home = join(root, "home");
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  await runCauseEffect(team.initialize());
  if (!team.getIdentity()) await runCauseEffect(team.configure(name, OWNER.username, OWNER.password));
  const agent = await runCauseEffect(store.createAgent({ name, description: "", avatarSeed: "ada", avatarHue: null }));
  const agents = new AgentService({ store, mailbox, browser: agentBrowser, serverName: () => name });
  let serverRef: InstanceType<typeof TeamApiServer> | null = null;
  const bridgeReach = new RemoteAgentBridgeReach({
    bridge: agents.remoteAgentBridge,
    teamApiPort: () => serverRef?.port ?? null,
  });
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    appVersion: HOST_VERSION,
    admin: {
      remoteAgentBridge: agents.remoteAgentBridge,
      remoteAgentBridgeReach: bridgeReach,
      serverName: () => name,
    },
  });
  serverRef = server;
  const port = await Effect.runPromise(server.start());
  return { name, database, store, mailbox, agents, server, port, agentId: agent.id };
}

async function stopHost(host: Host): Promise<void> {
  await Effect.runPromise(host.server.stop()).catch(() => undefined);
  await runCauseEffect(host.agents.stop()).catch(() => undefined);
  host.database.close();
}

const capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10);
// Protocol 10 sends the names after the protocol 9 baseline, and the baseline ones it leaves out.
const capabilityLists = encodeTeamCapabilitiesV10(capabilities);

async function call(
  host: Host,
  method: string,
  path: string,
  input: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: capabilityLists.capabilities.join(","),
    [TEAM_ABSENT_CAPABILITIES_HEADER]: capabilityLists.absent.join(","),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(host: Host): Promise<string> {
  const response = await call(host, "POST", TEAM_API_ROUTES.auth.login, { body: OWNER });
  assert.equal(response.status, 200);
  const body = response.body;
  assert.ok(typeof body === "object" && body !== null && "sessionToken" in body);
  const token = String(body.sessionToken);
  secrets.add(token);
  return token;
}

function messages(host: Host): { message_json: string }[] {
  const rows = host.database.connection
    .prepare("SELECT message_json FROM projection_mailbox_messages ORDER BY created_at")
    .all();
  return rows.filter(isMessageJsonRow);
}

function remember(value: string): void {
  if (value) secrets.add(value);
}

const root = await mkdtemp(join(tmpdir(), "openbot-remote-agent-bridge-files-"));
let hostA: Host | null = null;
let hostB: Host | null = null;

try {
  hostA = await startHost("Host A");
  hostB = await startHost("Host B");
  const left = hostA;
  const right = hostB;
  const tokenA = await login(left);
  const tokenB = await login(right);

  await step("Tailscale serve config merges the bridge handler only", async () => {
    const key = tailscaleWebKey("host.example.ts.net.");
    const merged = mergeBridgeServeConfig(null, key, 18_090);
    assert.equal(bridgeServeConfigured(merged, key, 18_090), true);
    assert.equal(bridgeServeConfigured(merged, key, 18_091), false);
  });

  await step("reach status without Tailscale is not ready", async () => {
    const response = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.reachStatus, { token: tokenB, body: {} });
    assert.equal(response.status, 200);
    assert.ok(isDynamicRecord(response.body) && response.body.ready === false);
  });

  await step("prepare without Tailscale fails", async () => {
    const response = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.prepareReach, { token: tokenB, body: {} });
    assert.equal(response.status, 503);
  });

  await step("protocol 10 advertises the link and protocol 9 does not", async () => {
    assert.ok(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).includes(REMOTE_AGENT_BRIDGE_CAPABILITY));
    assert.equal(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).includes(REMOTE_AGENT_BRIDGE_CAPABILITY), false);
    assert.equal(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V8).includes(REMOTE_AGENT_BRIDGE_CAPABILITY), false);
  });

  let code = "";
  await step("the owner creates an invite", async () => {
    const response = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.createInvite, { token: tokenB, body: {} });
    assert.equal(response.status, 201);
    assert.ok(isDynamicRecord(response.body) && isString(response.body.code) && isString(response.body.expiresAt));
    code = response.body.code;
    remember(code);
  });

  await step("the other host redeems the invite", async () => {
    const response = await call(left, "POST", REMOTE_AGENT_BRIDGE_ROUTES.redeem, { token: tokenA, body: { code } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(left.agents.remoteAgentBridge.listLinks().length, 1);
    assert.equal(right.agents.remoteAgentBridge.listLinks().length, 1);
  });

  await step("a member session cannot call a peer route", async () => {
    const response = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.agents, { token: tokenB, body: {} });
    assert.equal(response.status, 401);
  });

  await step("a link token cannot call a member route", async () => {
    const row = left.database.connection.prepare("SELECT token_ciphertext FROM remote_agent_bridge_links").get();
    const token = linkTokenFromRow(row);
    const response = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.invites, { token, body: {} });
    assert.equal(response.status, 401);
  });

  const note = join(root, "note.txt");
  await writeFile(note, "hello from the other server");
  let sentId = "";
  await step("a message and a file arrive on the other host", async () => {
    const link = left.agents.remoteAgentBridge.listLinks()[0];
    assert.ok(link);
    const sent = await runCauseEffect(
      left.agents.remoteAgentBridge.deliver({
        senderAgentId: left.agentId,
        senderAgentName: "Host A",
        recipients: [{ linkId: link.linkId, agentId: right.agentId }],
        text: "A file for you",
        paths: [note],
        replyToMessageId: null,
      }),
    );
    sentId = sent.messageIds[0] ?? "";
    const found = messages(right)
      .map((row) => readJsonRecord(row.message_json))
      .find(
        (message) =>
          isDynamicRecord(message) &&
          message.text === "A file for you" &&
          isDynamicRecord(message.sender) &&
          message.sender.kind === "remote-agent",
      );
    assert.ok(found && isDynamicRecord(found) && isDynamicRecord(found.sender));
    assert.equal(found.sender.serverName, "Host A");
    assert.ok(Array.isArray(found.attachments));
    assert.equal(
      found.attachments.some((file) => isDynamicRecord(file) && file.name === "note.txt"),
      true,
    );
  });

  await step("the reply uses the link of the received message", async () => {
    const incoming = messages(right)
      .map((row) => readJsonRecord(row.message_json))
      .find(
        (message) =>
          isDynamicRecord(message) &&
          isString(message.id) &&
          isDynamicRecord(message.sender) &&
          message.sender.kind === "remote-agent",
      );
    assert.ok(
      incoming &&
        isDynamicRecord(incoming) &&
        isString(incoming.id) &&
        isDynamicRecord(incoming.sender) &&
        isString(incoming.sender.linkId),
    );
    const incomingId = incoming.id;
    const incomingLinkId = incoming.sender.linkId;
    const link = right.agents.remoteAgentBridge.listLinks().find((row) => row.linkId === incomingLinkId);
    assert.ok(link);
    await runCauseEffect(
      right.agents.remoteAgentBridge.deliver({
        senderAgentId: right.agentId,
        senderAgentName: "Host B",
        recipients: [{ linkId: link.linkId, agentId: left.agentId }],
        text: "Got the file",
        paths: [],
        replyToMessageId: incomingId,
      }),
    );
    const replies = messages(left).map((row) => readJsonRecord(row.message_json));
    assert.equal(
      replies.some(
        (message) =>
          isDynamicRecord(message) && message.text === "Got the file" && message.replyToMessageId === incomingId,
      ),
      true,
    );
    const prompt = deliveryPromptInput(
      {
        delivery: {
          id: "delivery",
          messageId: incomingId,
          recipientAgentId: right.agentId,
          sender: {
            kind: "remote-agent",
            agentId: left.agentId,
            agentName: "Host A",
            linkId: incomingLinkId,
            serverName: "Host A",
          },
          text: "A file for you",
          attachments: [],
          replyToMessageId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          position: 0,
          status: "queued",
          turnId: null,
          error: null,
        },
        managedAttachments: [],
      } satisfies DeliveryContext,
      {
        agentNames: new Map(),
        snapshot: {
          agentId: right.agentId,
          threadId: null,
          activeTurnId: null,
          revision: 1,
          messages: [],
        },
        routineRun: null,
      } satisfies DeliveryPromptSources,
    );
    const text = JSON.stringify(prompt);
    assert.match(text, /Host A on Host A/);
    assert.match(text, new RegExp(`remote:${incomingLinkId}:${left.agentId}`));
  });

  await step("a second link to the same host is a second id", async () => {
    const created = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.createInvite, { token: tokenB, body: {} });
    const next = inviteCode(created.body);
    remember(next);
    const redeemed = await call(left, "POST", REMOTE_AGENT_BRIDGE_ROUTES.redeem, {
      token: tokenA,
      body: { code: next },
    });
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    const listed = await runCauseEffect(left.agents.remoteAgentBridge.listRemoteAgents());
    assert.equal(listed.length, 2);
    assert.equal(new Set(listed.map((agent) => agent.id)).size, 2);
    assert.equal(
      listed.every((agent) => agent.name.includes("Host B")),
      true,
    );
    assert.notEqual(listed[0]?.name, listed[1]?.name);
  });

  await step("an expired invite and a used invite fail", async () => {
    const created = await call(right, "POST", REMOTE_AGENT_BRIDGE_ROUTES.createInvite, { token: tokenB, body: {} });
    const { code: expired, inviteId } = inviteFields(created.body);
    remember(expired);
    right.database.connection
      .prepare("UPDATE remote_agent_bridge_invites SET expires_at = ? WHERE invite_id = ?")
      .run("2000-01-01T00:00:00.000Z", inviteId);
    const rejected = await call(left, "POST", REMOTE_AGENT_BRIDGE_ROUTES.redeem, {
      token: tokenA,
      body: { code: expired },
    });
    assert.equal(rejected.status, 409);
    assert.match(JSON.stringify(rejected.body), /expired/i);
    const again = await call(left, "POST", REMOTE_AGENT_BRIDGE_ROUTES.redeem, { token: tokenA, body: { code } });
    assert.notEqual(again.status, 200);
  });

  await step("a file over the limit sends nothing", async () => {
    const before = messages(right).length;
    const huge = join(root, "huge.bin");
    await writeFile(huge, "");
    const handle = await open(huge, "r+");
    await handle.truncate(ATTACHMENT_LIMITS.fileBytes + 1);
    await handle.close();
    const link = left.agents.remoteAgentBridge.listLinks()[0];
    assert.ok(link);
    await assert.rejects(
      () =>
        runCauseEffect(
          left.agents.remoteAgentBridge.deliver({
            senderAgentId: left.agentId,
            senderAgentName: "Host A",
            recipients: [{ linkId: link.linkId, agentId: right.agentId }],
            text: "too big",
            paths: [huge],
            replyToMessageId: null,
          }),
        ),
      (cause: unknown) =>
        cause instanceof RemoteAgentBridgeError &&
        cause.message === sourceText("error.backend.remoteAgentBridgeFileTooLarge"),
    );
    assert.equal(messages(right).length, before);
    assert.equal(
      messages(left).some((row) => row.message_json.includes("too big")),
      false,
    );
  });

  await step("a peer that does not answer fails without a retry", async () => {
    const link = left.agents.remoteAgentBridge.listLinks()[0];
    assert.ok(link);
    left.database.connection
      .prepare("UPDATE remote_agent_bridge_links SET peer_reach = ? WHERE link_id = ?")
      .run("not-a-url", link.linkId);
    const started = Date.now();
    await assert.rejects(
      () =>
        runCauseEffect(
          left.agents.remoteAgentBridge.deliver({
            senderAgentId: left.agentId,
            senderAgentName: "Host A",
            recipients: [{ linkId: link.linkId, agentId: right.agentId }],
            text: "offline",
            paths: [],
            replyToMessageId: null,
          }),
        ),
      (cause: unknown) =>
        cause instanceof RemoteAgentBridgeError &&
        cause.message === sourceText("error.backend.remoteAgentBridgePeerDown"),
    );
    assert.ok(Date.now() - started < 2_000);
  });

  await step("saved user, agent, and routine messages still decode", async () => {
    await runCauseEffect(
      left.mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [left.agentId], text: "from a person" }),
    );
    await runCauseEffect(
      left.mailbox.enqueue({
        sender: { kind: "agent", agentId: left.agentId },
        recipientAgentIds: [left.agentId],
        text: "from an agent",
      }),
    );
    await runCauseEffect(
      left.mailbox.enqueue({
        sender: {
          kind: "routine",
          routineId: "routine",
          runId: "run",
          routineName: "Morning",
          scheduledFor: "2026-01-01T08:00:00.000Z",
        },
        recipientAgentIds: [left.agentId],
        text: "from a routine",
      }),
    );
    const kinds = messages(left)
      .map((row) => senderKind(readJsonRecord(row.message_json)))
      .filter((kind): kind is string => kind !== null);
    assert.ok(kinds.includes("user"));
    assert.ok(kinds.includes("agent"));
    assert.ok(kinds.includes("routine"));
    assert.ok(kinds.includes("remote-agent"));
  });

  await step("remoteSender is sent only when the peer has the capability", async () => {
    const page = {
      agentId: "agent-1",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "m1",
          author: "agent",
          text: "hello",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "completed",
          remoteSender: { agentId: "ada", agentName: "Ada", serverName: "Host B" },
        },
      ],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    };
    const path = "/v1/agents/agent-1/conversation-page";
    const hidden = teamHttpCodec(9).encodeResponse("GET", path, 200, page, {});
    const shown = teamHttpCodec(9).encodeResponse("GET", path, 200, page, { remoteSender: true });
    const protocol7 = teamHttpCodec(7).encodeResponse("GET", path, 200, page, { remoteSender: true });
    assert.equal(hidden.includes("remoteSender"), false);
    assert.equal(shown.includes("remoteSender"), true);
    assert.equal(shown.includes("hello"), true);
    assert.equal(protocol7.includes("remoteSender"), false);
  });

  void sentId;
  report.passed = report.steps.every((item) => item.passed);
} catch (cause) {
  const error = cause instanceof Error ? cause.message : String(cause);
  if (!report.steps.some((item) => !item.passed)) report.steps.push({ name: "setup", passed: false, error });
  report.passed = false;
} finally {
  if (hostA) await stopHost(hostA);
  if (hostB) await stopHost(hostB);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify(report, null, 2);
  for (const secret of secrets) assert.equal(body.includes(secret), false);
  writeFileSync(join(OUT, "report.json"), body);
  process.stdout.write(`${body}\n`);
}

if (!report.passed) process.exit(1);
