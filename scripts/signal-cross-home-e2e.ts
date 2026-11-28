import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_GO_AWAY_CAPABILITY,
  SIGNAL_RESUME_FROM_CAPABILITY,
  type SignalServerMessage,
} from "@openbot/contracts/signal-protocol/messages";
import { REMOTE_TICKET_AUDIENCE, REMOTE_TICKET_PROTOCOL_VERSION } from "@openbot/contracts/signal-protocol/ticket";
import { createOpenBotLogger } from "@openbot/logging";
import { exportJWK, SignJWT } from "jose";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/signal-cross-home");
const WAIT_MS = 15_000;
const RETRY_MS = 200;
const GO_AWAY_WITHIN_MS = 1_000;

const logger = createOpenBotLogger("signal-cross-home-e2e");

const SESSION_SECRET = randomBytes(32).toString("base64url");
const AUTH_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const TURN_SECRET = randomBytes(32).toString("base64url");
const METRICS_TOKEN = randomBytes(32).toString("base64url");
const ADMIN_TOKEN = randomBytes(32).toString("base64url");

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}
const checks: Check[] = [];

function record(name: string, passed: boolean, evidence: string) {
  checks.push({ name, passed, evidence });
  if (passed) logger.info(`PASS ${name}`);
  else logger.error(`FAIL ${name}: ${evidence}`);
}

async function check(name: string, run: () => Promise<string>) {
  try {
    record(name, true, await run());
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, label: string, limit = WAIT_MS): Promise<void> {
  const deadline = Date.now() + limit;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
    await new Promise((wake) => setTimeout(wake, 25));
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

function hmac(secret: string, text: string) {
  return createHmac("sha256", secret).update(text).digest("base64url");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}

function startTurnServer(): Promise<Socket> {
  const socket = createSocket("udp4");
  socket.on("message", (request, sender) => {
    if (request.length < 20 || request.readUInt32BE(4) !== 0x2112a442) return;
    const header = Buffer.alloc(20);
    header.writeUInt16BE(request.readUInt16BE(0) | 0x0100, 0);
    request.copy(header, 4, 4, 20);
    socket.send(header, sender.port, sender.address);
  });
  return new Promise((resolveSocket) => socket.bind(0, "127.0.0.1", () => resolveSocket(socket)));
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "cross-home-1", alg: "ES256", use: "sig" };

type HomeId = "a" | "b";

interface SessionRecord {
  hostId: string;
  userId: string;
  membershipId: string;
  role: "host" | "member";
  clientPublicKey?: string;
  revoked: boolean;
}

const sessions = new Map<string, SessionRecord>();
const hostHomes = new Map<string, HomeId>();
const downHomes = new Set<HomeId>();
const homeUrls: Record<HomeId, string> = { a: "", b: "" };

function homeOf(url: string): HomeId | null {
  if (url === homeUrls.a) return "a";
  if (url === homeUrls.b) return "b";
  return null;
}

async function ticketFor(sessionId: string, home: HomeId): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Unknown session.");
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    jti: randomUUID(),
    sessionId,
    hostId: session.hostId,
    userId: session.userId,
    membershipId: session.membershipId,
    role: session.role,
    authEpoch: 1,
    protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
    protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
    sessionExpiresAt: now + 86_400,
    signal: home,
    ...(session.clientPublicKey ? { clientPublicKey: session.clientPublicKey } : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: "cross-home-1" })
    .setAudience(REMOTE_TICKET_AUDIENCE)
    .setIssuedAt(now - 1)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

const controlPlane = {
  renewHost(hostId: string, failedSignalUrl?: string): Promise<{ signalUrl: string; ticket: string }> {
    const current = hostHomes.get(hostId) ?? "a";
    const failed = failedSignalUrl ? homeOf(failedSignalUrl) : null;
    const other: HomeId = current === "a" ? "b" : "a";
    const chosen = current !== failed && !downHomes.has(current) ? current : other;
    hostHomes.set(hostId, chosen);
    return ticketFor(`host-session-${hostId}`, chosen).then((ticket) => ({ signalUrl: homeUrls[chosen], ticket }));
  },
  async bootstrapClient(sessionId: string): Promise<{ signalUrl: string; ticket: string }> {
    const session = sessions.get(sessionId);
    if (!session || session.revoked) throw new Error("The session ended.");
    const home = hostHomes.get(session.hostId) ?? "a";
    return { signalUrl: homeUrls[home], ticket: await ticketFor(sessionId, home) };
  },
};

const validateCalls: string[] = [];
function startControlPlane(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const timestamp = String(request.headers["openbot-timestamp"] ?? "");
    const signed =
      String(request.headers["openbot-signature"] ?? "") === hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`);
    const path = request.url ?? "";
    const payload = body ? JSON.parse(body) : {};
    const answer = (status: number, value?: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    if (!signed) return answer(401);
    const valid = (claim: { sessionId?: string }) => !sessions.get(String(claim.sessionId))?.revoked;
    if (path === "/v2/remote/resume/validate-batch") {
      const claims: Array<{ sessionId?: string }> = Array.isArray(payload.claims) ? payload.claims : [];
      validateCalls.push(path);
      return answer(200, { valid: claims.map(valid) });
    }
    if (path === "/v2/remote/resume/validate") {
      validateCalls.push(path);
      return answer(200, { valid: valid(payload) });
    }
    return answer(404);
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

interface Home {
  id: HomeId;
  signalPort: number;
  healthPort: number;
  child: ChildProcess;
}

const serviceOutput: string[] = [];

function spawnHome(id: HomeId, signalPort: number, healthPort: number, controlPlanePort: number, turnPort: number) {
  const child = spawn("bun", [resolve(ROOT, "remote/api/src/index.ts")], {
    cwd: resolve(ROOT, "remote/api"),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      REMOTE_SIGNAL_HOST: "127.0.0.1",
      REMOTE_SIGNAL_PORT: String(signalPort),
      REMOTE_HEALTH_HOST: "0.0.0.0",
      REMOTE_HEALTH_PORT: String(healthPort),
      REMOTE_TLS_DISABLED: "true",
      REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${controlPlanePort}`,
      REMOTE_SESSION_SECRET: SESSION_SECRET,
      REMOTE_AUTH_WEBHOOK_SECRET: AUTH_WEBHOOK_SECRET,
      TURN_SHARED_SECRET: TURN_SECRET,
      TURN_HOST: "127.0.0.1",
      TURN_PORT: String(turnPort),
      REMOTE_METRICS_TOKEN: METRICS_TOKEN,
      REMOTE_ADMIN_TOKEN: ADMIN_TOKEN,
      SIGNAL_ID: id,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
  return child;
}

async function waitForReady(home: Home) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (home.child.exitCode !== null) throw new Error(`Signal ${home.id} exited with code ${home.child.exitCode}.`);
    const ready = await fetch(`http://127.0.0.1:${home.signalPort}/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((wake) => setTimeout(wake, RETRY_MS));
  }
  throw new Error(`Signal ${home.id} did not become ready.`);
}

async function metric(home: Home, name: string): Promise<number> {
  const page = await fetch(`http://127.0.0.1:${home.healthPort}/metrics`, {
    headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
  }).then((response) => response.text());
  const line = page.split("\n").find((candidate) => candidate.startsWith(`${name} `));
  return line ? Number(line.split(" ")[1]) : 0;
}

