// Runs the Signal entry check against two real local HTTP servers, which stand for the two Signal
// machines, and a fake Cloudflare DNS API. The entry name stays while its machine answers, moves to
// the other machine when its machine fails two checks, and stays when no machine answers or the
// records are not clear. The Worker cron runs the check only on its own cron, and its log never holds
// the token.
//
// Run: bun apps/auth-api/scripts/signal-entry-failover-e2e.ts
// It writes .openbot-build/signal-entry-failover-e2e/report.json and exits non-zero on a failure.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Result } from "effect";
import {
  checkSignalEntry,
  SIGNAL_ENTRY_CRON,
  type SignalEntryBindings,
  type SignalEntryFetch,
} from "../src/server/signal-entry-failover";
import { createWorkerHandler } from "../src/server/worker-handler";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "signal-entry-failover-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const TOKEN = "cf-token-e2e-secret";
const ZONE = "zone-1";
const ENTRY = "signal.test";
const ADDRESS = { a: "192.0.2.1", b: "192.0.2.2" } as const;
const CONFIRM_DELAY = "200 millis";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

// The two Signal machines: `/health/ready` answers 200 while the machine is up.
// `fail-once` answers 503 one time, then works as `up`.
type Health = "up" | "down" | "fail-once" | "stopped";
const health: Record<"a" | "b", Health> = { a: "up", b: "up" };
function serveSignal(id: "a" | "b", port = 0) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => {
      const state = health[id];
      if (state === "fail-once") health[id] = "up";
      return new URL(request.url).pathname === "/health/ready" && state === "up"
        ? Response.json({ status: "ready" })
        : new Response(null, { status: 503 });
    },
  });
}
const servers = { a: serveSignal("a"), b: serveSignal("b") };
// A stopped server does not keep its port, so a restart uses the port from the start.
const PORT = { a: Number(servers.a.port), b: Number(servers.b.port) };
// Each machine has its own name, so the DNS API can give each one its own record.
const HOMES = `a=ws://localhost:${PORT.a}/v1/signal,b=ws://127.0.0.1:${PORT.b}/v1/signal`;
const HOST = { a: "localhost", b: "127.0.0.1" } as const;

async function setHealth(id: "a" | "b", next: Health) {
  if (health[id] === "stopped" && next !== "stopped") servers[id] = serveSignal(id, PORT[id]);
  if (next === "stopped") await servers[id].stop(true);
  health[id] = next;
}

// The fake Cloudflare DNS API: A records by name, and the requests it got.
interface FakeRecord {
  id: string;
  name: string;
  content: string;
  proxied: boolean;
}
let records: FakeRecord[] = [];
let apiFailure: number | null = null;
const apiRequests: { method: string; path: string; authorized: boolean; body: unknown }[] = [];

function resetDns(entryAddress: string, proxied = false) {
  records = [
    { id: "entry-record", name: ENTRY, content: entryAddress, proxied },
    { id: "a-record", name: HOST.a, content: ADDRESS.a, proxied: false },
    { id: "b-record", name: HOST.b, content: ADDRESS.b, proxied: false },
  ];
  apiFailure = null;
  apiRequests.length = 0;
}

const fakeFetch: SignalEntryFetch = async (input, init) => {
  const url = new URL(input);
  if (url.hostname !== "api.cloudflare.com") return fetch(input, init);
  const headers = new Headers(init.headers);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  const method = init.method ?? "GET";
  apiRequests.push({
    method,
    path: url.pathname,
    authorized: headers.get("authorization") === `Bearer ${TOKEN}`,
    body,
  });
  if (apiFailure !== null)
    return Response.json({ success: false, errors: [{ message: TOKEN }] }, { status: apiFailure });
  const prefix = `/client/v4/zones/${ZONE}/dns_records`;
  if (method === "GET" && url.pathname === prefix) {
    const name = url.searchParams.get("name");
    const result = records.filter((record) => url.searchParams.get("type") === "A" && record.name === name);
    return Response.json({ success: true, result });
  }
  const record = records.find((entry) => url.pathname === `${prefix}/${entry.id}`);
  if (method === "PATCH" && record && typeof body?.content === "string") {
    record.content = body.content;
    return Response.json({ success: true, result: record });
  }
  return Response.json({ success: false }, { status: 404 });
};

