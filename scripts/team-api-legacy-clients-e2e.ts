// Checks that a host of this build still serves the released Team API v1, v2 and v3 clients. A real
// `TeamApiServer` runs on loopback with the real team, agent, mailbox and sidebar stores on a
// temporary profile. Each client sends what its release sent and reads the reply with the frozen
// decoder of its protocol, so a change of a released wire meaning fails here:
// - v1: compatibility, the protocol gate, join, login, `bot`/`botId` wire keys and the event socket.
// - v2: the WebRTC frames of a real `TeamWebRtcHostPeer`, from the signed handshake to an RPC.
// - v3: agent duplication, its idempotent retry, and the refused request shapes.
// - v7 and v8: a v7 client on this host gets no v8 field; the v8 decoder reads the released v4-v7
//   fixtures; the v7 decoder still refuses a provider that it does not know.
// - v9: the v9 decoder reads the v9 fixtures, which have more than 128 capabilities; the v8 decoder
//   refuses them.
// - v8 over WebRTC: a browser tab opened from an agent's panel keeps its owner agent, and a secure
//   authentication answer and an agent profile save keep their agent (#3949).
// - context-usage-v1: a v8 client that asks for it gets the context of each agent it can see; any other
//   client gets the released runtime snapshot (#3584).
// Run: `bun scripts/team-api-legacy-clients-e2e.ts`.
// Writes .openbot-build/team-api-legacy-clients-e2e/report.json.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentContextState, BROWSER_SECRET_RESPONSE_PATH } from "@openbot/contracts/ipc";
import {
  createTeamProtocolV2Request,
  createTeamProtocolV8Event,
  decodeTeamProtocolSupportV1,
  decodeTeamProtocolV1Event,
  decodeTeamProtocolV1HttpRequest,
  decodeTeamProtocolV1HttpResponse,
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2RpcFrame,
  decodeTeamProtocolV3HttpRequest,
  decodeTeamProtocolV3HttpResponse,
  decodeTeamProtocolV7HttpResponse,
  decodeTeamProtocolV8CurrentEvent,
  decodeTeamProtocolV8HttpResponse,
  encodeTeamProtocolV1CurrentClientEvent,
  encodeTeamProtocolV2Frame,
  encodeTeamProtocolV8WebRtcHttpRequest,
  highestCommonTeamProtocol,
  TEAM_APP_VERSION_HEADER,
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CAPABILITIES_HEADER,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_V3,
  TEAM_PROTOCOL_V3_CAPABILITIES,
  TEAM_PROTOCOL_V7,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { decodeTeamProtocolSupportV8Base } from "@openbot/contracts/team-protocol/v8-base";
import { decodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import {
  decodeTeamProtocolSupportV9,
  TEAM_LONG_CAPABILITY_LISTS_CAPABILITY,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_V9_CAPABILITY_LIMIT,
} from "@openbot/contracts/team-protocol/v9";
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
import type { TeamWebRtcChannel } from "../src/main/team-webrtc-bridge";

const OUT = resolve(import.meta.dirname, "../.openbot-build/team-api-legacy-clients-e2e");
const FIXTURES = resolve(import.meta.dirname, "../packages/contracts/src/team-protocol/fixtures");
const HOST_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
/** The app version that a released client sends. The host must not choose by it. */
const CLIENT_VERSION = "0.3.5";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };

// The main process imports Electron for its windows and IPC. No check here opens a window, so each
// name is inert, and a call to one shows as a missing feature in the failing step.
plugin({
  name: "team-api-electron-boundary",
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
const { TeamWebRtcBridge } = await import("../src/main/team-webrtc-bridge");
const { TeamWebRtcHostPeer } = await import("../src/main/team-webrtc-host-peer");
const { RemoteWorkflowError } = await import("../src/main/remote-service-effects");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; host: { appVersion: string; port: number | null }; steps: Step[] } = {
  passed: false,
  host: { appVersion: HOST_VERSION, port: null },
  steps: [],
};

/** Runs one check. `summarize` keeps secrets and live objects out of the report. */
async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check waits for its event, and a missing event must fail.
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

function fixture(path: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, path), "utf8"));
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

/** No check needs the browser: a call to it is a failure. */
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
/** The owners of each tab that the Team API asked the browser to open. */
const openedTabOwners: { ownerThreadId: string | null; ownerAgentId: string | null }[] = [];
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: (url, ownerThreadId = null, ownerAgentId = null) => {
    openedTabOwners.push({ ownerThreadId, ownerAgentId });
    return Effect.succeed({ id: randomUUID(), title: "", url, loading: false, ownerThreadId, ownerAgentId });
  },
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

interface WireResponse {
  status: number;
  body: unknown;
}

/** One HTTP request as a released client sends it. `protocol: null` is a client from before the headers. */
async function wire(
  port: number,
  input: { protocol: number | string | null; method: string; path: string; body?: unknown; token?: string },
): Promise<WireResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.protocol !== null) {
    headers[TEAM_PROTOCOL_VERSION_HEADER] = String(input.protocol);
    headers[TEAM_APP_VERSION_HEADER] = CLIENT_VERSION;
    headers[TEAM_CAPABILITIES_HEADER] = (
      input.protocol === TEAM_PROTOCOL_V3 ? TEAM_PROTOCOL_V3_CAPABILITIES : TEAM_PROTOCOL_V1_CAPABILITIES
    ).join(",");
  }
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

/** A v1 client: the frozen v1 codec checks what it sends and reads what it gets back. */
async function v1(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  if (body !== undefined) decodeTeamProtocolV1HttpRequest(method, path, body);
  const response = await wire(port, { protocol: TEAM_PROTOCOL_V1, method, path, body, ...(token ? { token } : {}) });
  return {
    status: response.status,
    body: decodeTeamProtocolV1HttpResponse(method, path, response.status, response.body),
  };
}