type Frame = SignalServerMessage;

interface Hello {
  peer: "host" | "client";
  token: string;
  multiplex?: boolean;
  goAway?: boolean;
  resumeFrom?: string;
}

interface SessionEndedEvent {
  type: "remote-session-ended";
  hostId: string;
  sessionId: string;
}

interface GoAwaySummary {
  hosts: number;
  waves: number;
  withoutCapability: number;
}

function isGoAwaySummary(value: unknown): value is GoAwaySummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "hosts" in value &&
    typeof value.hosts === "number" &&
    "waves" in value &&
    typeof value.waves === "number" &&
    "withoutCapability" in value &&
    typeof value.withoutCapability === "number"
  );
}

interface Opened {
  socket: WebSocket;
  answered: Promise<Frame | null>;
}

function openSignal(url: string, hello: Hello, onFrame: (frame: Frame) => void, onClose: () => void) {
  const socket = new WebSocket(url);
  let settle: (frame: Frame | null) => void = () => undefined;
  const answered = new Promise<Frame | null>((resolveAnswer) => {
    settle = resolveAnswer;
  });
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "hello", version: 1, ...hello })));
  socket.addEventListener("message", (event) => {
    const frame = decodeSignalServerMessage(JSON.parse(String(event.data)));
    if (!frame) return;
    if (frame.type === "ready" || frame.type === "host-waiting") settle(frame);
    if (frame.type === "error") settle(null);
    onFrame(frame);
  });
  socket.addEventListener("close", () => {
    settle(null);
    onClose();
  });
  socket.addEventListener("error", () => socket.close());
  return { socket, answered } satisfies Opened;
}

