// Starts the real desktop app of this worktree with `bun run dev` as a server stops its start loop
// (`src/main/server-start-halt.ts`). Server mode needs a packaged Linux build, so the development-only
// `OPENBOT_E2E_SERVER_START_GUARD=1` turns on the server behavior of the start.
//
// Run: bun scripts/server-start-loop-e2e.ts
// Stop this worktree's own dev stack first: the script starts and stops the stack twelve times.
//
// First, bash runs the real `check` of scripts/hosting/openbot-hosted-update with a stub `systemctl`
// and `stage`: `openbot-update.timer` runs it each hour, it starts a stopped start loop again at each
// run, and it stages only about each 6 hours while OpenBot runs.
//
// Then the app. The runs use their own dev profile (`OpenBot Dev wt-<hash of "server-start-loop-e2e"
// and this path>`), so the worktree's normal dev data does not change. A "migration" run removes the
// marker of the latest migration and adds a trigger that refuses it again: the real migration runs,
// fails and rolls back. The test then puts the marker back.
// 0. A normal start, so that the profile has its database.
// 1-2. A migration fails: a failed start, and no halt.
// 3. The main process crashes before the database opens (`OPENBOT_E2E_FORCE_START_FAILURE=crash`).
// 4. No flag: three failures, so the server stops its start loop before the start. It exits with 78
//    and writes the reason `start_failed`. It does not count as a fourth failure.
// 5. No flag: the start after a halt tries once more. It removes the reason file and finishes.
// 6-7. Two crashes.
// 8. A migration fails: the third failure in a row, so the server stops its start loop at once.
// 9. No flag: the start after a halt tries once more and finishes.
// 10. The database has a migration version that is newer than this build: the server stops at once
//    with `newer_database`. The test then removes that version.
// 11. No flag: the start tries again and finishes.
// It writes .openbot-build/server-start-loop-e2e/report.json, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const MIGRATION_TRIGGER = "server_start_loop_e2e_refuse_marker";
const HOSTING = join(ROOT, "scripts", "hosting");
const HOUR_MS = 60 * 60_000;
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

type Mode = "crash" | "migration" | "none";
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
  if (mode === "crash") env.OPENBOT_E2E_FORCE_START_FAILURE = mode;
  else delete env.OPENBOT_E2E_FORCE_START_FAILURE;
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

/** The marker of the latest migration, which a "migration" run removes. */
interface MigrationMarker {
  version: number;
  appliedAt: string;
}

const decodeMarkerRow = Schema.decodeUnknownOption(
  Schema.Struct({ version: Schema.Number, applied_at: Schema.String }),
);

/** The real latest migration runs again at the next start, and the trigger makes it fail and roll back. */
function breakLatestMigration(): MigrationMarker {
  const database = new DatabaseSync(databasePath);
  try {
    const row = Option.getOrNull(
      decodeMarkerRow(
        database.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1").get(),
      ),
    );
    assert.ok(row, "the database has migrations");
    database.prepare("DELETE FROM schema_migrations WHERE version = ?").run(row.version);
    database.exec(
      `CREATE TRIGGER ${MIGRATION_TRIGGER} BEFORE INSERT ON schema_migrations WHEN NEW.version = ${row.version} BEGIN SELECT RAISE(ABORT, 'server-start-loop-e2e'); END`,
    );
    return { version: row.version, appliedAt: row.applied_at };
  } finally {
    database.close();
  }
}

function repairLatestMigration(marker: MigrationMarker): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`DROP TRIGGER IF EXISTS ${MIGRATION_TRIGGER}`);
    database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(marker.version, marker.appliedAt);
  } finally {
    database.close();
  }
}

interface CheckCase {
  name: string;
  activeState: string;
  execMainStatus: string;
  /** The age of the stage stamp, or null when there is none. */
  stampAgeMs: number | null;
  stageFails: boolean;
  /** The version that `staged_version` gives, or "" when no release is staged. */
  stagedVersion: string;
  expected: { calls: string[]; exitCode: number; stampRefreshed: boolean };
}

interface CheckResult extends CheckCase {
  calls: string[];
  exitCode: number | null;
  stampRefreshed: boolean;
}

/**
 * Runs the real `check` in bash with a stub `systemctl`, `stage` and `apply`. Sourcing the script
 * runs only its definitions.
 */
