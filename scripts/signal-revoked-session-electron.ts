import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import { join } from "node:path";
import { REMOTE_TICKET_AUDIENCE, REMOTE_TICKET_PROTOCOL_VERSION } from "@openbot/contracts/signal-protocol/ticket";
import { app, BrowserWindow } from "electron";
import { exportJWK, type JWK, SignJWT } from "jose";
import { z } from "zod";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const projectRoot = argument("project-root");
const pagePath = argument("page");
const reportPath = argument("report-path");
const runId = argument("run-id");

const HOST_ID = "host-revoked-session-e2e";
const OWNER = "owner-revoked-session-e2e";
const MEMBER_B = "member-b-revoked-session-e2e";
const MEMBER_C = "member-c-revoked-session-e2e";
const MESSAGES_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const AUTH_WEBHOOK_SECRET = randomBytes(32).toString("base64url");
const SESSION_SECRET = randomBytes(32).toString("base64url");
const TURN_SECRET = randomBytes(32).toString("base64url");
const HOST_RECONNECT_MS = 120_000;
const TEARDOWN_AFTER_REVOKE_MS = 20_000;
const OPEN_CHANNEL_CHECK_MS = 2_000;
const SIGNAL_INITIAL_CHECK_MS = 3 * 60_000;
const TICKET_LIFETIME_SECONDS = 300;

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}
const checks: Check[] = [];
const signalOutput: string[] = [];

app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

function record(name: string, passed: boolean, evidence: string): void {
  checks.push({ name, passed, evidence });
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${name}: ${evidence}\n`);
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

const revokedSessions = new Set<string>();
const sessionChecks = new Map<string, number>();
function startControlPlane(port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (request.url === "/v2/remote/resume/validate") {
        const sessionId = String(body.sessionId);
        sessionChecks.set(sessionId, (sessionChecks.get(sessionId) ?? 0) + 1);
      }
      response.writeHead(request.url === "/v2/remote/resume/validate" ? 200 : 404, {
        "Content-Type": "application/json",
      });
      response.end(
        request.url === "/v2/remote/resume/validate"
          ? JSON.stringify({ valid: !revokedSessions.has(String(body.sessionId)) })
          : "",
      );
    });
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

class SignalProxy {
  readonly #pairs = new Set<Socket>();
  readonly #server;
  #blocked = false;

  constructor(signalPort: () => number, localAddress: string) {
    this.#server = createNetServer((downstream) => {
      if (this.#blocked) {
        downstream.destroy();
        return;
      }
      const upstream = connect({ host: "127.0.0.1", port: signalPort(), localAddress });
      this.#pairs.add(downstream);
      this.#pairs.add(upstream);
      const end = () => {
        downstream.destroy();
        upstream.destroy();
        this.#pairs.delete(downstream);
        this.#pairs.delete(upstream);
      };
      downstream.pipe(upstream);
      upstream.pipe(downstream);
      downstream.on("error", end).on("close", end);
      upstream.on("error", end).on("close", end);
    });
  }

  listen(): Promise<number> {
    return new Promise((resolvePort) =>
      this.#server.listen(0, "127.0.0.1", () => {
        const address = this.#server.address();
        resolvePort(typeof address === "object" && address ? address.port : 0);
      }),
    );
  }

  block(): void {
    this.#blocked = true;
    for (const socket of [...this.#pairs]) socket.destroy();
  }

  unblock(): void {
    this.#blocked = false;
  }

  close(): void {
    this.block();
    this.#server.close();
  }
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
let publicJwk: JWK = {};

function ticket(input: { sessionId: string; userId: string; role: "host" | "owner" }): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    jti: randomUUID(),
    sessionId: input.sessionId,
    hostId: HOST_ID,
    userId: input.userId,
    membershipId: input.role === "host" ? `${HOST_ID}:host` : `${HOST_ID}:${input.userId}`,
    role: input.role,
    authEpoch: 1,
    protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
    protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
    sessionExpiresAt: now + 86_400,
  })
    .setProtectedHeader({ alg: "ES256", kid: "revoked-session-e2e" })
    .setAudience(REMOTE_TICKET_AUDIENCE)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + TICKET_LIFETIME_SECONDS)
    .sign(privateKey);
}

let signalPort = 0;
let healthPort = 0;
let controlPlanePort = 0;
let closedTurnPort = 0;
let signal: ChildProcess | null = null;
let signalStartedAt = 0;
let staleTicket: { sessionId: string; token: string; revokeStatus: number } | null = null;

async function startSignal(): Promise<void> {
  const child = spawn("bun", [join(projectRoot, "remote/api/src/index.ts")], {
    cwd: join(projectRoot, "remote/api"),
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
      TURN_PORT: String(closedTurnPort),
      REMOTE_MAX_MESSAGES_PER_MINUTE: String(MESSAGES_PER_MINUTE),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => signalOutput.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => signalOutput.push(chunk.toString()));
  signal = child;
  signalStartedAt = Date.now();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Signal exited with code ${child.exitCode}.`);
    const ready = await fetch(`http://127.0.0.1:${healthPort}/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error("Signal did not become ready.");
}

async function stopSignal(): Promise<void> {
  const child = signal;
  signal = null;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  await exited;
}

async function revoke(sessionId: string): Promise<number> {
  revokedSessions.add(sessionId);
  const body = JSON.stringify({ type: "remote-session-ended", hostId: HOST_ID, sessionId });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", AUTH_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("base64url");
  const response = await fetch(`http://127.0.0.1:${signalPort}/internal/auth-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signature },
    body,
  });
  return response.status;
}