function delayWithin(ms: number) {
  return new Promise((wake) => setTimeout(wake, Math.floor(Math.random() * ms)));
}

interface KeptPeer {
  id: string;
  connectionId: string;
}

interface HostActor {
  hostId: string;
  goAway: boolean;
  url: string;
  socket: WebSocket | null;
  ready: boolean;
  capabilities: string[];
  peers: Map<string, KeptPeer>;
  peerReady: Array<{ sessionId: string; resumed: boolean; home: HomeId | null }>;
  rebuilds: Map<string, number>;
  offers: Array<{ connectionId: string; home: HomeId | null }>;
  goAwayFrames: number;
  failedOpens: number;
  moves: Array<{ from: HomeId | null; to: HomeId | null; reason: string }>;
  moving: boolean;
}

function newHost(hostId: string, goAway: boolean): HostActor {
  sessions.set(`host-session-${hostId}`, {
    hostId,
    userId: `owner-${hostId}`,
    membershipId: `${hostId}:host`,
    role: "host",
    revoked: false,
  });
  return {
    hostId,
    goAway,
    url: "",
    socket: null,
    ready: false,
    capabilities: [],
    peers: new Map(),
    peerReady: [],
    rebuilds: new Map(),
    offers: [],
    goAwayFrames: 0,
    failedOpens: 0,
    moves: [],
    moving: false,
  };
}

async function connectHost(host: HostActor, failedSignalUrl: string | undefined, reason: string): Promise<void> {
  for (;;) {
    const from = homeOf(host.url);
    const bootstrap = await controlPlane.renewHost(host.hostId, failedSignalUrl);
    if (host.socket && bootstrap.signalUrl === host.url) return;
    const previous = host.socket;
    host.socket = null;
    host.ready = false;
    previous?.close(1000, "Network changed");
    host.url = bootstrap.signalUrl;
    const opened = openSignal(
      bootstrap.signalUrl,
      { peer: "host", token: bootstrap.ticket, multiplex: true, ...(host.goAway ? { goAway: true } : {}) },
      (frame) => onHostFrame(host, opened.socket, frame),
      () => onHostClose(host, opened.socket),
    );
    host.socket = opened.socket;
    const answer = await opened.answered;
    if (answer?.type === "ready") {
      host.ready = true;
      host.capabilities = answer.capabilities ?? [];
      host.moves.push({ from, to: homeOf(bootstrap.signalUrl), reason });
      return;
    }
    host.failedOpens += 1;
    failedSignalUrl = bootstrap.signalUrl;
    await new Promise((wake) => setTimeout(wake, RETRY_MS));
  }
}

function onHostFrame(host: HostActor, socket: WebSocket, frame: Frame) {
  if (host.socket !== socket) return;
  if (frame.type === "peer-ready") {
    const sessionId = frame.sessionId;
    const resumed = frame.resumed;
    host.peerReady.push({ sessionId, resumed, home: homeOf(host.url) });
    let peer = host.peers.get(sessionId);
    if (!peer || !resumed) {
      peer = { id: randomUUID(), connectionId: frame.connectionId };
      host.peers.set(sessionId, peer);
      host.rebuilds.set(sessionId, (host.rebuilds.get(sessionId) ?? 0) + 1);
    }
    peer.connectionId = frame.connectionId;
  }
  if (frame.type === "offer") {
    host.offers.push({ connectionId: frame.connectionId, home: homeOf(host.url) });
    socket.send(
      JSON.stringify({
        type: "answer",
        version: 1,
        connectionId: frame.connectionId,
        channel: frame.channel,
        sdp: "v=0 cross-home-answer",
      }),
    );
  }
  if (frame.type === "go-away") {
    host.goAwayFrames += 1;
    if (!host.goAway || host.moving) return;
    host.moving = true;
    const drainingUrl = host.url;
    void delayWithin(frame.withinMs)
      .then(() => connectHost(host, drainingUrl, "go-away"))
      .finally(() => {
        host.moving = false;
      });
  }
}

function onHostClose(host: HostActor, socket: WebSocket) {
  if (host.socket !== socket) return;
  host.socket = null;
  host.ready = false;
  if (host.moving) return;
  host.moving = true;
  void connectHost(host, host.url, "socket closed").finally(() => {
    host.moving = false;
  });
}

