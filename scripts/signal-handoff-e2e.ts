import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
  type RemoteRole,
} from "@openbot/contracts/signal-protocol/ticket";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENTS_PATH,
  WEBHOOK_ROUTE_AUDIENCE,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { createOpenBotLogger } from "@openbot/logging";
import { exportJWK, type JWTPayload, SignJWT } from "jose";
import { WebSocketServer } from "ws";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/signal-handoff");
const WAIT_MS = 20_000;
const DRAIN_SECONDS = 2;
const SNAPSHOT_SECONDS = 1;
const HANDOFF_CLOSE_CODE = 1012;
const HANDOFF_TOKEN_HEADER = "OpenBot-Handoff-Token";
const SIGNAL_ID = "a";
const HOSTS = 3;
const WEBHOOK_HOST_ID = "host-handoff-webhook";
const WEBHOOK_ROUTE = "route-handoff";
const REVOKED_HOST_ID = "host-handoff-revoked";
const DISCORD_APPLICATION_ID = "123456789012345678";
const DISCORD_SESSION_ID = `discord-session-${randomBytes(6).toString("hex")}`;

const logger = createOpenBotLogger("signal-handoff-e2e");
const AUTH_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const SESSION_SECRET = randomBytes(32).toString("base64url");
const HANDOFF_TOKEN = randomBytes(32).toString("base64url");
const METRICS_TOKEN = randomBytes(32).toString("base64url");
const TURN_SECRET = randomBytes(32).toString("base64url");
const DISCORD_BOT_TOKEN = [randomBytes(18), randomBytes(6), randomBytes(27)]
  .map((part) => part.toString("base64url"))
  .join(".");
const STATE_DIR = mkdtempSync(join(tmpdir(), "openbot-signal-handoff-"));
const SNAPSHOT_FILE = join(STATE_DIR, "signal-state.json");

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}
const checks: Check[] = [];

async function check(name: string, run: () => Promise<string>) {
  try {
    const evidence = await run();
    checks.push({ name, passed: true, evidence });
    logger.info(`PASS ${name}`);
  } catch (error) {
    const evidence = error instanceof Error ? error.message : String(error);
    checks.push({ name, passed: false, evidence });
    logger.error(`FAIL ${name}: ${evidence}`);
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hmac(secret: string, text: string) {
  return createHmac("sha256", secret).update(text).digest("base64url");
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

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}

async function waitFor(done: () => boolean, label: string, timeout = WAIT_MS) {
  const deadline = Date.now() + timeout;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}.`);
    await new Promise((wake) => setTimeout(wake, 25));
  }
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}.`)), WAIT_MS)),
  ]);
}

const resumeChecks = { single: 0, batch: 0 };
const resumeCheckCount = () => resumeChecks.single + resumeChecks.batch;
const resumeCheckPhases: string[] = [];
let phase = "setup";
const authEvents: Array<{ eventId: string; attemptedAt: number; payload: string }> = [];
let authEventsAvailable = true;

