// Smoke test of the Signal capacity reporter (`remote/api/src/capacity-report.ts`).
//   bun scripts/signal-capacity-report-smoke.ts
// Starts the real Signal server, opens two WebSockets to it, and serves a fake coturn metrics page and a
// local OpenPanel capture server. Runs the real reporter against them and checks its first event: the
// counts, the server client headers, and that no token or secret is in the event or the log. Then runs
// the reporter without the OpenPanel client and checks that it stops and sends nothing.
// Writes .openbot-build/signal-capacity-report/report.json.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { exportJWK } from "jose";

const logger = createOpenBotLogger("signal-capacity-report-smoke");
const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, ".openbot-build/signal-capacity-report");
const reporterPath = resolve(root, "remote/api/src/capacity-report.ts");
const metricsToken = randomBytes(24).toString("hex");
const clientSecret = `sec_${randomBytes(16).toString("hex")}`;
const OPEN_SOCKETS = 2;

const TURN_PAGE = [
  "# TYPE turn_total_allocations gauge",
  'turn_total_allocations{type="UDP"} 1343',
  'turn_total_allocations{type="TCP"} 710',
  'turn_total_allocations{type="TLS/TCP"} 616',
].join("\n");

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      done(address.port);
    }),
  );

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}

const body = (request: IncomingMessage) =>
  new Promise<string>((done) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => done(text));
  });

function collect(child: ChildProcess) {
  const output = { text: "" };
  child.stdout?.on("data", (chunk) => {
    output.text += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output.text += chunk;
  });
  return output;
}

const exitOf = (child: ChildProcess) => new Promise<number | null>((done) => child.on("exit", done));

/** Polls the real Signal metrics until `check` accepts the page. */
async function waitForMetrics(url: string, signal: ChildProcess, check: (page: string) => boolean) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signal.exitCode !== null) throw new Error(`Signal exited with code ${signal.exitCode}.`);
    const page = await fetch(url, { headers: { Authorization: `Bearer ${metricsToken}` } }).then(
      (response) => (response.ok ? response.text() : ""),
      () => "",
    );
    if (check(page)) return;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error("The Signal metrics did not reach the expected state.");
}

let turnRequests = 0;
const turnServer = createServer((_request, response) => {
  turnRequests += 1;
  response.end(TURN_PAGE);
});

interface Capture {
  headers: IncomingMessage["headers"];
  text: string;
}
const captures: Capture[] = [];
let resolveCapture: (capture: Capture) => void = () => undefined;
const captured = new Promise<Capture>((done) => {
  resolveCapture = done;
});
const captureServer = createServer(async (request, response) => {
  const capture = { headers: request.headers, text: await body(request) };
  captures.push(capture);
  response.writeHead(202).end();
  resolveCapture(capture);
});

const [turnPort, capturePort, signalPort, healthPort, controlPlanePort] = await Promise.all([
  listen(turnServer),
  listen(captureServer),
  freePort(),
  freePort(),
  freePort(),
]);