interface ClientActor {
  sessionId: string;
  hostId: string;
  goAway: boolean;
  url: string;
  ticket: string;
  resumeToken: string | null;
  resumeFrom: string | null;
  socket: WebSocket | null;
  ready: boolean;
  connectionId: string | null;
  capabilities: string[];
  answers: Array<{ home: HomeId | null }>;
  goAwayFrames: number;
  failedOpens: number;
  ended: boolean;
  following: boolean;
  closedWith: number | null;
  errors: string[];
}

function newClient(hostId: string, goAway: boolean): ClientActor {
  const sessionId = `client-session-${randomUUID()}`;
  sessions.set(sessionId, {
    hostId,
    userId: `member-${sessionId}`,
    membershipId: `${hostId}:member-${sessionId}`,
    role: "member",
    clientPublicKey: randomBytes(32).toString("base64url"),
    revoked: false,
  });
  return {
    sessionId,
    hostId,
    goAway,
    url: "",
    ticket: "",
    resumeToken: null,
    resumeFrom: null,
    socket: null,
    ready: false,
    connectionId: null,
    capabilities: [],
    answers: [],
    goAwayFrames: 0,
    failedOpens: 0,
    ended: false,
    following: false,
    closedWith: null,
    errors: [],
  };
}

async function openClient(client: ClientActor): Promise<boolean> {
  const hello: Hello = {
    peer: "client",
    token: client.resumeToken ?? client.ticket,
    ...(client.goAway ? { goAway: true } : {}),
    ...(client.goAway && !client.resumeToken && client.resumeFrom ? { resumeFrom: client.resumeFrom } : {}),
  };
  if (client.resumeToken === null) client.ticket = "";
  client.ready = false;
  const opened = openSignal(
    client.url,
    hello,
    (frame) => onClientFrame(client, opened.socket, frame),
    () => onClientClose(client, opened.socket),
  );
  opened.socket.addEventListener("close", (event) => {
    client.closedWith = event.code;
  });
  client.socket = opened.socket;
  const answer = await opened.answered;
  if (answer) return true;
  client.failedOpens += 1;
  return false;
}

function onClientFrame(client: ClientActor, socket: WebSocket, frame: Frame) {
  if (client.socket !== socket) return;
  if (frame.type === "error") client.errors.push(frame.code);
  if (frame.type === "host-waiting") {
    client.resumeToken = frame.resumeToken;
    client.resumeFrom = null;
  }
  if (frame.type === "ready") {
    client.resumeToken = frame.resumeToken;
    client.resumeFrom = null;
    client.connectionId = frame.connectionId;
    client.capabilities = frame.capabilities ?? [];
    client.ready = true;
    socket.send(
      JSON.stringify({
        type: "offer",
        version: 1,
        connectionId: client.connectionId,
        channel: "team",
        sdp: "v=0 cross-home-offer",
      }),
    );
  }
  if (frame.type === "answer") client.answers.push({ home: homeOf(client.url) });
  if (frame.type === "go-away") {
    client.goAwayFrames += 1;
    if (!client.goAway) return;
    void delayWithin(frame.withinMs).then(() => followHost(client));
  }
}

function onClientClose(client: ClientActor, socket: WebSocket) {
  if (client.socket !== socket) return;
  client.socket = null;
  client.ready = false;
  void followHost(client);
}

async function followHost(client: ClientActor): Promise<void> {
  if (client.following || client.ended) return;
  client.following = true;
  try {
    for (;;) {
      const bootstrap = await controlPlane.bootstrapClient(client.sessionId).catch(() => null);
      if (!bootstrap) {
        client.ended = true;
        return;
      }
      const moved = bootstrap.signalUrl !== client.url;
      client.ticket = bootstrap.ticket;
      if (moved) {
        client.resumeFrom = client.resumeToken ?? client.resumeFrom;
        client.resumeToken = null;
        client.url = bootstrap.signalUrl;
      } else if (client.socket) return;
      const previous = client.socket;
      client.socket = null;
      previous?.close(1000, "Signal moved");
      if (await openClient(client)) return;
      await new Promise((wake) => setTimeout(wake, RETRY_MS));
    }
  } finally {
    client.following = false;
  }
}

async function startClient(client: ClientActor) {
  const bootstrap = await controlPlane.bootstrapClient(client.sessionId);
  client.url = bootstrap.signalUrl;
  client.ticket = bootstrap.ticket;
  expect(await openClient(client), `The client of ${client.hostId} did not open.`);
}