function startControlPlane(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const timestamp = String(request.headers["openbot-timestamp"] ?? "");
    const signed =
      String(request.headers["openbot-signature"] ?? "") === hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`);
    const answer = (status: number, value?: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    if (!signed) return answer(401);
    const payload = body ? JSON.parse(body) : {};
    const path = request.url ?? "";
    if (path === "/v2/remote/resume/validate") {
      resumeChecks.single += 1;
      resumeCheckPhases.push(`${phase}:single`);
      return answer(200, { valid: true });
    }
    if (path === "/v2/remote/resume/validate-batch") {
      resumeChecks.batch += 1;
      resumeCheckPhases.push(`${phase}:batch`);
      return answer(200, { valid: payload.claims.map(() => true) });
    }
    if (path === "/v2/remote/webhook-route/validate")
      return answer(200, { routes: payload.routes.map((route: { id: string }) => route.id) });
    if (path === "/v2/remote/discord-route/reconcile") return answer(200, {});
    if (path === "/v2/remote/auth-events") {
      if (!authEventsAvailable) return answer(404);
      const after: { attemptedAt: number; eventId: string } = payload.after;
      const events = authEvents
        .filter(
          (event) =>
            event.attemptedAt > after.attemptedAt ||
            (event.attemptedAt === after.attemptedAt && event.eventId > after.eventId),
        )
        .sort((left, right) => left.attemptedAt - right.attemptedAt || left.eventId.localeCompare(right.eventId));
      return answer(200, { events: events.slice(0, payload.limit), more: events.length > payload.limit });
    }
    return answer(404);
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

interface GatewayConnection {
  openedAt: number;
  closedAt: number | null;
  kind: "identify" | "resume" | null;
  sessionId: string | null;
}
const gatewayConnections: GatewayConnection[] = [];
let gatewayOpen = 0;
let gatewayMaximumOpen = 0;

function startDiscord(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/api/v10/gateway/bot")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          url: `ws://127.0.0.1:${port}`,
          shards: 1,
          session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
        }),
      );
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end("{}");
  });
  const gateway = new WebSocketServer({ server });
  gateway.on("connection", (socket) => {
    const connection: GatewayConnection = { openedAt: Date.now(), closedAt: null, kind: null, sessionId: null };
    gatewayConnections.push(connection);
    gatewayOpen += 1;
    gatewayMaximumOpen = Math.max(gatewayMaximumOpen, gatewayOpen);
    let sequence = 0;
    const dispatch = (type: string, data: unknown) =>
      socket.send(JSON.stringify({ op: 0, t: type, s: ++sequence, d: data }));
    socket.on("close", () => {
      connection.closedAt = Date.now();
      gatewayOpen -= 1;
    });
    socket.on("message", (raw) => {
      const frame: { op: number; d: { session_id?: string; seq?: number } | null } = JSON.parse(String(raw));
      if (frame.op === 1) socket.send(JSON.stringify({ op: 11 }));
      if (frame.op === 2) {
        connection.kind = "identify";
        connection.sessionId = DISCORD_SESSION_ID;
        dispatch("READY", {
          v: 10,
          session_id: DISCORD_SESSION_ID,
          resume_gateway_url: `ws://127.0.0.1:${port}`,
          user: { id: "900000000000000001", username: "openbot", discriminator: "0", avatar: null },
          guilds: [],
          application: { id: DISCORD_APPLICATION_ID, flags: 0 },
          shard: [0, 1],
        });
      }
      if (frame.op === 6) {
        connection.kind = "resume";
        connection.sessionId = frame.d?.session_id ?? null;
        sequence = frame.d?.seq ?? 0;
        dispatch("RESUMED", {});
      }
    });
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "e2e-1", alg: "ES256", use: "sig" };

async function sign(claims: JWTPayload, audience: string) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "e2e-1" })
    .setAudience(audience)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

function ticket(hostId: string, role: RemoteRole, sessionId: string) {
  const now = Math.floor(Date.now() / 1_000);
  return sign(
    {
      jti: randomUUID(),
      sessionId,
      hostId,
      userId: `user-${hostId}`,
      membershipId: `${hostId}:${role}`,
      role,
      authEpoch: 1,
      protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
      protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
      sessionExpiresAt: now + 86_400,
    },
    REMOTE_TICKET_AUDIENCE,
  );
}

interface Peer {
  socket: WebSocket;
  frames: string[];
  closed: Promise<number>;
  next(predicate: (frame: string) => boolean, label: string): Promise<string>;
}

