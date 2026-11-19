import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  createTeamProtocolV2Request,
  decodeTeamProtocolSupportV9,
  decodeTeamProtocolV2AuthFrame,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
  type TeamProtocolV2Json,
  teamProtocolV2AuthenticationTranscript,
} from "@openbot/contracts/team-protocol";
import {
  expandTeamCapabilitiesV10,
  readTeamHostCompatibility,
  TEAM_WEB_CLIENT_PROTOCOL,
  TEAM_WEBRTC_CLIENT_PROTOCOL,
  teamCapabilitiesForProtocol,
  teamCapabilityHeaders,
  teamCapabilityLists,
  teamWebRtcClientProtocol,
} from "@openbot/contracts/team-protocol/current";
import {
  decodeServerSafeModeReason,
  SERVER_SAFE_MODE_CAPABILITY,
  SERVER_SAFE_MODE_ROUTES,
  type ServerSafeModeReason,
} from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { encodeTeamProtocolV9WebRtcHttpRequest } from "@openbot/contracts/team-protocol/v9-webrtc-adapter";
import { decodeTeamProtocolSupportV10, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { decodeTeamProtocolV10WebRtcHttpResponse } from "@openbot/contracts/team-protocol/v10-webrtc-adapter";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { Effect, Exit } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { TeamWebRtcChannel } from "../src/main/team-webrtc-bridge";

const OUT = resolve(import.meta.dirname, "../.openbot-build/server-safe-mode-e2e");
const HOST_VERSION = "0.0.0-e2e";
const CLIENT_VERSION = "0.74.0";
const STEP_DEADLINE_MS = 30_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const ADMIN = { username: "admin-user", password: "admin-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };

plugin({
  name: "server-safe-mode-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => CLIENT_VERSION, isPackaged: false, on: () => undefined },
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

const { TEAM_STORE_FILE, TeamStore } = await import("../src/main/team-store");
const { handleServerSafeModeRequest, refuseServerSafeModeUpgrade } = await import(
  "../src/main/team-api/server-safe-mode-api"
);
const { TeamWebRtcBridge } = await import("../src/main/team-webrtc-bridge");
const { TeamWebRtcHostPeer } = await import("../src/main/team-webrtc-host-peer");
const { RemoteWorkflowError } = await import("../src/main/remote-service-effects");
const { RemoteServerClient } = await import("../src/main/remote-server-client");
const { RemoteProtocolError } = await import("../src/main/remote-server-errors");
const { classifyRemoteConnectionError } = await import("../src/main/remote-server-connection-status");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: {
  passed: boolean;
  reason: ServerSafeModeReason | null;
  steps: Step[];
  profileFiles: string[];
} = { passed: false, reason: null, steps: [], profileFiles: [] };

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

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonObject {
  assert.ok(isRecord(value), `${label} is not an object.`);
  return value;
}

const answers: string[] = [];

interface WireResponse {
  status: number;
  body: unknown;
}

async function http(
  port: number,
  input: { protocol: number | null; method?: string; path: string; body?: unknown; token?: string },
  headers: Record<string, string> = {},
): Promise<WireResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(input.protocol === null
        ? {}
        : { [TEAM_PROTOCOL_VERSION_HEADER]: String(input.protocol), [TEAM_APP_VERSION_HEADER]: CLIENT_VERSION }),
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      ...headers,
    },
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  answers.push(body);
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

const v10Headers = () => teamCapabilityHeaders(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10));

function snapshot(directory: string): Record<string, { size: number; mtimeMs: number; sha256: string }> {
  const files: Record<string, { size: number; mtimeMs: number; sha256: string }> = {};
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stat = statSync(full);
        files[relative(directory, full)] = {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
        };
      }
    }
  };
  walk(directory);
  return files;
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

