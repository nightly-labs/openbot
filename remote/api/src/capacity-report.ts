import { Effect, Schedule, Schema } from "effect";

// Sends OpenPanel one `signal_capacity` event every 5 minutes: the TURN allocations from the coturn
// metrics, and the Signal sockets and peer connections. Counts only, with no account,
// address or session. It runs on the host network beside coturn, whose metrics listen on the host
// loopback address only. On 2026-10-30 coturn refused every allocation at its total quota, and nothing
// showed how near the quota it was. Without the OpenPanel server client it sends nothing.

const SCHEMA_VERSION = 1;
const SAMPLE_INTERVAL = "5 minutes";
const FETCH_TIMEOUT_MILLISECONDS = 5_000;
const ALLOCATION_TYPES = new Map([
  ["UDP", "udp"],
  ["TCP", "tcp"],
  ["TLS/TCP", "tls"],
]);

class CapacityReportError extends Schema.TaggedError<CapacityReportError>()("CapacityReportError", {
  source: Schema.Literals(["turn", "signal", "openpanel"]),
}) {}

interface Sample {
  type: string;
  value: number;
}

/** Each sample of `name` in a Prometheus text page, with the `type` label when it has one. */
function samples(page: string, name: string): Sample[] {
  const result: Sample[] = [];
  for (const line of page.split("\n")) {
    const match = /^([a-z_]+)(?:\{([^}]*)\})? ([0-9.e+-]+)$/u.exec(line);
    if (!match || match[1] !== name) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) continue;
    result.push({ type: /(?:^|,)type="([^"]*)"/u.exec(match[2] ?? "")?.[1] ?? "", value });
  }
  return result;
}

const total = (page: string, name: string) => samples(page, name).reduce((sum, sample) => sum + sample.value, 0);

const request = (url: string, source: CapacityReportError["source"], init: RequestInit = {}) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    },
    catch: () => new CapacityReportError({ source }),
  });

interface ReporterConfig {
  trackUrl: string;
  clientId: string;
  clientSecret: string;
  turnMetricsUrl: string;
  signalMetricsUrl: string;
  signalMetricsToken: string;
  turnHost: string;
}

function readConfig(environment: Record<string, string | undefined>): ReporterConfig | null {
  const clientId = environment.OPENPANEL_CLIENT_ID?.trim();
  const clientSecret = environment.OPENPANEL_CLIENT_SECRET?.trim();
  const signalMetricsToken = environment.REMOTE_METRICS_TOKEN?.trim();
  const turnHost = environment.TURN_DOMAIN?.trim();
  if (!clientId || !clientSecret || !signalMetricsToken || !turnHost) return null;
  return {
    // `scripts/signal-capacity-report-smoke.ts` points it at a local capture server.
    trackUrl: environment.OPENPANEL_TRACK_URL ?? "https://analytics.openbot.run/api/track",
    clientId,
    clientSecret,
    turnMetricsUrl: environment.TURN_METRICS_URL ?? "http://127.0.0.1:9641/metrics",
    signalMetricsUrl: environment.SIGNAL_METRICS_URL ?? "http://127.0.0.1:9642/metrics",
    signalMetricsToken,
    turnHost,
  };
}

const report = Effect.fn("CapacityReport.report")(function* (config: ReporterConfig) {
  const [turn, signal] = yield* Effect.all(
    [
      request(config.turnMetricsUrl, "turn"),
      request(config.signalMetricsUrl, "signal", {
        headers: { Authorization: `Bearer ${config.signalMetricsToken}` },
      }),
    ],
    { concurrency: "unbounded" },
  );
  const properties: Record<string, string | number> = {
    surface: "signal",
    environment: "production",
    event_schema_version: SCHEMA_VERSION,
    turn_host: config.turnHost,
    turn_allocations: total(turn, "turn_total_allocations"),
    signal_sockets: total(signal, "openbot_remote_signal_sockets"),
    signal_peer_connections: total(signal, "openbot_remote_peer_connections"),
  };
  // coturn writes a type only after its first allocation; send 0 so that the charts have no gaps.
  for (const type of ALLOCATION_TYPES.values()) properties[`turn_allocations_${type}`] = 0;
  for (const sample of samples(turn, "turn_total_allocations")) {
    const type = ALLOCATION_TYPES.get(sample.type);
    if (type) properties[`turn_allocations_${type}`] = sample.value;
  }
  yield* request(config.trackUrl, "openpanel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "openpanel-client-id": config.clientId,
      "openpanel-client-secret": config.clientSecret,
    },
    body: JSON.stringify({ type: "track", payload: { name: "signal_capacity", properties } }),
  });
});

const main = Effect.gen(function* () {
  const config = readConfig(process.env);
  if (!config) {
    console.info(
      "Capacity report off: OPENPANEL_CLIENT_ID, OPENPANEL_CLIENT_SECRET, REMOTE_METRICS_TOKEN or TURN_DOMAIN is missing.",
    );
    return;
  }
  yield* Effect.suspend(() => report(config)).pipe(
    // A failed sample is skipped; the next one comes at the next interval.
    Effect.catch((error) => Effect.sync(() => console.warn("Capacity report failed.", { source: error.source }))),
    Effect.repeat(Schedule.spaced(SAMPLE_INTERVAL)),
  );
});

Effect.runFork(main);