function connect(url: string): Promise<Peer> {
  return new Promise((resolvePeer, reject) => {
    const socket = new WebSocket(url);
    const frames: string[] = [];
    const waiters: Array<{ predicate: (frame: string) => boolean; resolve: (frame: string) => void }> = [];
    const closed = new Promise<number>((resolveClose) =>
      socket.addEventListener("close", (event) => resolveClose(event.code)),
    );
    socket.addEventListener("message", (event) => {
      const frame = String(event.data);
      frames.push(frame);
      for (const waiter of waiters.splice(0)) {
        if (waiter.predicate(frame)) waiter.resolve(frame);
        else waiters.push(waiter);
      }
    });
    socket.addEventListener("error", () => reject(new Error("The WebSocket failed.")));
    socket.addEventListener("open", () =>
      resolvePeer({
        socket,
        frames,
        closed,
        next: (predicate, label) => {
          const seen = frames.find(predicate);
          if (seen) return Promise.resolve(seen);
          return new Promise((resolveFrame, rejectFrame) => {
            const timer = setTimeout(() => rejectFrame(new Error(`No frame: ${label}.`)), WAIT_MS);
            waiters.push({
              predicate,
              resolve: (frame) => {
                clearTimeout(timer);
                resolveFrame(frame);
              },
            });
          });
        },
      }),
    );
  });
}

interface ReadyFrame {
  resumeToken?: string;
}

interface SocketCounts {
  unauthenticated: number;
  ingress: number;
  host: number;
  client: number;
}

interface SnapshotPayload {
  writtenAt: number;
  signalId: string;
}

interface ReportCounts {
  platform: string;
  reusePortProbes?: { first: number; second: number };
  drainMilliseconds?: number;
  handoffResumeChecks?: { peers: number; refusalProbes: number };
  webhooks?: { beforeDrain: number[]; duringDrain: number[][]; afterDrain: number[] };
  discord?: { connections: number; maximumOpen: number };
  crashRestartResumeChecks?: number;
  resumeCheckPhases?: string[];
}

interface Member {
  name: string;
  kind: "host" | "client" | "ingress";
  hostId: string;
  sessionId: string;
  firstTicket: string;
  resumeToken: string | null;
  webhookRoute: string | null;
  peer: Peer | null;
  closeCodes: number[];
}

const deliveredWebhooks = new Set<string>();

function answerWebhooks(peer: Peer) {
  peer.socket.addEventListener("message", (event) => {
    const frame: { type: string; requestId?: string; bodyBase64?: string } = JSON.parse(String(event.data));
    if (frame.type !== "webhook-delivery" || !frame.requestId) return;
    const body = Buffer.from(frame.bodyBase64 ?? "", "base64").toString();
    const delivered: { id?: string } = JSON.parse(body);
    const id = delivered.id;
    if (id) deliveredWebhooks.add(id);
    peer.socket.send(
      JSON.stringify({ type: "webhook-delivery-result", version: 1, requestId: frame.requestId, status: 202 }),
    );
  });
}

async function hello(member: Member, token: string) {
  const peer = await connect(signalUrl);
  if (member.kind === "ingress") answerWebhooks(peer);
  peer.socket.send(
    JSON.stringify({
      type: "hello",
      version: 1,
      peer: member.kind,
      token,
      ...(member.webhookRoute ? { webhookRoute: member.webhookRoute } : {}),
    }),
  );
  const outcome = await withDeadline(
    Promise.race([
      peer
        .next((frame) => frame.includes('"type":"ready"'), `${member.name} ready`)
        .then((frame) => {
          const ready: ReadyFrame = JSON.parse(frame);
          return { ready, code: null };
        }),
      peer.closed.then((code) => ({ ready: null, code })),
    ]),
    `${member.name} hello`,
  );
  return { peer, ...outcome };
}

async function admit(member: Member, token: string) {
  const { ready, code, peer } = await hello(member, token);
  if (!ready) throw new Error(`${member.name} was refused with ${code}.`);
  member.peer = peer;
  member.resumeToken = ready.resumeToken ?? null;
  return ready;
}

function rejoin(member: Member) {
  if (!member.resumeToken) throw new Error(`${member.name} has no resume token.`);
  return admit(member, member.resumeToken);
}

async function refused(member: Member, token: string): Promise<number> {
  const { peer, ready, code } = await hello(member, token);
  if (ready) {
    peer.socket.close();
    throw new Error(`${member.name} was admitted.`);
  }
  return code ?? 0;
}

