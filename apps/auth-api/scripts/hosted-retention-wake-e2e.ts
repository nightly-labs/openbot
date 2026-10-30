// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that starts and stops sandboxes. boat deletes the disk of a sandbox 14 days after its stop, so the
// cron must start an idle server with no use for 10 days, and the idle rule must stop it again when no
// client connects. One start goes in each 10 minutes of cron time, and a start that boat failed or
// refused goes again later, also after a refused start for a routine run. A sandbox that boat deleted
// keeps its error. A server with less sleep, a disk that boat deleted, a due deletion, or a plan that
// ended must not start.
//
// Run: bun run test:hosted-retention-wake
// It writes .openbot-build/hosted-retention-wake-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { createAccountAnalytics } from "../src/server/account-analytics";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-retention-wake-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const OWNER = { id: "owner", email: "owner@example.test" };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function run() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const t0 = Date.UTC(2026, 9, 23, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  const insert = database.prepare(
    `INSERT INTO hosted_servers(
       server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
       desired_state, observed_state, idempotency_key, last_active_at, next_run_at, deletion_scheduled_at,
       created_at, updated_at
     ) VALUES (?, ?, 'Cloud server', ?, 'small', 'starter', 'month', 'eur', ?, 'stopped', ?, ?, ?, ?, 1, ?)`,
  );
  const server = (
    id: string,
    desired: string,
    lastActiveAt: number,
    extra: { nextRunAt?: number; deletionAt?: number } = {},
  ) =>
    insert.run(
      id,
      OWNER.id,
      `bx_${id}`,
      desired,
      `key-${id}`,
      lastActiveAt,
      extra.nextRunAt ?? null,
      extra.deletionAt ?? null,
      lastActiveAt + 20 * MINUTE,
    );
  const nextRunAt = t0 + 30 * DAY;
  // The oldest change goes first, so `flaky` is the first start.
  server("flaky", "idle", t0 - 11 * DAY);
  server("due", "idle", t0 - 10 * DAY, { nextRunAt });
  server("recent", "idle", t0 - 9 * DAY);
  server("ended", "stopped", t0 - 11 * DAY);
  server("expired", "idle", t0 - 15 * DAY);
  server("deleting", "idle", t0 - 12 * DAY, { deletionAt: t0 - 1 });

  const calls: string[] = [];
  const running = new Set<string>();
  let flakyFaults = 1;
  let refusals = 0;
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const method = init.method ?? "GET";
    calls.push(`${method} ${path}`);
    const sandboxId = decodeURIComponent(path.split("/")[2] ?? "");
    if (path.endsWith("/resume")) {
      if (sandboxId === "bx_flaky" && flakyFaults > 0) {
        flakyFaults -= 1;
        return Response.json({ ok: false, code: "internal_error" }, { status: 500 });
      }
      if ((sandboxId === "bx_refused" || sandboxId === "bx_routine") && refusals > 0) {
        refusals -= 1;
        return Response.json({ ok: false, code: "billing_required" }, { status: 402 });
      }
      if (sandboxId === "bx_gone") return Response.json({ ok: false, code: "sandbox_not_found" }, { status: 404 });
      running.add(sandboxId);
      return Response.json({ ok: true, status: "resuming" });
    }
    if (path.endsWith("/stop")) {
      running.delete(sandboxId);
      return Response.json({ ok: true });
    }
    if (method === "GET") {
      return Response.json({
        ok: true,
        sandbox: { id: sandboxId, state: running.has(sandboxId) ? "running" : "archived" },
      });
    }
    return Response.json({ ok: true });
  };
  const events: { name: string; properties: { action?: string; reason?: string } }[] = [];
  const work: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init.body));
      events.push({ name: body.payload.name, properties: body.payload.properties });
      return new Response(null, { status: 200 });
    },
    schedule: (send) => work.push(Effect.runPromise(send)),
  });
  const service = new HostedServerService(
    { DB: sqliteD1(database), HOSTED_SERVERS_ENABLED: "true", BOAT_API_KEY: "boat-key" },
    {
      fetch: boatFetch,
      now: () => clock.now,
      analytics,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
    },
  );
  const tick = async (at: number) => {
    clock.now = at;
    const result = await Effect.runPromise(service.tick(at));
    await Promise.all(work.splice(0));
    return result;
  };
  const row = (serverId: string) =>
    database
      .prepare(
        `SELECT desired_state, observed_state, observed_error, last_wake_reason, last_active_at, next_run_at
         FROM hosted_servers WHERE server_id = ?`,
      )
      .get(serverId);
  const resumes = (id: string) => calls.filter((call) => call === `POST /sandboxes/bx_${id}/resume`).length;
  const stops = (id: string) => calls.filter((call) => call === `POST /sandboxes/bx_${id}/stop`).length;

  const first = await tick(t0);
  const reverted = row("flaky");
  check("the cron sends one keep-alive start in a tick", resumes("flaky") === 1 && resumes("due") === 0, calls);
  check(
    "after a boat fault the server sleeps again with its last use",
    first.retained === 0 &&
      reverted?.desired_state === "idle" &&
      reverted.observed_state === "stopped" &&
      reverted.observed_error === null &&
      reverted.last_active_at === t0 - 11 * DAY,
    { result: first, row: reverted },
  );

  // The test Worker runs the cron each minute, production each 5 minutes.
  await tick(t0 + MINUTE);
  await tick(t0 + 5 * MINUTE);
  check("no keep-alive start until 10 minutes of cron time pass", resumes("due") === 0, calls);

  const second = await tick(t0 + 10 * MINUTE);
  const woken = row("due");
  check("the next slot starts the next idle server with no use for 10 days", resumes("due") === 1, calls);
  check("the tick counts the keep-alive start", second.retained === 1 && second.scheduled === 0, second);
  check(
    "the server runs with the stored reason schedule and keeps its next routine run",
    woken?.desired_state === "running" &&
      woken.observed_state === "waking" &&
      woken.last_wake_reason === "schedule" &&
      woken.last_active_at === t0 + 10 * MINUTE &&
      woken.next_run_at === nextRunAt,
    woken,
  );
  check(
    "analytics gets the wake with the reason retention",
    events.some(
      (event) =>
        event.name === "hosted_server_action" &&
        event.properties.action === "woken" &&
        event.properties.reason === "retention",
    ),
    events,
  );
  check("a server with 9 days of sleep does not start", resumes("recent") === 0, calls);

  await tick(t0 + 20 * MINUTE);
  check("a later slot starts the server again after the boat fault", resumes("flaky") === 2, calls);
  check("the started server is running", row("due")?.observed_state === "running", row("due"));

  await tick(t0 + 24 * MINUTE);
  check("the server does not stop before 15 minutes with no use", stops("due") === 0, calls);

  await tick(t0 + 40 * MINUTE);
  check(
    "with no client the idle rule stops the server, and boat saves the disk",
    stops("due") === 1 && row("due")?.desired_state === "idle",
    { calls, row: row("due") },
  );
  check(
    "analytics gets the idle stop",
    events.some((event) => event.properties.action === "idle_stopped"),
    events,
  );

  await tick(t0 + 45 * MINUTE);
  const asleep = row("due");
  check(
    "the server sleeps again and is not started again",
    asleep?.desired_state === "idle" && asleep.observed_state === "stopped" && resumes("due") === 1,
    { calls, row: asleep },
  );

  await tick(t0 + 9 * DAY);
  check("no second start before 10 days", resumes("due") === 1, calls);
  await tick(t0 + 10 * DAY + 10 * MINUTE);
  check("a second start after 10 more days", resumes("due") === 2, calls);
  check("a server whose plan ended never starts", resumes("ended") === 0, calls);
  check("a server whose disk is older than 14 days never starts", resumes("expired") === 0, calls);
  check("a server with a due deletion never starts", resumes("deleting") === 0, calls);

  // A 4xx refusal, such as an empty boat wallet, must not leave the server in `error`: no cron path
  // starts it from there, so boat would delete its disk.
  const refusedAt = t0 + 10 * DAY + 20 * MINUTE;
  server("refused", "idle", refusedAt - 11 * DAY);
  refusals = 1;
  await tick(refusedAt);
  const refused = row("refused");
  check(
    "after a boat refusal the server sleeps again with its last use",
    resumes("refused") === 1 &&
      refused?.desired_state === "idle" &&
      refused.observed_state === "stopped" &&
      refused.observed_error === null &&
      refused.last_active_at === refusedAt - 11 * DAY,
    { calls, row: refused },
  );
  for (let slot = 1; slot <= 3; slot += 1) await tick(refusedAt + slot * 10 * MINUTE);
  check("a later slot starts the server again after the boat refusal", resumes("refused") === 2, calls);

  // The start for a routine run has the same rule. The oldest change goes first, so `gone` takes the slot.
  const routineAt = refusedAt + 40 * MINUTE;
  server("routine", "idle", routineAt - 3 * DAY, { nextRunAt: routineAt + 5 * MINUTE });
  server("gone", "idle", routineAt - 11 * DAY);
  refusals = 1;
  await tick(routineAt);
  const routine = row("routine");
  check(
    "after a refused start for a routine run the server sleeps again with its last use",
    resumes("routine") === 1 &&
      routine?.desired_state === "idle" &&
      routine.observed_state === "stopped" &&
      routine.observed_error === null &&
      routine.last_active_at === routineAt - 3 * DAY,
    { calls, row: routine },
  );
  const gone = row("gone");
  check(
    "a sandbox that boat deleted keeps its error and is not started again",
    resumes("gone") === 1 && gone?.observed_state === "error" && gone.observed_error === "provider_error",
    { calls, row: gone },
  );
  await tick(routineAt + 10 * MINUTE);
  check("the next slot does not start the deleted sandbox", resumes("gone") === 1, calls);
  database.close();
}

let passed = false;
try {
  await run();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