const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "capacity-smoke", alg: "ES256", use: "sig" };
const signal = spawn("bun", [resolve(root, "remote/api/src/index.ts")], {
  cwd: resolve(root, "remote/api"),
  // Only what Signal needs, so no developer or production secret reaches it.
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    REMOTE_SIGNAL_HOST: "127.0.0.1",
    REMOTE_SIGNAL_PORT: String(signalPort),
    REMOTE_HEALTH_HOST: "127.0.0.1",
    REMOTE_HEALTH_PORT: String(healthPort),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
    // The sockets never send `hello`, so Signal never calls the control plane.
    REMOTE_CONTROL_PLANE_URL: `http://127.0.0.1:${controlPlanePort}`,
    REMOTE_SESSION_SECRET: randomBytes(32).toString("base64url"),
    REMOTE_AUTH_WEBHOOK_SECRET: randomBytes(32).toString("base64url"),
    REMOTE_METRICS_TOKEN: metricsToken,
    TURN_SHARED_SECRET: randomBytes(32).toString("base64url"),
    TURN_HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const signalOutput = collect(signal);
const signalExited = exitOf(signal);
const signalMetricsUrl = `http://127.0.0.1:${healthPort}/metrics`;

const sockets: WebSocket[] = [];
try {
  await waitForMetrics(signalMetricsUrl, signal, (page) => page.includes("openbot_remote_signal_sockets 0"));
  for (let index = 0; index < OPEN_SOCKETS; index += 1) {
    sockets.push(new WebSocket(`ws://127.0.0.1:${signalPort}/v1/signal`));
  }
  await waitForMetrics(signalMetricsUrl, signal, (page) =>
    page.includes(`openbot_remote_signal_sockets ${OPEN_SOCKETS}`),
  );

  const reporterEnvironment = {
    PATH: process.env.PATH ?? "",
    OPENPANEL_TRACK_URL: `http://127.0.0.1:${capturePort}/track`,
    REMOTE_METRICS_TOKEN: metricsToken,
    TURN_DOMAIN: "turn.example.com",
    TURN_METRICS_URL: `http://127.0.0.1:${turnPort}/metrics`,
    SIGNAL_METRICS_URL: signalMetricsUrl,
  };
  const reporter = spawn("bun", [reporterPath], {
    cwd: root,
    env: { ...reporterEnvironment, OPENPANEL_CLIENT_ID: "smoke-client", OPENPANEL_CLIENT_SECRET: clientSecret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const reporterOutput = collect(reporter);
  const reporterExited = exitOf(reporter);
  const capture = await Promise.race([
    captured,
    reporterExited.then((code) => {
      throw new Error(`The reporter exited with ${code} before it sent an event: ${reporterOutput.text}`);
    }),
  ]);
  reporter.kill("SIGTERM");
  await reporterExited;

  const event = JSON.parse(capture.text);
  assert.equal(capture.headers["openpanel-client-id"], "smoke-client");
  assert.equal(capture.headers["openpanel-client-secret"], clientSecret);
  assert.deepEqual(event, {
    type: "track",
    payload: {
      name: "signal_capacity",
      properties: {
        surface: "signal",
        environment: "production",
        event_schema_version: 1,
        turn_host: "turn.example.com",
        turn_allocations: 2669,
        turn_allocations_udp: 1343,
        turn_allocations_tcp: 710,
        turn_allocations_tls: 616,
        signal_sockets: OPEN_SOCKETS,
        signal_peer_connections: 0,
      },
    },
  });
  assert.ok(!capture.text.includes(metricsToken), "The event has no metrics token.");
  assert.ok(!capture.text.includes(clientSecret), "The event has no client secret.");
  assert.ok(
    !reporterOutput.text.includes(metricsToken) && !reporterOutput.text.includes(clientSecret),
    "The log has no secret.",
  );

  // Without the OpenPanel server client the reporter stops at once and reads and sends nothing.
  const turnRequestsBefore = turnRequests;
  const off = spawn("bun", [reporterPath], { cwd: root, env: reporterEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  const offOutput = collect(off);
  assert.equal(await exitOf(off), 0, `The reporter without a client exits with 0: ${offOutput.text}`);
  assert.match(offOutput.text, /Capacity report off/u);
  assert.equal(captures.length, 1, "The reporter without a client sends no event.");
  assert.equal(turnRequests, turnRequestsBefore, "The reporter without a client reads no metrics.");

  mkdirSync(outputDirectory, { recursive: true });
  const reportPath = resolve(outputDirectory, "report.json");
  writeFileSync(
    reportPath,
    `${JSON.stringify({ passed: true, event: event.payload, offPathExitCode: 0, eventsSent: captures.length }, null, 2)}\n`,
  );
  logger.info(`Passed. Report: ${reportPath}`);
} catch (error) {
  logger.error(`Signal output: ${signalOutput.text}`);
  throw error;
} finally {
  for (const socket of sockets) socket.close();
  signal.kill("SIGTERM");
  await signalExited;
  for (const server of [turnServer, captureServer]) server.close();
}
