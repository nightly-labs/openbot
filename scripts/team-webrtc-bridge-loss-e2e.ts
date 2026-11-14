// Runs the real Team WebRTC bridge in Electron against the real Signal of `remote/api`, and stops the
// renderer of its hidden window. The Electron side is `scripts/team-webrtc-bridge-loss-electron.ts`;
// it runs the cases and records them.
//
// This script:
// 1. Builds the bridge preload (`src/preload/team-webrtc.ts`) and page (`src/renderer/team-webrtc.html`)
//    with `bun build`, and serves the page on a local port as the development renderer server does.
// 2. Starts Signal on a free local port with throwaway secrets, a fake TURN server and a fake account
//    service. The fake account service also makes the tickets that `renewSignal` gets, and can stop
//    and start Signal for the move case.
// 3. Starts Electron with its own user data under `.openbot-build`, and no account.
//
// Run: bun scripts/team-webrtc-bridge-loss-e2e.ts
// It writes .openbot-build/team-webrtc-bridge-loss-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { closeSync, existsSync, openSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { REMOTE_TICKET_AUDIENCE, REMOTE_TICKET_PROTOCOL_VERSION } from "@openbot/contracts/signal-protocol/ticket";
import { exportJWK, SignJWT } from "jose";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "team-webrtc-bridge-loss-e2e");
const BUILD = join(OUT, "build");
// The Electron side runs each case with its own waits. This is only the limit of the whole run.
const RUN_LIMIT_MS = 5 * 60_000;
// The `SIGNAL_ID` of this Signal. A host ticket with this `signal` claim names a home Signal.
const SIGNAL_ID = "a";
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

await rm(OUT, { recursive: true, force: true });
await mkdir(BUILD, { recursive: true });

// Throwaway keys and secrets for this run only.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "e2e-1", alg: "ES256", use: "sig" };
const sessionSecret = randomBytes(32).toString("base64url");
const authWebhookSecret = randomBytes(32).toString("base64url");
const turnSecret = randomBytes(32).toString("base64url");

const [signalPort, healthPort, accountPort, pagePort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
  freePort(),
]);
const signalUrl = `ws://127.0.0.1:${signalPort}/v1/signal`;
// The same Signal under another name: a move must get another URL, or it keeps the old registration.
const signalUrlAlias = `ws://localhost:${signalPort}/v1/signal`;
const signalOutput: string[] = [];
const accountCalls: string[] = [];
let signal: ChildProcess | null = null;
let turnServer: Socket | null = null;
let accountServer: Server | null = null;
let pageServer: Server | null = null;
let electron: ChildProcess | null = null;
let passed = false;
let error: string | undefined;
let checks: unknown[] = [];