function runCheck(entry: CheckCase): CheckResult {
  const directory = mkdtempSync(join(tmpdir(), `${NAME}-`));
  try {
    const stamp = join(directory, "staged");
    const calls = join(directory, "calls");
    writeFileSync(calls, "");
    if (entry.stampAgeMs !== null) {
      writeFileSync(stamp, "");
      const time = new Date(Date.now() - entry.stampAgeMs);
      utimesSync(stamp, time, time);
    }
    const before = stampTime(stamp);
    const script = [
      'source "$1"',
      'STAGE_STAMP="$2"',
      'CALLS="$3"',
      "systemctl() {",
      '  case "$*" in',
      '    *ActiveState*) echo "$E2E_ACTIVE_STATE" ;;',
      '    *ExecMainStatus*) echo "$E2E_EXEC_MAIN_STATUS" ;;',
      '    *) echo "systemctl $*" >>"$CALLS" ;;',
      "  esac",
      "}",
      'stage() { echo stage >>"$CALLS"; [ "$E2E_STAGE_FAILS" = 0 ]; }',
      'apply() { echo apply >>"$CALLS"; }',
      'staged_version() { echo "$E2E_STAGED_VERSION"; }',
      "check",
    ].join("\n");
    const result = Bun.spawnSync(["bash", "-c", script, NAME, join(HOSTING, "openbot-hosted-update"), stamp, calls], {
      env: {
        PATH: process.env.PATH ?? "",
        E2E_ACTIVE_STATE: entry.activeState,
        E2E_EXEC_MAIN_STATUS: entry.execMainStatus,
        E2E_STAGE_FAILS: entry.stageFails ? "1" : "0",
        E2E_STAGED_VERSION: entry.stagedVersion,
      },
    });
    const after = stampTime(stamp);
    return {
      ...entry,
      calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      exitCode: result.exitCode,
      stampRefreshed: after !== null && after !== before,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stampTime(path: string): number | null {
  return existsSync(path) ? statSync(path).mtimeMs : null;
}

const START = "systemctl start --no-block openbot.service";
const CHECK_CASES: CheckCase[] = [
  {
    name: "start loop stopped, first run after a boot: stage and start",
    activeState: "failed",
    execMainStatus: "78",
    stampAgeMs: null,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: ["stage", START], exitCode: 0, stampRefreshed: true },
  },
  {
    name: "start loop stopped, staged 1 hour ago: stage and start again",
    activeState: "failed",
    execMainStatus: "78",
    stampAgeMs: HOUR_MS,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: ["stage", START], exitCode: 0, stampRefreshed: true },
  },
  {
    name: "start loop stopped, stage fails: start all the same, and fail",
    activeState: "failed",
    execMainStatus: "78",
    stampAgeMs: HOUR_MS,
    stageFails: true,
    stagedVersion: "",
    expected: { calls: ["stage", START], exitCode: 1, stampRefreshed: false },
  },
  {
    name: "start loop stopped, a release is staged: install it and start",
    activeState: "failed",
    execMainStatus: "78",
    stampAgeMs: HOUR_MS,
    stageFails: false,
    stagedVersion: "99.0.0",
    expected: { calls: ["stage", "apply", START], exitCode: 0, stampRefreshed: true },
  },
  {
    name: "running, staged 1 hour ago: nothing",
    activeState: "active",
    execMainStatus: "0",
    stampAgeMs: HOUR_MS,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: [], exitCode: 0, stampRefreshed: false },
  },
  {
    name: "running, staged 7 hours ago: stage only",
    activeState: "active",
    execMainStatus: "0",
    stampAgeMs: 7 * HOUR_MS,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: ["stage"], exitCode: 0, stampRefreshed: true },
  },
  {
    name: "stopped by hand (status 0): stage when due, no start",
    activeState: "inactive",
    execMainStatus: "0",
    stampAgeMs: null,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: ["stage"], exitCode: 0, stampRefreshed: true },
  },
  {
    name: "stopped by hand after the start loop stopped (inactive, 78): no start",
    activeState: "inactive",
    execMainStatus: "78",
    stampAgeMs: HOUR_MS,
    stageFails: false,
    stagedVersion: "",
    expected: { calls: [], exitCode: 0, stampRefreshed: false },
  },
];

/** `openbot-update.timer` runs `check` each hour, and `openbot-update.service` runs `check`. */
function checkTimerUnits(): { timer: string; service: string } {
  const timer = readFileSync(join(HOSTING, "openbot-update.timer"), "utf8");
  const service = readFileSync(join(HOSTING, "openbot-update.service"), "utf8");
  const interval = timer.match(/^OnUnitActiveSec=(.+)$/mu)?.[1];
  assert.equal(interval, "1h", "openbot-update.timer runs each hour");
  assert.match(service, /^ExecStart=\/opt\/OpenBot\/hosted\/openbot-hosted-update check$/mu);
  return { timer: interval, service: "check" };
}

