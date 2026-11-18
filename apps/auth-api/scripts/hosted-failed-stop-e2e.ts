// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that answers as after a stop that it cancelled. boat runs the pre-stop hook, which stops OpenBot and
// makes the flag in /run, and then it can cancel the stop, for example when it cannot pause a Docker
// container that restarts. The sandbox then runs with OpenBot stopped. A client or a connector that
// cannot reach such a server must make the Worker run the command that starts OpenBot for an old flag.
// A server that boat still stops must not get the command, and a failed command must not fail the wake.
// The command runs after the reply.
//
// Run: bun run test:hosted-failed-stop
// It writes .openbot-build/hosted-failed-stop-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { HostedServerService } from "../src/server/hosted-server-service";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-failed-stop-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SERVER_ID = "server-1";
const SANDBOX_ID = "bx_1";
const OWNER = {
  id: "owner",
  email: "owner@example.test",
  name: null,
  avatarUrl: null,
  analyticsEnabled: null,
  chatColor: null,
};
const FLAG = "/run/openbot-pre-stop";

/** The state that boat reports for the sandbox. `idle` after a cancelled stop, `archiving` during a stop. */
type SandboxAnswer = "idle" | "archiving";
type CommandAnswer = "started" | "nothing" | "unavailable" | "failed";
type Caller = "client" | "connector";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function reachWith(options: {
  desired: "running" | "idle";
  sandbox: SandboxAnswer;
  command: CommandAnswer;
  caller?: Caller;
}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const now = Date.UTC(2026, 10, 5, 17);
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  database
    .prepare(
      `INSERT INTO hosted_servers(
         server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
         desired_state, observed_state, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, 'Cloud server', ?, 'small', 'starter', 'month', 'eur', ?, 'running', 'key-1', 1, ?)`,
    )
    .run(SERVER_ID, OWNER.id, SANDBOX_ID, options.desired, now - 10 * 60_000);

  const calls: { method: string; path: string; body: unknown }[] = [];
  // The command waits until the caller has its reply, as a slow boat command would.
  let release = () => {};
  const replied = new Promise<void>((resolve) => {
    release = resolve;
  });
  let commandEnded = false;
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? "GET", path, body });
    if (path.endsWith("/commands")) {
      await replied;
      commandEnded = true;
      if (options.command === "unavailable") {
        return Response.json({ ok: false, code: "sandbox_not_ready" }, { status: 503 });
      }
      return Response.json({
        ok: true,
        type: "command.finished",
        exitCode: options.command === "failed" ? 1 : 0,
        stdout: options.command === "started" ? "started\n" : "",
        stderr: options.command === "failed" ? "sudo: a password is required\n" : "",
      });
    }
    if (path.endsWith("/resume")) return Response.json({ ok: false, code: "already_running" }, { status: 409 });
    return Response.json({ ok: true, sandbox: { id: SANDBOX_ID, state: options.sandbox } });
  };
  const scheduled: Promise<void>[] = [];
  const service = new HostedServerService(
    { DB: sqliteD1(database), HOSTED_SERVERS_ENABLED: "true", BOAT_API_KEY: "boat-key" },
    { fetch: boatFetch, now: () => now, schedule: (work) => scheduled.push(Effect.runPromise(work)) },
  );
  // A call that waits for the command never gets its reply; the time limit ends that wait.
  const reach = Effect.runPromise(
    options.caller === "connector" ? service.startForRoute(SERVER_ID) : service.wake(OWNER, SERVER_ID),
  ).then(() => true);
  const first = await Promise.race([reach, delay(5_000).then(() => null)]);
  const replyBeforeCommand = first !== null && !commandEnded;
  release();
  await reach;
  await Promise.all(scheduled);
  const row = database
    .prepare("SELECT desired_state, observed_state, observed_error FROM hosted_servers WHERE server_id = ?")
    .get(SERVER_ID);
  return {
    replyBeforeCommand,
    row,
    calls: calls.map((call) => `${call.method} ${call.path}`),
    commands: calls.filter((call) => call.path.endsWith("/commands")),
  };
}

/** The command starts OpenBot only for a flag older than 5 minutes, and touches nothing else. */
function commandStartsOnlyForAnOldFlag(commands: { path: string; body: unknown }[]) {
  const body = commands[0]?.body;
  if (!isDynamicRecord(body)) return false;
  const text = isString(body.command) ? body.command : "";
  return (
    commands.length === 1 &&
    commands[0]?.path === `/sandboxes/${SANDBOX_ID}/commands` &&
    text.startsWith(`if find ${FLAG} -mmin +5 2>/dev/null | grep -q .; then `) &&
    text.includes(`sudo -n rm -f ${FLAG}`) &&
    text.includes("sudo -n systemctl start --no-block openbot.service") &&
    typeof body.timeoutSeconds === "number" &&
    body.timeoutSeconds <= 15
  );
}

let passed = false;
try {
  const cancelled = await reachWith({ desired: "running", sandbox: "idle", command: "started" });
  check(
    "a client wake after a cancelled stop runs the start command once",
    commandStartsOnlyForAnOldFlag(cancelled.commands),
    cancelled,
  );
  check("the wake replies before the command ends", cancelled.replyBeforeCommand, cancelled);
  check(
    "the server stays running with no error",
    isDynamicRecord(cancelled.row) &&
      cancelled.row.observed_state === "running" &&
      cancelled.row.observed_error === null,
    cancelled,
  );

  const sleeping = await reachWith({ desired: "idle", sandbox: "idle", command: "started" });
  check(
    "a wake of a sleeping server whose idle stop boat cancelled runs the start command",
    commandStartsOnlyForAnOldFlag(sleeping.commands) &&
      isDynamicRecord(sleeping.row) &&
      sleeping.row.desired_state === "running",
    sleeping,
  );

  const connector = await reachWith({ desired: "running", sandbox: "idle", command: "started", caller: "connector" });
  check(
    "a connector event after a cancelled stop runs the start command once",
    commandStartsOnlyForAnOldFlag(connector.commands),
    connector,
  );

  const noFlag = await reachWith({ desired: "running", sandbox: "idle", command: "nothing" });
  check(
    "a server with no old flag gets the command, which does nothing",
    noFlag.commands.length === 1 && isDynamicRecord(noFlag.row) && noFlag.row.observed_state === "running",
    noFlag,
  );

  const stopping = await reachWith({ desired: "running", sandbox: "archiving", command: "started" });
  check(
    "a server that boat still stops gets no command",
    stopping.commands.length === 0 && isDynamicRecord(stopping.row) && stopping.row.observed_state === "stopping",
    stopping,
  );

  const unavailable = await reachWith({ desired: "running", sandbox: "idle", command: "unavailable" });
  check(
    "a refused command does not fail the wake",
    unavailable.commands.length === 1 && unavailable.replyBeforeCommand,
    unavailable,
  );

  const failed = await reachWith({ desired: "running", sandbox: "idle", command: "failed" });
  check("a failed command does not fail the wake", failed.commands.length === 1 && failed.replyBeforeCommand, failed);

  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