function peerReadyOn(host: HostActor, client: ClientActor, home: HomeId, from = 0) {
  return host.peerReady.slice(from).filter((entry) => entry.sessionId === client.sessionId && entry.home === home);
}

async function postAuthEvent(home: Home, event: SessionEndedEvent) {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return fetch(`http://127.0.0.1:${home.signalPort}/internal/auth-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OpenBot-Timestamp": timestamp,
      "OpenBot-Signature": hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`),
    },
    body,
  });
}

function goAway(home: Home, body: unknown, token: string | null = ADMIN_TOKEN, address = "127.0.0.1") {
  return fetch(`http://${address}:${home.healthPort}/admin/go-away`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function externalAddress(): string | null {
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) if (entry.family === "IPv4" && !entry.internal) return entry.address;
  return null;
}

const [signalPortA, healthPortA, signalPortB, healthPortB, controlPlanePort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const plane = await startControlPlane(controlPlanePort);
const turnServer = await startTurnServer();
const turnPort = turnServer.address().port;
homeUrls.a = `ws://127.0.0.1:${signalPortA}/v1/signal`;
homeUrls.b = `ws://127.0.0.1:${signalPortB}/v1/signal`;
const homeA: Home = {
  id: "a",
  signalPort: signalPortA,
  healthPort: healthPortA,
  child: spawnHome("a", signalPortA, healthPortA, controlPlanePort, turnPort),
};
const homeB: Home = {
  id: "b",
  signalPort: signalPortB,
  healthPort: healthPortB,
  child: spawnHome("b", signalPortB, healthPortB, controlPlanePort, turnPort),
};
const hosts: HostActor[] = [];
const clients: ClientActor[] = [];
const skipped: string[] = [
  "The real WebRTC data channel: the actors speak the Signal protocol only. The kept peer is the host-side peer that a resumed peer-ready keeps, as src/renderer/src/features/team/team-webrtc.ts does.",
  "The host drops kept clients whose data channel is closed: that rule is in the renderer bridge (moveSignal), which needs Electron.",
];

try {
  await Promise.all([waitForReady(homeA), waitForReady(homeB)]);
  logger.info("Both Signal homes are ready.");

  const killHost = newHost("host-kill", true);
  const oldHost = newHost("host-old", false);
  const killClient = newClient(killHost.hostId, true);
  const oldClient = newClient(killHost.hostId, false);
  const oldHostClient = newClient(oldHost.hostId, false);
  hosts.push(killHost, oldHost);
  clients.push(killClient, oldClient, oldHostClient);

  await check("Hosts and clients start on home a", async () => {
    await Promise.all(hosts.map((host) => connectHost(host, undefined, "start")));
    await Promise.all(clients.map(startClient));
    await until(() => clients.every((client) => client.ready && client.answers.length > 0), "first answers");
    expect(
      hosts.every((host) => homeOf(host.url) === "a"),
      "A host is not on home a.",
    );
    return `${hosts.length} hosts and ${clients.length} clients ready on a; each client got an answer from its host`;
  });

  await check("Signal advertises go-away and resume-from only to peers that announce goAway", async () => {
    const expected = [SIGNAL_GO_AWAY_CAPABILITY, SIGNAL_RESUME_FROM_CAPABILITY].join(",");
    expect(killHost.capabilities.join(",") === expected, `new host: ${killHost.capabilities.join(",")}`);
    expect(killClient.capabilities.join(",") === expected, `new client: ${killClient.capabilities.join(",")}`);
    expect(oldHost.capabilities.length === 0, `old host: ${oldHost.capabilities.join(",")}`);
    expect(oldClient.capabilities.length === 0, `old client: ${oldClient.capabilities.join(",")}`);
    return `new peers: ${expected}; old peers: none`;
  });

  await check(
    "When home a is killed, hosts move to b, clients follow and the resumed client keeps its peer",
    async () => {
      const keptPeer = killHost.peers.get(killClient.sessionId)?.id;
      const oldPeer = killHost.peers.get(oldClient.sessionId)?.id;
      downHomes.add("a");
      homeA.child.kill("SIGKILL");
      await until(
        () =>
          hosts.every((host) => host.ready && homeOf(host.url) === "b") &&
          clients.every((client) => client.ready && homeOf(client.url) === "b"),
        "everyone on b",
      );
      await until(
        () => clients.every((client) => client.answers.some((answer) => answer.home === "b")),
        "answers on b",
      );
      const resumed = peerReadyOn(killHost, killClient, "b");
      expect(resumed.length > 0 && resumed.every((entry) => entry.resumed), `resumed: ${JSON.stringify(resumed)}`);
      expect(killHost.peers.get(killClient.sessionId)?.id === keptPeer, "The host built the resumed client again.");
      expect(
        killHost.rebuilds.get(killClient.sessionId) === 1,
        `builds: ${killHost.rebuilds.get(killClient.sessionId)}`,
      );
      return `host moves: ${JSON.stringify(killHost.moves)}; peer-ready on b resumed=${resumed.map((entry) => entry.resumed).join(",")}; same host peer ${keptPeer === killHost.peers.get(killClient.sessionId)?.id}; old client peer rebuilt ${oldPeer !== killHost.peers.get(oldClient.sessionId)?.id}`;
    },
  );

  await check("An old client without the capability still reconnects on the other home", async () => {
    expect(oldClient.ready && homeOf(oldClient.url) === "b", "The old client is not ready on b.");
    expect(
      oldClient.answers.some((answer) => answer.home === "b"),
      "The old client got no answer on b.",
    );
    const onB = peerReadyOn(killHost, oldClient, "b");
    expect(onB.length > 0 && onB.every((entry) => !entry.resumed), `peer-ready: ${JSON.stringify(onB)}`);
    expect(oldHostClient.ready && homeOf(oldHostClient.url) === "b", "The client of the old host is not on b.");
    expect(oldHost.ready && homeOf(oldHost.url) === "b", "The old host is not on b.");
    return `old client ready on b with resumed=false (full rebuild, the old path); old host and its old client ready on b`;
  });

  await check("A resume proof of another session does not resume", async () => {
    const intruder = newClient(killHost.hostId, true);
    clients.push(intruder);
    await startClient(intruder);
    await until(() => peerReadyOn(killHost, intruder, "b").length > 0, "intruder peer-ready");
    intruder.socket?.close();
    intruder.ended = true;
    const ticket = await ticketFor(intruder.sessionId, "b");
    const proof = killClient.resumeToken ?? "";
    const before = killHost.peerReady.length;
    const opened = openSignal(
      homeUrls.b,
      { peer: "client", token: ticket, goAway: true, resumeFrom: proof },
      () => undefined,
      () => undefined,
    );
    const answer = await opened.answered;
    await until(() => killHost.peerReady.length > before, "peer-ready for the foreign proof");
    const entry = killHost.peerReady.at(-1);
    opened.socket.close();
    expect(answer?.type === "ready", `answer: ${answer?.type}`);
    expect(entry?.sessionId === intruder.sessionId && entry.resumed === false, `peer-ready: ${JSON.stringify(entry)}`);
    return "ready with resumed=false; the host builds the peer again";
  });

  homeA.child = spawnHome("a", signalPortA, healthPortA, controlPlanePort, turnPort);
  await waitForReady(homeA);
  downHomes.delete("a");
  logger.info("Home a is ready again.");

  const drainHost = newHost("host-drain", true);
  const drainClient = newClient(drainHost.hostId, true);
  const drainOldClient = newClient(drainHost.hostId, false);
  hostHomes.set(drainHost.hostId, "b");
  hosts.push(drainHost);
  clients.push(drainClient, drainOldClient);
  await connectHost(drainHost, undefined, "start");
  await Promise.all([startClient(drainClient), startClient(drainOldClient)]);
  await until(() => drainClient.ready && drainOldClient.ready, "drain clients ready");

  await check("The admin route refuses calls without the token, with a wrong token or a bad body", async () => {
    const statuses = {
      noToken: (await goAway(homeB, {}, null)).status,
      wrongToken: (await goAway(homeB, {}, randomBytes(32).toString("base64url"))).status,
      badBody: (await goAway(homeB, { waveSize: 0 })).status,
      extraField: (await goAway(homeB, { waveSize: 1, hostIds: ["x"] })).status,
      largeBody: (await goAway(homeB, "x".repeat(2_048))).status,
      get: (
        await fetch(`http://127.0.0.1:${homeB.healthPort}/admin/go-away`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        })
      ).status,
    };
    expect(statuses.noToken === 404 && statuses.wrongToken === 404, JSON.stringify(statuses));
    expect(
      statuses.badBody === 400 && statuses.extraField === 400 && statuses.largeBody === 400,
      JSON.stringify(statuses),
    );
    expect(statuses.get !== 200, JSON.stringify(statuses));
    expect(
      hosts.every((host) => host.goAwayFrames === 0),
      "A refused call sent go-away.",
    );
    return JSON.stringify(statuses);
  });

  const external = externalAddress();
  if (external)
    await check("The admin route refuses a call from an address that is not loopback", async () => {
      const status = (await goAway(homeB, {}, ADMIN_TOKEN, external)).status;
      expect(status === 404, `status ${status}`);
      return `status ${status} from ${external.includes(":") ? "an IPv6" : "an IPv4"} interface address`;
    });
  else skipped.push("Admin route from an address that is not loopback: the machine has no external IPv4 interface.");

  await check("go-away moves hosts and clients to the other home with no failed open", async () => {
    const failuresBefore =
      (await metric(homeA, "openbot_remote_auth_failures_total")) +
      (await metric(homeB, "openbot_remote_auth_failures_total"));
    const capable = hosts.filter((host) => host.goAway && homeOf(host.url) === "b");
    const followers = clients.filter(
      (client) => client.goAway && !client.ended && capable.some((host) => host.hostId === client.hostId),
    );
    const keptPeers = new Map(
      followers.map((client) => [
        client.sessionId,
        hosts.find((host) => host.hostId === client.hostId)?.peers.get(client.sessionId)?.id,
      ]),
    );
    const opensBefore = [...capable, ...followers].map((actor) => actor.failedOpens);
    const peerReadyBefore = new Map(capable.map((host) => [host.hostId, host.peerReady.length]));
    const response = await goAway(homeB, { waveSize: 1, waveIntervalMs: 300, withinMs: GO_AWAY_WITHIN_MS });
    const summary = await response.json();
    expect(response.status === 200, `status ${response.status}`);
    expect(isGoAwaySummary(summary), `summary ${JSON.stringify(summary)}`);
    expect(summary.hosts === capable.length && summary.waves === capable.length, JSON.stringify(summary));
    expect(summary.withoutCapability === 1, JSON.stringify(summary));
    await until(
      () =>
        capable.every((host) => host.ready && homeOf(host.url) === "a") &&
        followers.every(
          (client) =>
            client.ready && homeOf(client.url) === "a" && client.answers.some((answer) => answer.home === "a"),
        ),
      "drained peers on a",
    );
    const failedOpens = [...capable, ...followers].map((actor, index) => actor.failedOpens - (opensBefore[index] ?? 0));
    expect(
      failedOpens.every((count) => count === 0),
      `failed opens: ${failedOpens.join(",")}`,
    );
    for (const client of followers) {
      const host = hosts.find((candidate) => candidate.hostId === client.hostId);
      expect(
        host?.peers.get(client.sessionId)?.id === keptPeers.get(client.sessionId),
        "A drained host built a resumed client again.",
      );
      const onA = host ? peerReadyOn(host, client, "a", peerReadyBefore.get(host.hostId)) : [];
      expect(onA.length > 0 && onA.every((entry) => entry.resumed), `peer-ready on a: ${JSON.stringify(onA)}`);
    }
    const failuresAfter =
      (await metric(homeA, "openbot_remote_auth_failures_total")) +
      (await metric(homeB, "openbot_remote_auth_failures_total"));
    expect(failuresAfter === failuresBefore, `auth failures ${failuresBefore} -> ${failuresAfter}`);
    return `${JSON.stringify(summary)}; ${capable.length} hosts and ${followers.length} clients on a; failed opens 0; auth failures unchanged; kept peers resumed`;
  });

  await check("Old peers get no go-away and keep today's behavior", async () => {
    expect(
      oldHost.goAwayFrames === 0 && homeOf(oldHost.url) === "b",
      `old host: ${oldHost.goAwayFrames} frames on ${homeOf(oldHost.url)}`,
    );
    const oldClients = clients.filter((client) => !client.goAway);
    expect(
      oldClients.every((client) => client.goAwayFrames === 0),
      "An old client got go-away.",
    );
    expect(drainOldClient.socket !== null, "The old client of the drained host lost its socket.");
    return `old host stays on b; ${oldClients.length} old clients got no go-away frame`;
  });

  await check("A host that connects to a draining home gets go-away at once", async () => {
    const lateHost = newHost("host-late", true);
    hostHomes.set(lateHost.hostId, "b");
    hosts.push(lateHost);
    await connectHost(lateHost, undefined, "start");
    await until(() => lateHost.ready && homeOf(lateHost.url) === "a", "late host on a");
    expect(lateHost.goAwayFrames >= 1, `frames ${lateHost.goAwayFrames}`);
    return `moves: ${JSON.stringify(lateHost.moves)}`;
  });

  await check("A revoked session cannot resume on the other home", async () => {
    const proof = drainClient.resumeToken;
    expect(proof !== null, "The client has no resume token.");
    const session = sessions.get(drainClient.sessionId);
    expect(session !== undefined, "No session.");
    const preparedTicket = await ticketFor(drainClient.sessionId, "b");
    session.revoked = true;
    const event: SessionEndedEvent = {
      type: "remote-session-ended",
      hostId: drainClient.hostId,
      sessionId: drainClient.sessionId,
    };
    const statuses = [(await postAuthEvent(homeA, event)).status, (await postAuthEvent(homeB, event)).status];
    await until(() => drainClient.ended && drainClient.socket === null, "revoked client ends");
    const refusals: string[] = [];
    for (const [label, hello] of [
      ["ticket with resumeFrom", { peer: "client", token: preparedTicket, goAway: true, resumeFrom: proof }],
      ["home a resume token on b", { peer: "client", token: proof, goAway: true }],
    ] as const) {
      const frames: Frame[] = [];
      const opened = openSignal(
        homeUrls.b,
        hello,
        (frame) => frames.push(frame),
        () => undefined,
      );
      const answer = await opened.answered;
      opened.socket.close();
      expect(answer === null, `${label}: ${answer?.type}`);
      refusals.push(
        `${label}: ${frames.map((frame) => (frame.type === "error" ? frame.code : frame.type)).join(",") || "closed"}`,
      );
    }
    const ticket = await controlPlane.bootstrapClient(drainClient.sessionId).then(
      () => "issued",
      () => "refused",
    );
    expect(ticket === "refused", "The control plane gave a ticket to a revoked session.");
    return `auth events ${statuses.join(",")}; client closed ${drainClient.closedWith}; ${refusals.join("; ")}; new ticket ${ticket}`;
  });

  await check("A resume token of one home is refused as a token on the other home", async () => {
    const client = clients.find(
      (candidate) => candidate.goAway && !candidate.ended && candidate.resumeToken && homeOf(candidate.url) === "a",
    );
    const token = client?.resumeToken;
    expect(typeof token === "string", "No resumed client on a.");
    const opened = openSignal(
      homeUrls.b,
      { peer: "client", token },
      () => undefined,
      () => undefined,
    );
    const answer = await opened.answered;
    opened.socket.close();
    expect(answer === null, `answer ${answer?.type}`);
    return "refused: the resume token keeps the signal claim of its home";
  });

  await check("No log line holds a secret", async () => {
    const secrets = [SESSION_SECRET, AUTH_WEBHOOK_SECRET, TURN_SECRET, METRICS_TOKEN, ADMIN_TOKEN];
    const leaks = serviceOutput.filter((line) => secrets.some((secret) => line.includes(secret)));
    expect(leaks.length === 0, `${leaks.length} log chunks hold a secret`);
    return `${serviceOutput.length} log chunks checked`;
  });
} catch (error) {
  record("The cross-home run completes", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const host of hosts) host.socket?.close();
  for (const client of clients) {
    client.ended = true;
    client.socket?.close();
  }
  homeA.child.kill("SIGTERM");
  homeB.child.kill("SIGTERM");
  plane.close();
  turnServer.close();
}

mkdirSync(OUT, { recursive: true });
const failed = checks.filter((item) => !item.passed);
const report = {
  service: "remote/api",
  homes: ["a", "b"],
  checks,
  passed: checks.length - failed.length,
  failed: failed.length,
  hostMoves: hosts.map((host) => ({
    hostId: host.hostId,
    goAway: host.goAway,
    moves: host.moves,
    failedOpens: host.failedOpens,
  })),
  clientOpens: clients.map((client) => ({
    hostId: client.hostId,
    goAway: client.goAway,
    failedOpens: client.failedOpens,
    errors: client.errors,
  })),
  validateCalls: validateCalls.length,
  skipped,
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`Wrote .openbot-build/signal-cross-home/report.json: ${report.passed} passed, ${report.failed} failed.`);
process.exit(failed.length === 0 ? 0 : 1);
