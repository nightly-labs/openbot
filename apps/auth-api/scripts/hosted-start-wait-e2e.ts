// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that refuses starts with a rate limit (#2229). The server must stay `waking` with `provider_limit`,
// and the start must go again after a growing delay, from a client wake and from the cron. Then it runs
// the shared client wake helper: a client waits while the machine starts, and only the host start of a
// running machine has a time limit.
//
// Run: bun run test:hosted-start-wait
// It writes .openbot-build/hosted-start-wait-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type HostedServerSummary, parseHostedServerSummary } from "@openbot/contracts/hosted-servers";
import {
  createHostedServerWake,
  HOSTED_HOST_READY_LIMIT_MS,
  hostedStartStep,
  WAKE_RECONNECT_DELAY_MS,
} from "@openbot/team-client/hosted-server-wake";
import { Effect } from "effect";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-start-wait-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SERVER_ID = "server-1";
const SANDBOX_ID = "bx_1";
const OWNER = { id: "owner", email: "owner@example.test", name: null, avatarUrl: null, analyticsEnabled: null };
const SECOND = 1_000;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function workerRetriesRateLimitedStart() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const { readdirSync, readFileSync } = await import("node:fs");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const t0 = Date.UTC(2026, 9, 16, 12);
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

  const calls: string[] = [];
  let refusals = 4;
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    calls.push(`${init.method ?? "GET"} ${path}`);
    if (path.endsWith("/resume")) {
      if (refusals > 0) {
        refusals -= 1;
        return Response.json({ ok: false, code: "rate_limited" }, { status: 429 });
      }
      return Response.json({ ok: true });
    }
    // A provider read during the wait would see the stopped sandbox.
    return Response.json({ ok: true, sandbox: { id: SANDBOX_ID, state: "archived" } });
  };
  const service = new HostedServerService(
    { DB: sqliteD1(database), HOSTED_SERVERS_ENABLED: "true", BOAT_API_KEY: "boat-key" },
    { fetch: boatFetch, now: () => clock.now },
  );
  const row = () => {
    const value = database
      .prepare("SELECT observed_state, observed_error, provider_event_at, updated_at FROM hosted_servers")
      .get();
    return {
      observed_state: value?.observed_state,
      observed_error: value?.observed_error,
      provider_event_at: value?.provider_event_at,
      updated_at: value?.updated_at,
    };
  };
  const resumes = () => calls.filter((call) => call.endsWith("/resume")).length;
  const wake = (at: number) => {
    clock.now = at;
    return Effect.runPromise(service.wake(OWNER, SERVER_ID));
  };
  const tick = (at: number) => {
    clock.now = at;
    return Effect.runPromise(service.tick(at));
  };

  const first = await wake(t0);
  check(
    "a refused start stays waking with provider_limit",
    first.state === "waking" && first.error === "provider_limit",
    {
      reply: { state: first.state, error: first.error },
      row: row(),
    },
  );
  check("the first wake sends one start", resumes() === 1, calls);

  const early = await wake(t0 + 10 * SECOND);
  check("a wake before the delay sends no start", resumes() === 1 && early.error === "provider_limit", calls);

  await tick(t0 + 20 * SECOND);
  check("the cron before the delay sends no start", resumes() === 1, calls);

  await tick(t0 + 31 * SECOND);
  check("the cron sends the start again after 30 seconds", resumes() === 2, calls);
  const afterCron = row();
  check(
    "a second refusal keeps the wake time and the state",
    afterCron.observed_state === "waking" &&
      afterCron.observed_error === "provider_limit" &&
      afterCron.provider_event_at === t0,
    afterCron,
  );

  await wake(t0 + 50 * SECOND);
  check("the delay grows: a wake 19 seconds after the refusal sends no start", resumes() === 2, calls);

  await wake(t0 + 62 * SECOND);
  check("a wake after the delay sends the start again", resumes() === 3, calls);
  await tick(t0 + 124 * SECOND);
  check("the cron sends it again after the doubled delay", resumes() === 4, calls);

  // The next start is due at 248 seconds. At 246 seconds the start waits longer than the stuck-start
  // check, which must not read boat and mark the server stopped.
  await tick(t0 + 246 * SECOND);
  check("the cron waits for the delay", resumes() === 4, calls);
  check(
    "the cron does not read the provider of a rate-limited start",
    calls.every((call) => !call.startsWith("GET ")) && row().observed_state === "waking",
    { calls, row: row() },
  );

  const last = await wake(t0 + 250 * SECOND);
  const started = row();
  check(
    "the start that boat accepts clears the error",
    resumes() === 5 && started.observed_state === "waking" && started.observed_error === null,
    { calls, row: started },
  );
  check("the wake reply has no error after the start", last.state === "waking" && last.error === null, {
    state: last.state,
    error: last.error,
  });
  database.close();
  return first;
}

async function clientWaitsWhileServerStarts(template: HostedServerSummary) {
  const clock = { now: Date.UTC(2026, 9, 16, 12) };
  let state: HostedServerSummary["state"] = "waking";
  const wake = createHostedServerWake(
    () =>
      Effect.succeed({
        ok: true,
        status: 200,
        json: async () => ({ ...template, state, error: null }),
      }),
    () => clock.now,
  );
  const reply = () => Effect.runPromise(wake(SERVER_ID));

  // 10 minutes of a machine that starts: more than the 60 replies that ended the wait before.
  let machine = true;
  for (let index = 0; index < 120; index += 1) {
    machine &&= await reply();
    clock.now += WAKE_RECONNECT_DELAY_MS;
  }
  check("the client keeps waiting for 10 minutes while the machine starts", machine);

  state = "running";
  const runningAt = clock.now;
  let host = true;
  while (clock.now - runningAt < HOSTED_HOST_READY_LIMIT_MS) {
    host &&= await reply();
    clock.now += WAKE_RECONNECT_DELAY_MS;
  }
  check("the client waits for the host of a running machine up to the limit", host);
  check("the client stops waiting when the host did not connect in the limit", !(await reply()));

  const steps = {
    waking: hostedStartStep({ state: "waking", error: null }),
    rateLimited: hostedStartStep({ state: "waking", error: "provider_limit" }),
    running: hostedStartStep({ state: "running", error: null }),
    stopping: hostedStartStep({ state: "stopping", error: null }),
    stopped: hostedStartStep({ state: "stopped", error: null }),
    stoppedFailed: hostedStartStep({ state: "stopped", error: "provider_error" }),
    failed: hostedStartStep({ state: "error", error: "provider_limit" }),
    planEnded: hostedStartStep({ state: "stopping", error: "plan_ended" }),
  };
  check(
    "the start step follows the account server state",
    steps.waking === "machine" &&
      steps.rateLimited === "provider_limit" &&
      steps.running === "openbot" &&
      steps.stopping === "machine" &&
      steps.stopped === "machine" &&
      steps.stoppedFailed === null &&
      steps.failed === null &&
      steps.planEnded === null,
    steps,
  );
}

let passed = false;
try {
  const reply = await workerRetriesRateLimitedStart();
  const template = parseHostedServerSummary(reply);
  assert.ok(template, "The wake reply is not a hosted server summary.");
  await clientWaitsWhileServerStarts(template);
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
