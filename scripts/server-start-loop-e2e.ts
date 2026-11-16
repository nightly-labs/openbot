// Starts the real desktop app of this worktree with `bun run dev` as a server stops its start loop
// (`src/main/server-start-halt.ts`). Server mode needs a packaged Linux build, so the development-only
// `OPENBOT_E2E_SERVER_START_GUARD=1` turns on the server behavior of the start.
//
// Run: bun scripts/server-start-loop-e2e.ts
// Stop this worktree's own dev stack first: the script starts and stops the stack eight times.
//
// The runs use their own dev profile (`OpenBot Dev wt-<hash of "server-start-loop-e2e" and this path>`),
// so the worktree's normal dev data does not change.
// 0. A normal start, so that the profile has its database.
// 1-3. The main process crashes before the database opens (`OPENBOT_E2E_FORCE_START_FAILURE=crash`).
// 4. No flag: three failures, so the server stops its start loop before the start. It exits with 78
//    and writes the reason `start_failed`. It does not count as a fourth failure.
// 5. No flag: the start after a halt tries once more. It removes the reason file and finishes.
// 6. The database has a migration version that is newer than this build: the server stops at once
//    with `newer_database`. The test then removes that version.
// 7. No flag: the start tries again and finishes.
// It writes .openbot-build/server-start-loop-e2e/report.json, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createOpenBotLogger } from "@openbot/logging";
import { Option, Schema } from "effect";
import { developmentUserDataName } from "../src/main/development-profile";
import { START_HALT_FILE, START_LOOP_EXIT_CODE } from "../src/main/server-start-halt";
import { START_ATTEMPTS_FILE } from "../src/main/start-attempts";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

const NAME = "server-start-loop-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const POLL_MS = 250;
// The first start of a stack can build the main bundle and seed the new profile.
const RUN_TIMEOUT_MS = 5 * 60_000;
// Far above each migration version that OpenBot can have.
const NEWER_DATABASE_VERSION = 999_999;
const logger = createOpenBotLogger(NAME);

const instanceId = `wt-${createHash("sha256").update(`openbot:${NAME}:${ROOT}`).digest("hex")}`;
const profile = join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", instanceId));
const attemptsPath = join(profile, START_ATTEMPTS_FILE);
const haltPath = join(profile, START_HALT_FILE);
const databasePath = join(profile, "openbot.db");

const AttemptsFile = Schema.Struct({
  appVersion: Schema.String,
  consecutiveFailures: Schema.Number,
  attempt: Schema.NullOr(Schema.Struct({ startedAt: Schema.Number, state: Schema.String })),
});
type Attempts = typeof AttemptsFile.Type;
const decodeAttempts = Schema.decodeUnknownOption(AttemptsFile);

// Exactly these keys: the reason file has fixed words, a version and a time only.
const HaltFile = Schema.Struct({
  version: Schema.Number,
  reason: Schema.String,
  appVersion: Schema.String,
  haltedAt: Schema.Finite,
});
type Halt = typeof HaltFile.Type;
const decodeHalt = Schema.decodeUnknownOption(HaltFile, { onExcessProperty: "error" });

type Mode = "crash" | "none";
interface RunReport {
  run: number;
  mode: Mode;
  exitCode: number | null;
  attemptsAfter: Attempts | null;
  /** The reason file after the run. */
  haltAfter: Halt | null;
}

function readAttempts(): Attempts | null {
  try {
    return Option.getOrNull(decodeAttempts(JSON.parse(readFileSync(attemptsPath, "utf8"))));
  } catch {
    return null;
  }
}

/** `null` when the file is missing, or when it is not exactly a reason file. */
function readHalt(): Halt | null {
  if (!existsSync(haltPath)) return null;
  const decoded = Option.getOrNull(decodeHalt(JSON.parse(readFileSync(haltPath, "utf8"))));
  assert.ok(decoded, "the reason file has only the expected keys and types");
  return decoded;
}

function assertHalt(reason: string, appVersion: string): void {
  const halt = readHalt();
  assert.ok(halt, "the server wrote its reason file");
  assert.deepEqual(
    { version: halt.version, reason: halt.reason, appVersion: halt.appVersion },
    { version: 1, reason, appVersion },
  );
}