try {
  build(["src/preload/team-webrtc.ts", "--target=node", "--format=cjs", "--external=electron"], {
    outfile: join(BUILD, "preload", "teamWebrtc.cjs"),
  });
  // The page names its script from the renderer root, as the Vite root of the renderer is `src/renderer`.
  build(["team-webrtc.html", "--target=browser"], {
    outdir: join(BUILD, "renderer"),
    cwd: join(ROOT, "src", "renderer"),
  });
  assert.ok(existsSync(join(BUILD, "renderer", "team-webrtc.html")), "the page build has team-webrtc.html");
  const harness = join(BUILD, "team-webrtc-bridge-loss-electron.mjs");
  build(["scripts/team-webrtc-bridge-loss-electron.ts", "--target=node", "--format=esm", "--external=electron"], {
    outfile: harness,
  });

  turnServer = await startTurnServer();
  accountServer = await startAccountService(accountPort);
  pageServer = await startPageServer(pagePort, join(BUILD, "renderer"));
  await startSignal();

  const config = {
    userData: join(OUT, "user-data"),
    accountUrl: `http://127.0.0.1:${accountPort}`,
    signalUrl,
    signalUrlAlias,
    pageUrl: `http://127.0.0.1:${pagePort}`,
    preloadPath: join(BUILD, "preload", "teamWebrtc.cjs"),
    resultFile: join(OUT, "electron-result.json"),
  };
  const configFile = join(OUT, "config.json");
  await writeFile(configFile, JSON.stringify(config));
  const log = openSync(join(OUT, "electron.log"), "w");
  electron = spawn(electronPath, [harness, `--config=${configFile}`], {
    env: withoutElectronRuntimeFlags(process.env),
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const exited = new Promise<number | null>((done) => electron?.once("exit", (code) => done(code)));
  const code = await Promise.race([
    exited,
    sleep(RUN_LIMIT_MS, undefined, { ref: false }).then(() => "limit" as const),
  ]);
  assert.notEqual(code, "limit", `Electron did not end within ${RUN_LIMIT_MS} ms: see ${OUT}/electron.log`);
  assert.ok(existsSync(config.resultFile), `Electron wrote no result (exit ${code}): see ${OUT}/electron.log`);
  const result = JSON.parse(readFileSync(config.resultFile, "utf8"));
  assert.ok(isDynamicRecord(result) && Array.isArray(result.checks), "the result has checks");
  checks = result.checks;
  const failed = result.checks.filter((item) => !(isDynamicRecord(item) && item.passed === true));
  assert.equal(failed.length, 0, `${failed.length} of ${result.checks.length} checks failed`);
  assert.equal(code, 0, `Electron ended with code ${code}`);
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (electron && electron.exitCode === null && electron.signalCode === null) electron.kill("SIGKILL");
  await stopSignal();
  turnServer?.close();
  accountServer?.close();
  pageServer?.close();
  await writeFile(join(OUT, "signal.log"), signalOutput.join(""));
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, checks, accountCalls: [...new Set(accountCalls)], error }, null, 2)}\n`,
  );
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

function build(arguments_: string[], output: { outfile?: string; outdir?: string; cwd?: string }) {
  const target = output.outfile ? `--outfile=${output.outfile}` : `--outdir=${output.outdir}`;
  const result = spawnSync(process.execPath, ["build", ...arguments_, target], { cwd: output.cwd ?? ROOT });
  assert.equal(result.status, 0, `bun build ${arguments_[0]} failed: ${result.stderr.toString()}`);
}

async function startSignal() {
  const child = spawn(process.execPath, [resolve(ROOT, "remote/api/src/index.ts")], {
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
      REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${accountPort}`,
      REMOTE_SESSION_SECRET: sessionSecret,
      REMOTE_AUTH_WEBHOOK_SECRET: authWebhookSecret,
      TURN_SHARED_SECRET: turnSecret,
      TURN_HOST: "127.0.0.1",
      TURN_PORT: String(turnServer?.address().port ?? 0),
      SIGNAL_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => signalOutput.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => signalOutput.push(chunk.toString()));
  signal = child;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Signal exited with code ${child.exitCode}.`);
    const ready = await fetch(`http://127.0.0.1:${signalPort}/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await sleep(200);
  }
  throw new Error("Signal did not become ready.");
}

async function stopSignal() {
  const child = signal;
  signal = null;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGKILL");
  await exited;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}

// The account service. Signal asks it about sessions; it accepts each one. The Electron side asks it
// for tickets, as `issueRemoteHostTicket` and a client session do, and to stop and start Signal.
function startAccountService(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const path = request.url ?? "";
    accountCalls.push(path);
    const body = await readBody(request);
    const answer = (status: number, value?: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(value === undefined ? "" : JSON.stringify(value));
    };
    try {
      if (path === "/e2e/ticket") {
        const input = JSON.parse(body);
        assert.ok(isDynamicRecord(input) && typeof input.hostId === "string", "a ticket request names a host");
        const role = input.role === "member" ? "member" : "host";
        const ttlSeconds = typeof input.ttlSeconds === "number" ? input.ttlSeconds : 86_400;
        return answer(200, {
          ticket: await ticket(input.hostId, role, ttlSeconds, input.home === true),
        });
      }
      if (path === "/e2e/signal/stop") {
        await stopSignal();
        return answer(204);
      }
      if (path === "/e2e/signal/start") {
        await startSignal();
        return answer(204);
      }
      if (path === "/v2/remote/resume/validate") return answer(200, { valid: true });
      return answer(200, {});
    } catch (cause) {
      return answer(500, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

async function ticket(hostId: string, role: "host" | "member", ttlSeconds: number, home: boolean) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    jti: randomUUID(),
    sessionId: `session-${randomUUID()}`,
    hostId,
    userId: role === "host" ? "owner-e2e" : "member-e2e",
    membershipId: `${hostId}:${role === "host" ? "host" : "member-e2e"}`,
    role,
    authEpoch: 1,
    protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
    protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
    sessionExpiresAt: now + ttlSeconds,
    ...(home ? { signal: SIGNAL_ID } : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: "e2e-1" })
    .setAudience(REMOTE_TICKET_AUDIENCE)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

// Serves the built page as the development renderer server does. The first path segment names the
// bridge that loads it, so the Electron side can tell the windows of each bridge apart.
function startPageServer(port: number, directory: string): Promise<Server> {
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((request, response) => {
    const segments = new URL(request.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean);
    const candidates = [segments.slice(1).join("/"), segments.join("/")].filter(Boolean);
    const file = candidates
      .map((candidate) => resolve(directory, candidate))
      .find((path) => path.startsWith(directory) && existsSync(path) && statSync(path).isFile());
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

/** A TURN server that answers each Allocate as coturn does, as in `scripts/signal-security-e2e.ts`. */
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
