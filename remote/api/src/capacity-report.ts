import { Effect, Schedule, Schema } from "effect";

// Sends OpenPanel one `signal_capacity` event every 5 minutes: the TURN allocations from the coturn
// metrics, and the Signal sockets and peer connections. Counts only, with no account,
// address or session. It runs on the host network beside coturn, whose metrics listen on the host
// loopback address only. On 2026-10-30 coturn refused every allocation at its total quota, and nothing
// showed how near the quota it was. Without the OpenPanel server client it sends nothing.
//
// Generation 2 adds the generic webhook answers of the interval, by status, and the time Signal waited
// for the hosts. Signal counts from its start, so the first sample of this process sets the base and
// sends no webhook values; a lower count than the last sample means that Signal restarted.

const SCHEMA_VERSION = 2;
const SAMPLE_INTERVAL_MILLISECONDS = 5 * 60 * 1_000;
const FETCH_TIMEOUT_MILLISECONDS = 5_000;
const WEBHOOK_ANSWER_STATUSES = ["200", "202", "400", "401", "404", "413", "415", "429", "503"] as const;
const WEBHOOK_COUNTERS = [
  ["webhook_waits", "openbot_remote_webhook_waits_total"],
  ["webhook_wait_ms", "openbot_remote_webhook_wait_milliseconds_total"],
  ["webhook_slow_waits", "openbot_remote_webhook_slow_waits_total"],
] as const;
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
  status: string;
  value: number;
}

const label = (labels: string, name: string) => new RegExp(`(?:^|,)${name}="([^"]*)"`, "u").exec(labels)?.[1] ?? "";

/** Each sample of `name` in a Prometheus text page, with its `type` and `status` labels when it has them. */
function samples(page: string, name: string): Sample[] {
  const result: Sample[] = [];
  for (const line of page.split("\n")) {
    const match = /^([a-z_]+)(?:\{([^}]*)\})? ([0-9.e+-]+)$/u.exec(line);
    if (!match || match[1] !== name) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) continue;
    const labels = match[2] ?? "";
    result.push({ type: label(labels, "type"), status: label(labels, "status"), value });
  }
  return result;
}

/** The webhook counters of one Signal metrics page, by property name. */
function webhookCounters(page: string): Map<string, number> {
  const counters = new Map<string, number>();
  for (const status of WEBHOOK_ANSWER_STATUSES) counters.set(`webhook_answers_${status}`, 0);
  for (const sample of samples(page, "openbot_remote_webhook_answers_total")) {
    const key = `webhook_answers_${sample.status}`;
    if (counters.has(key)) counters.set(key, sample.value);
  }
  for (const [property, name] of WEBHOOK_COUNTERS) counters.set(property, total(page, name));
  return counters;
}

/**
 * The webhook values of one interval: each counter less its last sample. A Signal that has no webhook
 * counters, such as an older one, sends none.
 */
function webhookInterval(page: string, previous: Map<string, number>, current: Map<string, number>) {
  if (!page.includes("openbot_remote_webhook_answers_total")) return {};
  const restarted = [...current].some(([key, value]) => value < (previous.get(key) ?? 0));
  const delta = (key: string) => (current.get(key) ?? 0) - (restarted ? 0 : (previous.get(key) ?? 0));
  const properties: Record<string, number> = {};
  for (const status of WEBHOOK_ANSWER_STATUSES)
    properties[`webhook_answers_${status}`] = delta(`webhook_answers_${status}`);
  const waits = delta("webhook_waits");
  properties.webhook_waits = waits;
  properties.webhook_slow_waits = delta("webhook_slow_waits");
  if (waits > 0) properties.webhook_wait_ms_avg = Math.round(delta("webhook_wait_ms") / waits);
  return properties;
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
  intervalMilliseconds: number;
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
    // The smoke test sets a short interval, so that it sees a second sample.
    intervalMilliseconds: Number(environment.CAPACITY_REPORT_INTERVAL_MS) || SAMPLE_INTERVAL_MILLISECONDS,
  };
}

const report = Effect.fn("CapacityReport.report")(function* (
  config: ReporterConfig,
  webhookBase: { counters: Map<string, number> | null },
) {
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
  const counters = webhookCounters(signal);
  const previous = webhookBase.counters;
  webhookBase.counters = counters;
  if (previous) Object.assign(properties, webhookInterval(signal, previous, counters));
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
  const webhookBase: { counters: Map<string, number> | null } = { counters: null };
  yield* Effect.suspend(() => report(config, webhookBase)).pipe(
    // A failed sample is skipped; the next one comes at the next interval.
    Effect.catch((error) => Effect.sync(() => console.warn("Capacity report failed.", { source: error.source }))),
    Effect.repeat(Schedule.spaced(config.intervalMilliseconds)),
  );
});

Effect.runFork(main);
