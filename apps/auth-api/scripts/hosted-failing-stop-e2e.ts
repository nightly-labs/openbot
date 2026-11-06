// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that answers as during a stop that boat cannot finish. boat runs the pre-stop hook, which stops
// OpenBot, and then cannot save the disk. It reports `stop.status: "failing"` and tries the stop again
// until a save works, while the sandbox keeps a usable state (`idle`). On 2026-11-05 a server stayed so
// for 18 hours: the Worker read the sandbox as running, and the fault stayed hidden.
//
// The Worker must read the server as `stopping`, not running, and log a warning. It must not end the
// stop: boat does not say if a resume keeps the disk or restores the last saved one, and a forced stop
// loses what was written after that. Each client wake and connector event still sends the start command
// of a failed stop, as before. A webhook must not hide the failing stop. A stop that boat still does
// gets no command.
//
// Run: bun run test:hosted-failing-stop
// It writes .openbot-build/hosted-failing-stop-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-failing-stop-e2e");
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
const FLAG = "/run/openbot-pre-stop";
const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 5, 21);
const WARNING = "Hosted server stop is failing.";

/**
 * The stop that boat reports on the sandbox. `failing` keeps the state `idle`, `pending` is
 * `archiving`, and `unknown` is a stop object with no status on a sandbox that runs.
 */
type StopAnswer = "failing" | "pending" | "unknown";
/** `route` is a connector event (`startForRoute`). `webhook` is a boat `sandbox.ready` event. */
type Caller = "client" | "route" | "cron" | "webhook";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function sandboxAnswer(stop: StopAnswer) {
  if (stop === "unknown") return { id: SANDBOX_ID, state: "idle", stop: { id: "stop_1" } };
  return {
    id: SANDBOX_ID,
    state: stop === "failing" ? "idle" : "archiving",
    health: "degraded",
    stop: {
      id: "stop_1",
      status: stop,
      requestedAt: new Date(NOW - 18 * 60 * MINUTE).toISOString(),
      lastAttemptAt: new Date(NOW - MINUTE).toISOString(),
      error: stop === "failing" ? "Refusing archive/stop: no successful snapshot" : null,
      endedAt: null,
      forced: false,
    },
  };
}

