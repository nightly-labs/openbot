// Starts the real Signal service (`remote/api`) on a free local port with throwaway secrets and a
// fake account service, then checks its secret and authentication rules over real HTTP and
// WebSocket connections: the Telegram secret header, the Slack signature, the signed account
// events, the body limits, the remote and route tickets, a failed account service during an initial ticket check after a start, the limit on parallel account service checks during a burst of hellos, the generic webhook headers, the hello deadline, the reuse of
// TURN credentials, the pick of one TURN relay that allocates for each host, the `signal` ticket claim and the entry rule of
// two Signal machines (with a second Signal and a fake DNS server), and that no frame or log line holds the Telegram bot token. Writes .openbot-build/signal-security-e2e/report.json and exits
// non-zero when a check fails. It makes no request to Telegram, Slack or Discord.
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import {
  createIngressQueueKeyPair,
  importIngressQueuePrivateKey,
  openQueuedDelivery,
} from "@openbot/contracts/signal-protocol/ingress-queue";
import { SLACK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/slack-route";
import { TELEGRAM_ROUTE_AUDIENCE, TELEGRAM_UPDATES_PATH } from "@openbot/contracts/signal-protocol/telegram-route";
import {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
  type RemoteTicketClaims,
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

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/signal-security-e2e");
const WAIT_MS = 10_000;

const logger = createOpenBotLogger("signal-security-e2e");

// Throwaway values for this run only. The bot token's secret part must never leave Signal.
const BOT_ID = "777000111";
const BOT_TOKEN_SECRET = `AAH-${randomBytes(18).toString("base64url")}`;
const BOT_TOKEN = `${BOT_ID}:${BOT_TOKEN_SECRET}`;
const TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const AUTH_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const SLACK_APP_ID = "A0E2ETEST";
const SLACK_SECRET = randomBytes(32).toString("hex");
const HOST_ID = "host-e2e";
const ROUTED_CHAT = "-100";
const SECOND_CHAT = "-300";
const WEBHOOK_ROUTE = "route-e2e";
const LINK_HOST_ID = "host-link-e2e";
const LINK_CHAT = "-500";
const LINK_CODE = randomBytes(32).toString("base64url");
// The account service fails for the sessions of this host, and calls the sessions of the next one inactive.
const UNAVAILABLE_HOST_ID = "host-unavailable-e2e";
const INACTIVE_HOST_ID = "host-inactive-e2e";
// The account service answers the sessions of these hosts slowly, and the run counts how many checks wait at a time.
const BURST_HOST_PREFIX = "host-burst-e2e-";
const BURST_PEERS = 100;
const BURST_CHECK_MILLISECONDS = 300;
// `RESUME_CHECK_CONCURRENCY` in remote/api/src/index.ts.
const RESUME_CHECK_CONCURRENCY = 64;
const burstChecks = { active: 0, maximum: 0 };
// Two names of the fake TURN server, which allocates, and one name that does not resolve.
const LIVE_RELAYS = ["127.0.0.1", "localhost"];
const DOWN_RELAY = "turn-down.invalid";
const RELAY_HOST_IDS = Array.from({ length: 12 }, (_, index) => `host-relay-e2e-${index}`);
const METRICS_TOKEN = randomBytes(32).toString("base64url");
// The `SIGNAL_ID` of both Signals of this run, and the entry name that the fake DNS server answers.
const SIGNAL_ID = "a";
const ENTRY_HOST = "signal.entry.test";
const ENTRY_IPV4 = "192.0.2.1";
const OTHER_IPV4 = "192.0.2.2";
// The address that the fake DNS server gives for the entry name. The run changes it to move the entry.
const entryDns = { address: ENTRY_IPV4 };

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

/**
 * A TURN server that answers each Allocate as coturn does: 401 with a realm and a nonce without
 * credentials, success with them. It does not check the credentials. It answers each Refresh.
 */
function startTurnServer(): Promise<Socket> {
  const socket = createSocket("udp4");
  const attribute = (type: number, value: Buffer) => {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(value.length, 2);
    return Buffer.concat([header, value, Buffer.alloc((4 - (value.length % 4)) % 4)]);
  };
  socket.on("message", (request, sender) => {
    if (request.length < 20 || request.readUInt32BE(4) !== 0x2112a442) return;
    const method = request.readUInt16BE(0);
    let credentials = false;
    for (let offset = 20; offset + 4 <= request.length; ) {
      if (request.readUInt16BE(offset) === 0x0006) credentials = true;
      offset += 4 + Math.ceil(request.readUInt16BE(offset + 2) / 4) * 4;
    }
    const body =
      method === 0x0003 && !credentials
        ? Buffer.concat([
            attribute(0x0009, Buffer.from([0, 0, 4, 1])),
            attribute(0x0014, Buffer.from("e2e")),
            attribute(0x0015, Buffer.from("nonce")),
          ])
        : Buffer.alloc(0);
    const header = Buffer.alloc(20);
    header.writeUInt16BE(method | (method === 0x0003 && !credentials ? 0x0110 : 0x0100), 0);
    header.writeUInt16BE(body.length, 2);
    request.copy(header, 4, 4, 20);
    socket.send(Buffer.concat([header, body]), sender.port, sender.address);
  });
  return new Promise((resolveSocket) => socket.bind(0, "127.0.0.1", () => resolveSocket(socket)));
}

/**
 * A DNS server that answers the A query of `ENTRY_HOST` with `entryDns.address`, and any other query with
 * NXDOMAIN. The TTL is 0, so each lookup of Signal asks again.
 */
function startEntryDns(): Promise<Socket> {
  const socket = createSocket("udp4");
  socket.on("message", (query, sender) => {
    if (query.length < 12) return;
    const labels: string[] = [];
    let offset = 12;
    while (offset < query.length && query[offset] !== 0) {
      const length = query[offset] ?? 0;
      labels.push(query.subarray(offset + 1, offset + 1 + length).toString());
      offset += 1 + length;
    }
    // The zero label, the type and the class.
    const questionEnd = offset + 5;
    if (questionEnd > query.length) return;
    const matches = labels.join(".").toLowerCase() === ENTRY_HOST && query.readUInt16BE(offset + 1) === 1;
    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header.writeUInt16BE(matches ? 0x8180 : 0x8183, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(matches ? 1 : 0, 6);
    const answer = matches
      ? Buffer.concat([
          Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4]),
          Buffer.from(entryDns.address.split(".").map(Number)),
        ])
      : Buffer.alloc(0);
    socket.send(Buffer.concat([header, query.subarray(12, questionEnd), answer]), sender.port, sender.address);
  });
  return new Promise((resolveSocket) => socket.bind(0, "127.0.0.1", () => resolveSocket(socket)));
}

/** The host names in the STUN and TURN URLs of a `ready` frame. */
function relayHosts(ready: { iceServers?: Array<{ urls: string | string[] }> }): string[] {
  const urls = (ready.iceServers ?? []).flatMap((server) => [server.urls].flat());
  return [...new Set(urls.map((url) => url.replace(/^(?:stun|turns?):/u, "").replace(/:[0-9]+(?:\?.*)?$/u, "")))];
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

function hmac(secret: string, text: string, encoding: "hex" | "base64url") {
  return createHmac("sha256", secret).update(text).digest(encoding);
}

// The account service that Signal asks. It confirms every route that a ticket names, and records
// whether each request carried a valid service signature.
const controlPlaneCalls: Array<{ path: string; signed: boolean }> = [];
// The Telegram chat and the `wake` flag of each route-wake request.
const routeWakes: Array<{ chatId: string; wake: boolean }> = [];
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}
function startControlPlane(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const timestamp = String(request.headers["openbot-timestamp"] ?? "");
    const signature = String(request.headers["openbot-signature"] ?? "");
    const signed =
      signature === hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`, "base64url") &&
      Math.abs(Date.now() / 1_000 - Number(timestamp)) < 300;
    const path = request.url ?? "";
    controlPlaneCalls.push({ path, signed });
    const payload = body ? JSON.parse(body) : {};
    const answer = (status: number, value?: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    if (!signed) return answer(401);
    if (path === "/v2/remote/resume/validate") {
      if (payload.hostId === UNAVAILABLE_HOST_ID) return answer(503);
      if (String(payload.hostId).startsWith(BURST_HOST_PREFIX)) {
        burstChecks.active += 1;
        burstChecks.maximum = Math.max(burstChecks.maximum, burstChecks.active);
        await new Promise((wake) => setTimeout(wake, BURST_CHECK_MILLISECONDS));
        burstChecks.active -= 1;
        return answer(200, { valid: true });
      }
      return answer(200, { valid: payload.hostId !== INACTIVE_HOST_ID });
    }
    if (path === "/v2/remote/telegram-route/validate") return answer(200, { chats: payload.chats });
    // Only the one link code of this run links a chat, to the host of the link check.
    if (path === "/v2/remote/telegram-route/link")
      return payload.code === LINK_CODE ? answer(200, { hostId: LINK_HOST_ID, linkedAt: Date.now() }) : answer(404);
    // With route wakes, Signal keeps events for a host. No route here is of a hosted server.
    if (path === "/v2/remote/route-wake") {
      if (payload.route?.platform === "telegram") routeWakes.push({ chatId: payload.route.chatId, wake: payload.wake });
      return answer(200, { hostId: null, state: "not_hosted" });
    }
    if (path === "/v2/remote/webhook-route/validate")
      return answer(200, { routes: payload.routes.map((route: { id: string }) => route.id) });
    return answer(404);
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

// Tickets that the account service would sign for a host.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const { privateKey: foreignKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "e2e-1", alg: "ES256", use: "sig" };

async function sign(claims: JWTPayload, audience: string, key = privateKey) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "e2e-1" })
    .setAudience(audience)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + 300)
    .sign(key);
}

function remoteTicket(
  overrides: Partial<
    Pick<
      RemoteTicketClaims,
      "hostId" | "userId" | "membershipId" | "sessionExpiresAt" | "protocolMinimum" | "protocolMaximum" | "signal"
    >
  > = {},
  key = privateKey,
) {
  const now = Math.floor(Date.now() / 1_000);
  return sign(
    {
      jti: randomUUID(),
      sessionId: `session-${randomUUID()}`,
      hostId: HOST_ID,
      userId: "owner-e2e",
      membershipId: `${HOST_ID}:host`,
      role: "host",
      authEpoch: 1,
      protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
      protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
      sessionExpiresAt: now + 86_400,
      ...overrides,
    },
    REMOTE_TICKET_AUDIENCE,
    key,
  );
}

interface Peer {
  frames: string[];
  socket: WebSocket;
  closed: Promise<number>;
  next(predicate: (frame: string) => boolean, label: string): Promise<string>;
}

const allFrames: string[] = [];
function connect(signalUrl: string): Promise<Peer> {
  return new Promise((resolvePeer, reject) => {
    const socket = new WebSocket(signalUrl);
    const frames: string[] = [];
    const waiters: Array<{ predicate: (frame: string) => boolean; resolve: (frame: string) => void }> = [];
    const closed = new Promise<number>((resolveClose) => socket.addEventListener("close", (e) => resolveClose(e.code)));
    socket.addEventListener("message", (event) => {
      const frame = event.data instanceof ArrayBuffer ? Buffer.from(event.data).toString() : String(event.data);
      frames.push(frame);
      allFrames.push(frame);
      for (const waiter of waiters.splice(0)) {
        if (waiter.predicate(frame)) waiter.resolve(frame);
        else waiters.push(waiter);
      }
    });
    socket.addEventListener("error", () => reject(new Error("The WebSocket failed.")));
    socket.addEventListener("open", () =>
      resolvePeer({
        frames,
        socket,
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

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}.`)), WAIT_MS)),
  ]);
}