async function newMember(kind: Member["kind"], hostId: string, name: string): Promise<Member> {
  const sessionId = `session-${randomUUID()}`;
  return {
    name,
    kind,
    hostId,
    sessionId,
    firstTicket: await ticket(hostId, kind === "client" ? "owner" : "host", sessionId),
    resumeToken: null,
    webhookRoute:
      kind === "ingress"
        ? await sign({ hid: hostId, routes: [{ id: WEBHOOK_ROUTE, linkedAt: 1_000 }] }, WEBHOOK_ROUTE_AUDIENCE)
        : null,
    peer: null,
    closeCodes: [],
  };
}

function deferred() {
  let done = (): void => undefined;
  const promise = new Promise<void>((resolveDone) => {
    done = resolveDone;
  });
  return { promise, done };
}

async function moveAll(members: Member[]) {
  const hostsBack = new Map(
    members.filter((member) => member.kind === "host").map((member) => [member.hostId, deferred()]),
  );
  await Promise.all(
    members.map(async (member) => {
      const peer = member.peer;
      if (!peer) throw new Error(`${member.name} is not connected.`);
      const code = await withDeadline(peer.closed, `${member.name} close`);
      member.closeCodes.push(code);
      member.peer = null;
      if (member.kind === "client") await hostsBack.get(member.hostId)?.promise;
      await rejoin(member);
      if (member.kind === "host") hostsBack.get(member.hostId)?.done();
    }),
  );
}

async function resumedPeerReady(members: Member[]) {
  const frames = await Promise.all(
    members
      .filter((member) => member.kind === "host" && member.hostId !== REVOKED_HOST_ID)
      .map((member) => {
        const client = members.find((entry) => entry.kind === "client" && entry.hostId === member.hostId);
        if (!member.peer || !client) throw new Error(`${member.name} has no peer or client.`);
        return member.peer.next(
          (frame) => frame.includes('"type":"peer-ready"') && frame.includes(`"sessionId":"${client.sessionId}"`),
          `${member.name} peer-ready`,
        );
      }),
  );
  return frames.map((frame) => {
    const ready: { resumed?: boolean } = JSON.parse(frame);
    return ready.resumed;
  });
}

interface SignalProcess {
  name: string;
  child: ChildProcess;
  healthPort: number;
  output: string[];
  exited: Promise<number | null>;
}
const processes: SignalProcess[] = [];