const hostProxy = new SignalProxy(() => signalPort, "127.0.0.1");
const attackerProxy = new SignalProxy(() => signalPort, "127.0.0.2");
const memberBProxy = new SignalProxy(() => signalPort, "127.0.0.3");
const memberCProxy = new SignalProxy(() => signalPort, "127.0.0.4");
const signalUrl = (port: number) => `ws://127.0.0.1:${port}/v1/signal`;
let hostUrl = "";
let attackerUrl = "";
let memberBUrl = "";
let memberCUrl = "";
let window: BrowserWindow | null = null;

async function page<T>(schema: z.ZodType<T>, method: string, ...args: unknown[]): Promise<T> {
  if (!window) throw new Error("The page is not open.");
  return schema.parse(
    await window.webContents.executeJavaScript(`window.e2e.${method}(...${JSON.stringify(args)})`, true),
  );
}

async function clientSession(
  name: string,
  userId: string,
  url: string,
): Promise<{ sessionId: string; peerId: string }> {
  const sessionId = `session-${name}-${randomUUID()}`;
  const peerId = await page(
    z.string(),
    "connectClient",
    name,
    sessionId,
    url,
    await ticket({ sessionId, userId, role: "owner" }),
  );
  return { sessionId, peerId };
}

async function hostSignalDown(): Promise<void> {
  const from = await page(z.number(), "mark");
  hostProxy.block();
  await page(z.unknown(), "waitHostEvent", from, { type: "signal-closed", peerId: HOST_ID }, 10_000);
}

async function hostSignalUp(): Promise<number> {
  const from = await page(z.number(), "mark");
  hostProxy.unblock();
  await page(z.unknown(), "waitHostEvent", from, { type: "signal-ready", peerId: HOST_ID }, HOST_RECONNECT_MS);
  return Date.now();
}

async function staleChannelEvidence(
  name: string,
  closedWithin: number,
): Promise<{ closed: boolean; answered: boolean; text: string }> {
  const startedAt = Date.now();
  const closed = await page(z.boolean(), "waitRpcClosed", name, closedWithin);
  if (closed) return { closed, answered: false, text: `the data channel closed after ${Date.now() - startedAt} ms` };
  const answered = await page(z.boolean(), "rpc", name, `after-revoke-${randomUUID()}`, 5_000);
  return {
    closed,
    answered,
    text: `the data channel stayed ${JSON.stringify(await page(z.unknown(), "clientState", name))} for ${closedWithin} ms; host RPC answer: ${answered}`,
  };
}

async function waitLiveConfirmed(from: number, sessionId: string): Promise<void> {
  await page(z.unknown(), "waitHostEvent", from, { type: "incoming-peer", sessionId }, 10_000);
}