/** A v3 client: the same, with the frozen v3 codec. */
async function v3(
  port: number,
  method: string,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  decodeTeamProtocolV3HttpRequest(method, path, body);
  const response = await wire(port, { protocol: TEAM_PROTOCOL_V3, method, path, body, token });
  return {
    status: response.status,
    body: decodeTeamProtocolV3HttpResponse(method, path, response.status, response.body),
  };
}

/** Waits for the first socket message that `pick` accepts. */
function nextMessage<T>(socket: WebSocket, pick: (value: unknown) => T | null): Promise<T> {
  return new Promise((resolveMessage, reject) => {
    const onMessage = (event: MessageEvent) => {
      let picked: T | null;
      try {
        picked = pick(JSON.parse(String(event.data)));
      } catch (error) {
        socket.removeEventListener("message", onMessage);
        reject(error);
        return;
      }
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

/** The bridge of a released v2 client: frames go to the host peer directly, with no Signal. */
class LoopbackBridge extends TeamWebRtcBridge {
  readonly sent: { peerId: string; channel: TeamWebRtcChannel; data: string }[] = [];
  readonly disconnected: string[] = [];
  readonly #waiters = new Set<() => void>();

  override readonly send = (peerId: string, channel: TeamWebRtcChannel, data: string | ArrayBuffer) =>
    Effect.sync(() => {
      if (typeof data === "string") this.sent.push({ peerId, channel, data });
      for (const wake of this.#waiters) wake();
    });

  /** As the WebRTC worker does, a closed peer connection reports `peer-disconnected` to the host. */
  override readonly disconnectPeer = (peerId: string) =>
    Effect.sync(() => {
      this.disconnected.push(peerId);
      queueMicrotask(() => this.emit("disconnected", peerId));
      for (const wake of this.#waiters) wake();
    });

  /** Waits until `pick` accepts the host's output, which includes what it sent before the call. */
  until<T>(pick: () => T | null): Promise<T> {
    return new Promise((resolveValue) => {
      const check = () => {
        const value = pick();
        if (value === null) return;
        this.#waiters.delete(check);
        resolveValue(value);
      };
      this.#waiters.add(check);
      check();
    });
  }

  /** The next frame on the RPC channel from index `from`, decoded by `decode`. */
  rpcFrom<T>(from: number, decode: (data: string) => T | null): Promise<T> {
    return this.until(() => {
      for (const frame of this.sent.slice(from)) {
        if (frame.channel !== "rpc") continue;
        const value = decode(frame.data);
        if (value !== null) return value;
      }
      return null;
    });
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-team-api-legacy-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
let agents: AgentService | null = null;
let server: InstanceType<typeof TeamApiServer> | null = null;
let socket: WebSocket | undefined;
const peers: InstanceType<typeof TeamWebRtcHostPeer>[] = [];

try {
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const identity = await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const source = await runCauseEffect(
    agents.createAgentProfile({
      name: "Research",
      description: "Finds sources.",
      avatarSeed: "research",
      avatarHue: null,
    }),
  );
  server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    agentAccess: access,
    appVersion: HOST_VERSION,
  });
  const port = await Effect.runPromise(server.start());
  report.host.port = port;

  // --- v1 over HTTP ---

  await step("v1 compatibility: a v1-only client finds protocol 1", async () => {
    const response = await wire(port, { protocol: null, method: "GET", path: "/v1/compatibility" });
    assert.equal(response.status, 200);
    const host = decodeTeamProtocolSupportV1(response.body);
    const released = decodeTeamProtocolSupportV1(fixture("v1/host-compatibility.json"));
    assert.equal(host.appVersion, HOST_VERSION);
    assert.equal(highestCommonTeamProtocol(released.protocol, host.protocol), TEAM_PROTOCOL_V1);
    assert.equal(highestCommonTeamProtocol({ minimum: 1, maximum: TEAM_PROTOCOL_V3 }, host.protocol), TEAM_PROTOCOL_V3);
    const missing = released.capabilities.filter((capability) => !host.capabilities.includes(capability));
    assert.deepEqual(missing, [], "The host stopped advertising a released v1 capability.");
    return { protocol: host.protocol, releasedCapabilities: released.capabilities };
  });

  await step("protocol gate: refuses clients that cannot be served, with the frozen error shape", async () => {
    const noHeaders = await wire(port, { protocol: null, method: "GET", path: "/v1/identity" });
    assert.equal(noHeaders.status, 426);
    const noHeadersBody = record(noHeaders.body, "426 body");
    assert.equal(noHeadersBody.code, "client_update_required");
    decodeTeamProtocolV1HttpResponse("GET", "/v1/identity", noHeaders.status, noHeaders.body);
    const tooNew = await wire(port, { protocol: 99, method: "GET", path: "/v1/identity" });
    assert.equal(tooNew.status, 426);
    assert.equal(record(tooNew.body, "426 body").code, "host_update_required");
    const malformed = await wire(port, { protocol: "one", method: "GET", path: "/v1/identity" });
    assert.equal(malformed.status, 400);
    assert.equal(record(malformed.body, "400 body").code, "protocol_error");
    const identityResponse = await v1(port, "GET", "/v1/identity");
    assert.equal(identityResponse.status, 200);
    assert.equal(record(identityResponse.body, "identity").serverId, identity.serverId);
    return { missingHeaders: 426, newerProtocol: 426, malformed: 400, v1Identity: 200 };
  });

  const invite = await runCauseEffect(team.createInvite("member"));
  const member = await step(
    "v1 join: preview, join and login with the released request bodies",
    async () => {
      const previewBody = { ...record(fixture("v1/client-http-request.json"), "fixture"), inviteToken: invite.token };
      const preview = await v1(port, "POST", "/v1/invitations/preview", previewBody);
      assert.equal(preview.status, 200);
      const joined = await v1(port, "POST", "/v1/join", { inviteToken: invite.token, ...MEMBER });
      assert.equal(joined.status, 201);
      const joinedBody = record(joined.body, "join");
      const joinedMember = record(joinedBody.member, "join member");
      assert.equal(joinedMember.username, MEMBER.username);
      assert.equal(joinedMember.role, "member");
      const reused = await wire(port, {
        protocol: TEAM_PROTOCOL_V1,
        method: "POST",
        path: "/v1/join",
        body: { inviteToken: invite.token, username: "second-user", password: MEMBER.password },
      });
      assert.ok(reused.status >= 400 && reused.status < 500, `A used invitation joined again: ${reused.status}.`);
      const login = await v1(port, "POST", "/v1/auth/login", MEMBER);
      assert.equal(login.status, 200);
      const loginBody = record(login.body, "login");
      const me = await v1(port, "GET", "/v1/me", undefined, text(loginBody.sessionToken, "session token"));
      assert.equal(me.status, 200);
      const meBody = record(me.body, "me");
      const releasedKeys = Object.keys(record(fixture("v1/host-http-response.json"), "fixture")).sort();
      assert.deepEqual(Object.keys(meBody).sort(), releasedKeys, "GET /v1/me changed its released keys.");
      assert.equal(meBody.id, joinedMember.id);
      return {
        id: text(joinedMember.id, "member id"),
        token: text(loginBody.sessionToken, "session token"),
        sessionExpiresAt: text(loginBody.sessionExpiresAt, "expiry"),
        reusedInviteStatus: reused.status,
      };
    },
    ({ id, reusedInviteStatus }) => ({ memberId: id, reusedInviteStatus }),
  );

  await step("v1 agents: the released `bot` vocabulary and provider view", async () => {
    const listed = await v1(port, "GET", "/v1/agents", undefined, member.token);
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body));
    const agent = listed.body.map((value) => record(value, "agent")).find((value) => value.id === source.id);
    assert.ok(agent, "The created agent is not in GET /v1/agents.");
    assert.equal(agent.name, "Research");
    const queue = await wire(port, {
      protocol: TEAM_PROTOCOL_V1,
      method: "GET",
      path: `/v1/agents/${source.id}/queue`,
      token: member.token,
    });
    assert.equal(queue.status, 200);
    const queueBody = record(queue.body, "queue");
    assert.equal(queueBody.botId, source.id, "A v1 queue lost its `botId` key.");
    assert.ok(!Object.hasOwn(queueBody, "agentId"), "A v1 queue has the current `agentId` key.");
    decodeTeamProtocolV1HttpResponse("GET", `/v1/agents/${source.id}/queue`, queue.status, queue.body);
    return { agentProvider: agent.provider, queueKeys: Object.keys(queueBody).sort() };
  });

  await step("v1 events: the released socket subprotocol, scope and `botId` events", async () => {
    const opened = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      TEAM_PROTOCOL_V1_WEBSOCKET,
      `openbot-token.${member.token}`,
    ]);
    socket = opened;
    await new Promise<void>((resolveOpen, reject) => {
      opened.addEventListener("open", () => resolveOpen(), { once: true });
      opened.addEventListener("error", () => reject(new Error("The v1 event socket did not open.")), { once: true });
    });
    assert.equal(opened.protocol, TEAM_PROTOCOL_V1_WEBSOCKET);
    const snapshot = nextMessage(opened, (value) => {
      const decoded = decodeTeamProtocolV1Event(value);
      return decoded.kind === "known" && decoded.event.type === "runtime-snapshot" ? decoded.event : null;
    });
    opened.send(JSON.stringify(fixture("v1/client-scope.json")));
    await snapshot;
    const memoriesChanged = nextMessage(opened, (value) => {
      const decoded = decodeTeamProtocolV1Event(value);
      assert.notEqual(decoded.kind, "invalid", `The host sent an invalid v1 event: ${JSON.stringify(value)}.`);
      return decoded.kind === "known" && decoded.event.type === "memories-changed" ? decoded.event : null;
    });
    const memory = await v1(
      port,
      "POST",
      `/v1/agents/${source.id}/memories`,
      { text: "Prefers primary sources." },
      member.token,
    );
    assert.ok(memory.status === 200 || memory.status === 201, `POST memories returned ${memory.status}.`);
    assert.equal(record(memory.body, "memory").botId, source.id);
    const event = await memoriesChanged;
    assert.equal(event.botId, source.id);
    opened.close();
    socket = undefined;
    return { subprotocol: opened.protocol, event };
  });

  // --- v3 over HTTP ---

  const duplicate = await step("v3 duplicate: 201 `{bot, layout}` and an idempotent retry", async () => {
    const body = { ...record(fixture("v3/client-http-request.json"), "fixture"), operationId: randomUUID() };
    const path = `/v1/agents/${source.id}/duplicate`;
    const first = await v3(port, "POST", path, body, member.token);
    assert.equal(first.status, 201);
    const firstBody = record(first.body, "duplicate");
    const copy = record(firstBody.bot, "bot");
    const layout = record(firstBody.layout, "layout");
    assert.notEqual(copy.id, source.id);
    const releasedKeys = Object.keys(record(fixture("v3/host-http-response.json"), "fixture")).sort();
    assert.deepEqual(Object.keys(firstBody).sort(), releasedKeys);
    const retry = await v3(port, "POST", path, body, member.token);
    assert.equal(retry.status, 201);
    assert.equal(record(record(retry.body, "retry").bot, "retry bot").id, copy.id, "A retry made a second copy.");
    const listed = await v1(port, "GET", "/v1/agents", undefined, member.token);
    assert.ok(Array.isArray(listed.body));
    assert.equal(listed.body.filter((value) => record(value, "agent").name === copy.name).length, 1);
    return { copyId: text(copy.id, "copy id"), layoutKeys: Object.keys(layout).sort() };
  });

  await step("v3 duplicate: refuses a body that is not exactly `{operationId}`", async () => {
    const path = `/v1/agents/${source.id}/duplicate`;
    const extra = await wire(port, {
      protocol: TEAM_PROTOCOL_V3,
      method: "POST",
      path,
      body: { operationId: randomUUID(), name: "Renamed" },
      token: member.token,
    });
    assert.ok(extra.status >= 400 && extra.status < 500, `An extra key was accepted: ${extra.status}.`);
    const notUuid = await wire(port, {
      protocol: TEAM_PROTOCOL_V3,
      method: "POST",
      path,
      body: { operationId: "not-a-uuid" },
      token: member.token,
    });
    assert.ok(notUuid.status >= 400 && notUuid.status < 500, `A bad operation id was accepted: ${notUuid.status}.`);
    const listed = await v1(port, "GET", "/v1/agents", undefined, member.token);
    assert.ok(Array.isArray(listed.body));
    assert.equal(listed.body.length, 2, "A refused duplicate request still made a copy.");
    return { extraKeyStatus: extra.status, badOperationIdStatus: notUuid.status };
  });

  // --- v7 and v8: open provider ids ---

  await step("v8 decoder: reads the released v4-v7 fixtures; v7 still refuses an unknown provider", async () => {
    const read: string[] = [];
    for (const version of [4, 5, 6, 7, 8]) {
      decodeTeamProtocolV8HttpResponse("GET", "/v1/agents", 200, fixture(`v${version}/host-http-response.json`));
      read.push(`v${version}/host-http-response.json`);
      if (version < 5) continue;
      decodeTeamProtocolV8HttpResponse(
        "GET",
        "/v1/agents/status",
        200,
        fixture(`v${version}/host-status-response.json`),
      );
      decodeTeamProtocolV8HttpResponse(
        "GET",
        "/v1/agents/models",
        200,
        fixture(`v${version}/host-models-response.json`),
      );
      read.push(`v${version}/host-status-response.json`, `v${version}/host-models-response.json`);
    }
    // The v8 fixtures carry a provider that no released protocol knows.
    for (const [path, name] of [
      ["/v1/agents", "host-http-response.json"],
      ["/v1/agents/status", "host-status-response.json"],
      ["/v1/agents/models", "host-models-response.json"],
    ] as const) {
      assert.throws(
        () => decodeTeamProtocolV7HttpResponse("GET", path, 200, fixture(`v8/${name}`)),
        `The v7 decoder read v8/${name}.`,
      );
    }
    return { read };
  });

  await step("v9 decoder: reads the v9 fixtures; the v8 decoder refuses more than 128 capabilities", async () => {
    const client = fixture("v9/client-capabilities.json");
    assert.ok(Array.isArray(client), "v9/client-capabilities.json is not a list.");
    assert.ok(
      client.length > 128 && client.length <= TEAM_PROTOCOL_V9_CAPABILITY_LIMIT,
      `v9/client-capabilities.json has ${client.length} capabilities.`,
    );
    assert.ok(client.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY), "The v9 client list has no marker.");
    const host = decodeTeamProtocolSupportV9(fixture("v9/host-compatibility.json"));
    assert.equal(host.protocol.maximum, TEAM_PROTOCOL_V9);
    assert.ok(
      host.capabilities.length > 128,
      `v9/host-compatibility.json has ${host.capabilities.length} capabilities.`,
    );
    assert.ok(host.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY), "The v9 host list has no marker.");
    assert.throws(
      () => decodeTeamProtocolSupportV8Base(fixture("v9/host-compatibility.json")),
      "The v8 decoder read v9/host-compatibility.json.",
    );
    return { client: client.length, host: host.capabilities.length };
  });

  await step("v7 client: this host serves protocol 7 without the v8 `displayName`", async () => {
    const compatibility = await wire(port, { protocol: null, method: "GET", path: "/v1/compatibility" });
    const host = record(record(compatibility.body, "compatibility").protocol, "protocol");
    assert.ok(Number(host.maximum) >= 8, `The host maximum is ${String(host.maximum)}.`);
    assert.equal(
      highestCommonTeamProtocol(
        { minimum: 1, maximum: TEAM_PROTOCOL_V7 },
        {
          minimum: Number(host.minimum),
          maximum: Number(host.maximum),
        },
      ),
      TEAM_PROTOCOL_V7,
    );
    const path = "/v1/agents/status";
    const v7 = await wire(port, { protocol: TEAM_PROTOCOL_V7, method: "GET", path, token: member.token });
    const v8 = await wire(port, { protocol: 8, method: "GET", path, token: member.token });
    assert.equal(v7.status, 200, `v7 status: ${v7.status}`);
    assert.equal(v8.status, 200, `v8 status: ${v8.status}`);
    const rows = (body: unknown) => {
      const providers = record(body, "status").providers;
      return Array.isArray(providers) ? providers.map((row) => record(row, "provider row")) : [];
    };
    const v7Rows = rows(decodeTeamProtocolV7HttpResponse("GET", path, 200, v7.body));
    const v8Rows = rows(decodeTeamProtocolV8HttpResponse("GET", path, 200, v8.body));
    assert.ok(
      v7Rows.every((row) => !Object.hasOwn(row, "displayName")),
      "A v7 row has a displayName.",
    );
    assert.ok(
      v8Rows.every((row) => typeof row.displayName === "string" && row.displayName.length > 0),
      "A v8 row has no displayName.",
    );
    // Protocol 7 knows only these providers. The host leaves out the rows of later ones, such as OpenRouter.
    const v7Providers = ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline", "pi", "muse"];
    assert.deepEqual(
      v7Rows.map((row) => row.id),
      v8Rows.map((row) => row.id).filter((id) => v7Providers.includes(String(id))),
      "v7 and v8 list different providers.",
    );
    return { providers: v8Rows.map((row) => `${String(row.id)}: ${String(row.displayName)}`) };
  });

  // --- context-usage-v1 ---

  const contextState = (agentId: string, threadId: string): AgentContextState => ({
    agentId,
    threadId,
    usage: {
      usedTokens: 52_000,
      windowTokens: 200_000,
      autoCompactAt: 0.9,
      nativeManaged: false,
      categories: [{ category: "messages", tokens: 40_000 }],
    },
    compaction: { id: `compaction-${threadId}`, startedAt: 1_793_000_000_000, status: "completed" },
  });
  const sourceContext = contextState(source.id, "thread-source");
  const sourceThreadContext = { ...contextState(source.id, "thread-source-side"), compaction: null };
  // No provider runs here, so the host reports what a provider would have reported. The copy is the
  // agent that the member cannot see.
  const hostAgents = agents;
  const runtimeSnapshot = hostAgents.getRuntimeSnapshot.bind(hostAgents);
  hostAgents.getRuntimeSnapshot = () => ({
    ...runtimeSnapshot(),
    contextStates: [sourceContext, contextState(duplicate.copyId, "thread-copy")],
    threadContextStates: [sourceThreadContext, contextState(duplicate.copyId, "thread-copy-side")],
  });

  /** The first runtime snapshot on the event socket of a current client that declares `capabilities`. */
  async function currentRuntimeSnapshot(capabilities: readonly string[]): Promise<JsonObject> {
    const opened = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      TEAM_PROTOCOL_V1_WEBSOCKET,
      `openbot-token.${member.token}`,
    ]);
    await new Promise<void>((resolveOpen, reject) => {
      opened.addEventListener("open", () => resolveOpen(), { once: true });
      opened.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
    });
    const snapshot = nextMessage(opened, (value) =>
      isRecord(value) && value.type === "runtime-snapshot" ? value : null,
    );
    opened.send(
      encodeTeamProtocolV1CurrentClientEvent({
        type: "agent-event-scope",
        includeConversations: false,
        capabilities: [...capabilities],
      }),
    );
    try {
      return await snapshot;
    } finally {
      opened.close();
    }
  }

  /** Sets what every member can do with the copy. */
  async function setCopyAccess(level: "none" | "manage") {
    const agentIds = new Set([source.id, duplicate.copyId]);
    await Effect.runPromise(
      access.set(
        identity.serverId,
        { revision: access.get(identity.serverId).revision, everyone: { [duplicate.copyId]: level }, roles: [] },
        agentIds,
        agentIds,
      ),
    );
  }

  await step("context-usage-v1: a v8 client gets the context of each agent that it can see", async () => {
    const capabilities = teamCapabilitiesForProtocol(8);
    assert.ok(capabilities.includes(TEAM_CONTEXT_USAGE_CAPABILITY), "A v8 client does not ask for context-usage-v1.");
    await setCopyAccess("none");
    try {
      const wire = await currentRuntimeSnapshot(capabilities);
      const decoded = decodeTeamProtocolV8BaseCurrentEvent(wire);
      assert.ok(
        decoded.kind === "known" && decoded.event.type === "runtime-snapshot",
        `The v8 snapshot did not decode: ${JSON.stringify(wire)}.`,
      );
      const { snapshot } = decoded.event;
      assert.deepEqual(snapshot.contextStates, [sourceContext], "The context is not that of the visible agent only.");
      assert.deepEqual(snapshot.threadContextStates, [sourceThreadContext]);
      return {
        contextStates: snapshot.contextStates?.length,
        threadContextStates: snapshot.threadContextStates?.length,
      };
    } finally {
      await setCopyAccess("manage");
    }
  });

  await step("context-usage-v1: a client that does not ask for it gets the released snapshot", async () => {
    assert.ok(
      !teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7).includes(TEAM_CONTEXT_USAGE_CAPABILITY),
      "A v7 client asks for context-usage-v1.",
    );
    const wire = await currentRuntimeSnapshot(
      teamCapabilitiesForProtocol(8).filter((capability) => capability !== TEAM_CONTEXT_USAGE_CAPABILITY),
    );
    const snapshot = record(wire.snapshot, "snapshot");
    assert.ok(!Object.hasOwn(snapshot, "contextStates"), "A client without context-usage-v1 got contextStates.");
    assert.ok(!Object.hasOwn(snapshot, "threadContextStates"), "A client without it got threadContextStates.");
    return { snapshotKeys: Object.keys(snapshot).sort() };
  });

  await step("context-usage-v1: a WebRTC event follows the capability; a bad value fails closed", async () => {
    const wire = await currentRuntimeSnapshot(teamCapabilitiesForProtocol(8));
    const relayed = decodeTeamProtocolV8CurrentEvent(createTeamProtocolV8Event(1, wire, { contextUsage: true }));
    assert.ok(relayed.status === "known" && relayed.event.type === "runtime-snapshot");
    assert.ok(relayed.event.snapshot.contextStates?.some((state) => state.agentId === source.id));
    const without = createTeamProtocolV8Event(2, wire, {});
    assert.ok(without.type === "event" && !JSON.stringify(without.payload).includes("contextStates"));
    const snapshot = record(wire.snapshot, "snapshot");
    const malformed = { ...wire, snapshot: { ...snapshot, contextStates: [{ botId: source.id, threadId: "t" }] } };
    assert.equal(decodeTeamProtocolV8BaseCurrentEvent(malformed).kind, "invalid");
    return { relayed: relayed.status, malformed: "invalid" };
  });
  // The steps after these read the snapshot that the host builds.
  hostAgents.getRuntimeSnapshot = runtimeSnapshot;

  // --- v2 over WebRTC frames ---

  const clientKeys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const fingerprints = { localFingerprint: "host-fingerprint", remoteFingerprint: "client-fingerprint" };

  /**
   * A released v2 client: Signal sent `connection`, then the client proves the ticket key.
   * `forged` signs another transcript; `request-first` sends an RPC before it authenticates.
   */
  async function connectV2(peerId: string, opening: "valid" | "forged" | "request-first" = "valid") {
    const bridge = new LoopbackBridge();
    const ticket = `ticket-${randomUUID()}`;
    const sessionId = randomUUID();
    const sessionExpiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const claims = {
      sessionId,
      hostId: identity.serverId,
      userId: `account-${member.id}`,
      membershipId: member.id,
      authEpoch: 1,
      sessionExpiresAt,
      role: "member" as const,
      clientPublicKey: clientKeys.publicKey,
    };
    const pathChanges: [sessionId: string, lost: boolean][] = [];
    const peer = new TeamWebRtcHostPeer(
      {
        bridge,
        store: team,
        appVersion: HOST_VERSION,
        transferDirectory: join(root, "transfers"),
        pathChanged: (changed, lost) => pathChanges.push([changed, lost]),
        verifyClientTicket: (presented) =>
          presented === ticket
            ? Effect.succeed(claims)
            : Effect.fail(new RemoteWorkflowError({ cause: new Error("Unknown ticket.") })),
      },
      { peerId, hostId: identity.serverId, localApiPort: port },
    );
    peers.push(peer);
    await Effect.runPromise(
      peer.incoming({
        hostId: identity.serverId,
        connectionId: randomUUID(),
        sessionId,
        userId: claims.userId,
        membershipId: member.id,
        role: "member",
        sessionExpiresAt,
      }),
    );
    bridge.emit("connected", peerId, fingerprints);
    if (opening === "request-first") {
      bridge.emit(
        "data",
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame(
          createTeamProtocolV2Request(randomUUID(), "http.request", { method: "GET", path: "/v1/agents", body: null }),
        ),
      );
    }
    const clientNonce = randomBytes(32).toString("base64url");
    const transcript = teamProtocolV2AuthenticationTranscript({
      hostId: identity.serverId,
      sessionId,
      ticket,
      clientPublicKey: clientKeys.publicKey,
      clientNonce,
      clientFingerprint: fingerprints.remoteFingerprint,
      hostFingerprint: fingerprints.localFingerprint,
    });
    const signed = opening === "forged" ? `${transcript}-forged` : transcript;
    bridge.emit(
      "data",
      peerId,
      "rpc",
      encodeTeamProtocolV2Frame({
        version: 2,
        type: "auth-init",
        ticket,
        clientPublicKey: clientKeys.publicKey,
        clientNonce,
        signature: sign(null, Buffer.from(signed), clientKeys.privateKey).toString("base64url"),
      }),
    );
    return { bridge, peer, ticket, sessionId, clientNonce, pathChanges };
  }

  function authFrame(data: string) {
    try {
      return decodeTeamProtocolV2AuthFrame(data);
    } catch {
      return null;
    }
  }

  function rpcFrame(data: string) {
    try {
      return decodeTeamProtocolV2RpcFrame(data);
    } catch {
      return null;
    }
  }

  function rpcResponse(requestId: string) {
    return (data: string) => {
      const frame = rpcFrame(data);
      return frame?.type === "response" && frame.requestId === requestId ? frame : null;
    };
  }

  const v2 = await step(
    "v2 handshake: the host signs the transcript and confirms the session",
    async () => {
      const connection = await connectV2("peer-v2");
      const ready = await connection.bridge.rpcFrom(0, (data) => {
        const frame = authFrame(data);
        return frame?.type === "auth-ready" ? frame : null;
      });
      assert.equal(ready.clientNonce, connection.clientNonce);
      const hostTranscript = teamProtocolV2AuthenticationTranscript({
        hostId: identity.serverId,
        sessionId: connection.sessionId,
        ticket: connection.ticket,
        clientPublicKey: clientKeys.publicKey,
        clientNonce: connection.clientNonce,
        hostNonce: ready.hostNonce,
        clientFingerprint: fingerprints.remoteFingerprint,
        hostFingerprint: fingerprints.localFingerprint,
      });
      assert.ok(
        verify(null, Buffer.from(hostTranscript), identity.publicKey, Buffer.from(ready.signature, "base64url")),
        "The host signature does not verify with the host key that the client pinned.",
      );
      connection.bridge.emit(
        "data",
        "peer-v2",
        "rpc",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "auth-complete",
          clientNonce: connection.clientNonce,
          hostNonce: ready.hostNonce,
        }),
      );
      await connection.bridge.rpcFrom(0, (data) => {
        const frame = authFrame(data);
        return frame?.type === "auth-confirmed" && frame.hostNonce === ready.hostNonce ? frame : null;
      });
      assert.ok(
        team.listSessions().some((session) => session.id === connection.sessionId),
        "The confirmed WebRTC session is not a team session.",
      );
      return connection;
    },
    ({ sessionId }) => ({ sessionId, confirmed: true }),
  );

  await step("v2 RPC: `http.request` frames reach the host with the released body vocabulary", async () => {
    const capabilities = record(fixture("v2/client-scope.json"), "fixture").capabilities;
    assert.ok(Array.isArray(capabilities));
    const call = async (method: "GET" | "POST", path: string, body: unknown = null) => {
      const requestId = randomUUID();
      const from = v2.bridge.sent.length;
      v2.bridge.emit(
        "data",
        "peer-v2",
        "rpc",
        encodeTeamProtocolV2Frame(
          createTeamProtocolV2Request(requestId, "http.request", { method, path, body, capabilities }),
        ),
      );
      const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
      assert.ok("result" in frame, `The ${method} ${path} frame failed: ${JSON.stringify(frame)}.`);
      return record(frame.result, "RPC result");
    };
    const listed = await call("GET", "/v1/agents");
    assert.equal(listed.status, 200);
    const agentsOverV2 = decodeTeamProtocolV1HttpResponse("GET", "/v1/agents", 200, listed.body);
    assert.ok(Array.isArray(agentsOverV2) && agentsOverV2.some((value) => record(value, "agent").id === source.id));
    const queue = await call("GET", `/v1/agents/${source.id}/queue`);
    assert.equal(record(queue.body, "queue").botId, source.id, "A v2 queue lost its `botId` key.");
    const duplicateOverV2 = await call("POST", `/v1/agents/${duplicate.copyId}/duplicate`, {
      operationId: randomUUID(),
    });
    assert.equal(duplicateOverV2.status, 201);
    const decoded = record(
      decodeTeamProtocolV3HttpResponse("POST", `/v1/agents/${duplicate.copyId}/duplicate`, 201, duplicateOverV2.body),
      "duplicate",
    );
    assert.notEqual(record(decoded.bot, "bot").id, duplicate.copyId);
    return { agents: agentsOverV2.length, queueKeys: Object.keys(record(queue.body, "queue")).sort() };
  });

  await step("v8 RPC: a browser tab opened over WebRTC keeps its owner agent", async () => {
    // What a current desktop client sends when the user opens a tab in an agent's browser panel.
    const path = "/v1/browser/open";
    const owners = { ownerThreadId: `openbot-thread-${source.id}`, ownerAgentId: source.id };
    const requestId = randomUUID();
    const from = v2.bridge.sent.length;
    openedTabOwners.length = 0;
    v2.bridge.emit(
      "data",
      "peer-v2",
      "rpc",
      encodeTeamProtocolV2Frame(
        createTeamProtocolV2Request(requestId, "http.request", {
          method: "POST",
          path,
          body: encodeTeamProtocolV8WebRtcHttpRequest("POST", path, {
            url: "https://example.com/",
            ...owners,
            focus: true,
          }),
          capabilities: [...teamCapabilitiesForProtocol(8)],
        }),
      ),
    );
    const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
    assert.ok("result" in frame, `The browser open frame failed: ${JSON.stringify(frame)}.`);
    assert.deepEqual(openedTabOwners, [owners], "The host opened the tab without its owner agent.");
    return owners;
  });

  await step("v8 RPC: a DELETE over WebRTC reaches the Team API", async () => {
    // A current client sends `{}` with a DELETE. No frozen codec has a body for it, so the host must
    // forward it and let the route answer, not fail it as a host error.
    const path = `/v1/agents/${source.id}/avatar`;
    const requestId = randomUUID();
    const from = v2.bridge.sent.length;
    v2.bridge.emit(
      "data",
      "peer-v2",
      "rpc",
      encodeTeamProtocolV2Frame(
        createTeamProtocolV2Request(requestId, "http.request", {
          method: "DELETE",
          path,
          body: encodeTeamProtocolV8WebRtcHttpRequest("DELETE", path, {}),
          capabilities: [...teamCapabilitiesForProtocol(8)],
        }),
      ),
    );
    const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
    const status = "result" in frame ? record(frame.result, "RPC result").status : frame.error?.status;
    assert.ok(
      "result" in frame || frame.error?.code !== "host_error",
      `The host failed the DELETE: ${JSON.stringify(frame)}.`,
    );
    return { status };
  });

  await step("v9 RPC: a protocol 9 peer gets the full list; a protocol 8 peer gets at most 128", async () => {
    // A WebRTC request has no protocol header: the host reads the protocol from the marker
    // capabilities. Protocols 7 and 8 read at most 128 capabilities, so their list leaves out the
    // protocol 9 ones.
    const compatibility = async (capabilities: readonly string[]) => {
      const requestId = randomUUID();
      const from = v2.bridge.sent.length;
      v2.bridge.emit(
        "data",
        "peer-v2",
        "rpc",
        encodeTeamProtocolV2Frame(
          createTeamProtocolV2Request(requestId, "http.request", {
            method: "GET",
            path: "/v1/compatibility",
            body: null,
            capabilities: [...capabilities],
          }),
        ),
      );
      const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
      assert.ok("result" in frame, `The compatibility frame failed: ${JSON.stringify(frame)}.`);
      return record(frame.result, "RPC result").body;
    };
    // The bootstrap list of a protocol 9 client has the marker, so its first read is complete.
    const first = decodeTeamProtocolSupportV9(await compatibility(TEAM_BOOTSTRAP_CAPABILITIES));
    assert.equal(first.protocol.maximum, TEAM_PROTOCOL_V9);
    assert.ok(first.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY), "The protocol 9 list has no marker.");
    // A protocol 9 request may carry more than 128 capabilities.
    const full = decodeTeamProtocolSupportV9(await compatibility(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)));
    assert.deepEqual(full.capabilities, first.capabilities);
    // The released protocol 8 decoder still reads what a protocol 8 peer gets.
    const v8 = decodeTeamProtocolSupportV8Base(await compatibility(teamCapabilitiesForProtocol(8)));
    assert.ok(v8.capabilities.length <= 128, `A protocol 8 peer got ${v8.capabilities.length} capabilities.`);
    assert.ok(!v8.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY), "A protocol 8 peer got the marker.");
    assert.ok(
      !v8.capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY),
      "A protocol 8 peer got a protocol 9 capability.",
    );
    return { protocol9: first.capabilities.length, protocol8: v8.capabilities.length };
  });

  await step("v8 RPC: a secure authentication answer over WebRTC reaches the agent (#3949)", async () => {
    // The answer names its agent as `agentId` on every protocol. With `botId`, the Team API refused
    // the body with 400 before the agent service read it.
    const path = BROWSER_SECRET_RESPONSE_PATH;
    const requestId = randomUUID();
    const from = v2.bridge.sent.length;
    v2.bridge.emit(
      "data",
      "peer-v2",
      "rpc",
      encodeTeamProtocolV2Frame(
        createTeamProtocolV2Request(requestId, "http.request", {
          method: "POST",
          path,
          body: encodeTeamProtocolV8WebRtcHttpRequest("POST", path, {
            requestId: "no-such-request",
            agentId: source.id,
            decision: "cancel",
          }),
          capabilities: [...teamCapabilitiesForProtocol(8)],
        }),
      ),
    );
    const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
    // No secure card is open, so the agent service answers that the request is no longer active.
    const error = "error" in frame ? frame.error : undefined;
    assert.equal(
      error?.message,
      sourceText("error.backend.authRequestInactive"),
      `The answer did not reach the agent service: ${JSON.stringify(frame)}.`,
    );
    return { status: error?.status };
  });

  await step("v8 RPC: an agent profile save over WebRTC keeps its agent", async () => {
    // The profile routes also read `agentId` on the wire. With `botId`, the Team API read a save of an
    // agent as a new agent with no first message and refused it with 400.
    const path = "/v1/agents/profile/save";
    const requestId = randomUUID();
    const from = v2.bridge.sent.length;
    v2.bridge.emit(
      "data",
      "peer-v2",
      "rpc",
      encodeTeamProtocolV2Frame(
        createTeamProtocolV2Request(requestId, "http.request", {
          method: "POST",
          path,
          body: encodeTeamProtocolV8WebRtcHttpRequest("POST", path, {
            operationId: randomUUID(),
            agentId: "no-such-agent",
            draft: {
              name: "Smoke",
              title: "",
              description: "Profile check",
              avatarSeed: "smoke",
              avatarHue: null,
              sectionId: null,
            },
          }),
          capabilities: [...teamCapabilitiesForProtocol(8)],
        }),
      ),
    );
    const frame = await v2.bridge.rpcFrom(from, rpcResponse(requestId));
    // The agent does not exist, so the agent service answers for that agent and not for a new one.
    const error = "error" in frame ? frame.error : undefined;
    assert.equal(
      error?.message,
      sourceText("error.agent.gone"),
      `The save did not keep its agent: ${JSON.stringify(frame)}.`,
    );
    return { status: error?.status };
  });

  await step("v2 path: a failed ICE path marks the session away and keeps it open (#3583)", async () => {
    v2.bridge.emit("pathLost", "other-peer");
    assert.deepEqual(v2.pathChanges, [], "The path of another peer must not change this session.");
    v2.bridge.emit("pathLost", "peer-v2");
    v2.bridge.emit("pathRestored", "peer-v2");
    assert.deepEqual(v2.pathChanges, [
      [v2.sessionId, true],
      [v2.sessionId, false],
    ]);
    assert.deepEqual(v2.bridge.disconnected, [], "A failed path must not drop the peer.");
    assert.ok(
      team.listSessions().some((session) => session.id === v2.sessionId),
      "A failed path must not end the team session.",
    );
    return v2.pathChanges;
  });

  await step("v2 handshake: a forged proof or an RPC before the proof gets no session", async () => {
    const before = team.listSessions().length;
    const results: Record<string, boolean> = {};
    for (const [peerId, opening] of [
      ["peer-forged", "forged"],
      ["peer-request-first", "request-first"],
    ] as const) {
      const refused = await connectV2(peerId, opening);
      await refused.bridge.until(() => (refused.bridge.disconnected.includes(peerId) ? true : null));
      const ready = refused.bridge.sent
        .map((frame) => authFrame(frame.data))
        .find((frame) => frame?.type === "auth-ready");
      if (opening === "forged") assert.equal(ready, undefined, "The host signed for a forged proof.");
      // A completion that was in flight when the connection closed: the host must refuse it.
      refused.bridge.emit(
        "data",
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame({
          version: 2,
          type: "auth-complete",
          clientNonce: refused.clientNonce,
          hostNonce: ready?.type === "auth-ready" ? ready.hostNonce : randomBytes(32).toString("base64url"),
        }),
      );
      const outcome = await refused.bridge.until(() => {
        if (refused.bridge.sent.some((frame) => authFrame(frame.data)?.type === "auth-confirmed")) return "confirmed";
        return refused.bridge.disconnected.filter((id) => id === peerId).length > 1 ? "refused" : null;
      });
      assert.equal(outcome, "refused", `The ${opening} client was confirmed.`);
      assert.ok(
        !refused.bridge.sent.some((frame) => {
          const response = rpcFrame(frame.data);
          return response?.type === "response" && "result" in response;
        }),
        `The ${opening} client got an RPC result.`,
      );
      results[opening] = true;
    }
    assert.equal(team.listSessions().length, before, "A refused handshake opened a session.");
    return { disconnected: results };
  });

  await step("v2 revoke: the host ends the session of a revoked WebRTC member", async () => {
    await Effect.runPromise(v2.peer.revokeSession(v2.sessionId));
    await v2.bridge.until(() => (v2.bridge.disconnected.includes("peer-v2") ? true : null));
    await runCauseEffect(team.revokeSession(v2.sessionId));
    assert.ok(!team.listSessions().some((session) => session.id === v2.sessionId));
    return { sessionId: v2.sessionId };
  });

  report.passed = report.steps.every((entry) => entry.passed);
} finally {
  socket?.close();
  for (const peer of peers) await Effect.runPromise(peer.dispose()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`Team API v1-v3, v7 and v8 clients passed. Report: ${join(OUT, "report.json")}\n`);
