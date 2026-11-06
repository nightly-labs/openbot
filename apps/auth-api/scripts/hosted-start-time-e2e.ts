// Runs the real account server hosted-server service on a migrated SQLite database with a fake boat API,
// and checks the `ready` analytics event: the time from the start request to the usable sandbox.
// A client wake that boat reports by webhook, and a provider stop that the cron sees, each send one event
// with the time and the reason of the start. A second report of the same start sends none, and a start
// time older than the limit sends none. Then it checks the OpenPanel body of the event.
//
// Run: bun run test:hosted-start-time
// It writes .openbot-build/hosted-start-time-e2e/report.json and exits non-zero on a failure.
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import {
  type AccountAnalyticsEvent,
  createAccountAnalytics,
  MAX_HOSTED_START_MS,
} from "../src/server/account-analytics";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-start-time-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SERVER_ID = "server-1";
const SANDBOX_ID = "bx_1";
const WEBHOOK_SECRET = "webhook-secret";
const OWNER = {
  id: "owner",
  email: "owner@example.test",
  name: null,
  avatarUrl: null,
  analyticsEnabled: null,
  chatColor: null,
};
const SECOND = 1_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type Ready = Extract<AccountAnalyticsEvent, { name: "hosted_server_action" }>;

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  return database;
}

