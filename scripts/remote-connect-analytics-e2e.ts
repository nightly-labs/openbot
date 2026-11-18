// Drives the real remote connect trace into the real host analytics, with a capture in place of the
// OpenPanel client, and checks the `system_remote_connect` events:
//   1. A first connection sends one `connected` event with each phase time and the hosted start wait.
//   2. The first failed attempt after a connection sends one `failed` event with its last phase.
//   3. Later failed attempts send nothing, and the next connection counts them.
//   4. A cancel sends nothing and starts a new wait, so the next failure is sent again.
//   5. An old attempt that ends after a newer one began does not stop the newer one.
//   6. No event carries a host id, and each one has the host surface and its generation.
// The analytics queue sends in order, so a last connection to another host shows that no other event
// was sent before it.
//
// Run: bun run test:remote-connect-analytics
// It writes .openbot-build/remote-connect-analytics-e2e/report.json and exits non-zero on a failure.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import { HostAnalytics, type HostOpenPanelClient } from "../src/main/analytics";
import { REMOTE_CONNECT_PHASES, RemoteConnectTrace } from "../src/main/remote-connect-trace";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "remote-connect-analytics-e2e");
const HOST = "host-7f3a-marker";
const OTHER_HOST = "host-91c2-marker";
const LAST_HOST = "host-55d0-marker";
const PHASE_PROPERTIES = [
  "session_ms",
  "ticket_ms",
  "bridge_ms",
  "signal_socket_ms",
  "signal_ms",
  "channels_ms",
  "auth_ms",
  "compatibility_ms",
  "first_request_ms",
];

type Sent = { name: string; properties: NonNullable<Parameters<HostOpenPanelClient["track"]>[1]> };
const sent: Sent[] = [];
const globals: Parameters<HostOpenPanelClient["setGlobalProperties"]>[0] = {};
const waiters: { count: number; resolve: () => void }[] = [];
function sentCount(count: number): Promise<void> {
  if (sent.length >= count) return Promise.resolve();
  return new Promise((resolve) => waiters.push({ count, resolve }));
}
const client: HostOpenPanelClient = {
  setGlobalProperties: (properties) => Object.assign(globals, properties),
  identify: async () => {},
  clear: () => {},
  track: async (name, properties = {}) => {
    sent.push({ name, properties: { ...properties } });
    for (const waiter of waiters.filter((item) => sent.length >= item.count)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  },
};

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function run() {
  const analytics = new HostAnalytics(
    {
      enabled: true,
      trackingEnabled: true,
      appVersion: "0.0.0",
      platform: "darwin",
      resolveOwner: () => ({ id: "account-1", email: "owner@example.test" }),
      resolveAgent: () => null,
    },
    () => client,
  );
  const trace = new RemoteConnectTrace(
    () => {},
    (summary) => analytics.handleRemoteConnect(summary),
  );
  const connect = (
    hostId: string,
    session: string,
    firstRequest: "ok" | "error",
    hostedWaitMs?: number,
    afterBegin = () => {},
  ) => {
    trace.begin(hostId);
    afterBegin();
    for (const phase of REMOTE_CONNECT_PHASES) {
      if (phase === "compatibility" && hostedWaitMs !== undefined) trace.hostedStart(hostId, hostedWaitMs);
      trace.mark(hostId, phase, phase === "session" ? session : phase === "first-request" ? firstRequest : "ok");
    }
  };
  const remoteEvents = () => sent.filter((event) => event.name === "system_remote_connect");

  // 1. The first connection, after a hosted start of 61.234 s.
  connect(HOST, "ok", "ok", 61_234);
  await sentCount(1);
  const first = remoteEvents()[0]?.properties ?? {};
  check(
    "a first connection sends its outcome, session and every phase time",
    first.outcome === "connected" &&
      first.connection === "first" &&
      first.session_kind === "new" &&
      first.last_phase === "first-request" &&
      first.first_request === "ok" &&
      first.failed_attempts === 0 &&
      PHASE_PROPERTIES.every((key) => Number.isInteger(first[key])) &&
      Number.isInteger(first.total_ms) &&
      first.wait_ms === first.total_ms,
    first,
  );
  check("the hosted start wait has two significant digits", first.hosted_start_wait_ms === 61_000, first);

  // 2. The first failure after the connection: a stored session, then an error.
  const stored = trace.begin(HOST);
  trace.mark(HOST, "session", "stored");
  trace.fail(HOST, stored, "error");
  await sentCount(2);
  const failed = remoteEvents()[1]?.properties ?? {};
  check(
    "the first failed attempt sends its last phase",
    failed.outcome === "failed" &&
      failed.connection === "reconnect" &&
      failed.session_kind === "stored" &&
      failed.last_phase === "session" &&
      Number.isInteger(failed.session_ms) &&
      !("ticket_ms" in failed) &&
      !("first_request" in failed) &&
      !("hosted_start_wait_ms" in failed),
    failed,
  );

  // 3. Two more failures send nothing. The next connection counts all three.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    trace.fail(HOST, trace.begin(HOST), "error");
  }
  connect(HOST, "reused", "error");
  await sentCount(3);
  const retried = remoteEvents()[2]?.properties ?? {};
  check(
    "later failures send nothing, and the next connection counts them",
    retried.outcome === "connected" &&
      retried.connection === "reconnect" &&
      retried.session_kind === "reused" &&
      retried.first_request === "error" &&
      retried.failed_attempts === 3 &&
      Number(retried.wait_ms) >= Number(retried.total_ms),
    retried,
  );

  // 4. A cancel sends nothing and ends the wait: the next failure is the first one again.
  trace.fail(OTHER_HOST, trace.begin(OTHER_HOST), "cancelled");
  trace.fail(OTHER_HOST, trace.begin(OTHER_HOST), "error");
  await sentCount(4);
  const afterCancel = remoteEvents()[3]?.properties ?? {};
  check(
    "a cancel sends nothing, and the next failure is sent",
    afterCancel.outcome === "failed" && afterCancel.connection === "first" && afterCancel.last_phase === "start",
    afterCancel,
  );

  // 5. A last connection to a new host. An old attempt ends with a cancel after the new one began.
  // The queue is in order, so nothing else was sent.
  const old = trace.begin(LAST_HOST);
  connect(LAST_HOST, "ok", "ok", undefined, () => trace.fail(LAST_HOST, old, "cancelled"));
  await sentCount(5);
  const last = remoteEvents()[4]?.properties ?? {};
  check(
    "an old attempt that ends late does not stop the newer one",
    last.outcome === "connected" && last.connection === "first" && last.last_phase === "first-request",
    last,
  );
  check(
    "only these five events were sent",
    sent.length === 5,
    sent.map((event) => event.name),
  );
  const body = JSON.stringify({ globals, sent });
  check("no event names a host", ![HOST, OTHER_HOST, LAST_HOST].some((host) => body.includes(host)));
  check(
    "the events go on the host surface with its current generation",
    globals.surface === "desktop_host" && globals.event_schema_version === ANALYTICS_GENERATIONS.desktop_host,
    globals,
  );
}

let passed = false;
try {
  await run();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
const logger = createOpenBotLogger("remote-connect-analytics-e2e");
for (const item of checks) {
  if (item.passed) logger.info(`ok ${item.name}`);
  else logger.error(`FAIL ${item.name}`);
}
logger.info(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