function startSignal(name: string, healthPort: number, peerPort: number): SignalProcess {
  const output: string[] = [];
  const child = spawn("bun", [resolve(ROOT, "remote/api/src/index.ts")], {
    cwd: resolve(ROOT, "remote/api"),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      REMOTE_SIGNAL_HOST: "127.0.0.1",
      REMOTE_SIGNAL_PORT: String(signalPort),
      REMOTE_HEALTH_PORT: String(healthPort),
      REMOTE_TLS_DISABLED: "true",
      REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${controlPlanePort}`,
      REMOTE_SESSION_SECRET: SESSION_SECRET,
      REMOTE_AUTH_WEBHOOK_SECRET: AUTH_WEBHOOK_SECRET,
      TURN_SHARED_SECRET: TURN_SECRET,
      TURN_HOST: "127.0.0.1",
      REMOTE_METRICS_TOKEN: METRICS_TOKEN,
      REMOTE_HANDOFF_TOKEN: HANDOFF_TOKEN,
      REMOTE_HANDOFF_PEER_PORT: String(peerPort),
      REMOTE_STATE_DIR: STATE_DIR,
      REMOTE_DRAIN_SECONDS: String(DRAIN_SECONDS),
      REMOTE_STATE_SNAPSHOT_SECONDS: String(SNAPSHOT_SECONDS),
      SIGNAL_ID,
      DISCORD_BOT_TOKEN,
      DISCORD_APPLICATION_ID,
      DISCORD_TEST_API_ORIGIN: `http://127.0.0.1:${discordPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const exited = new Promise<number | null>((resolveExit) => child.once("exit", (code) => resolveExit(code)));
  const started = { name, child, healthPort, output, exited };
  processes.push(started);
  return started;
}

async function waitReady(signal: SignalProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signal.child.exitCode !== null)
      throw new Error(`${signal.name} exited with ${signal.child.exitCode}: ${signal.output.join("").slice(-800)}`);
    const ready = await fetch(`http://127.0.0.1:${signal.healthPort}/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((wake) => setTimeout(wake, 100));
  }
  throw new Error(`${signal.name} did not become ready.`);
}

function handoffRequest(port: number, path: string, token = HANDOFF_TOKEN) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [HANDOFF_TOKEN_HEADER]: token },
    body: "{}",
  });
}

async function socketCounts(port: number): Promise<SocketCounts> {
  const response = await handoffRequest(port, "/handoff/status");
  const status: { sockets: SocketCounts } = await response.json();
  return status.sockets;
}

const said = (signal: SignalProcess, text: string) => signal.output.join("").includes(text);

async function postAuthEvent(event: RemoteAuthEvent) {
  const body = JSON.stringify(event);
  authEvents.push({ eventId: randomUUID(), attemptedAt: Date.now(), payload: body });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return fetch(`http://127.0.0.1:${signalPort}/internal/auth-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OpenBot-Timestamp": timestamp,
      "OpenBot-Signature": hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`),
    },
    body,
  });
}

function postWebhook(id: string) {
  return fetch(`http://127.0.0.1:${signalPort}${WEBHOOK_EVENTS_PATH}/${WEBHOOK_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [WEBHOOK_TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1_000)),
      [WEBHOOK_DELIVERY_ID_HEADER]: id,
      [WEBHOOK_SIGNATURE_HEADER]: `sha256=${"c".repeat(64)}`,
    },
    body: JSON.stringify({ id }),
  }).then((response) => response.status);
}

async function postWebhookWithRetry(id: string) {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const status = await postWebhook(id);
    statuses.push(status);
    if (status !== 503) break;
    await new Promise((wake) => setTimeout(wake, 250));
  }
  return statuses;
}

function resealSnapshot(change: (payload: SnapshotPayload) => void, signature?: string) {
  const sealed: { payload: string } = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
  const payload: SnapshotPayload = JSON.parse(sealed.payload);
  change(payload);
  const text = JSON.stringify(payload);
  const signed = hmac(SESSION_SECRET, `openbot-signal-state-v1.${text}`);
  writeFileSync(SNAPSHOT_FILE, JSON.stringify({ payload: text, signature: signature ?? signed }));
}

async function crash(signal: SignalProcess, members: Member[]) {
  signal.child.kill("SIGKILL");
  await signal.exited;
  await Promise.all(
    members.map(async (member) => {
      if (!member.peer) return;
      member.closeCodes.push(await withDeadline(member.peer.closed, `${member.name} close after a crash`));
      member.peer = null;
    }),
  );
}

async function rejoinInOrder(members: Member[]) {
  for (const member of members.filter((entry) => entry.kind !== "client")) await rejoin(member);
  for (const member of members.filter((entry) => entry.kind === "client")) await rejoin(member);
}

async function safePath(name: string, healthPort: number, logLine: string, host: Member) {
  const before = resumeCheckCount();
  const signal = startSignal(name, healthPort, healthPort === healthA ? healthB : healthA);
  await waitReady(signal);
  expect(said(signal, logLine), `${name} did not log "${logLine}".`);
  await rejoin(host);
  const checked = resumeCheckCount() - before;
  expect(checked >= 1, `${name} admitted a resume token with ${checked} account service checks.`);
  await crash(signal, [host]);
  return `${name} logged "${logLine}" and checked the resume token with the account service (${checked} calls)`;
}

