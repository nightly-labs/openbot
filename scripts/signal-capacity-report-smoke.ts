// Smoke test of the Signal capacity reporter (`remote/api/src/capacity-report.ts`).
//   bun scripts/signal-capacity-report-smoke.ts
// Starts a fake coturn metrics page, a fake Signal metrics page that needs the metrics token, and a
// local OpenPanel capture server. Runs the real reporter against them and checks its first event: the
// counts, the server client headers, and that no token or secret is in the event.
// Writes .openbot-build/signal-capacity-report/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("signal-capacity-report-smoke");
const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, ".openbot-build/signal-capacity-report");
const metricsToken = randomBytes(24).toString("hex");
const clientSecret = `sec_${randomBytes(16).toString("hex")}`;

const TURN_PAGE = [
  "# TYPE turn_total_allocations gauge",
  'turn_total_allocations{type="UDP"} 1343',
  'turn_total_allocations{type="TCP"} 710',
  'turn_total_allocations{type="TLS/TCP"} 616',
  'turn_total_traffic_rcvb{realm="turn.example.com"} 1000',
  "turn_total_traffic_sentb 2000",
].join("\n");
const SIGNAL_PAGE = ["openbot_remote_signal_sockets 6669", "openbot_remote_peer_connections 1598"].join("\n");

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      done(address.port);
    }),
  );

const body = (request: IncomingMessage) =>
  new Promise<string>((done) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => done(text));
  });

let signalUnauthorized = 0;
const turnServer = createServer((_request, response) => response.end(TURN_PAGE));
const signalServer = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${metricsToken}`) {
    signalUnauthorized += 1;
    response.writeHead(404).end();
    return;
  }
  response.end(SIGNAL_PAGE);
});

interface Capture {
  headers: IncomingMessage["headers"];
  text: string;
}
let resolveCapture: (capture: Capture) => void = () => undefined;
const captured = new Promise<Capture>((done) => {
  resolveCapture = done;
});
const captureServer = createServer(async (request, response) => {
  const text = await body(request);
  response.writeHead(202).end();
  resolveCapture({ headers: request.headers, text });
});

const [turnPort, signalPort, capturePort] = await Promise.all([
  listen(turnServer),
  listen(signalServer),
  listen(captureServer),
]);

const reporter = spawn("bun", ["src/capacity-report.ts"], {
  cwd: resolve(root, "remote/api"),
  env: {
    PATH: process.env.PATH,
    OPENPANEL_CLIENT_ID: "smoke-client",
    OPENPANEL_CLIENT_SECRET: clientSecret,
    OPENPANEL_TRACK_URL: `http://127.0.0.1:${capturePort}/track`,
    REMOTE_METRICS_TOKEN: metricsToken,
    TURN_DOMAIN: "turn.example.com",
    TURN_METRICS_URL: `http://127.0.0.1:${turnPort}/metrics`,
    SIGNAL_METRICS_URL: `http://127.0.0.1:${signalPort}/metrics`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let reporterOutput = "";
reporter.stdout.on("data", (chunk) => {
  reporterOutput += chunk;
});
reporter.stderr.on("data", (chunk) => {
  reporterOutput += chunk;
});
const exited = new Promise<number | null>((done) => reporter.on("exit", done));

const capture = await Promise.race([
  captured,
  exited.then((code) => {
    throw new Error(`The reporter exited with ${code} before it sent an event: ${reporterOutput}`);
  }),
]);
reporter.kill("SIGTERM");
await exited;
for (const server of [turnServer, signalServer, captureServer]) server.close();

const event = JSON.parse(capture.text);
assert.equal(capture.headers["openpanel-client-id"], "smoke-client");
assert.equal(capture.headers["openpanel-client-secret"], clientSecret);
assert.equal(signalUnauthorized, 0, "The reporter sends the metrics token to Signal.");
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
      signal_sockets: 6669,
      signal_peer_connections: 1598,
    },
  },
});
assert.ok(!capture.text.includes(metricsToken), "The event has no metrics token.");
assert.ok(!capture.text.includes(clientSecret), "The event has no client secret.");
assert.ok(!reporterOutput.includes(metricsToken) && !reporterOutput.includes(clientSecret), "The log has no secret.");

mkdirSync(outputDirectory, { recursive: true });
const reportPath = resolve(outputDirectory, "report.json");
writeFileSync(reportPath, `${JSON.stringify({ passed: true, event: event.payload }, null, 2)}\n`);
logger.info(`Passed. Report: ${reportPath}`);