async function signedWebhook(body: string) {
  const deliveryId = "delivery-1";
  const timestamp = String(Math.floor(NOW / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${deliveryId}.${timestamp}.${body}`));
  const signature = `v1=${Buffer.from(digest).toString("hex")}`;
  return { deliveryId, timestamp, signature, body };
}

async function runWith(options: {
  desired: "running" | "idle";
  observed: "running" | "stopping";
  observedError?: "provider_error";
  stop: StopAnswer;
  caller: Caller;
}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  database
    .prepare(
      `INSERT INTO hosted_servers(
         server_id, owner_user_id, name, provider_sandbox_id, size, pending_size, plan, billing_interval, currency,
         desired_state, observed_state, observed_error, idempotency_key, last_active_at, created_at, updated_at
       ) VALUES (?, ?, 'Cloud server', ?, 'small', NULL, 'starter', 'month', 'eur', ?, ?, ?, 'key-1', ?, 1, ?)`,
    )
    .run(
      SERVER_ID,
      OWNER.id,
      SANDBOX_ID,
      options.desired,
      options.observed,
      options.observedError ?? null,
      NOW - 30 * MINUTE,
      NOW - 10 * MINUTE,
    );

  const calls: { method: string; path: string; body: unknown }[] = [];
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? "GET", path, body });
    if (path.endsWith("/commands")) {
      return Response.json({ ok: true, type: "command.finished", exitCode: 0, stdout: "started\n", stderr: "" });
    }
    if (path.endsWith("/resume")) {
      return Response.json({ ok: true, type: "sandbox.resuming", id: SANDBOX_ID, status: "running" });
    }
    if (path.endsWith("/stop")) return Response.json({ ok: true, status: "archiving" }, { status: 202 });
    return Response.json({ ok: true, sandbox: sandboxAnswer(options.stop) });
  };
  const scheduled: Promise<void>[] = [];
  const service = new HostedServerService(
    {
      DB: sqliteD1(database),
      HOSTED_SERVERS_ENABLED: "true",
      BOAT_API_KEY: "boat-key",
      BOAT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
    { fetch: boatFetch, now: () => NOW, schedule: (work) => scheduled.push(Effect.runPromise(work)) },
  );
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  let failure: string | null = null;
  try {
    if (options.caller === "cron") await Effect.runPromise(service.tick(NOW));
    else if (options.caller === "route") await Effect.runPromise(service.startForRoute(SERVER_ID));
    else if (options.caller === "webhook") {
      const body = JSON.stringify({
        type: "sandbox.ready",
        createdAt: new Date(NOW).toISOString(),
        data: { state: "idle", sandbox: { id: SANDBOX_ID } },
      });
      await Effect.runPromise(service.handleWebhook(await signedWebhook(body)));
    } else await Effect.runPromise(service.wake(OWNER, SERVER_ID));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    console.warn = warn;
  }
  await Promise.all(scheduled);
  const row = database
    .prepare("SELECT desired_state, observed_state, observed_error FROM hosted_servers WHERE server_id = ?")
    .get(SERVER_ID);
  return {
    failure,
    warned: warnings.includes(WARNING),
    row,
    calls: calls.map((call) => `${call.method} ${call.path}`),
    reads: calls.filter((call) => call.method === "GET"),
    resumes: calls.filter((call) => call.method === "POST" && call.path === `/sandboxes/${SANDBOX_ID}/resume`),
    stops: calls.filter((call) => call.path.endsWith("/stop")),
    commands: calls.filter((call) => call.path.endsWith("/commands")),
  };
}

/** The command of a failed stop: it starts OpenBot only for a flag older than 5 minutes. */
function failedStopStart(commands: { body: unknown }[]) {
  const body = commands[0]?.body;
  const text = isDynamicRecord(body) && isString(body.command) ? body.command : "";
  return (
    commands.length === 1 &&
    text.startsWith(`if find ${FLAG} -mmin +5 `) &&
    text.includes("sudo -n systemctl start --no-block openbot.service")
  );
}

function state(row: unknown) {
  return isDynamicRecord(row) ? row.observed_state : null;
}

/** Read as stopping, logged, and only the start command of a failed stop sent to boat. */
function heldWithStart(result: Awaited<ReturnType<typeof runWith>>) {
  return (
    result.failure === null &&
    result.warned &&
    state(result.row) === "stopping" &&
    result.resumes.length === 0 &&
    result.stops.length === 0 &&
    failedStopStart(result.commands)
  );
}

let passed = false;
try {
  const inUse = await runWith({ desired: "running", observed: "running", stop: "failing", caller: "client" });
  check("a client wake during a failing stop reads the server as stopping", state(inUse.row) === "stopping", inUse);
  check("the wake logs that the stop fails", inUse.warned, inUse);
  check(
    "the wake sends no resume, no stop and no forced stop",
    inUse.resumes.length === 0 && inUse.stops.length === 0,
    inUse,
  );
  check("the wake still sends the start command of a failed stop", failedStopStart(inUse.commands), inUse);
  check("the wake does not fail", inUse.failure === null, inUse);

  const again = await runWith({ desired: "running", observed: "stopping", stop: "failing", caller: "client" });
  check("a later client wake of a stopping server still sends the start command", heldWithStart(again), again);

  const route = await runWith({ desired: "running", observed: "stopping", stop: "failing", caller: "route" });
  check("a connector event during a failing stop sends the start command", heldWithStart(route), route);

  const sleeping = await runWith({ desired: "idle", observed: "running", stop: "failing", caller: "client" });
  check(
    "a client wake of a sleeping server during a failing stop is held the same way",
    heldWithStart(sleeping),
    sleeping,
  );

  for (const desired of ["running", "idle"] as const) {
    const cron = await runWith({ desired, observed: "stopping", stop: "failing", caller: "cron" });
    check(
      `the cron keeps a failing stop (desired ${desired}) stopping, logs it, and sends nothing to boat`,
      cron.resumes.length === 0 &&
        cron.stops.length === 0 &&
        cron.commands.length === 0 &&
        cron.warned &&
        state(cron.row) === "stopping",
      cron,
    );
  }

  const stale = await runWith({
    desired: "running",
    observed: "stopping",
    observedError: "provider_error",
    stop: "failing",
    caller: "cron",
  });
  check(
    "a failing stop clears an old provider error",
    isDynamicRecord(stale.row) && stale.row.observed_error === null && state(stale.row) === "stopping",
    stale,
  );

  const webhook = await runWith({ desired: "running", observed: "stopping", stop: "failing", caller: "webhook" });
  check(
    "a ready webhook for a stopping server asks boat and keeps the failing stop",
    webhook.failure === null &&
      webhook.reads.length === 1 &&
      webhook.warned &&
      state(webhook.row) === "stopping" &&
      webhook.resumes.length === 0,
    webhook,
  );

  const unknown = await runWith({ desired: "running", observed: "running", stop: "unknown", caller: "client" });
  check(
    "a stop with an unknown form does not fail the wake, and the server runs",
    unknown.failure === null && !unknown.warned && state(unknown.row) === "running",
    unknown,
  );

  const finishing = await runWith({ desired: "running", observed: "running", stop: "pending", caller: "client" });
  check(
    "a stop that boat still does gets no resume, no command and no warning",
    finishing.resumes.length === 0 &&
      finishing.commands.length === 0 &&
      !finishing.warned &&
      state(finishing.row) === "stopping",
    finishing,
  );

  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
