import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SIGNAL_PROTOCOL_VERSION } from "@openbot/contracts/signal-protocol/messages";
import { Effect } from "effect";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { SignalIngress } from "../src/main/signal-ingress";

const HOSTS = 8;
const CYCLES = 3;
const FAILING_HOSTS = 4;
const ONLINE_MIN_MS = 900;
const ONLINE_MAX_MS = 16_500;
const FAILED_MAX_MS = 2_500;
const READY_HOLD_MS = 150;
const outputDir = join(process.cwd(), ".openbot-build", "signal-ingress-reconnect-smoke");

interface HostTrace {
  ticketAt: number[];
  closedAt: number[];
}

const traces = new Map<string, HostTrace>();
const traceOf = (hostId: string): HostTrace => {
  const known = traces.get(hostId);
  if (known) return known;
  const created = { ticketAt: [], closedAt: [] };
  traces.set(hostId, created);
  return created;
};

const server = Bun.serve<{ hostId: string | null }>({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request, bun) {
    if (bun.upgrade(request, { data: { hostId: null } })) return undefined;
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(socket, raw) {
      const hello = JSON.parse(String(raw));
      if (!isDynamicRecord(hello) || hello.type !== "hello" || !isString(hello.token)) return;
      const token = hello.token;
      socket.data.hostId = token;
      socket.send(
        JSON.stringify({
          type: "ready",
          version: SIGNAL_PROTOCOL_VERSION,
          connectionId: `connection-${token}`,
          resumeToken: `resume-${token}`,
          iceServers: [],
        }),
      );
      setTimeout(() => {
        const hostId = socket.data.hostId;
        if (!hostId) return;
        traceOf(hostId).closedAt.push(performance.now());
        socket.close(1012, "restart");
      }, READY_HOLD_MS);
    },
  },
});

const signalUrl = `ws://127.0.0.1:${server.port}/v1/signal`;
const fail = (step: string) => new RemoteWorkflowError({ cause: new Error(step) });
const routeFailure = Effect.fail(fail("route not used"));

function ingressFor(hostId: string, failFirstTicket: boolean): SignalIngress {
  let calls = 0;
  return new SignalIngress({
    hostId: () => hostId,
    signedIn: () => true,
    issueTicket: (id) =>
      Effect.suspend(() => {
        calls += 1;
        traceOf(id).ticketAt.push(performance.now());
        if (failFirstTicket && calls === 1) return Effect.fail(fail("ticket refused"));
        return Effect.succeed({ ticket: id, signalUrl });
      }),
    issueSlackRoute: () => routeFailure,
    issueDiscordRoute: () => routeFailure,
    issueWebhookRoute: () => Effect.succeed(`webhook-route-${hostId}`),
    issueGitHubRoute: () => routeFailure,
    resolveProxy: () => Effect.succeed("DIRECT"),
  });
}

const waitFor = async (condition: () => boolean, timeoutMs: number) => {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) return false;
    await Bun.sleep(50);
  }
  return true;
};

const onlineHosts = Array.from({ length: HOSTS }, (_, index) => `online-host-${index}`);
const failingHosts = Array.from({ length: FAILING_HOSTS }, (_, index) => `failing-host-${index}`);
const ingresses = [
  ...onlineHosts.map((hostId) => ingressFor(hostId, false)),
  ...failingHosts.map((hostId) => ingressFor(hostId, true)),
];
const releases = ingresses.map((ingress) => ingress.acquireWebhooks());

const finished = await waitFor(
  () =>
    onlineHosts.every((hostId) => (traces.get(hostId)?.ticketAt.length ?? 0) > CYCLES) &&
    failingHosts.every((hostId) => (traces.get(hostId)?.ticketAt.length ?? 0) >= 2),
  CYCLES * ONLINE_MAX_MS + 20_000,
);

for (const release of releases) release();
await Promise.all(ingresses.map((ingress) => Effect.runPromise(ingress.dispose())));
server.stop(true);

const onlineDelays = onlineHosts.flatMap((hostId) => {
  const trace = traceOf(hostId);
  return trace.closedAt.slice(0, CYCLES).flatMap((closedAt, index) => {
    const next = trace.ticketAt[index + 1];
    return next === undefined ? [] : [Math.round(next - closedAt)];
  });
});
const failedDelays = failingHosts.flatMap((hostId) => {
  const [first, second] = traceOf(hostId).ticketAt;
  return first === undefined || second === undefined ? [] : [Math.round(second - first)];
});

const sorted = [...onlineDelays].sort((a, b) => a - b);
const spread = sorted.length > 0 ? (sorted.at(-1) ?? 0) - (sorted[0] ?? 0) : 0;
const overOldMax = onlineDelays.filter((delay) => delay > 2_500).length;
const checks = [
  { name: "every host reconnected after each online close", pass: finished },
  { name: `online close samples >= ${HOSTS * CYCLES}`, pass: onlineDelays.length >= HOSTS * CYCLES },
  {
    name: `online close delay within ${ONLINE_MIN_MS}-${ONLINE_MAX_MS} ms`,
    pass: onlineDelays.every((delay) => delay >= ONLINE_MIN_MS && delay <= ONLINE_MAX_MS),
  },
  { name: "online close delays spread over more than 5 s", pass: spread > 5_000 },
  {
    name: "at least half of online close delays exceed the old 2 s backoff",
    pass: overOldMax * 2 >= onlineDelays.length,
  },
  {
    name: `failed ticket retry stays under ${FAILED_MAX_MS} ms`,
    pass: failedDelays.length === FAILING_HOSTS && failedDelays.every((delay) => delay <= FAILED_MAX_MS),
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  hosts: HOSTS,
  cycles: CYCLES,
  onlineCloseDelaysMs: sorted,
  onlineCloseDelayP50Ms: sorted[Math.floor(sorted.length / 2)] ?? null,
  onlineCloseSpreadMs: spread,
  failedTicketRetryMs: failedDelays,
  checks,
  pass: checks.every((check) => check.pass),
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const check of checks) process.stdout.write(`${check.pass ? "PASS" : "FAIL"} ${check.name}\n`);
process.stdout.write(
  `${JSON.stringify({ p50: report.onlineCloseDelayP50Ms, spread, failedDelays, samples: sorted.length })}\n`,
);
process.exit(report.pass ? 0 : 1);