async function proofOfConcept(): Promise<void> {
  await page(
    z.unknown(),
    "connectHost",
    HOST_ID,
    hostUrl,
    await ticket({ sessionId: `host-${randomUUID()}`, userId: OWNER, role: "host" }),
  );
  const hostConnectedAt = Date.now();
  const attacker = await clientSession("attacker", OWNER, attackerUrl);
  record(
    "PoC setup: owner client has an open data channel that the host answers",
    await page(z.boolean(), "rpc", "attacker", "before-revoke", 5_000),
    `client peer ${attacker.peerId}`,
  );
  await new Promise((wake) => setTimeout(wake, Math.max(0, hostConnectedAt + RATE_WINDOW_MS + 1_000 - Date.now())));
  const from = await page(z.number(), "mark");
  await page(z.unknown(), "turnRefreshBurst", "attacker", MESSAGES_PER_MINUTE - 1);
  const answered = await page(z.boolean(), "renegotiate", "attacker", 5_000);
  const limited = await page(
    z.unknown(),
    "waitHostEvent",
    from,
    { type: "peer-error", peerId: HOST_ID, code: "rate_limited" },
    3_000,
  ).then(
    () => true,
    () => false,
  );
  record(
    "A client burst in the owner rate bucket does not close the host Signal socket",
    answered && !limited,
    `host answered the offer: ${answered}; host got rate_limited: ${limited}; host events ${JSON.stringify(await page(z.unknown(), "hostEvents", from))}`,
  );
  const status = await revoke(attacker.sessionId);
  const closeCode = await page(z.number(), "waitSignalClosed", "attacker", 10_000);
  record(
    "PoC revoke: Signal accepts the event and closes the client Signal socket",
    status === 204 && closeCode === 1008,
    `auth event ${status}, client Signal close ${closeCode}`,
  );
  let evidence = await staleChannelEvidence("attacker", TEARDOWN_AFTER_REVOKE_MS);
  if (!evidence.closed && limited) {
    await page(z.unknown(), "waitHostEvent", from, { type: "signal-ready", peerId: HOST_ID }, HOST_RECONNECT_MS).catch(
      () => undefined,
    );
    evidence = await staleChannelEvidence("attacker", TEARDOWN_AFTER_REVOKE_MS);
    evidence.text = `after the host Signal reconnect, ${evidence.text}`;
  }
  record("PoC: the host closes the data channel of the revoked session", evidence.closed, evidence.text);
}

async function revokeWhileHostOffline(): Promise<void> {
  const stale = await clientSession("stale-b", MEMBER_B, memberBUrl);
  await clientSession("live-b", MEMBER_B, memberBUrl);
  await hostSignalDown();
  const status = await revoke(stale.sessionId);
  await page(z.unknown(), "waitSignalClosed", "stale-b", 10_000);
  await hostSignalUp();
  const evidence = await staleChannelEvidence("stale-b", TEARDOWN_AFTER_REVOKE_MS);
  record(
    "Host offline during revoke: the host closes the revoked data channel after it reconnects",
    status === 204 && evidence.closed,
    `auth event ${status}; ${evidence.text}`,
  );
  const live = await page(z.boolean(), "rpc", "live-b", "live-after-reconnect", 5_000);
  record(
    "Host offline during revoke: a live session that Signal maps again keeps its data channel",
    live,
    JSON.stringify(await page(z.unknown(), "clientState", "live-b")),
  );
}

