import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentModelOption, LEGACY_AGENT_REASONING_EFFORTS } from "@openbot/contracts/ipc";
import {
  createTeamProtocolV2Request,
  decodeTeamProtocolSupportV9,
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol";
import {
  expandTeamCapabilitiesV10,
  TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES,
  TEAM_WEB_CLIENT_PROTOCOL,
  teamCapabilitiesForProtocol,
  teamCapabilityHeaders,
  teamCapabilityLists,
  teamWebRtcClientProtocol,
} from "@openbot/contracts/team-protocol/current";
import {
  TEAM_REASONING_EFFORTS,
  TEAM_REASONING_EFFORTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/reasoning-efforts-v1";
import { TEAM_LONG_CAPABILITY_LISTS_CAPABILITY, TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import {
  decodeTeamProtocolSupportV10,
  TEAM_ABSENT_CAPABILITIES_HEADER,
  TEAM_CAPABILITY_BASELINE_CAPABILITY,
  TEAM_PROTOCOL_V10,
} from "@openbot/contracts/team-protocol/v10";
import { decodeTeamProtocolV10WebRtcHttpResponse } from "@openbot/contracts/team-protocol/v10-webrtc-adapter";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamWebRtcChannel } from "../src/main/team-webrtc-bridge";
import { readWebHostCompatibility } from "../src/renderer/src/features/web-client/web-host-compatibility";

const OUT = resolve(import.meta.dirname, "../.openbot-build/team-protocol-v10-e2e");
const FIXTURES = resolve(import.meta.dirname, "../packages/contracts/src/team-protocol/fixtures");
const HOST_VERSION = "0.0.0-e2e";
const CLIENT_VERSION = "0.74.0";
const STEP_DEADLINE_MS = 30_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const MAC_APPS_LIMIT = "mac-apps-limit-v1";

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
const { RemoteServerClient } = await import("../src/main/remote-server-client");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: {
  passed: boolean;
  host: { appVersion: string; platform: string; port: number | null };
  steps: Step[];
} = { passed: false, host: { appVersion: HOST_VERSION, platform: process.platform, port: null }, steps: [] };

async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
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

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function fixture(path: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, path), "utf8"));
}

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

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
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

interface WireResponse {
  status: number;
  body: unknown;
}

async function http(
  port: number,
  input: { protocol: number; method?: string; path: string; body?: unknown; token?: string },
  headers: Record<string, string>,
): Promise<WireResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(input.protocol),
      [TEAM_APP_VERSION_HEADER]: CLIENT_VERSION,
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      ...headers,
    },
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

class LoopbackBridge extends TeamWebRtcBridge {
  readonly sent: { peerId: string; channel: TeamWebRtcChannel; data: string }[] = [];
  readonly #waiters = new Set<() => void>();

  override readonly send = (peerId: string, channel: TeamWebRtcChannel, data: string | ArrayBuffer) =>
    Effect.sync(() => {
      if (typeof data === "string") this.sent.push({ peerId, channel, data });
      for (const wake of this.#waiters) wake();
    });

  override readonly disconnectPeer = (peerId: string) =>
    Effect.sync(() => {
      queueMicrotask(() => this.emit("disconnected", peerId));
      for (const wake of this.#waiters) wake();
    });

  rpcFrom<T>(from: number, pick: (data: string) => T | null): Promise<T> {
    return new Promise((resolveValue) => {
      const check = () => {
        for (const frame of this.sent.slice(from)) {
          if (frame.channel !== "rpc") continue;
          const value = pick(frame.data);
          if (value === null) continue;
          this.#waiters.delete(check);
          resolveValue(value);
          return;
        }
      };
      this.#waiters.add(check);
      check();
    });
  }
}

function authFrame(data: string) {
  try {
    return decodeTeamProtocolV2AuthFrame(data);
  } catch {
    return null;
  }
}

function rpcResponse(requestId: string) {
  return (data: string) => {
    try {
      const frame = decodeTeamProtocolV2RpcFrame(data);
      return frame.type === "response" && frame.requestId === requestId ? frame : null;
    } catch {
      return null;
    }
  };
}

function startProtocol9Host(): Promise<{ server: Server; port: number; protocols: string[]; absent: string[] }> {
  const protocols: string[] = [];
  const absent: string[] = [];
  const support = decodeTeamProtocolSupportV9(fixture("v9/host-compatibility.json"));
  const server = createServer((request, response) => {
    const protocol = String(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()] ?? "");
    protocols.push(protocol);
    const absentHeader = request.headers[TEAM_ABSENT_CAPABILITIES_HEADER.toLowerCase()];
    if (absentHeader !== undefined) absent.push(String(absentHeader));
    response.setHeader("Content-Type", "application/json");
    if (request.url !== "/v1/compatibility") {
      response.writeHead(404).end(JSON.stringify({ error: "Not found.", code: "not_found" }));
    } else if (Number(protocol) > TEAM_PROTOCOL_V9) {
      response
        .writeHead(426)
        .end(JSON.stringify({ error: "Update the host.", code: "host_update_required", host: support }));
    } else {
      const known = new Set<string>(teamCapabilitiesForProtocol(Number(protocol) || TEAM_PROTOCOL_V1));
      const capabilities = support.capabilities.filter((capability) => known.has(capability));
      response.writeHead(200).end(JSON.stringify({ ...support, capabilities }));
    }
  });
  return new Promise((resolveHost) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address !== null && typeof address === "object");
      resolveHost({ server, port: address.port, protocols, absent });
    });
  });
}