async function workerTimesEachStart() {
  const database = migratedDatabase();
  const t0 = Date.UTC(2026, 10, 5, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  database
    .prepare(
      `INSERT INTO hosted_servers(
         server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
         desired_state, observed_state, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, 'Cloud server', ?, 'default', 'standard', 'month', 'eur', 'running', 'stopped', 'key-1', 1, ?)`,
    )
    .run(SERVER_ID, OWNER.id, SANDBOX_ID, t0 - 10 * 60 * SECOND);

  let boatState = "archived";
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    if (path.endsWith("/resume")) return Response.json({ ok: true });
    if (path.endsWith("/commands"))
      return Response.json({ ok: true, type: "command.finished", exitCode: 0, stdout: "", stderr: "" });
    if ((init.method ?? "GET") === "GET")
      return Response.json({ ok: true, sandbox: { id: SANDBOX_ID, state: boatState } });
    return Response.json({ ok: true });
  };
  const tracked: Ready[] = [];
  const scheduled: Promise<void>[] = [];
  const service = new HostedServerService(
    {
      DB: sqliteD1(database),
      HOSTED_SERVERS_ENABLED: "true",
      BOAT_API_KEY: "boat-key",
      BOAT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
    {
      fetch: boatFetch,
      now: () => clock.now,
      schedule: (work) => scheduled.push(Effect.runPromise(work)),
      analytics: {
        track: (_account, event) => {
          if (event.name === "hosted_server_action") tracked.push(event);
        },
      },
    },
  );
  const ready = () => tracked.filter((event) => event.action === "ready");
  const startTime = () =>
    database.prepare("SELECT start_requested_at FROM hosted_servers WHERE server_id = ?").get(SERVER_ID)
      ?.start_requested_at;
  let delivery = 0;
  const webhook = (type: string, state: string, at: number) => {
    clock.now = at;
    delivery += 1;
    const deliveryId = `delivery-${delivery}`;
    const timestamp = String(Math.floor(at / SECOND));
    const body = JSON.stringify({
      type,
      createdAt: new Date(at).toISOString(),
      data: { state, sandbox: { id: SANDBOX_ID } },
    });
    const signature = `v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${deliveryId}.${timestamp}.${body}`).digest("hex")}`;
    return Effect.runPromise(service.handleWebhook({ deliveryId, timestamp, signature, body }));
  };

  // 1. A client wake of a stopped server. boat reports the sandbox by webhook 42 seconds later.
  clock.now = t0;
  const woken = await Effect.runPromise(service.wake(OWNER, SERVER_ID));
  await Promise.all(scheduled.splice(0));
  check("a client wake stores the start time", woken.state === "waking" && startTime() === t0, {
    state: woken.state,
    startRequestedAt: startTime(),
  });
  boatState = "running";
  await webhook("sandbox.ready", "running", t0 + 42 * SECOND);
  check(
    "the webhook of the usable sandbox sends one ready event with the time and reason of the wake",
    ready().length === 1 && ready()[0]?.durationMs === 42 * SECOND && ready()[0]?.reason === "message",
    ready(),
  );
  check("the ready event clears the start time", startTime() === null, { startRequestedAt: startTime() });
  await webhook("sandbox.ready", "running", t0 + 50 * SECOND);
  clock.now = t0 + 10 * 60 * SECOND;
  await Effect.runPromise(service.tick(clock.now));
  await Effect.runPromise(service.wake(OWNER, SERVER_ID));
  check("a later report of the running sandbox sends no second event", ready().length === 1, ready());

  // 2. boat stops the sandbox. The Worker starts it again, and the cron reads it as usable.
  const t1 = t0 + 20 * 60 * SECOND;
  boatState = "archived";
  await webhook("sandbox.archived", "archived", t1);
  await Promise.all(scheduled.splice(0));
  check("a provider stop stores the start time of the restart", startTime() === t1, { startRequestedAt: startTime() });
  boatState = "running";
  clock.now = t1 + 3 * 60 * SECOND;
  await Effect.runPromise(service.tick(clock.now));
  check(
    "the cron that sees the usable sandbox sends the ready event of the restart",
    ready().length === 2 && ready()[1]?.durationMs === 3 * 60 * SECOND && ready()[1]?.reason === "restart",
    ready(),
  );

  // 3. A start time that a Worker without the column left behind gives no event.
  const t2 = t1 + 60 * 60 * SECOND;
  boatState = "archived";
  await webhook("sandbox.archived", "archived", t2);
  await Promise.all(scheduled.splice(0));
  database
    .prepare("UPDATE hosted_servers SET start_requested_at = ? WHERE server_id = ?")
    .run(t2 - MAX_HOSTED_START_MS - SECOND, SERVER_ID);
  boatState = "running";
  await webhook("sandbox.ready", "running", t2 + 30 * SECOND);
  check(
    "a start time older than the limit is cleared and sends no event",
    ready().length === 2 && startTime() === null,
    { ready: ready(), startRequestedAt: startTime() },
  );
}

async function openPanelBodyHasTheTime() {
  const bodies: unknown[] = [];
  const work: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    },
    schedule: (send) => work.push(Effect.runPromise(send)),
    database: sqliteD1(migratedDatabase()),
  });
  const event = (durationMs: number, reason: Ready["reason"] = "create"): Ready => ({
    name: "hosted_server_action",
    action: "ready",
    plan: "standard",
    size: "default",
    reason,
    durationMs,
  });
  analytics.track("owner", event(61_234));
  analytics.track("owner", event(MAX_HOSTED_START_MS + 1, "message"));
  analytics.track("owner", { name: "hosted_server_action", action: "woken", reason: "message", durationMs: 5 });
  await Promise.all(work);
  const properties = bodies.map((body) =>
    isDynamicRecord(body) && isDynamicRecord(body.payload) && isDynamicRecord(body.payload.properties)
      ? body.payload.properties
      : null,
  );
  check(
    "the OpenPanel body of ready has the action, reason, time and generation",
    properties[0]?.action === "ready" &&
      properties[0]?.reason === "create" &&
      properties[0]?.duration_ms === 61_234 &&
      properties[0]?.event_schema_version === 15,
    properties[0],
  );
  check(
    "a time over the limit and a time on another action are dropped",
    properties[1]?.action === "ready" &&
      !("duration_ms" in (properties[1] ?? {})) &&
      properties[2]?.action === "woken" &&
      !("duration_ms" in (properties[2] ?? {})),
    properties.slice(1),
  );
}

let passed = false;
try {
  await workerTimesEachStart();
  await openPanelBodyHasTheTime();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
