// Runs the real account server hosted-server service on a migrated SQLite database, with a boat API
// that answers a start in each of its ways. boat can keep a stopped machine in memory and continue it
// with no boot (`"status": "running"`). Then the flag of the pre-stop hook stays in /run and OpenBot
// does not start, so the Worker must run the command that removes the flag. A start with a boot
// (`"status": "resuming"`) and a refused start must not run a command, and a failed command must not
// fail the wake. The command runs after the wake reply.
//
// Run: bun run test:hosted-held-resume
// It writes .openbot-build/hosted-held-resume-e2e/report.json and exits non-zero on a failure.
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
const OUT = join(ROOT, ".openbot-build", "hosted-held-resume-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const SERVER_ID = "server-1";
const SANDBOX_ID = "bx_1";
const OWNER = { id: "owner", email: "owner@example.test", name: null, avatarUrl: null, analyticsEnabled: null };
const FLAG = "/run/openbot-pre-stop";

type ResumeAnswer = "running" | "resuming" | "conflict";
type CommandAnswer = "started" | "nothing" | "unavailable" | "failed";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function wakeWith(resume: ResumeAnswer, command: CommandAnswer) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const now = Date.UTC(2026, 9, 20, 12);
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);
  database
    .prepare(
      `INSERT INTO hosted_servers(
         server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency,
         desired_state, observed_state, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, 'Cloud server', ?, 'small', 'starter', 'month', 'eur', 'idle', 'stopped', 'key-1', 1, ?)`,
    )
    .run(SERVER_ID, OWNER.id, SANDBOX_ID, now - 10 * 60_000);

  const calls: { method: string; path: string; body: unknown }[] = [];
  // The command waits until the wake has its reply, as a slow boat command would.
  let release = () => {};
  const replied = new Promise<void>((resolve) => {
    release = resolve;
  });
  let commandEnded = false;
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? "GET", path, body });
    if (path.endsWith("/resume")) {
      if (resume === "conflict") return Response.json({ ok: false, code: "already_running" }, { status: 409 });
      return Response.json({
        ok: true,
        status: resume,
        sandbox: { id: SANDBOX_ID, state: resume === "running" ? "running" : "provisioned" },
      });
    }
    if (path.endsWith("/commands")) {
      await replied;
      commandEnded = true;
      if (command === "unavailable") return Response.json({ ok: false, code: "sandbox_not_ready" }, { status: 503 });
      return Response.json({
        ok: true,
        type: "command.finished",
        exitCode: command === "failed" ? 1 : 0,
        stdout: command === "started" ? "started\n" : "",
        stderr: command === "failed" ? "sudo: a password is required\n" : "",
      });
    }
    return Response.json({ ok: true, sandbox: { id: SANDBOX_ID, state: "archived" } });
  };
  const service = new HostedServerService(
    { DB: sqliteD1(database), HOSTED_SERVERS_ENABLED: "true", BOAT_API_KEY: "boat-key" },
    { fetch: boatFetch, now: () => now, schedule: (work) => scheduled.push(Effect.runPromise(work)) },
  );
  const scheduled: Promise<void>[] = [];
  // A wake that waits for the command never gets its reply; the time limit ends that wait.
  const wake = Effect.runPromise(service.wake(OWNER, SERVER_ID));
  const first = await Promise.race([wake, delay(5_000).then(() => null)]);
  const replyBeforeCommand = first !== null && !commandEnded;
  release();
  const reply = first ?? (await wake);
  await Promise.all(scheduled);
  const row = database
    .prepare("SELECT desired_state, observed_state, observed_error FROM hosted_servers WHERE server_id = ?")
    .get(SERVER_ID);
  const commands = calls.filter((call) => call.path.endsWith("/commands"));
  return {
    reply: { state: reply.state, error: reply.error },
    replyBeforeCommand,
    row,
    calls: calls.map((c) => `${c.method} ${c.path}`),
    commands,
  };
}

function commandClearsOnlyTheFlag(commands: { path: string; body: unknown }[]) {
  const body = commands[0]?.body;
  if (!isDynamicRecord(body)) return false;
  const text = isString(body.command) ? body.command : "";
  return (
    commands.length === 1 &&
    commands[0]?.path === `/sandboxes/${SANDBOX_ID}/commands` &&
    text.startsWith(`if [ -e ${FLAG} ]; then `) &&
    text.includes(`sudo -n rm -f ${FLAG}`) &&
    text.includes("sudo -n systemctl start --no-block openbot.service") &&
    typeof body.timeoutSeconds === "number" &&
    body.timeoutSeconds <= 15
  );
}

let passed = false;
try {
  const held = await wakeWith("running", "started");
  check("a start from memory runs the flag command once", commandClearsOnlyTheFlag(held.commands), held);
  check("the wake replies before the command ends", held.replyBeforeCommand, held);
  check(
    "a start from memory leaves the server waking with no error",
    held.reply.state === "waking" && held.reply.error === null && held.row?.desired_state === "running",
    held,
  );

  const heldNoFlag = await wakeWith("running", "nothing");
  check(
    "a start from memory with no flag is still a normal wake",
    heldNoFlag.commands.length === 1 && heldNoFlag.reply.state === "waking" && heldNoFlag.reply.error === null,
    heldNoFlag,
  );

  const booted = await wakeWith("resuming", "started");
  check(
    "a start with a boot runs no command",
    booted.commands.length === 0 && booted.reply.state === "waking" && booted.reply.error === null,
    booted,
  );

  const unavailable = await wakeWith("running", "unavailable");
  check(
    "a refused command does not fail the wake",
    unavailable.commands.length === 1 && unavailable.reply.state === "waking" && unavailable.reply.error === null,
    unavailable,
  );

  const failed = await wakeWith("running", "failed");
  check(
    "a failed command does not fail the wake",
    failed.commands.length === 1 && failed.reply.state === "waking" && failed.reply.error === null,
    failed,
  );

  const conflict = await wakeWith("conflict", "started");
  check(
    "a start that boat refuses as already running runs no command",
    conflict.commands.length === 0 && conflict.reply.error === null,
    conflict,
  );

  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