async function waitFor<T>(what: string, read: () => T | null | undefined, timeoutMs = RUN_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

function startStack(run: number, mode: Mode): { child: ChildProcess; exit: Promise<number | null> } {
  const logFile = openSync(join(OUT, `run-${run}.log`), "w");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENBOT_DEV_INSTANCE_ID: instanceId,
    OPENBOT_E2E_SERVER_START_GUARD: "1",
  };
  // An Electron harness shell sets it, and Electron then starts as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "none") delete env.OPENBOT_E2E_FORCE_START_FAILURE;
  else env.OPENBOT_E2E_FORCE_START_FAILURE = mode;
  const child = spawn("bun", ["run", "dev"], { cwd: ROOT, env, stdio: ["ignore", logFile, logFile] });
  const exit = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  void exit.then(() => closeSync(logFile));
  return { child, exit };
}

function stopStack(): void {
  execFileSync("bun", ["run", "dev:stop"], { cwd: ROOT, stdio: "inherit" });
}

/** A new attempt of this run is on disk. */
function startedAfter(time: number): Attempts | null {
  const attempts = readAttempts();
  return attempts?.attempt && attempts.attempt.startedAt >= time ? attempts : null;
}

function setNewerDatabase(on: boolean): void {
  const database = new DatabaseSync(databasePath);
  try {
    if (on)
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(NEWER_DATABASE_VERSION, new Date().toISOString());
    else database.prepare("DELETE FROM schema_migrations WHERE version = ?").run(NEWER_DATABASE_VERSION);
  } finally {
    database.close();
  }
}

mkdirSync(OUT, { recursive: true });
const runs: RunReport[] = [];
let appVersion: string | null = null;
let passed = false;
let error: string | undefined;
let newerDatabase = false;
const stack: { running: ReturnType<typeof startStack> | null } = { running: null };

/** A start that finishes. The app then quits with `bun run dev:stop`. */
async function finishingRun(run: number): Promise<Attempts> {
  const startedAt = Date.now();
  stack.running = startStack(run, "none");
  const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
  appVersion ??= begun.appVersion;
  // The start after a halt removes the reason file before it continues.
  assert.equal(existsSync(haltPath), false, `run ${run} removed the reason file`);
  const finished = await waitFor(`run ${run} finishes its start`, () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null ? attempts : null;
  });
  assert.equal(finished.consecutiveFailures, 0, `run ${run} clears the count`);
  stopStack();
  const exitCode = await stack.running.exit;
  stack.running = null;
  runs.push({ run, mode: "none", exitCode, attemptsAfter: readAttempts(), haltAfter: readHalt() });
  return begun;
}

/** A start that ends by itself: a forced crash, or a halt. */
async function endingRun(run: number, mode: Mode, expectedFailures: number): Promise<number | null> {
  const startedAt = Date.now();
  stack.running = startStack(run, mode);
  const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
  assert.equal(begun.appVersion, appVersion, `run ${run} has the version of run 0`);
  assert.equal(begun.consecutiveFailures, expectedFailures, `run ${run} counts the earlier failures`);
  const exitCode = await stack.running.exit;
  stack.running = null;
  runs.push({ run, mode, exitCode, attemptsAfter: readAttempts(), haltAfter: readHalt() });
  return exitCode;
}

try {
  // Only this test's files in this test's profile. The rest of the profile stays.
  for (const path of [attemptsPath, `${attemptsPath}.tmp`, haltPath, `${haltPath}.tmp`]) rmSync(path, { force: true });

  await finishingRun(0);
  assert.ok(appVersion, "run 0 gave the app version");
  const version: string = appVersion;

  await endingRun(1, "crash", 0);
  await endingRun(2, "crash", 1);
  await endingRun(3, "crash", 2);
  assert.equal(existsSync(haltPath), false, "a crash writes no reason file");

  const haltCode = await endingRun(4, "none", 3);
  assert.equal(haltCode, START_LOOP_EXIT_CODE, "the halted start exits with the start-loop status");
  assertHalt("start_failed", version);
  const afterHalt = readAttempts();
  assert.equal(afterHalt?.attempt?.state, "quitting", "the halt is not a failed start");
  assert.equal(afterHalt?.consecutiveFailures, 3);

  await finishingRun(5);

  setNewerDatabase(true);
  newerDatabase = true;
  const newerCode = await endingRun(6, "none", 0);
  assert.equal(newerCode, START_LOOP_EXIT_CODE, "data from a newer version stops the loop at once");
  assertHalt("newer_database", version);
  setNewerDatabase(false);
  newerDatabase = false;

  await finishingRun(7);
  assert.equal(existsSync(haltPath), false);
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (stack.running) {
    stopStack();
    await stack.running.exit;
  }
  if (newerDatabase) setNewerDatabase(false);
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, appVersion, instanceId, runs, error }, null, 2)}\n`,
  );
  logger.info(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}`);
  if (!passed) {
    logger.error(error ?? "unknown failure");
    process.exitCode = 1;
  }
}