const [signalPort, healthA, healthB, controlPlanePort, discordPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const signalUrl = `ws://127.0.0.1:${signalPort}/v1/signal`;
const controlPlane = await startControlPlane(controlPlanePort);
const discord = await startDiscord(discordPort);
const counts: ReportCounts = { platform: process.platform };
let fatal: string | null = null;

try {
  const first = startSignal("A", healthA, healthB);
  await waitReady(first);
  await waitFor(
    () => gatewayConnections.some((connection) => connection.kind === "identify"),
    "first Discord identify",
  );

  const members: Member[] = [];
  for (let index = 0; index < HOSTS; index += 1) {
    const hostId = `host-handoff-${index}`;
    members.push(await newMember("host", hostId, `host-${index}`));
    members.push(await newMember("client", hostId, `client-${index}`));
  }
  members.push(await newMember("ingress", WEBHOOK_HOST_ID, "ingress"));
  members.push(await newMember("host", REVOKED_HOST_ID, "revoked-host"));
  for (const member of members) await admit(member, member.firstTicket);
  const usedTicketOwner = members[0];
  if (!usedTicketOwner) throw new Error("No host.");
  const revoked = await newMember("client", REVOKED_HOST_ID, "revoked-client");
  await admit(revoked, revoked.firstTicket);
  revoked.peer?.socket.close();
  await revoked.peer?.closed;
  revoked.peer = null;

  await check("The handoff routes need the handoff token", async () => {
    const missing = await fetch(`http://127.0.0.1:${healthA}/handoff/status`, { method: "POST", body: "{}" });
    const wrong = await handoffRequest(healthA, "/handoff/status", randomBytes(32).toString("base64url"));
    const drainWithoutToken = await fetch(`http://127.0.0.1:${healthA}/handoff/drain`, { method: "POST", body: "{}" });
    expect(missing.status === 404, `no token: ${missing.status}`);
    expect(wrong.status === 404, `wrong token: ${wrong.status}`);
    expect(drainWithoutToken.status === 404, `drain without a token: ${drainWithoutToken.status}`);
    return "status without a token 404, wrong token 404, drain without a token 404";
  });

  phase = "handoff";
  const checksBeforeHandoff = resumeCheckCount();
  const second = startSignal("B", healthB, healthA);
  await check("The new process joins the running process on the same port", async () => {
    await waitReady(second);
    expect(said(second, "joined the running process"), "B did not join A.");
    const probes = await Promise.all(Array.from({ length: 40 }, () => connect(signalUrl)));
    const [onFirst, onSecond] = await Promise.all([socketCounts(healthA), socketCounts(healthB)]);
    for (const probe of probes) probe.socket.close();
    const spread = { first: onFirst.unauthenticated, second: onSecond.unauthenticated };
    counts.reusePortProbes = spread;
    if (process.platform === "linux")
      expect(spread.first > 0 && spread.second > 0, `40 new sockets: A ${spread.first}, B ${spread.second}`);
    return `both listen on ${signalPort}; 40 new sockets: A ${spread.first}, B ${spread.second}${
      process.platform === "linux" ? "" : " (the spread is checked on Linux only)"
    }`;
  });

  const checksBeforeProbes = resumeCheckCount();
  phase = "refusal-probes";
  await check("A session ended during the handoff is refused on both processes", async () => {
    const answer = await postAuthEvent({
      type: "remote-session-ended",
      hostId: revoked.hostId,
      sessionId: revoked.sessionId,
    });
    expect(answer.status === 204, `auth event: ${answer.status}`);
    const codes: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) codes.push(await refused(revoked, revoked.resumeToken ?? ""));
    expect(
      codes.every((code) => code === 1008),
      `close codes: ${codes.join(",")}`,
    );
    return `8 resume attempts while both processes listen: ${codes.join(",")}`;
  });

  await check("A ticket used on the old process is refused while both processes listen", async () => {
    const codes: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1)
      codes.push(await refused(usedTicketOwner, usedTicketOwner.firstTicket));
    expect(
      codes.every((code) => code === 1008),
      `close codes: ${codes.join(",")}`,
    );
    return `8 attempts: ${codes.join(",")}`;
  });

  const probeChecks = resumeCheckCount() - checksBeforeProbes;
  phase = "handoff";
  const beforeDrain = await Promise.all(Array.from({ length: 8 }, (_, index) => postWebhook(`before-drain-${index}`)));

  const drainStarted = Date.now();
  const drain = await handoffRequest(healthA, "/handoff/drain");
  const moved = moveAll(members);
  const duringDrain = Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      await new Promise((wake) => setTimeout(wake, index * 200));
      return postWebhookWithRetry(`during-drain-${index}`);
    }),
  );

  await check("Each host, client and ingress socket closes with 1012 and resumes on the new process", async () => {
    expect(drain.status === 202, `drain: ${drain.status}`);
    await withDeadline(moved, "all peers moved");
    const codes = members.map((member) => member.closeCodes.at(-1));
    expect(
      codes.every((code) => code === HANDOFF_CLOSE_CODE),
      `close codes: ${codes.join(",")}`,
    );
    const resumed = await resumedPeerReady(members);
    expect(
      resumed.every((value) => value === true),
      `peer-ready resumed: ${resumed.join(",")}`,
    );
    const firstExit = await withDeadline(first.exited, "A exit");
    counts.drainMilliseconds = Date.now() - drainStarted;
    expect(firstExit === 0, `A exit code: ${firstExit}`);
    return `${members.length} sockets closed with 1012 and came back on B; hosts got peer-ready resumed:true; A exited 0 after ${counts.drainMilliseconds} ms`;
  });

  await check("The handoff makes no account service resume checks", async () => {
    const checked = resumeCheckCount() - checksBeforeHandoff - probeChecks;
    counts.handoffResumeChecks = { peers: checked, refusalProbes: probeChecks };
    expect(checked === 0, `resume checks for the moved peers: ${checked}`);
    return `0 validate and validate-batch calls for ${members.length} moved sockets (${probeChecks} calls came from the refused probes only)`;
  });

  await check("A webhook sent before, during and after the drain reaches its host", async () => {
    const during = await withDeadline(duringDrain, "webhooks during the drain");
    const afterDrain = await Promise.all(Array.from({ length: 4 }, (_, index) => postWebhook(`after-drain-${index}`)));
    counts.webhooks = { beforeDrain, duringDrain: during, afterDrain };
    expect(
      beforeDrain.every((status) => status === 202),
      `before: ${beforeDrain.join(",")}`,
    );
    expect(
      during.every((statuses) => statuses.at(-1) === 202),
      `during: ${JSON.stringify(during)}`,
    );
    expect(
      afterDrain.every((status) => status === 202),
      `after: ${afterDrain.join(",")}`,
    );
    const ids = [
      ...Array.from({ length: 8 }, (_, index) => `before-drain-${index}`),
      ...Array.from({ length: 8 }, (_, index) => `during-drain-${index}`),
      ...Array.from({ length: 4 }, (_, index) => `after-drain-${index}`),
    ];
    const missing = ids.filter((id) => !deliveredWebhooks.has(id));
    expect(missing.length === 0, `not delivered: ${missing.join(",")}`);
    const retried = during.filter((statuses) => statuses.length > 1).length;
    return `20 of 20 delivered with 202; ${retried} of 8 during the drain got 503 first and 202 on a sender retry`;
  });

  await check("Only one Discord gateway runs at a time, and the new process resumes the session", async () => {
    await waitFor(() => gatewayConnections.length >= 2 && gatewayConnections[1]?.kind !== null, "Discord resume");
    const [old, next] = gatewayConnections;
    counts.discord = { connections: gatewayConnections.length, maximumOpen: gatewayMaximumOpen };
    expect(gatewayMaximumOpen === 1, `open gateways at one time: ${gatewayMaximumOpen}`);
    expect(next?.kind === "resume", `second connection: ${next?.kind}`);
    expect(next.sessionId === DISCORD_SESSION_ID, "The resume used another session id.");
    expect(old !== undefined && old.closedAt !== null && old.closedAt <= next.openedAt, "The two gateways overlapped.");
    return `2 connections, at most 1 open; the second is a resume of ${DISCORD_SESSION_ID.slice(0, 16)}…`;
  });

  phase = "refusal-probes";
  await check("A session ended during the handoff stays refused on the new process", async () => {
    const code = await refused(revoked, revoked.resumeToken ?? "");
    const ticketCode = await refused(usedTicketOwner, usedTicketOwner.firstTicket);
    expect(code === 1008 && ticketCode === 1008, `revoked ${code}, used ticket ${ticketCode}`);
    return `revoked session ${code}, used ticket ${ticketCode}`;
  });

  await new Promise((wake) => setTimeout(wake, (SNAPSHOT_SECONDS * 2 + 0.5) * 1_000));
  await crash(second, members);
  phase = "crash-restart";
  const checksBeforeCrashRestart = resumeCheckCount();
  const third = startSignal("C", healthA, healthB);
  await check("A crash restart with the snapshot makes no account service burst", async () => {
    await waitReady(third);
    expect(said(third, "restored its state snapshot"), "C did not restore the snapshot.");
    await rejoinInOrder(members);
    const checked = resumeCheckCount() - checksBeforeCrashRestart;
    counts.crashRestartResumeChecks = checked;
    expect(checked === 0, `resume checks after the crash restart: ${checked}`);
    return `${members.length} sockets came back on C with 0 account service checks`;
  });

  phase = "refusal-probes";
  await check("After the crash restart, the ended session and the used ticket stay refused", async () => {
    const code = await refused(revoked, revoked.resumeToken ?? "");
    const ticketCode = await refused(usedTicketOwner, usedTicketOwner.firstTicket);
    expect(code === 1008 && ticketCode === 1008, `revoked ${code}, used ticket ${ticketCode}`);
    return `revoked session ${code}, used ticket ${ticketCode}`;
  });

  await new Promise((wake) => setTimeout(wake, (SNAPSHOT_SECONDS * 2 + 0.5) * 1_000));
  await crash(third, members);
  phase = "safe-path";

  await check("An old snapshot is refused and each session is checked again", async () => {
    resealSnapshot((payload) => {
      payload.writtenAt = Date.now() - 11 * 60_000;
    });
    return safePath("D", healthB, "refused its state snapshot (old)", usedTicketOwner);
  });

  await check("A snapshot with a bad signature is refused and each session is checked again", async () => {
    resealSnapshot(() => undefined, randomBytes(32).toString("base64url"));
    return safePath("E", healthA, "refused its state snapshot (signature)", usedTicketOwner);
  });

  await check("A snapshot of another Signal is refused and each session is checked again", async () => {
    resealSnapshot((payload) => {
      payload.signalId = "b";
    });
    return safePath("F", healthB, "refused its state snapshot (signal)", usedTicketOwner);
  });

  await check("When the auth events cannot be read, each session is checked again", async () => {
    await new Promise((wake) => setTimeout(wake, 100));
    resealSnapshot(() => undefined);
    authEventsAvailable = false;
    return safePath("G", healthA, "could not read the recent auth events", usedTicketOwner);
  });
} catch (error) {
  fatal = error instanceof Error ? error.message : String(error);
  logger.error(`The E2E stopped: ${fatal}`);
} finally {
  for (const signal of processes) if (signal.child.exitCode === null) signal.child.kill("SIGKILL");
  controlPlane.close();
  discord.close();
  rmSync(STATE_DIR, { recursive: true, force: true });
}

mkdirSync(OUT, { recursive: true });
counts.resumeCheckPhases = resumeCheckPhases;
for (const signal of processes) writeFileSync(join(OUT, `signal-${signal.name}.log`), signal.output.join(""));
const passed = fatal === null && checks.every((entry) => entry.passed);
writeFileSync(
  join(OUT, "report.json"),
  `${JSON.stringify({ passed, fatal, checks, counts, finishedAt: new Date().toISOString() }, null, 2)}\n`,
);
logger.info(
  `${checks.filter((entry) => entry.passed).length}/${checks.length} checks passed. Report: ${OUT}/report.json`,
);
process.exit(passed ? 0 : 1);