function upgradeStatus(port: number, token: string): Promise<string> {
  return new Promise((resolveLine, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        [
          "GET /v1/events HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Version: 13",
          `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
          `Authorization: Bearer ${token}`,
          "",
          "",
        ].join("\r\n"),
      );
    });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
    });
    socket.on("close", () => resolveLine(received.split("\r\n")[0] ?? ""));
    socket.on("error", reject);
  });
}

const HOSTING = resolve(import.meta.dirname, "hosting");
const START = "systemctl start --no-block openbot.service";
const STOP = "systemctl stop openbot.service";

interface CheckCase {
  name: string;
  activeState: string;
  marker: boolean;
  stageFails: boolean;
  stagedVersion: string;
  expected: { calls: string[]; exitCode: number };
}

const CHECK_CASES: CheckCase[] = [
  {
    name: "safe mode, no staged release: stage, stop and start",
    activeState: "active",
    marker: true,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: ["stage", STOP, START], exitCode: 0 },
  },
  {
    name: "safe mode, a release is staged: stage, stop, install it and start",
    activeState: "active",
    marker: true,
    stageFails: false,
    stagedVersion: "99.0.0",
    expected: { calls: ["stage", STOP, "apply", START], exitCode: 0 },
  },
  {
    name: "safe mode, stage fails: stop and start all the same, and fail",
    activeState: "active",
    marker: true,
    stageFails: true,
    stagedVersion: "",
    expected: { calls: ["stage", STOP, START], exitCode: 1 },
  },
  {
    name: "running with no marker, staged 1 hour ago: nothing",
    activeState: "active",
    marker: false,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: [], exitCode: 0 },
  },
  {
    name: "a marker left by a stopped service: no start",
    activeState: "inactive",
    marker: true,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: [], exitCode: 0 },
  },
];

function runCheck(entry: CheckCase): { calls: string[]; exitCode: number } {
  const directory = mkdtempSync(join(tmpdir(), "server-safe-mode-check-"));
  try {
    const stamp = join(directory, "staged");
    const calls = join(directory, "calls");
    const marker = join(directory, "server-safe-mode");
    writeFileSync(calls, "");
    writeFileSync(stamp, "");
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(stamp, hourAgo, hourAgo);
    if (entry.marker) writeFileSync(marker, "");
    const script = [
      'source "$1"',
      'STAGE_STAMP="$2"',
      'CALLS="$3"',
      'SAFE_MODE_MARKER="$4"',
      "systemctl() {",
      '  case "$*" in',
      '    *ActiveState*) echo "$E2E_ACTIVE_STATE" ;;',
      "    *ExecMainStatus*) echo 0 ;;",
      '    *) echo "systemctl $*" >>"$CALLS" ;;',
      "  esac",
      "}",
      'stage() { echo stage >>"$CALLS"; [ "$E2E_STAGE_FAILS" = 0 ]; }',
      'apply() { echo apply >>"$CALLS"; }',
      'staged_version() { echo "$E2E_STAGED_VERSION"; }',
      "check",
    ].join("\n");
    const result = Bun.spawnSync(
      ["bash", "-c", script, "server-safe-mode-e2e", join(HOSTING, "openbot-hosted-update"), stamp, calls, marker],
      {
        env: {
          PATH: process.env.PATH ?? "",
          E2E_ACTIVE_STATE: entry.activeState,
          E2E_STAGE_FAILS: entry.stageFails ? "1" : "0",
          E2E_STAGED_VERSION: entry.stagedVersion,
        },
      },
    );
    return { calls: readFileSync(calls, "utf8").split("\n").filter(Boolean), exitCode: result.exitCode };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-server-safe-mode-"));
const userData = join(root, "user-data");
const reason: ServerSafeModeReason = { reason: "newer_database", appVersion: HOST_VERSION, haltedAt: Date.now() };
report.reason = reason;
let safeServer: Server | null = null;
const peers: InstanceType<typeof TeamWebRtcHostPeer>[] = [];

try {
  mkdirSync(userData, { recursive: true });
  const database = new OpenBotDatabase(userData);
  await runCauseEffect(database.initialize());
  const databaseFile = relative(userData, database.path);
  database.close();
  const setup = new TeamStore(join(userData, TEAM_STORE_FILE));
  await runCauseEffect(setup.initialize());
  const identity = await runCauseEffect(setup.configure("E2E Host", OWNER.username, OWNER.password));
  const owner = await runCauseEffect(setup.login(OWNER.username, OWNER.password));
  const adminInvite = await runCauseEffect(setup.createInvite("admin"));
  const admin = await runCauseEffect(setup.acceptInvite(adminInvite.token, ADMIN.username, ADMIN.password));
  const memberInvite = await runCauseEffect(setup.createInvite("member"));
  const member = await runCauseEffect(setup.acceptInvite(memberInvite.token, MEMBER.username, MEMBER.password));
  const tokens = { owner: owner.sessionToken, admin: admin.sessionToken, member: member.sessionToken };
  const members = { owner: owner.member, admin: admin.member, member: member.member };
  const before = snapshot(userData);
  report.profileFiles = Object.keys(before).sort();
  assert.ok(report.profileFiles.includes(databaseFile), "The profile has no database.");

  const store = new TeamStore(join(userData, TEAM_STORE_FILE));
  await runCauseEffect(store.loadReadOnly());
  assert.equal(store.getIdentity()?.serverId, identity.serverId);
  const server = createServer((request, response) =>
    handleServerSafeModeRequest(request, response, { reason, authenticate: (token) => store.authenticate(token) }),
  );
  server.on("upgrade", (_request, socket) => refuseServerSafeModeUpgrade(socket));
  safeServer = server;
  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address !== null && typeof address === "object");
      resolvePort(address.port);
    });
  });
  const apiUrl = `http://127.0.0.1:${port}`;

  await step("HTTP protocols 1-9: the compatibility read says that only protocol 10 is served", async () => {
    const results: { protocol: number; update: string | null }[] = [];
    for (let protocol = 1; protocol <= TEAM_PROTOCOL_V9; protocol += 1) {
      const response = await http(port, { protocol, path: "/v1/compatibility" });
      assert.equal(response.status, 200);
      const support = decodeTeamProtocolSupportV9(response.body);
      assert.deepEqual(support.protocol, { minimum: TEAM_PROTOCOL_V10, maximum: TEAM_PROTOCOL_V10 });
      assert.deepEqual(support.capabilities, [], "A protocol 1-9 client reads a capability.");
      const negotiated = teamWebRtcClientProtocol(support.protocol, TEAM_WEBRTC_CLIENT_PROTOCOL);
      assert.equal(negotiated.protocol, null);
      assert.equal(negotiated.update, "client_update_required");
      results.push({ protocol, update: negotiated.update });
    }
    return results;
  });

  await step("HTTP protocols 1-9 and no headers: the reason route gets 426 client_update_required", async () => {
    const statuses: { protocol: number | null; status: number; code: Json }[] = [];
    for (const protocol of [null, 1, 2, 3, 4, 5, 6, 7, 8, TEAM_PROTOCOL_V9]) {
      const response = await http(port, { protocol, path: SERVER_SAFE_MODE_ROUTES.reason, token: tokens.owner });
      assert.equal(response.status, 426, `Protocol ${String(protocol)}: ${JSON.stringify(response.body)}`);
      const body = record(response.body, "426 body");
      assert.equal(body.code, "client_update_required");
      assert.deepEqual(record(body.host, "host").protocol, { minimum: TEAM_PROTOCOL_V10, maximum: TEAM_PROTOCOL_V10 });
      statuses.push({ protocol, status: response.status, code: body.code });
    }
    return statuses;
  });

  await step("HTTP protocol 11 and malformed headers: host_update_required and protocol_error", async () => {
    const newer = await http(port, { protocol: 11, path: SERVER_SAFE_MODE_ROUTES.reason, token: tokens.owner });
    assert.equal(newer.status, 426);
    assert.equal(record(newer.body, "426 body").code, "host_update_required");
    const malformed = await http(
      port,
      { protocol: TEAM_PROTOCOL_V10, path: SERVER_SAFE_MODE_ROUTES.reason, token: tokens.owner },
      { [TEAM_PROTOCOL_VERSION_HEADER]: "ten" },
    );
    assert.equal(malformed.status, 400);
    assert.equal(record(malformed.body, "400 body").code, "protocol_error");
    return { newer: newer.status, malformed: malformed.status };
  });

  await step("HTTP protocol 10: the host serves server-safe-mode-v1 and no other capability", async () => {
    const response = await http(port, { protocol: TEAM_PROTOCOL_V10, path: "/v1/compatibility" }, v10Headers());
    assert.equal(response.status, 200);
    const support = decodeTeamProtocolSupportV10(response.body);
    assert.equal(support.appVersion, HOST_VERSION);
    assert.deepEqual(support.protocol, { minimum: TEAM_PROTOCOL_V10, maximum: TEAM_PROTOCOL_V10 });
    assert.deepEqual(expandTeamCapabilitiesV10(support).sort(), [SERVER_SAFE_MODE_CAPABILITY]);
    return { capabilities: support.capabilities, absent: support.absent.length };
  });

  await step("HTTP protocol 10: the owner, an admin and a member read the reason", async () => {
    const read: Record<string, ServerSafeModeReason> = {};
    for (const [role, token] of Object.entries(tokens)) {
      const response = await http(
        port,
        { protocol: TEAM_PROTOCOL_V10, path: SERVER_SAFE_MODE_ROUTES.reason, token },
        v10Headers(),
      );
      assert.equal(response.status, 200, `${role}: ${JSON.stringify(response.body)}`);
      assert.deepEqual(Object.keys(record(response.body, "reason")).sort(), ["appVersion", "haltedAt", "reason"]);
      const value = decodeServerSafeModeReason(response.body);
      assert.deepEqual(value, reason);
      read[role] = value;
    }
    return Object.keys(read);
  });

  await step("HTTP protocol 10: no token and a wrong token get 401", async () => {
    const none = await http(port, { protocol: TEAM_PROTOCOL_V10, path: SERVER_SAFE_MODE_ROUTES.reason }, v10Headers());
    const wrong = await http(
      port,
      {
        protocol: TEAM_PROTOCOL_V10,
        path: SERVER_SAFE_MODE_ROUTES.reason,
        token: randomBytes(32).toString("base64url"),
      },
      v10Headers(),
    );
    assert.equal(none.status, 401);
    assert.equal(wrong.status, 401);
    return { none: none.status, wrong: wrong.status };
  });

  await step("HTTP protocol 10: each other route, sign-in, join and events get 503 server_safe_mode", async () => {
    const routes: { method: string; path: string; body?: unknown; token?: string }[] = [
      { method: "GET", path: "/v1/agents", token: tokens.owner },
      { method: "GET", path: "/v1/members", token: tokens.owner },
      { method: "POST", path: "/v1/auth/login", body: OWNER },
      { method: "POST", path: "/v1/join", body: { inviteToken: "unused", ...MEMBER } },
      { method: "POST", path: SERVER_SAFE_MODE_ROUTES.reason, token: tokens.owner },
    ];
    const results: { method: string; path: string; status: number }[] = [];
    for (const route of routes) {
      const response = await http(port, { protocol: TEAM_PROTOCOL_V10, ...route }, v10Headers());
      assert.equal(response.status, 503, `${route.method} ${route.path}: ${JSON.stringify(response.body)}`);
      const body = record(response.body, "503 body");
      assert.equal(body.code, "server_safe_mode");
      assert.equal(body.error, sourceText("error.team.serverSafeMode"));
      results.push({ method: route.method, path: route.path, status: response.status });
    }
    const events = await upgradeStatus(port, tokens.owner);
    assert.match(events, /^HTTP\/1\.1 503 /u);
    return { routes: results, events };
  });

  await step("HTTP desktop client: the connect fails with server_safe_mode and the translated reason", async () => {
    const recorded: string[] = [];
    const desktop = new RemoteServerClient({
      appVersion: CLIENT_VERSION,
      servers: {
        require: () => {
          throw new Error("No stored server is read by this check.");
        },
        token: () => tokens.member,
      },
      connections: {
        compatibilityFor: () => null,
        issueFor: () => null,
        setCompatibility: () => {
          recorded.push("setCompatibility");
        },
        clearStaleIssue: () => {},
        reportError: () => {},
      },
      transport: null,
    });
    const exit = await Effect.runPromiseExit(
      desktop.ensureCompatibility(
        {
          id: "safe-mode-server",
          name: "E2E Host",
          apiUrl,
          fingerprint: "",
          username: MEMBER.username,
          encryptedToken: "",
          remoteDesktopAvailable: false,
          role: "member",
        },
        true,
      ),
    );
    assert.ok(Exit.isFailure(exit), "The connect to a server in safe mode succeeded.");
    const failure = exit.cause.reasons.find((entry) => entry._tag === "Fail");
    assert.ok(failure?._tag === "Fail" && failure.error instanceof RemoteWorkflowError);
    const cause = failure.error.cause;
    assert.ok(cause instanceof RemoteProtocolError, `Not a protocol error: ${String(cause)}`);
    assert.equal(cause.code, "server_safe_mode");
    assert.equal(cause.message, sourceText("error.team.serverSafeModeNewerDatabase", { version: HOST_VERSION }));
    assert.deepEqual(recorded, [], "The safe mode was recorded as a usable connection.");
    const outcome = classifyRemoteConnectionError(cause);
    assert.equal(outcome.state, "incompatible");
    assert.equal(outcome.issue?.code, "server_safe_mode");
    assert.equal(outcome.hostSupport?.appVersion, HOST_VERSION);
    return { code: cause.code, message: cause.message, state: outcome.state };
  });

  const clientKeys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const fingerprints = { localFingerprint: "host-fingerprint", remoteFingerprint: "client-fingerprint" };

  async function connectWebRtc(peerId: string, role: "owner" | "admin" | "member") {
    const bridge = new LoopbackBridge();
    const ticket = `ticket-${randomUUID()}`;
    const sessionId = randomUUID();
    const sessionExpiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const membershipId = members[role].id;
    const claims = {
      sessionId,
      hostId: identity.serverId,
      userId: `account-${membershipId}`,
      membershipId,
      authEpoch: 1,
      sessionExpiresAt,
      role,
      clientPublicKey: clientKeys.publicKey,
    };
    const peer = new TeamWebRtcHostPeer(
      {
        bridge,
        store,
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
        membershipId,
        role,
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

    async function call(path: string, keys: { capabilities: string[]; absent?: string[] }, input?: TeamProtocolV2Json) {
      const requestId = randomUUID();
      const from = bridge.sent.length;
      const sideRoute = teamSideRouteCodec(path);
      const body = sideRoute
        ? sideRoute.request(path, input, { channelIsolation: true, channelPicture: true, channelBrowser: true })
        : encodeTeamProtocolV9WebRtcHttpRequest("GET", path, undefined);
      bridge.emit(
        "data",
        peerId,
        "rpc",
        encodeTeamProtocolV2Frame(
          createTeamProtocolV2Request(requestId, "http.request", { method: "GET", path, body, ...keys }),
        ),
      );
      const frame = await bridge.rpcFrom(from, rpcResponse(requestId));
      answers.push(JSON.stringify(frame));
      return frame;
    }
    return { call };
  }

  const v10Lists = () => teamCapabilityLists(TEAM_PROTOCOL_V10, teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10));

  const web = await connectWebRtc("peer-web", "member");
  await step("WebRTC web and mobile client: protocol 10 and server-safe-mode-v1", async () => {
    let known: number | undefined;
    let reads = 0;
    const { support, negotiated } = await readTeamHostCompatibility(async () => {
      reads += 1;
      const keys = known !== undefined && known >= TEAM_PROTOCOL_V10 ? known : undefined;
      const frame = await web.call("/v1/compatibility", teamCapabilityLists(keys, teamCapabilitiesForProtocol(keys)));
      assert.ok("result" in frame, JSON.stringify(frame));
      const result = record(frame.result, "result");
      const body = decodeTeamProtocolV10WebRtcHttpResponse("GET", "/v1/compatibility", 200, result.body);
      known =
        teamWebRtcClientProtocol(decodeTeamProtocolSupportV9(body).protocol, TEAM_WEB_CLIENT_PROTOCOL).protocol ??
        undefined;
      return body;
    }, TEAM_WEB_CLIENT_PROTOCOL);
    assert.equal(negotiated.protocol, TEAM_PROTOCOL_V10);
    assert.equal(negotiated.update, null);
    assert.deepEqual(support.capabilities, [SERVER_SAFE_MODE_CAPABILITY]);
    return { protocol: negotiated.protocol, reads, capabilities: support.capabilities };
  });

  await step("WebRTC protocol 10: owner, admin and member peers read the reason", async () => {
    const roles: string[] = [];
    for (const role of ["owner", "admin", "member"] as const) {
      const peer = role === "member" ? web : await connectWebRtc(`peer-${role}`, role);
      const frame = await peer.call(SERVER_SAFE_MODE_ROUTES.reason, v10Lists(), role === "member" ? {} : undefined);
      assert.ok("result" in frame, `${role}: ${JSON.stringify(frame)}`);
      const result = record(frame.result, "result");
      assert.equal(result.status, 200);
      const codec = teamSideRouteCodec(SERVER_SAFE_MODE_ROUTES.reason);
      assert.ok(codec, "The reason route has no client codec.");
      const body = codec.response(SERVER_SAFE_MODE_ROUTES.reason, 200, result.body);
      assert.deepEqual(decodeServerSafeModeReason(body), reason);
      roles.push(role);
    }
    return roles;
  });

  await step("WebRTC protocol 10: another route gets server_safe_mode", async () => {
    const frame = await web.call("/v1/agents", v10Lists());
    assert.ok("error" in frame, `The route answered: ${JSON.stringify(frame)}.`);
    assert.equal(frame.error.code, "server_safe_mode");
    return { status: frame.error.status, code: frame.error.code };
  });

  const old = await connectWebRtc("peer-protocol-9", "member");
  await step("WebRTC protocol 9 peer (an older phone app): reads that it must update", async () => {
    const compatibility = await old.call("/v1/compatibility", {
      capabilities: [...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)],
    });
    assert.ok("result" in compatibility, JSON.stringify(compatibility));
    const support = decodeTeamProtocolSupportV9(record(compatibility.result, "result").body);
    assert.deepEqual(teamWebRtcClientProtocol(support.protocol), { protocol: null, update: "client_update_required" });
    const reasonFrame = await old.call(SERVER_SAFE_MODE_ROUTES.reason, {
      capabilities: [...teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)],
    });
    assert.ok("error" in reasonFrame, `A protocol 9 peer read the reason: ${JSON.stringify(reasonFrame)}.`);
    assert.equal(reasonFrame.error.code, "client_update_required");
    return { update: "client_update_required", reason: reasonFrame.error.code };
  });

  await step("No answer has a path, a token, an error text or a stack", async () => {
    const forbidden = [root, userData, homedir(), ...Object.values(tokens), "Error:", "    at ", "node:internal"];
    for (const answer of answers) {
      for (const value of forbidden) assert.ok(!answer.includes(value), `An answer has "${value}".`);
    }
    return { answers: answers.length };
  });

  await step("No file of the profile is made, changed or removed", async () => {
    await runCauseEffect(store.createInvite("member")).then(
      () => assert.fail("The read-only team store wrote an invite."),
      () => undefined,
    );
    for (const peer of peers.splice(0)) await Effect.runPromise(peer.dispose());
    const after = snapshot(userData);
    assert.deepEqual(after, before);
    return { files: Object.keys(after).sort() };
  });

  await step("openbot-hosted-update check: the marker of the safe mode starts OpenBot again", async () => {
    const results: { name: string; calls: string[]; exitCode: number }[] = [];
    for (const entry of CHECK_CASES) {
      const result = runCheck(entry);
      assert.deepEqual(result, entry.expected, `check: ${entry.name}`);
      results.push({ name: entry.name, ...result });
    }
    return results;
  });

  report.passed = report.steps.every((entry) => entry.passed);
} finally {
  for (const peer of peers) await Effect.runPromise(peer.dispose()).catch(() => undefined);
  const closing = safeServer;
  if (closing) {
    await new Promise<void>((done) => {
      closing.close(() => done());
      closing.closeAllConnections();
    });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

if (!report.passed) {
  process.stderr.write(`Server safe mode failed. Report: ${join(OUT, "report.json")}\n`);
  process.exit(1);
}
process.stdout.write(`Server safe mode passed. Report: ${join(OUT, "report.json")}\n`);
