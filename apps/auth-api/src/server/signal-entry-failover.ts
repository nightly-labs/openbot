import { type Duration, Effect, Schema } from "effect";
import { type RemoteSignalPlan, remoteSignalPlan } from "./remote-control-plane";
import type { WorkerBindings } from "./types";

/**
 * The cron that runs only the entry check. The other scheduled jobs keep their own cron. Cloudflare
 * reads `*\/1` as each minute, and `controller.cron` keeps the text, so the two crons stay apart.
 */
export const SIGNAL_ENTRY_CRON = "*/1 * * * *";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
// A machine leaves the entry only when two checks this far apart fail, so one slow answer does not move
// the bots.
const CONFIRM_DELAY: Duration.Input = "20 seconds";
const HEALTH_TIMEOUT_MS = 5_000;
const API_TIMEOUT_MS = 10_000;

export type SignalEntryBindings = Pick<
  WorkerBindings,
  "REMOTE_SIGNAL_URL" | "REMOTE_SIGNAL_HOMES" | "SIGNAL_ENTRY_ZONE_ID" | "SIGNAL_ENTRY_DNS_TOKEN"
>;

export type SignalEntryFetch = (input: string, init: RequestInit) => Promise<Response>;

type SignalEntryCheck =
  | { status: "off" }
  /** The DNS records do not show one entry machine. The check changes nothing. */
  | { status: "unknown"; reason: "entry_record" | "entry_address" }
  | { status: "healthy"; entry: string }
  /** The entry machine failed, and no other machine answered. */
  | { status: "kept"; entry: string }
  | { status: "moved"; from: string; to: string };

/** The Cloudflare API refused a request or did not answer. The token and the answer text are not kept. */
class SignalEntryDnsError extends Schema.TaggedError<SignalEntryDnsError>()("SignalEntryDnsError", {
  operation: Schema.Literals(["list", "update"]),
  status: Schema.Number,
}) {}

const DnsRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  content: Schema.String,
  proxied: Schema.optional(Schema.Boolean),
});
type DnsRecord = typeof DnsRecord.Type;
const DnsRecordList = Schema.Struct({ success: Schema.Literal(true), result: Schema.Array(DnsRecord) });
const DnsRecordUpdate = Schema.Struct({ success: Schema.Literal(true) });

interface SignalMachine {
  id: string;
  host: string;
  healthUrl: string;
}

/**
 * Keeps `signal.openbot.run` on a Signal machine that answers. The entry machine runs the bots and
 * takes the tickets without a `signal` claim (`remote/api/src/entry.ts`), so the name must move when
 * that machine stops.
 *
 * Each run reads the A records of the entry name and of each home in `REMOTE_SIGNAL_HOMES`. When the
 * machine that the entry name gives fails `/health/ready` two times, 20 seconds apart, the record gets
 * the address of the first other home that answers. The name does not go back by itself: both machines
 * are equal, and a machine that starts and stops must not move the bots each minute.
 */
export const checkSignalEntry = Effect.fn("SignalEntry.check")(function* (
  bindings: SignalEntryBindings,
  options: { fetch: SignalEntryFetch; confirmDelay?: Duration.Input },
) {
  const token = bindings.SIGNAL_ENTRY_DNS_TOKEN?.trim();
  const zoneId = bindings.SIGNAL_ENTRY_ZONE_ID?.trim();
  const plan = remoteSignalPlan(bindings);
  if (!token || !zoneId || !plan || plan.homes.size < 2) return { status: "off" } satisfies SignalEntryCheck;
  const api = { token, zoneId, fetch: options.fetch };
  const machines = signalMachines(plan);
  const entryHost = new URL(plan.entryUrl).hostname;
  const [entryRecords, ...homeRecords] = yield* Effect.forEach(
    [entryHost, ...machines.map((machine) => machine.host)],
    (name) => listARecords(api, name),
    { concurrency: "unbounded" },
  );
  const entry = entryRecords?.length === 1 ? entryRecords[0] : undefined;
  if (!entry || entry.proxied === true) return { status: "unknown", reason: "entry_record" } satisfies SignalEntryCheck;
  const located = machines.map((machine, index) => {
    const records = homeRecords[index] ?? [];
    return { ...machine, address: records.length === 1 ? (records[0]?.content ?? null) : null };
  });
  const current = located.find((machine) => machine.address === entry.content);
  if (!current) return { status: "unknown", reason: "entry_address" } satisfies SignalEntryCheck;
  if (yield* isHealthy(options.fetch, current))
    return { status: "healthy", entry: current.id } satisfies SignalEntryCheck;
  yield* Effect.sleep(options.confirmDelay ?? CONFIRM_DELAY);
  if (yield* isHealthy(options.fetch, current))
    return { status: "healthy", entry: current.id } satisfies SignalEntryCheck;
  for (const machine of located) {
    if (machine === current || machine.address === null) continue;
    if (!(yield* isHealthy(options.fetch, machine))) continue;
    yield* updateARecord(api, entry, machine.address);
    return { status: "moved", from: current.id, to: machine.id } satisfies SignalEntryCheck;
  }
  return { status: "kept", entry: current.id } satisfies SignalEntryCheck;
});

function signalMachines(plan: RemoteSignalPlan): SignalMachine[] {
  return [...plan.homes].map(([id, url]) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "ws:" ? "http:" : "https:";
    return { id, host: parsed.hostname, healthUrl: `${protocol}//${parsed.host}/health/ready` };
  });
}

/** Whether the Signal of the machine answers. A failed request is an unhealthy machine, not an error. */
function isHealthy(fetcher: SignalEntryFetch, machine: SignalMachine): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: (signal) =>
      fetcher(machine.healthUrl, {
        method: "GET",
        signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]),
      }),
    catch: () => null,
  }).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  );
}

interface CloudflareDnsApi {
  token: string;
  zoneId: string;
  fetch: SignalEntryFetch;
}

const listARecords = Effect.fn("SignalEntry.listARecords")(function* (api: CloudflareDnsApi, name: string) {
  const query = new URLSearchParams({ type: "A", name });
  const payload = yield* cloudflareRequest(api, "list", `/zones/${api.zoneId}/dns_records?${query}`, {
    method: "GET",
  });
  const decoded = yield* Schema.decodeUnknownEffect(DnsRecordList)(payload).pipe(
    Effect.mapError(() => new SignalEntryDnsError({ operation: "list", status: 502 })),
  );
  return decoded.result.filter((record) => record.name === name);
});

const updateARecord = Effect.fn("SignalEntry.updateARecord")(function* (
  api: CloudflareDnsApi,
  record: DnsRecord,
  address: string,
) {
  const payload = yield* cloudflareRequest(api, "update", `/zones/${api.zoneId}/dns_records/${record.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: address }),
  });
  yield* Schema.decodeUnknownEffect(DnsRecordUpdate)(payload).pipe(
    Effect.mapError(() => new SignalEntryDnsError({ operation: "update", status: 502 })),
  );
});

const cloudflareRequest = Effect.fn("SignalEntry.cloudflareRequest")(function* (
  api: CloudflareDnsApi,
  operation: SignalEntryDnsError["operation"],
  path: string,
  init: RequestInit,
) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      api.fetch(`${CLOUDFLARE_API}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${api.token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
      }),
    catch: () => new SignalEntryDnsError({ operation, status: 0 }),
  });
  if (!response.ok) return yield* new SignalEntryDnsError({ operation, status: response.status });
  return yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => new SignalEntryDnsError({ operation, status: 502 }),
  });
});