mkdirSync(OUT, { recursive: true });
const runs: RunReport[] = [];
const checks: CheckResult[] = [];
let units: ReturnType<typeof checkTimerUnits> | null = null;
let brokenMigration: MigrationMarker | null = null;
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

/** A start that ends by itself: a forced crash, a failed migration, or a halt. */
async function endingRun(run: number, mode: Mode, expectedFailures: number): Promise<number | null> {
  const startedAt = Date.now();
  if (mode === "migration") brokenMigration = breakLatestMigration();
  stack.running = startStack(run, mode);
  const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
  assert.equal(begun.appVersion, appVersion, `run ${run} has the version of run 0`);
  assert.equal(begun.consecutiveFailures, expectedFailures, `run ${run} counts the earlier failures`);
  const exitCode = await stack.running.exit;
  stack.running = null;
  if (brokenMigration) {
    repairLatestMigration(brokenMigration);
    brokenMigration = null;
  }
  runs.push({ run, mode, exitCode, attemptsAfter: readAttempts(), haltAfter: readHalt() });
  return exitCode;
}

/** A migration fails before the third failure: a failed start, and the server does not stop its loop. */
async function migrationFailureWithoutHalt(run: number, expectedFailures: number): Promise<void> {
  const exitCode = await endingRun(run, "migration", expectedFailures);
  assert.notEqual(exitCode, START_LOOP_EXIT_CODE, `run ${run}: a failed migration alone does not stop the loop`);
  assert.equal(existsSync(haltPath), false, `run ${run} writes no reason file`);
  const attempts = readAttempts();
  assert.deepEqual(
    { state: attempts?.attempt?.state, failures: attempts?.consecutiveFailures },
    { state: "failed", failures: expectedFailures },
    `run ${run} is a failed start`,
  );
}

try {
  units = checkTimerUnits();
  for (const entry of CHECK_CASES) {
    const result = runCheck(entry);
    checks.push(result);
    assert.deepEqual(
      { calls: result.calls, exitCode: result.exitCode, stampRefreshed: result.stampRefreshed },
      entry.expected,
      `check: ${entry.name}`,
    );
  }

  // Only this test's files in this test's profile. The rest of the profile stays.
  for (const path of [attemptsPath, `${attemptsPath}.tmp`, haltPath, `${haltPath}.tmp`]) rmSync(path, { force: true });

  await finishingRun(0);
  assert.ok(appVersion, "run 0 gave the app version");
  const version: string = appVersion;

  await migrationFailureWithoutHalt(1, 0);
  await migrationFailureWithoutHalt(2, 1);
  await endingRun(3, "crash", 2);
  assert.equal(existsSync(haltPath), false, "a crash writes no reason file");

  const haltCode = await endingRun(4, "none", 3);
  assert.equal(haltCode, START_LOOP_EXIT_CODE, "the halted start exits with the start-loop status");
  assertHalt("start_failed", version);
  const afterHalt = readAttempts();
  assert.equal(afterHalt?.attempt?.state, "quitting", "the halt is not a failed start");
  assert.equal(afterHalt?.consecutiveFailures, 3);

  await finishingRun(5);

  await endingRun(6, "crash", 0);
  await endingRun(7, "crash", 1);
  const migrationHaltCode = await endingRun(8, "migration", 2);
  assert.equal(migrationHaltCode, START_LOOP_EXIT_CODE, "a failed migration as the third failure stops the loop");
  assertHalt("start_failed", version);
  assert.equal(readAttempts()?.attempt?.state, "failed", "the third failure counts");

  await finishingRun(9);

  setNewerDatabase(true);
  newerDatabase = true;
  const newerCode = await endingRun(10, "none", 0);
  assert.equal(newerCode, START_LOOP_EXIT_CODE, "data from a newer version stops the loop at once");
  assertHalt("newer_database", version);
  setNewerDatabase(false);
  newerDatabase = false;

  await finishingRun(11);
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
  if (brokenMigration) repairLatestMigration(brokenMigration);
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, appVersion, instanceId, units, checks, runs, error }, null, 2)}\n`,
  );
  logger.info(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}`);
  if (!passed) {
    logger.error(error ?? "unknown failure");
    process.exitCode = 1;
  }
}