async function waitForReady(url: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Signal exited with code ${child.exitCode}.`);
    const ready = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error("Signal did not become ready.");
}

const [signalPort, healthPort, controlPlanePort] = await Promise.all([freePort(), freePort(), freePort()]);
const controlPlane = await startControlPlane(controlPlanePort);
const turnServer = await startTurnServer();
const serviceOutput: string[] = [];
const child = spawn("bun", [resolve(ROOT, "remote/api/src/index.ts")], {
  cwd: resolve(ROOT, "remote/api"),
  // Only what Signal needs, so no developer or production secret reaches it.
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    REMOTE_SIGNAL_HOST: "127.0.0.1",
    REMOTE_SIGNAL_PORT: String(signalPort),
    REMOTE_HEALTH_PORT: String(healthPort),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
    REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${controlPlanePort}`,
    REMOTE_SESSION_SECRET: randomBytes(32).toString("base64url"),
    REMOTE_AUTH_WEBHOOK_SECRET: AUTH_WEBHOOK_SECRET,
    TURN_SHARED_SECRET: randomBytes(32).toString("base64url"),
    TURN_HOST: LIVE_RELAYS[0],
    TURN_EXTRA_HOSTS: [...LIVE_RELAYS.slice(1), DOWN_RELAY].join(","),
    TURN_PORT: String(turnServer.address().port),
    REMOTE_METRICS_TOKEN: METRICS_TOKEN,
    SIGNAL_ID,
    SLACK_SIGNING_SECRET: `${SLACK_APP_ID}:${SLACK_SECRET}`,
    TELEGRAM_BOT_TOKENS: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET,
    // All sockets of the burst check come from one address.
    REMOTE_MAX_CONNECTIONS_PER_IP: String(BURST_PEERS * 2),
    REMOTE_MAX_MESSAGES_PER_MINUTE: String(BURST_PEERS * 20),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
child.stderr?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));