const bindings: SignalEntryBindings = {
  REMOTE_SIGNAL_URL: `ws://${ENTRY}/v1/signal`,
  REMOTE_SIGNAL_HOMES: HOMES,
  SIGNAL_ENTRY_ZONE_ID: ZONE,
  SIGNAL_ENTRY_DNS_TOKEN: TOKEN,
};

function run(input: SignalEntryBindings = bindings) {
  return Effect.runPromise(Effect.result(checkSignalEntry(input, { fetch: fakeFetch, confirmDelay: CONFIRM_DELAY })));
}
const patches = () => apiRequests.filter((request) => request.method === "PATCH");
const entryAddress = () => records.find((record) => record.name === ENTRY)?.content;

try {
  // Off: no token, no zone, or fewer than two homes. No request goes to Cloudflare.
  resetDns(ADDRESS.a);
  const offResults = [
    await run({ ...bindings, SIGNAL_ENTRY_DNS_TOKEN: "" }),
    await run({ ...bindings, SIGNAL_ENTRY_ZONE_ID: undefined }),
    await run({ ...bindings, REMOTE_SIGNAL_HOMES: `a=ws://localhost:${PORT.a}/v1/signal` }),
    await run({ ...bindings, REMOTE_SIGNAL_HOMES: "not a list" }),
  ];
  check(
    "Without the token, the zone or two homes, the check is off and sends no request",
    offResults.every((result) => Result.isSuccess(result) && result.success.status === "off") &&
      apiRequests.length === 0,
    { offResults, apiRequests: apiRequests.length },
  );

  // Healthy entry: no change.
  resetDns(ADDRESS.a);
  const healthy = await run();
  check(
    "While the entry machine answers, the record stays",
    Result.isSuccess(healthy) &&
      healthy.success.status === "healthy" &&
      healthy.success.entry === "a" &&
      patches().length === 0 &&
      entryAddress() === ADDRESS.a,
    healthy,
  );
  check(
    "Each Cloudflare request carries the token, and the check reads only A records of the entry and homes",
    apiRequests.length === 3 && apiRequests.every((request) => request.authorized && request.method === "GET"),
    apiRequests,
  );

  // The entry machine stops: the record moves to the other machine.
  resetDns(ADDRESS.a);
  await setHealth("a", "stopped");
  const moved = await run();
  check(
    "When the entry machine does not answer two times, the record gets the address of the other machine",
    Result.isSuccess(moved) &&
      moved.success.status === "moved" &&
      moved.success.from === "a" &&
      moved.success.to === "b" &&
      entryAddress() === ADDRESS.b,
    { moved, patches: patches() },
  );
  check(
    "The move changes only the content of the entry record",
    patches().length === 1 &&
      patches()[0]?.path.endsWith("/dns_records/entry-record") === true &&
      JSON.stringify(patches()[0]?.body) === JSON.stringify({ content: ADDRESS.b }),
    patches(),
  );

  // After the move, the first machine starts again. The name does not go back.
  await setHealth("a", "up");
  apiRequests.length = 0;
  const noFailback = await run();
  check(
    "When the old entry machine answers again, the record stays on the new machine",
    Result.isSuccess(noFailback) &&
      noFailback.success.status === "healthy" &&
      noFailback.success.entry === "b" &&
      patches().length === 0 &&
      entryAddress() === ADDRESS.b,
    noFailback,
  );

  // One failed answer, then the machine answers before the second check: no move.
  resetDns(ADDRESS.a);
  await setHealth("a", "fail-once");
  const recovered = await run();
  check(
    "A machine that fails once and answers at the second check keeps the entry",
    Result.isSuccess(recovered) &&
      recovered.success.status === "healthy" &&
      recovered.success.entry === "a" &&
      patches().length === 0,
    recovered,
  );

  // Both machines fail: the record stays, because no machine can take the entry.
  resetDns(ADDRESS.a);
  await setHealth("a", "down");
  await setHealth("b", "down");
  const kept = await run();
  check(
    "When no machine answers, the record stays",
    Result.isSuccess(kept) && kept.success.status === "kept" && patches().length === 0 && entryAddress() === ADDRESS.a,
    kept,
  );
  await setHealth("b", "up");

  // Records that do not show one entry machine: the check changes nothing.
  resetDns(ADDRESS.a, true);
  const proxied = await run();
  resetDns("198.51.100.9");
  const foreign = await run();
  resetDns(ADDRESS.a);
  records.push({ id: "entry-record-2", name: ENTRY, content: ADDRESS.b, proxied: false });
  const two = await run();
  check(
    "A proxied entry record, an entry address of no home, or two entry records change nothing",
    Result.isSuccess(proxied) &&
      proxied.success.status === "unknown" &&
      Result.isSuccess(foreign) &&
      foreign.success.status === "unknown" &&
      Result.isSuccess(two) &&
      two.success.status === "unknown" &&
      patches().length === 0,
    { proxied, foreign, two },
  );

  // A refused API request: a typed error with the status, and no change.
  resetDns(ADDRESS.a);
  apiFailure = 403;
  const refused = await run();
  check(
    "A refused Cloudflare request fails with its operation and status, and holds no answer text",
    Result.isFailure(refused) &&
      refused.failure._tag === "SignalEntryDnsError" &&
      refused.failure.operation === "list" &&
      refused.failure.status === 403 &&
      !JSON.stringify(refused.failure).includes(TOKEN) &&
      patches().length === 0,
    Result.isFailure(refused) ? { operation: refused.failure.operation, status: refused.failure.status } : refused,
  );

  // The Worker cron: the entry cron runs only the check, the other cron never calls Cloudflare, and
  // the log of a failed check holds no token.
  await setHealth("a", "down");
  resetDns(ADDRESS.a);
  apiFailure = 403;
  const database = new DatabaseSync(":memory:");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  const logs: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLog = { error: console.error, warn: console.warn, info: console.info };
  const capture = (...values: unknown[]) => void logs.push(JSON.stringify(values));
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => fakeFetch(String(input), init ?? {}),
    {
      preconnect: originalFetch.preconnect,
    },
  );
  Object.assign(console, { error: capture, warn: capture, info: capture });
  const handler = createWorkerHandler(() => new Response(null, { status: 404 }));
  const workerBindings = { ...bindings, DB: sqliteD1(database) };
  try {
    await handler.scheduled({ scheduledTime: Date.UTC(2026, 9, 31, 12, 5), cron: "*/5 * * * *" }, workerBindings);
    const afterOtherCron = apiRequests.length;
    await handler.scheduled({ scheduledTime: Date.UTC(2026, 9, 31, 12, 6), cron: SIGNAL_ENTRY_CRON }, workerBindings);
    check(
      "The five-minute cron does not run the check, and the entry cron does",
      afterOtherCron === 0 && apiRequests.length > 0,
      { afterOtherCron, afterEntryCron: apiRequests.length },
    );
    check(
      "The cron logs a failed check with its operation and status, and never the token",
      logs.some((line) => line.includes("Signal entry check failed") && line.includes("403")) &&
        logs.every((line) => !line.includes(TOKEN)),
      logs,
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalLog);
  }
} finally {
  for (const server of Object.values(servers)) await server.stop(true);
}

const failed = checks.filter((entry) => !entry.passed);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
for (const entry of checks) console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
console.log(`Wrote ${join(OUT, "report.json")}: ${checks.length - failed.length} passed, ${failed.length} failed.`);
if (failed.length > 0) process.exit(1);