async function revokeThenSignalRestart(): Promise<void> {
  const stale = await clientSession("stale-c", MEMBER_C, memberCUrl);
  const liveSession = await clientSession("live-c", MEMBER_C, memberCUrl);
  await hostSignalDown();
  const status = await revoke(stale.sessionId);
  await page(z.unknown(), "waitSignalClosed", "stale-c", 10_000);
  const staleTicketSession = `session-stale-ticket-${randomUUID()}`;
  const staleToken = await ticket({ sessionId: staleTicketSession, userId: MEMBER_C, role: "owner" });
  staleTicket = { sessionId: staleTicketSession, token: staleToken, revokeStatus: await revoke(staleTicketSession) };
  await stopSignal();
  await startSignal();
  await hostSignalUp();
  const reconnectFrom = await page(z.number(), "mark");
  await page(z.unknown(), "reconnectClientSignal", "live-c", memberCUrl);
  await waitLiveConfirmed(reconnectFrom, liveSession.sessionId);
  await hostSignalDown();
  const firedOffline = await page(z.number(), "advancePastReconfirm");
  const offline = await staleChannelEvidence("stale-c", OPEN_CHANNEL_CHECK_MS);
  record(
    "Signal outage: time while the host is off Signal does not count toward the re-confirmation limit",
    !offline.closed && offline.answered,
    `clock advanced past the limit while the host was off Signal (${firedOffline} timers fired); ${offline.text}`,
  );
  const upFrom = await page(z.number(), "mark");
  await hostSignalUp();
  await waitLiveConfirmed(upFrom, liveSession.sessionId);
  const firedOnline = await page(z.number(), "advancePastReconfirm");
  const evidence = await staleChannelEvidence("stale-c", TEARDOWN_AFTER_REVOKE_MS);
  record(
    "Signal lost its memory: the host closes a data channel that Signal does not map again",
    status === 204 && evidence.closed,
    `auth event ${status}; clock advanced past the limit while the host was on Signal (${firedOnline} timers fired); ${evidence.text}`,
  );
  const live = await page(z.boolean(), "rpc", "live-c", "live-after-restart", 5_000);
  record(
    "Signal lost its memory: a session that comes back to Signal keeps its data channel",
    live,
    JSON.stringify(await page(z.unknown(), "clientState", "live-c")),
  );
}

async function unusedTicketAfterRestart(): Promise<void> {
  if (!staleTicket) throw new Error("No ticket from before the Signal restart.");
  await new Promise((wake) =>
    setTimeout(wake, Math.max(0, signalStartedAt + SIGNAL_INITIAL_CHECK_MS + 2_000 - Date.now())),
  );
  const stale = await page(helloSchema, "hello", memberCUrl, staleTicket.token, 10_000);
  record(
    "After a Signal restart, an unused ticket of an ended session is refused also after the first 3 minutes",
    staleTicket.revokeStatus === 204 && stale.type !== "ready",
    `${Math.round((Date.now() - signalStartedAt) / 1_000)} s after the Signal start: ${JSON.stringify(stale)}; account service checks: ${sessionChecks.get(staleTicket.sessionId) ?? 0}`,
  );
  const freshSession = `session-fresh-${randomUUID()}`;
  const fresh = await page(
    helloSchema,
    "hello",
    memberCUrl,
    await ticket({ sessionId: freshSession, userId: MEMBER_C, role: "owner" }),
    10_000,
  );
  const checks = sessionChecks.get(freshSession) ?? 0;
  record(
    "A ticket issued after the Signal start connects with no extra account service check",
    fresh.type === "ready" && checks === 0,
    `${JSON.stringify(fresh)}; account service checks: ${checks}`,
  );
}

const helloSchema = z.object({ type: z.string(), code: z.string().optional(), closeCode: z.number().optional() });

void main();

async function main(): Promise<void> {
  let failure: string | null = null;
  let server: Server | null = null;
  try {
    publicJwk = { ...(await exportJWK(publicKey)), kid: "revoked-session-e2e", alg: "ES256", use: "sig" };
    [signalPort, healthPort, controlPlanePort, closedTurnPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    server = await startControlPlane(controlPlanePort);
    hostUrl = signalUrl(await hostProxy.listen());
    attackerUrl = signalUrl(await attackerProxy.listen());
    memberBUrl = signalUrl(await memberBProxy.listen());
    memberCUrl = signalUrl(await memberCProxy.listen());
    await app.whenReady();
    window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await startSignal();
    await window.loadFile(pagePath);
    await page(z.unknown(), "startBridge");
    for (const scenario of [
      proofOfConcept,
      revokeWhileHostOffline,
      revokeThenSignalRestart,
      unusedTicketAfterRestart,
    ]) {
      try {
        await scenario();
      } catch (error) {
        record(`${scenario.name} completed`, false, error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const passed = failure === null && checks.length > 0 && checks.every((check) => check.passed);
  await mkdir(join(reportPath, ".."), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        status: passed ? "passed" : "failed",
        runId,
        failure,
        checks,
        signalOutput: passed ? [] : signalOutput.slice(-40),
      },
      null,
      2,
    )}\n`,
  );
  for (const proxy of [hostProxy, attackerProxy, memberBProxy, memberCProxy]) proxy.close();
  server?.close();
  await stopSignal();
  app.exit(passed ? 0 : 1);
}