// The second Signal and the DNS server of the entry checks.
let entryChild: ChildProcess | null = null;
let entryDnsServer: Socket | null = null;

const base = `http://127.0.0.1:${signalPort}`;
const signalUrl = `ws://127.0.0.1:${signalPort}/v1/signal`;
const telegramSecret = hmac(TELEGRAM_WEBHOOK_SECRET, `telegram-webhook:${BOT_ID}`, "base64url");
const postUpdate = (body: string, secret = telegramSecret, botId = BOT_ID) =>
  fetch(`${base}${TELEGRAM_UPDATES_PATH}/${botId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body,
  });
const update = (chatId: string, text: string) =>
  JSON.stringify({ update_id: 1, message: { chat: { id: Number(chatId) }, text } });
const postAuthEvent = (body: string, timestamp: string, signature: string) =>
  fetch(`${base}/internal/auth-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signature },
    body,
  });
const postSlack = (body: string, timestamp: string, signature: string) =>
  fetch(`${base}${SLACK_EVENTS_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
const slackSignature = (body: string, timestamp: string, secret = SLACK_SECRET) =>
  `v0=${hmac(secret, `v0:${timestamp}:${body}`, "hex")}`;
const nowSeconds = () => String(Math.floor(Date.now() / 1_000));

/** Sends a host hello and returns the socket. */
async function hello(url: string, token: string): Promise<Peer> {
  const peer = await connect(url);
  peer.socket.send(JSON.stringify({ type: "hello", version: 1, peer: "host", token }));
  return peer;
}

/** The `ready` frame of a host hello. */
async function helloReady(url: string, token: string): Promise<{ peer: Peer; ready: { resumeToken?: string } }> {
  const peer = await hello(url, token);
  const ready = JSON.parse(await peer.next((frame) => frame.includes('"type":"ready"'), "ready after hello"));
  return { peer, ready };
}

/** Waits until `/metrics` of the Signal on `port` has the line `sample`. */
async function metricShows(port: number, sample: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    const page = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    }).then((response) => response.text());
    lines = page.split("\n").filter((line) => line.startsWith("openbot_remote_signal_entry"));
    if (lines.includes(sample)) return sample;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error(`metric: ${lines.join(", ") || "absent"}`);
}

async function helloFails(name: string, ticket: string) {
  await check(name, async () => {
    const peer = await connect(signalUrl);
    peer.socket.send(JSON.stringify({ type: "hello", version: 1, peer: "host", token: ticket }));
    const code = await withDeadline(peer.closed, "close after a refused hello");
    expect(!peer.frames.some((frame) => frame.includes('"type":"ready"')), "Signal sent ready for a refused ticket.");
    return `closed with ${code}; frames: ${peer.frames.join(" ").slice(0, 200)}`;
  });
}

try {
  await waitForReady(`${base}/health/ready`, child);
  logger.info(`Signal is ready on port ${signalPort}.`);

  // 1. Telegram: only a request with the bot's own secret header reaches a host.
  const ingress = await connect(signalUrl);
  ingress.socket.send(
    JSON.stringify({
      type: "hello",
      version: 1,
      peer: "ingress",
      token: await remoteTicket(),
      telegramRoute: await sign(
        {
          hid: HOST_ID,
          chats: [
            { id: ROUTED_CHAT, botId: BOT_ID, linkedAt: 1_000 },
            { id: SECOND_CHAT, botId: BOT_ID, linkedAt: 1_000 },
          ],
        },
        TELEGRAM_ROUTE_AUDIENCE,
      ),
      webhookRoute: await sign(
        { hid: HOST_ID, routes: [{ id: WEBHOOK_ROUTE, linkedAt: 1_000 }] },
        WEBHOOK_ROUTE_AUDIENCE,
      ),
    }),
  );
  const ready = await ingress.next((frame) => frame.includes('"type":"ready"'), "ingress ready");

  await check("A valid host ticket with a Telegram route is admitted", async () => {
    expect(JSON.parse(ready).capabilities?.includes("telegram") === true, `ready: ${ready.slice(0, 200)}`);
    return "ready names the telegram capability";
  });

  await check("A Telegram update with a wrong or empty secret header gets 401 and reaches no host", async () => {
    const before = ingress.frames.length;
    const wrong = await postUpdate(update(ROUTED_CHAT, "wrong secret"), "x".repeat(43));
    const empty = await postUpdate(update(ROUTED_CHAT, "empty secret"), "");
    const otherBot = await postUpdate(update(ROUTED_CHAT, "other bot"), telegramSecret, "999");
    expect(wrong.status === 401, `wrong secret: ${wrong.status}`);
    expect(empty.status === 401, `empty secret: ${empty.status}`);
    expect(otherBot.status === 404, `unknown bot: ${otherBot.status}`);
    // The next valid update is the barrier: when it arrives, nothing before it did.
    const accepted = await postUpdate(update(ROUTED_CHAT, "right secret"));
    expect(accepted.status === 200, `right secret: ${accepted.status}`);
    const delivery = await ingress.next(
      (frame) => frame.includes('"type":"telegram-delivery"'),
      "Telegram delivery with the right secret",
    );
    const delivered = ingress.frames.slice(before).filter((frame) => frame.includes('"type":"telegram-delivery"'));
    expect(delivered.length === 1, `deliveries: ${delivered.length}`);
    const body = Buffer.from(JSON.parse(delivery).bodyBase64, "base64").toString();
    expect(body.includes("right secret"), "The delivered body is not the signed update.");
    return "wrong 401, empty 401, unknown bot 404, right secret 200 and one delivery";
  });

  await check("A host cannot call the Bot API in a chat that is not routed to its socket", async () => {
    ingress.socket.send(
      JSON.stringify({
        type: "telegram-call",
        version: 1,
        requestId: "call-unrouted",
        botId: BOT_ID,
        method: "sendMessage",
        params: { chat_id: -999, text: "hi" },
      }),
    );
    const answer = JSON.parse(await ingress.next((frame) => frame.includes('"call-unrouted"'), "telegram-call-result"));
    expect(answer.ok === false && answer.errorCode === 403, `answer: ${JSON.stringify(answer)}`);
    return `ok=false errorCode=${answer.errorCode} description=${answer.description}`;
  });

  await check("A Telegram link that lands while its host connects again reaches the next socket", async () => {
    const queueKey = await createIngressQueueKeyPair();
    // The route ticket is made before the link, so it does not name the chat.
    const staleRoute = await sign({ hid: LINK_HOST_ID, chats: [] }, TELEGRAM_ROUTE_AUDIENCE);
    const hello = async () =>
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "ingress",
        token: await remoteTicket({ hostId: LINK_HOST_ID, membershipId: `${LINK_HOST_ID}:host` }),
        telegramRoute: staleRoute,
        queueKey: queueKey.publicKey,
      });
    const first = await connect(signalUrl);
    first.socket.send(await hello());
    await first.next((frame) => frame.includes('"type":"ready"'), "first socket of the link host ready");
    first.socket.close();
    await withDeadline(first.closed, "first socket of the link host closed");
    const linked = await postUpdate(update(LINK_CHAT, `/start ${LINK_CODE}`));
    expect(linked.status === 200, `link update: ${linked.status}`);
    const second = await connect(signalUrl);
    second.socket.send(await hello());
    const kept = JSON.parse(
      await second.next((frame) => frame.includes('"type":"queued-delivery"'), "kept link on the next socket"),
    );
    const opened = await openQueuedDelivery(
      await importIngressQueuePrivateKey(queueKey.privateKey),
      LINK_HOST_ID,
      kept.sealed,
    );
    expect(
      opened.type === "telegram-delivery" && opened.chatId === LINK_CHAT && opened.linked === true,
      `kept frame: ${opened.type}`,
    );
    second.socket.send(JSON.stringify({ type: "queued-delivery-ack", version: 1, id: kept.id }));
    // The next socket holds the chat, though its route ticket does not name it.
    await postUpdate(update(LINK_CHAT, "after link"));
    await second.next(
      (frame) => frame.includes('"type":"telegram-delivery"') && frame.includes(`"chatId":"${LINK_CHAT}"`),
      "update of the linked chat on the next socket",
    );
    second.socket.close();
    return "the next socket got the kept link with linked=true, and the next update of the chat";
  });

  await check("Only a Telegram update that can address OpenBot asks to start a hosted server", async () => {
    // Each case uses its own chat that no socket holds, so Signal asks the account service once for it.
    const message = <Fields extends object>(fields: Fields) => ({ message_id: 1, from: { id: 5 }, ...fields });
    const cases: Array<{ chatId: string; wake: boolean; body: object }> = [
      { chatId: "-600", wake: false, body: { message: message({ chat: { id: -600, type: "group" }, text: "hi" }) } },
      {
        chatId: "-601",
        wake: false,
        body: { message: message({ chat: { id: -601, type: "supergroup" }, caption: "photo", photo: [] }) },
      },
      {
        chatId: "-602",
        wake: true,
        body: {
          message: message({
            chat: { id: -602, type: "group" },
            text: "@bot hi",
            entities: [{ type: "mention", offset: 0, length: 4 }],
          }),
        },
      },
      {
        chatId: "-603",
        wake: true,
        body: {
          message: message({
            chat: { id: -603, type: "group" },
            caption: "@bot",
            caption_entities: [{ type: "mention", offset: 0, length: 4 }],
          }),
        },
      },
      {
        chatId: "-604",
        wake: true,
        body: {
          message: message({ chat: { id: -604, type: "group" }, text: "ok", reply_to_message: { message_id: 0 } }),
        },
      },
      {
        chatId: "-605",
        wake: true,
        body: { message: message({ chat: { id: -605, type: "supergroup" }, text: "ok", message_thread_id: 9 }) },
      },
      { chatId: "606", wake: true, body: { message: message({ chat: { id: 606, type: "private" }, text: "hi" }) } },
      {
        chatId: "-607",
        wake: true,
        body: { message: message({ chat: { id: -607, type: "group" }, new_chat_title: "T" }) },
      },
      {
        chatId: "-608",
        wake: true,
        body: { callback_query: { id: "q-608", data: "s:x", message: { message_id: 1, chat: { id: -608 } } } },
      },
    ];
    for (const { chatId, body } of cases) {
      const response = await postUpdate(JSON.stringify({ update_id: 1, ...body }));
      expect(response.status === 200, `chat ${chatId}: ${response.status}`);
    }
    const deadline = Date.now() + 5_000;
    while (cases.some(({ chatId }) => !routeWakes.some((call) => call.chatId === chatId)) && Date.now() < deadline)
      await new Promise((next) => setTimeout(next, 20));
    const wrong = cases.filter(({ chatId, wake }) => routeWakes.find((call) => call.chatId === chatId)?.wake !== wake);
    expect(
      wrong.length === 0,
      `wrong wake: ${wrong.map(({ chatId }) => `${chatId}=${routeWakes.find((call) => call.chatId === chatId)?.wake}`).join(", ")}`,
    );
    return "plain text and caption: wake=false; mention, caption mention, reply, thread, direct, rename, button: wake=true";
  });

  // 2. Signed account events: Signal acts only on an event that the account service signed now.
  await check("An account event with a bad or stale signature gets 401; a signed one revokes the route", async () => {
    const body = JSON.stringify({ type: "telegram-route-revoked", botId: BOT_ID, chatId: ROUTED_CHAT, through: 2_000 });
    const bad = await postAuthEvent(body, nowSeconds(), "x".repeat(43));
    const staleTime = String(Math.floor(Date.now() / 1_000) - 600);
    const stale = await postAuthEvent(body, staleTime, hmac(AUTH_WEBHOOK_SECRET, `${staleTime}.${body}`, "base64url"));
    const otherBody = await postAuthEvent(
      body.replace(ROUTED_CHAT, SECOND_CHAT),
      nowSeconds(),
      hmac(AUTH_WEBHOOK_SECRET, `${nowSeconds()}.${body}`, "base64url"),
    );
    expect(bad.status === 401, `bad signature: ${bad.status}`);
    expect(stale.status === 401, `stale timestamp: ${stale.status}`);
    expect(otherBody.status === 401, `signature of another body: ${otherBody.status}`);
    const timestamp = nowSeconds();
    const signed = await postAuthEvent(body, timestamp, hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`, "base64url"));
    expect(signed.status === 204, `signed: ${signed.status}`);
    // The revoked chat no longer reaches the host. The update of the chat that stays routed is the barrier.
    const before = ingress.frames.length;
    await postUpdate(update(ROUTED_CHAT, "after revoke"));
    await postUpdate(update(SECOND_CHAT, "still routed"));
    await ingress.next(
      (frame) =>
        frame.includes('"type":"telegram-delivery"') &&
        Buffer.from(JSON.parse(frame).bodyBase64, "base64").toString().includes("still routed"),
      "delivery of the chat that stays routed",
    );
    const revoked = ingress.frames
      .slice(before)
      .filter((frame) => frame.includes('"type":"telegram-delivery"') && frame.includes(`"chatId":"${ROUTED_CHAT}"`));
    expect(revoked.length === 0, "The revoked chat still reached the host.");
    return "bad 401, stale 401, other body 401, signed 204, revoked chat not delivered";
  });

  // 3. Generic webhooks: Signal relays only a request with well-formed signed headers.
  await check("A generic webhook request without well-formed signed headers gets 401", async () => {
    const body = JSON.stringify({ event: "e2e" });
    const headers = (signature: string, timestamp = nowSeconds()) => ({
      "Content-Type": "application/json",
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_DELIVERY_ID_HEADER]: "delivery-1",
      [WEBHOOK_SIGNATURE_HEADER]: signature,
    });
    const post = (signature: string, timestamp?: string) =>
      fetch(`${base}${WEBHOOK_EVENTS_PATH}/${WEBHOOK_ROUTE}`, {
        method: "POST",
        headers: headers(signature, timestamp),
        body,
      });
    const missing = await post("");
    const malformed = await post("sha256=not-hex");
    const badTime = await post(`sha256=${"a".repeat(64)}`, "soon");
    expect(missing.status === 401, `missing signature: ${missing.status}`);
    expect(malformed.status === 401, `malformed signature: ${malformed.status}`);
    expect(badTime.status === 401, `malformed timestamp: ${badTime.status}`);
    const unheld = await fetch(`${base}${WEBHOOK_EVENTS_PATH}/route-nobody-holds`, {
      method: "POST",
      headers: headers(`sha256=${"a".repeat(64)}`),
      body,
    });
    expect(unheld.status === 503, `route that no host holds: ${unheld.status}`);
    const delivered = ingress.frames.filter((frame) => frame.includes('"delivery-1"'));
    expect(delivered.length === 0, "A refused webhook request reached the host.");
    return "missing 401, malformed 401, bad timestamp 401, unheld route 503, nothing delivered";
  });

  // 4. Slack: Signal checks the signature, its age, and that the secret belongs to the named app.
  await check("A Slack request with a bad, stale or other-app signature gets 401", async () => {
    const challenge = JSON.stringify({ type: "url_verification", challenge: "e2e-challenge", token: "unused" });
    const bad = await postSlack(challenge, nowSeconds(), "v0=bad");
    const staleTime = String(Math.floor(Date.now() / 1_000) - 600);
    const stale = await postSlack(challenge, staleTime, slackSignature(challenge, staleTime));
    const otherSecret = await postSlack(
      challenge,
      nowSeconds(),
      slackSignature(challenge, nowSeconds(), "z".repeat(64)),
    );
    expect(bad.status === 401, `bad signature: ${bad.status}`);
    expect(stale.status === 401, `stale timestamp: ${stale.status}`);
    expect(otherSecret.status === 401, `secret of no app: ${otherSecret.status}`);
    const event = JSON.stringify({
      type: "event_callback",
      api_app_id: "A0OTHERAPP",
      team_id: "T0E2E",
      event: { type: "app_mention", channel_type: "channel" },
    });
    const time = nowSeconds();
    const otherApp = await postSlack(event, time, slackSignature(event, time));
    expect(otherApp.status === 401, `signed for one app, named another: ${otherApp.status}`);
    const okTime = nowSeconds();
    const valid = await postSlack(challenge, okTime, slackSignature(challenge, okTime));
    const answer = await valid.text();
    expect(valid.status === 200 && answer === "e2e-challenge", `valid: ${valid.status} ${answer}`);
    return "bad 401, stale 401, unknown secret 401, other app 401, valid challenge 200";
  });

  // A body with no declared length: Signal must stop at its limit, so it answers before the body ends.
  await check("A Slack request or an account event with a body that does not end gets 413", async () => {
    const endless = () => {
      const chunk = new Uint8Array(16 * 1024).fill(0x20);
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          // Past 1 MiB the stream sends nothing more and does not end.
          if (sent >= 1024 * 1024) return new Promise<void>(() => {});
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
    };
    const post = (path: string, headers: Record<string, string>) =>
      withDeadline(fetch(`${base}${path}`, { method: "POST", headers, body: endless() }), path);
    const event = await post("/internal/auth-events", {
      "Content-Type": "application/json",
      "OpenBot-Timestamp": nowSeconds(),
      "OpenBot-Signature": "v1=bad",
    });
    const slack = await post(SLACK_EVENTS_PATH, {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": nowSeconds(),
      "X-Slack-Signature": "v0=bad",
    });
    expect(event.status === 413, `account event: ${event.status}`);
    expect(slack.status === 413, `Slack: ${slack.status}`);
    return "account event 413, Slack 413";
  });

  // 5. Remote tickets: a host connects only with a current ticket that the account service signed.
  await helloFails("A ticket signed by another key is refused", await remoteTicket({}, foreignKey));
  await helloFails(
    "A ticket of an expired remote session is refused",
    await remoteTicket({ sessionExpiresAt: Math.floor(Date.now() / 1_000) - 60 }),
  );
  await helloFails(
    "A ticket with an unsupported protocol range is refused",
    await remoteTicket({
      protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION + 1,
      protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION + 1,
    }),
  );
  // After a restart, Signal asks the account service about each session. A failed account service
  // must not end a session that can still be active; an inactive session still ends.
  await check("A session that the account service cannot check is closed with 1013 and no error", async () => {
    const peer = await connect(signalUrl);
    peer.socket.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "host",
        token: await remoteTicket({ hostId: UNAVAILABLE_HOST_ID, membershipId: `${UNAVAILABLE_HOST_ID}:host` }),
      }),
    );
    const code = await withDeadline(peer.closed, "close after an unchecked hello");
    expect(code === 1013, `close code: ${code}`);
    expect(peer.frames.length === 0, `frames: ${peer.frames.join(" ").slice(0, 200)}`);
    return `closed with ${code} and no frame`;
  });
  await check("A revoked session that the account service cannot check is still refused", async () => {
    const body = JSON.stringify({ type: "remote-auth-changed", hostId: UNAVAILABLE_HOST_ID, authEpoch: 2 });
    const timestamp = nowSeconds();
    const revoked = await postAuthEvent(
      body,
      timestamp,
      hmac(AUTH_WEBHOOK_SECRET, `${timestamp}.${body}`, "base64url"),
    );
    expect(revoked.status === 204, `signed revoke: ${revoked.status}`);
    const peer = await connect(signalUrl);
    peer.socket.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "host",
        token: await remoteTicket({ hostId: UNAVAILABLE_HOST_ID, membershipId: `${UNAVAILABLE_HOST_ID}:host` }),
      }),
    );
    const code = await withDeadline(peer.closed, "close after a revoked unchecked hello");
    expect(code === 1008, `close code: ${code}`);
    expect(
      peer.frames.some((frame) => frame.includes('"code":"authentication_required"')),
      `frames: ${peer.frames.join(" ").slice(0, 200)}`,
    );
    return `closed with ${code} and an authentication_required error`;
  });
  await check("A session that the account service calls inactive is refused", async () => {
    const peer = await connect(signalUrl);
    peer.socket.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "host",
        token: await remoteTicket({ hostId: INACTIVE_HOST_ID, membershipId: `${INACTIVE_HOST_ID}:host` }),
      }),
    );
    const code = await withDeadline(peer.closed, "close after an inactive hello");
    expect(code === 1008, `close code: ${code}`);
    expect(
      peer.frames.some((frame) => frame.includes('"code":"authentication_required"')),
      `frames: ${peer.frames.join(" ").slice(0, 200)}`,
    );
    return `closed with ${code} and an authentication_required error`;
  });
  // After a restart every peer connects again at once. Signal sends a limited number of checks to the
  // account service at the same time, and each peer still gets ready. The hellos use initial tickets,
  // which Signal checks with the account service only in the first 3 minutes after its start.
  await check(
    `A burst of hellos sends at most ${RESUME_CHECK_CONCURRENCY} account service checks at a time`,
    async () => {
      const tickets = await Promise.all(
        Array.from({ length: BURST_PEERS }, (_, index) => {
          const hostId = `${BURST_HOST_PREFIX}${index}`;
          return remoteTicket({ hostId, membershipId: `${hostId}:host`, userId: `owner-burst-${index}` });
        }),
      );
      const peers = await Promise.all(tickets.map(() => connect(signalUrl)));
      try {
        for (const [index, peer] of peers.entries()) {
          peer.socket.send(JSON.stringify({ type: "hello", version: 1, peer: "host", token: tickets[index] }));
        }
        await Promise.all(
          peers.map((peer) => peer.next((frame) => frame.includes('"type":"ready"'), "ready after a burst hello")),
        );
        expect(
          burstChecks.maximum === RESUME_CHECK_CONCURRENCY,
          `${burstChecks.maximum} checks at a time, expected ${RESUME_CHECK_CONCURRENCY}`,
        );
        return `${BURST_PEERS} peers ready; at most ${burstChecks.maximum} checks at a time`;
      } finally {
        for (const peer of peers) peer.socket.close();
      }
    },
  );
  await check("An ingress hello without a route ticket is refused", async () => {
    const peer = await connect(signalUrl);
    peer.socket.send(JSON.stringify({ type: "hello", version: 1, peer: "ingress", token: await remoteTicket() }));
    const code = await withDeadline(peer.closed, "close after an ingress hello with no route");
    expect(!peer.frames.some((frame) => frame.includes('"type":"ready"')), "Signal sent ready.");
    return `closed with ${code}`;
  });

  // 6. Idle sockets and TURN credentials. The idle check runs between the two refreshes, so the
  // second refresh is at least one second later and new credentials would have a new username.
  const refresh = async (): Promise<string> => {
    const before = ingress.frames.length;
    ingress.socket.send(JSON.stringify({ type: "turn-refresh", version: 1, connectionId: null }));
    const answer = JSON.parse(
      await ingress.next(
        (frame) => ingress.frames.indexOf(frame) >= before && frame.includes('"type":"ready"'),
        "ready after turn-refresh",
      ),
    );
    const usernames: unknown[] = (answer.iceServers ?? []).map((server: { username?: unknown }) => server.username);
    const username = usernames.find((value) => typeof value === "string");
    expect(typeof username === "string", `ready: ${JSON.stringify(answer).slice(0, 200)}`);
    return username;
  };
  const firstRefresh = await refresh();

  await check("A socket that sends no hello is closed after the hello deadline", async () => {
    const peer = await connect(signalUrl);
    const code = await Promise.race([
      peer.closed,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error("The idle socket stayed open.")), 45_000)),
    ]);
    expect(code === 1008, `close code: ${code}`);
    expect(
      peer.frames.some((frame) => frame.includes('"code":"authentication_required"')),
      `frames: ${peer.frames.join(" ").slice(0, 200)}`,
    );
    return `closed with ${code} and an authentication_required error`;
  });

  await check("A second turn-refresh soon after the first gets the same TURN credentials", async () => {
    const second = await refresh();
    expect(second !== "" && firstRefresh === second, "Signal made new TURN credentials for each turn-refresh.");
    return "both answers have the same TURN username";
  });

  await check("Signal signs each request to the account service", async () => {
    expect(controlPlaneCalls.length > 0, "Signal made no account service request.");
    const unsigned = controlPlaneCalls.filter((call) => !call.signed);
    expect(unsigned.length === 0, `unsigned: ${unsigned.map((call) => call.path).join(", ")}`);
    return `${controlPlaneCalls.length} requests, all signed: ${[...new Set(controlPlaneCalls.map((call) => call.path))].join(", ")}`;
  });

  // 7. TURN relays: Signal probes each relay and gives each host one relay that allocates.
  await check("Signal marks each TURN relay by its probe", async () => {
    const expected = [...LIVE_RELAYS.map((host) => `{host="${host}"} 1`), `{host="${DOWN_RELAY}"} 0`].map(
      (sample) => `openbot_remote_turn_relay_available${sample}`,
    );
    const deadline = Date.now() + WAIT_MS;
    let samples: string[] = [];
    while (Date.now() < deadline) {
      const page = await fetch(`http://127.0.0.1:${healthPort}/metrics`, {
        headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
      }).then((response) => response.text());
      samples = page.split("\n").filter((line) => line.startsWith("openbot_remote_turn_relay_available{"));
      if (expected.every((sample) => samples.includes(sample))) return samples.join(", ");
      await new Promise((wake) => setTimeout(wake, 200));
    }
    throw new Error(`samples: ${samples.join(", ")}`);
  });
  const relayOf = async (hostId: string) => {
    const peer = await connect(signalUrl);
    peer.socket.send(
      JSON.stringify({
        type: "hello",
        version: 1,
        peer: "host",
        token: await remoteTicket({ hostId, membershipId: `${hostId}:host` }),
      }),
    );
    const ready = JSON.parse(await peer.next((frame) => frame.includes('"type":"ready"'), `ready of ${hostId}`));
    peer.socket.close();
    return relayHosts(ready);
  };
  await check("Each host gets one TURN relay, and only relays that allocate", async () => {
    const picks = new Map<string, string[]>();
    for (const hostId of RELAY_HOST_IDS) picks.set(hostId, await relayOf(hostId));
    const evidence = [...picks].map(([hostId, hosts]) => `${hostId}=${hosts.join("+")}`).join(", ");
    expect(
      [...picks.values()].every((hosts) => hosts.length === 1 && LIVE_RELAYS.includes(hosts[0] ?? "")),
      evidence,
    );
    const used = new Set([...picks.values()].flat());
    expect(
      LIVE_RELAYS.every((host) => used.has(host)),
      `not every live relay was used: ${evidence}`,
    );
    return evidence;
  });
  await check("Two sessions of one host get the same TURN relay", async () => {
    const [first, second] = [await relayOf(HOST_ID), await relayOf(HOST_ID)];
    expect(first.join() === second.join(), `first ${first.join()}, second ${second.join()}`);
    return `both ${first.join()}`;
  });
  await check("/health/turn reports the relay of TURN_HOST", async () => {
    const response = await fetch(`${base}/health/turn`);
    const body = await response.text();
    expect(response.status === 200 && body.includes('"status":"ready"'), `${response.status} ${body}`);
    return `${response.status} ${body}`;
  });

  // 8. Two Signal machines. A Signal with `SIGNAL_ID` refuses a ticket of another machine. A second
  // Signal with the entry rule refuses the tickets of the entry while the entry name names another machine.
  await check("A ticket whose signal claim names another Signal is refused", async () => {
    const peer = await hello(signalUrl, await remoteTicket({ signal: "b" }));
    const code = await withDeadline(peer.closed, "close after a ticket of another Signal");
    expect(code === 1008, `close code: ${code}`);
    expect(
      peer.frames.some((frame) => frame.includes('"code":"authentication_required"')),
      `frames: ${peer.frames.join(" ").slice(0, 200)}`,
    );
    expect(!peer.frames.some((frame) => frame.includes('"type":"ready"')), "Signal sent ready.");
    return `closed with ${code} and an authentication_required error`;
  });
  await check("A ticket with the signal claim of this Signal works, and so does its resume token", async () => {
    const first = await helloReady(signalUrl, await remoteTicket({ signal: SIGNAL_ID }));
    const resumeToken = first.ready.resumeToken;
    expect(typeof resumeToken === "string", "The ready frame has no resume token.");
    first.peer.socket.close();
    const resumed = await helloReady(signalUrl, resumeToken);
    resumed.peer.socket.close();
    return "ready after the ticket and after its resume token";
  });
  await check("A ticket without a signal claim works on the entry", async () => {
    const { peer } = await helloReady(signalUrl, await remoteTicket());
    peer.socket.close();
    return "ready";
  });

  const dnsServer = await startEntryDns();
  entryDnsServer = dnsServer;
  const [entrySignalPort, entryHealthPort] = await Promise.all([freePort(), freePort()]);
  const secondSignal = spawn("bun", [resolve(ROOT, "remote/api/src/index.ts")], {
    cwd: resolve(ROOT, "remote/api"),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      REMOTE_SIGNAL_HOST: "127.0.0.1",
      REMOTE_SIGNAL_PORT: String(entrySignalPort),
      REMOTE_HEALTH_PORT: String(entryHealthPort),
      REMOTE_TLS_DISABLED: "true",
      REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${controlPlanePort}`,
      REMOTE_SESSION_SECRET: randomBytes(32).toString("base64url"),
      REMOTE_AUTH_WEBHOOK_SECRET: AUTH_WEBHOOK_SECRET,
      TURN_SHARED_SECRET: randomBytes(32).toString("base64url"),
      TURN_HOST: LIVE_RELAYS[0],
      TURN_PORT: String(turnServer.address().port),
      REMOTE_METRICS_TOKEN: METRICS_TOKEN,
      SIGNAL_ID,
      SIGNAL_ENTRY_HOST: ENTRY_HOST,
      SIGNAL_PUBLIC_IPV4: ENTRY_IPV4,
      SIGNAL_ENTRY_TEST_DNS_SERVER: `127.0.0.1:${dnsServer.address().port}`,
      SIGNAL_ENTRY_TEST_CHECK_SECONDS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  entryChild = secondSignal;
  secondSignal.stdout?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
  secondSignal.stderr?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
  const entryBase = `http://127.0.0.1:${entrySignalPort}`;
  const entrySignalUrl = `ws://127.0.0.1:${entrySignalPort}/v1/signal`;
  const entryTicket = (hostId: string, signal?: string) =>
    remoteTicket({ hostId, membershipId: `${hostId}:host`, ...(signal ? { signal } : {}) });
  // Without a content type: the entry answers 415, another machine 503 before it reads anything.
  const postEntryWebhook = () =>
    fetch(`${entryBase}${WEBHOOK_EVENTS_PATH}/${WEBHOOK_ROUTE}`, { method: "POST", body: "{}" });
  await waitForReady(`${entryBase}/health/ready`, secondSignal);

  await check("A Signal whose address the entry name has is the entry", async () => {
    const sample = await metricShows(entryHealthPort, `openbot_remote_signal_entry{signal="${SIGNAL_ID}"} 1`);
    const webhook = await postEntryWebhook();
    expect(webhook.status === 415, `webhook status: ${webhook.status}`);
    return `${sample}; webhook ${webhook.status}`;
  });
  const entryPeer = (await helloReady(entrySignalUrl, await entryTicket("host-entry-e2e"))).peer;
  const homedPeer = (await helloReady(entrySignalUrl, await entryTicket("host-homed-e2e", SIGNAL_ID))).peer;
  entryDns.address = OTHER_IPV4;
  await check("When the entry name names another machine, the Signal stops being the entry", async () => {
    const sample = await metricShows(entryHealthPort, `openbot_remote_signal_entry{signal="${SIGNAL_ID}"} 0`);
    return sample;
  });
  await check("The Signal closes the sockets without a signal claim with 1013 and no error", async () => {
    const code = await withDeadline(entryPeer.closed, "close of a socket without a signal claim");
    expect(code === 1013, `close code: ${code}`);
    expect(
      !entryPeer.frames.some((frame) => frame.includes('"type":"error"')),
      `frames: ${entryPeer.frames.join(" ").slice(0, 200)}`,
    );
    expect(homedPeer.socket.readyState === WebSocket.OPEN, "The socket with the signal claim was closed.");
    return `closed with ${code}; the socket with the signal claim stays open`;
  });
  await check("A ticket without a signal claim gets 1013 and no frame when the Signal is not the entry", async () => {
    const peer = await hello(entrySignalUrl, await entryTicket("host-entry-e2e"));
    const code = await withDeadline(peer.closed, "close after a hello without a signal claim");
    expect(code === 1013, `close code: ${code}`);
    expect(peer.frames.length === 0, `frames: ${peer.frames.join(" ").slice(0, 200)}`);
    return `closed with ${code} and no frame`;
  });
  await check("A ticket with the signal claim of the Signal works when it is not the entry", async () => {
    const { peer } = await helloReady(entrySignalUrl, await entryTicket("host-homed-e2e", SIGNAL_ID));
    peer.socket.close();
    return "ready";
  });
  await check("A Signal that is not the entry answers webhooks with 503", async () => {
    const webhook = await postEntryWebhook();
    expect(webhook.status === 503, `webhook status: ${webhook.status}`);
    const health = await fetch(`${entryBase}/health/ready`);
    expect(health.status === 200, `health status: ${health.status}`);
    return `webhook ${webhook.status}; health ${health.status}`;
  });
  homedPeer.socket.close();
  entryDns.address = ENTRY_IPV4;
  await check("When the entry name names the Signal again, it is the entry again", async () => {
    const sample = await metricShows(entryHealthPort, `openbot_remote_signal_entry{signal="${SIGNAL_ID}"} 1`);
    const { peer } = await helloReady(entrySignalUrl, await entryTicket("host-entry-e2e"));
    peer.socket.close();
    return `${sample}; a ticket without a signal claim is ready`;
  });

  // 9. The bot token stays in Signal.
  await check("No frame and no log line holds the Telegram bot token", async () => {
    const framesWithToken = allFrames.filter((frame) => frame.includes(BOT_TOKEN_SECRET));
    const logsWithToken = serviceOutput.filter((line) => line.includes(BOT_TOKEN_SECRET));
    expect(allFrames.length > 0, "No frame was captured.");
    expect(framesWithToken.length === 0, `${framesWithToken.length} frames hold the token.`);
    expect(logsWithToken.length === 0, `${logsWithToken.length} log chunks hold the token.`);
    return `${allFrames.length} frames and ${serviceOutput.length} log chunks checked`;
  });
} catch (error) {
  record("Signal starts and admits a host", false, error instanceof Error ? error.message : String(error));
} finally {
  child.kill("SIGTERM");
  entryChild?.kill("SIGTERM");
  entryDnsServer?.close();
  controlPlane.close();
  turnServer.close();
}

mkdirSync(OUT, { recursive: true });
const failed = checks.filter((item) => !item.passed);
const report = {
  service: "remote/api",
  checks,
  passed: checks.length - failed.length,
  failed: failed.length,
  skipped: [
    "Upload token works once: the first upload calls the real Bot API, whose origin Signal does not take from its configuration.",
    "File token download: it downloads from the real Bot API.",
    "Webhook acknowledgement only from the receiving socket: it needs a full delivery and commit exchange.",
    "Discord routes: they need the real Discord Gateway.",
  ],
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`Wrote .openbot-build/signal-security-e2e/report.json: ${report.passed} passed, ${report.failed} failed.`);
process.exit(failed.length === 0 ? 0 : 1);