const root = await mkdtemp(join(tmpdir(), "openbot-team-protocol-v10-"));
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
let protocol9Host: Server | null = null;
const peers: InstanceType<typeof TeamWebRtcHostPeer>[] = [];

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const identity = await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const source = await runCauseEffect(
    agents.createAgentProfile({ name: "Research", description: "Finds sources.", avatarSeed: "r", avatarHue: null }),
  );
  const wideModel: AgentModelOption = {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Reasoning model.",
    defaultReasoningEffort: "none",
    supportedReasoningEfforts: [...TEAM_REASONING_EFFORTS],
  };
  const hostAgents = agents;
  const listAgents = hostAgents.listAgents.bind(hostAgents);
  hostAgents.listModels = () => [wideModel];
  hostAgents.listAgents = () =>
    listAgents().map((agent) =>
      agent.id === source.id ? { ...agent, model: wideModel.id, reasoningEffort: "ultra" } : agent,
    );
  server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: {
      listTabs: () => [],
      getControlState: () => ({ sessions: [] }),
      open: unused,
      activate: unused,
      navigate: unused,
      reload: unused,
      stop: unused,
      answerPermission: unused,
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
      answerViewDialog: unused,
      importSignIn: unused,
      answerHttpSignIn: unused,
    },
    sidebarLayout: sidebar,
    agentAccess: access,
    appVersion: HOST_VERSION,
  });
  const port = await Effect.runPromise(server.start());
  report.host.port = port;
  const apiUrl = `http://127.0.0.1:${port}`;

  await step("baseline: the registry makes the frozen protocol 9 list", async () => {
    const frozen = fixture("v10/baseline-capabilities.json");
    assert.deepEqual([...TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES], frozen);
    assert.deepEqual([...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)], frozen);
    assert.ok(!TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES.includes(TEAM_CAPABILITY_BASELINE_CAPABILITY));
    return { names: TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES.length };
  });

  const protocol9List = await step(
    "HTTP protocol 9: a protocol 9 client gets the protocol 9 list, with no `absent`",
    async () => {
      const response = await http(
        port,
        { protocol: TEAM_PROTOCOL_V9, path: "/v1/compatibility" },
        { [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(",") },
      );
      assert.equal(response.status, 200);
      assert.ok(!Object.hasOwn(record(response.body, "compatibility"), "absent"), "A protocol 9 answer has `absent`.");
      const support = decodeTeamProtocolSupportV9(response.body);
      assert.deepEqual(support.protocol, { minimum: TEAM_PROTOCOL_V1, maximum: TEAM_PROTOCOL_V10 });
      const baseline = new Set<string>(TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES);
      assert.deepEqual(
        support.capabilities,
        TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES.filter((capability) => support.capabilities.includes(capability)),
      );
      assert.ok(support.capabilities.every((capability) => baseline.has(capability)));
      assert.ok(support.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY));
      assert.equal(support.capabilities.includes(MAC_APPS_LIMIT), process.platform !== "darwin");
      return support.capabilities;
    },
    (capabilities) => ({ names: capabilities.length }),
  );

  const protocol10Set = await step(
    "HTTP protocol 10: the two lists give the full set; `absent` has the baseline names that the host does not serve",
    async () => {
      const response = await http(
        port,
        { protocol: TEAM_PROTOCOL_V10, path: "/v1/compatibility" },
        teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
      );
      assert.equal(response.status, 200);
      const support = decodeTeamProtocolSupportV10(response.body);
      assert.ok(support.capabilities.includes(TEAM_CAPABILITY_BASELINE_CAPABILITY));
      assert.ok(support.capabilities.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY));
      assert.ok(
        support.capabilities.length < protocol9List.length,
        "The protocol 10 `capabilities` list repeats the baseline.",
      );
      const baseline = new Set<string>(TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES);
      assert.ok(support.absent.every((capability) => baseline.has(capability)));
      assert.deepEqual(
        sorted(support.absent),
        sorted(TEAM_PROTOCOL_V10_BASELINE_CAPABILITIES.filter((capability) => !protocol9List.includes(capability))),
      );
      assert.equal(support.absent.includes(MAC_APPS_LIMIT), process.platform === "darwin");
      const expanded = expandTeamCapabilitiesV10(support);
      assert.equal(expanded.includes(MAC_APPS_LIMIT), process.platform !== "darwin");
      const after9 = support.capabilities.filter((capability) => !baseline.has(capability));
      assert.deepEqual(sorted(expanded), sorted([...protocol9List, ...after9]));
      return { expanded, absent: support.absent, capabilities: support.capabilities };
    },
    ({ absent, capabilities, expanded }) => ({ capabilities, absent, expanded: expanded.length }),
  );

  const desktop = new RemoteServerClient({
    appVersion: CLIENT_VERSION,
    servers: {
      require: () => {
        throw new Error("No stored server is used by this check.");
      },
      token: () => "",
    },
    connections: {
      compatibilityFor: () => null,
      issueFor: () => null,
      setCompatibility: () => {},
      clearStaleIssue: () => {},
      reportError: () => {},
    },
    transport: null,
  });

  await step("HTTP desktop client: negotiates protocol 10 with this host and reads the full set", async () => {
    const compatibility = await Effect.runPromise(desktop.negotiateCompatibility(apiUrl));
    assert.equal(compatibility.negotiatedProtocol, TEAM_PROTOCOL_V10);
    assert.deepEqual(sorted(compatibility.capabilities), sorted(protocol10Set.expanded));
    return { negotiatedProtocol: compatibility.negotiatedProtocol, names: compatibility.capabilities.length };
  });

  const v9Host = await startProtocol9Host();
  protocol9Host = v9Host.server;
  await step("HTTP desktop client: a host of protocols 1-9 gets protocol 9 and no protocol 10 request", async () => {
    const compatibility = await Effect.runPromise(
      desktop.negotiateCompatibility(`http://127.0.0.1:${String(v9Host.port)}`),
    );
    assert.equal(compatibility.negotiatedProtocol, TEAM_PROTOCOL_V9);
    const released = decodeTeamProtocolSupportV9(fixture("v9/host-compatibility.json"));
    assert.deepEqual(compatibility.capabilities, released.capabilities);
    assert.ok(!v9Host.protocols.includes(String(TEAM_PROTOCOL_V10)), `Protocols sent: ${v9Host.protocols.join()}.`);
    assert.deepEqual(v9Host.absent, []);
    return { negotiatedProtocol: compatibility.negotiatedProtocol, protocolsSent: v9Host.protocols };
  });

  const invite = await runCauseEffect(team.createInvite("member"));
  const v1Headers = { [TEAM_CAPABILITIES_HEADER]: TEAM_PROTOCOL_V1_CAPABILITIES.join(",") };
  const joined = await http(
    port,
    { protocol: TEAM_PROTOCOL_V1, method: "POST", path: "/v1/join", body: { inviteToken: invite.token, ...MEMBER } },
    v1Headers,
  );
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  const memberId = text(record(record(joined.body, "join").member, "member").id, "member id");
  const login = await http(
    port,
    { protocol: TEAM_PROTOCOL_V1, method: "POST", path: "/v1/auth/login", body: MEMBER },
    v1Headers,
  );
  assert.equal(login.status, 200);
  const token = text(record(login.body, "login").sessionToken, "session token");

  async function effortsOverHttp(headers: Record<string, string>) {
    const models = await http(port, { protocol: TEAM_PROTOCOL_V10, path: "/v1/agents/models", token }, headers);
    assert.equal(models.status, 200, JSON.stringify(models.body));
    assert.ok(Array.isArray(models.body));
    return record(
      models.body.find((entry) => isRecord(entry) && entry.id === wideModel.id),
      "wide model",
    );
  }

  const withoutEfforts = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).filter(
    (capability) => capability !== TEAM_REASONING_EFFORTS_CAPABILITY,
  );
  await step("HTTP protocol 10: a baseline capability in `absent` is not served to the client", async () => {
    const full = await effortsOverHttp(
      teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
    );
    assert.equal(full.defaultReasoningEffort, "none");
    assert.deepEqual(full.supportedReasoningEfforts, [...TEAM_REASONING_EFFORTS]);
    const headers = teamCapabilityHeaders(TEAM_PROTOCOL_V10, withoutEfforts);
    assert.equal(headers[TEAM_ABSENT_CAPABILITIES_HEADER], TEAM_REASONING_EFFORTS_CAPABILITY);
    const left = await effortsOverHttp(headers);
    assert.equal(left.defaultReasoningEffort, "low");
    assert.deepEqual(left.supportedReasoningEfforts, [...LEGACY_AGENT_REASONING_EFFORTS]);
    return { full: full.defaultReasoningEffort, absent: left.defaultReasoningEffort };
  });

  await step(
    "HTTP protocol 10: a malformed list fails closed with protocol_error on a route behind the protocol gate",
    async () => {
      const invalidName = await http(
        port,
        { protocol: TEAM_PROTOCOL_V10, path: "/v1/agents/models", token },
        {
          ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
          [TEAM_ABSENT_CAPABILITIES_HEADER]: "Not A Name",
        },
      );
      const tooLong = await http(
        port,
        { protocol: TEAM_PROTOCOL_V10, path: "/v1/agents/models", token },
        {
          ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
          [TEAM_ABSENT_CAPABILITIES_HEADER]: Array.from({ length: 300 }, (_, index) => `name-${index}`).join(","),
        },
      );
      for (const response of [invalidName, tooLong]) {
        assert.equal(response.status, 400, JSON.stringify(response.body));
        assert.equal(record(response.body, "400 body").code, "protocol_error");
      }
      const unknown = await http(
        port,
        { protocol: TEAM_PROTOCOL_V10, path: "/v1/agents/models", token },
        {
          ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)),
          [TEAM_ABSENT_CAPABILITIES_HEADER]: "a-name-from-later",
        },
      );
      assert.equal(unknown.status, 200);
      return { invalidName: invalidName.status, tooLong: tooLong.status, unknownName: unknown.status };
    },
  );

  const clientKeys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const fingerprints = { localFingerprint: "host-fingerprint", remoteFingerprint: "client-fingerprint" };

  async function connectWebRtc(peerId: string) {
    const bridge = new LoopbackBridge();
    const ticket = `ticket-${randomUUID()}`;
    const sessionId = randomUUID();
    const sessionExpiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const claims = {
      sessionId,
      hostId: identity.serverId,
      userId: `account-${memberId}`,
      membershipId: memberId,
      authEpoch: 1,
      sessionExpiresAt,
      role: "member" as const,
      clientPublicKey: clientKeys.publicKey,
    };
    const peer = new TeamWebRtcHostPeer(
      {
        bridge,
        store: team,
        appVersion: HOST_VERSION,
        transferDirectory: join(root, "transfers"),
        pathChanged: () => {},
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
        membershipId: memberId,
        role: "member",
        sessionExpiresAt,
      }),
    );
    bridge.emit("connected", peerId, fingerprints);
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
        signature: sign(null, Buffer.from(transcript), clientKeys.privateKey).toString("base64url"),
      }),
    );
    const ready = await bridge.rpcFrom(0, (data) => {
      const frame = authFrame(data);
      return frame?.type === "auth-ready" ? frame : null;
    });
    bridge.emit(
      "data",
      peerId,
      "rpc",
      encodeTeamProtocolV2Frame({ version: 2, type: "auth-complete", clientNonce, hostNonce: ready.hostNonce }),
    );
    await bridge.rpcFrom(0, (data) => {
      const frame = authFrame(data);
      return frame?.type === "auth-confirmed" ? frame : null;
    });

    async function call(path: string, keys: { capabilities: string[]; absent?: string[] }) {
      const requestId = randomUUID();
      const from = bridge.sent.length;
      bridge.emit(
        "data",
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame(
          createTeamProtocolV2Request(requestId, "http.request", { method: "GET", path, body: null, ...keys }),
        ),
      );
      return bridge.rpcFrom(from, rpcResponse(requestId));
    }
    return { call };
  }

  const web = await connectWebRtc("peer-web");
  await step("WebRTC web client: protocol 10 with this host, and the full set after a second read", async () => {
    let known: number | undefined;
    const sent: { capabilities: number; absent: boolean }[] = [];
    const { support, negotiated } = await readWebHostCompatibility(async () => {
      const keys = known !== undefined && known >= TEAM_PROTOCOL_V10 ? known : undefined;
      const lists = teamCapabilityLists(keys, teamCapabilitiesForProtocol(keys));
      sent.push({ capabilities: lists.capabilities.length, absent: lists.absent !== undefined });
      const frame = await web.call("/v1/compatibility", lists);
      assert.ok("result" in frame, JSON.stringify(frame));
      const result = record(frame.result, "result");
      const body = decodeTeamProtocolV10WebRtcHttpResponse("GET", "/v1/compatibility", 200, result.body);
      known =
        teamWebRtcClientProtocol(decodeTeamProtocolSupportV9(body).protocol, TEAM_WEB_CLIENT_PROTOCOL).protocol ??
        undefined;
      return body;
    });
    assert.equal(negotiated.protocol, TEAM_PROTOCOL_V10);
    assert.equal(sent.length, 2, "The web client did not read the protocol 10 lists.");
    assert.deepEqual(sorted(support.capabilities), sorted(protocol10Set.expanded));
    return { protocol: negotiated.protocol, reads: sent, names: support.capabilities.length };
  });

  await step("WebRTC web client: a host of protocols 1-9 stays on protocol 9 with one read", async () => {
    let reads = 0;
    const { support, negotiated } = await readWebHostCompatibility(async () => {
      reads += 1;
      return fixture("v9/host-compatibility.json");
    });
    assert.equal(negotiated.protocol, TEAM_PROTOCOL_V9);
    assert.equal(negotiated.update, null);
    assert.equal(reads, 1);
    return { protocol: negotiated.protocol, reads, names: support.capabilities.length };
  });

  const mobile = await connectWebRtc("peer-mobile");
  await step("WebRTC protocol 9 peer (mobile): gets the protocol 9 list, with no `absent`", async () => {
    const frame = await mobile.call("/v1/compatibility", {
      capabilities: [...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)],
    });
    assert.ok("result" in frame, JSON.stringify(frame));
    const body = record(record(frame.result, "result").body, "body");
    assert.ok(!Object.hasOwn(body, "absent"));
    const support = decodeTeamProtocolSupportV9(body);
    assert.deepEqual(support.capabilities, protocol9List);
    assert.deepEqual(teamWebRtcClientProtocol(support.protocol), { protocol: TEAM_PROTOCOL_V9, update: null });
    return { names: support.capabilities.length };
  });

  await step("WebRTC protocol 10: a baseline capability in `absent` is not served to the client", async () => {
    const efforts = async (keys: { capabilities: string[]; absent?: string[] }) => {
      const frame = await web.call("/v1/agents/models", keys);
      assert.ok("result" in frame, JSON.stringify(frame));
      const models = record(frame.result, "result").body;
      assert.ok(Array.isArray(models));
      return record(
        models.find((entry) => isRecord(entry) && entry.id === wideModel.id),
        "wide model",
      );
    };
    const full = await efforts(teamCapabilityLists(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)));
    assert.equal(full.defaultReasoningEffort, "none");
    const lists = teamCapabilityLists(TEAM_PROTOCOL_V10, withoutEfforts);
    assert.deepEqual(lists.absent, [TEAM_REASONING_EFFORTS_CAPABILITY]);
    const left = await efforts(lists);
    assert.equal(left.defaultReasoningEffort, "low");
    assert.deepEqual(left.supportedReasoningEfforts, [...LEGACY_AGENT_REASONING_EFFORTS]);
    return { full: full.defaultReasoningEffort, absent: left.defaultReasoningEffort };
  });

  await step("WebRTC protocol 10: a malformed list fails closed with protocol_error", async () => {
    const frame = await web.call("/v1/compatibility", {
      capabilities: [TEAM_LONG_CAPABILITY_LISTS_CAPABILITY, TEAM_CAPABILITY_BASELINE_CAPABILITY],
      absent: ["Not A Name"],
    });
    assert.ok("error" in frame, `A malformed list got a result: ${JSON.stringify(frame)}.`);
    assert.equal(frame.error.code, "protocol_error");
    return { status: frame.error.status, code: frame.error.code };
  });

  report.passed = report.steps.every((entry) => entry.passed);
} finally {
  for (const peer of peers) await Effect.runPromise(peer.dispose()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  protocol9Host?.close();
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`Team API protocol 10 passed. Report: ${join(OUT, "report.json")}\n`);
