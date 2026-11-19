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
const RUN_TIMEOUT_MS = 5 * 60_000;
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
  safeMode: boolean;
  attemptsAfter: Attempts | null;
  haltAfter: Halt | null;
}

function readAttempts(): Attempts | null {
  try {
    return Option.getOrNull(decodeAttempts(JSON.parse(readFileSync(attemptsPath, "utf8"))));
  } catch {
    return null;
  }
}

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
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "crash") env.OPENBOT_E2E_FORCE_START_FAILURE = mode;
  else delete env.OPENBOT_E2E_FORCE_START_FAILURE;
  const child = spawn("bun", ["run", "dev"], { cwd: ROOT, env, stdio: ["ignore", logFile, logFile] });
  logPath = join(OUT, `run-${run}.log`);
  const exit = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  void exit.then(() => closeSync(logFile));
  return { child, exit };
}

let logPath: string | null = null;
const SAFE_MODE_ON = /\[server-safe-mode\] Safe mode is on \((start_failed|newer_database)\)/u;

function safeModeIsOn(): boolean {
  return logPath !== null && existsSync(logPath) && SAFE_MODE_ON.test(readFileSync(logPath, "utf8"));
}

function stopStack(): void {
  execFileSync("bun", ["run", "dev:stop"], { cwd: ROOT, stdio: "inherit" });
}

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

interface MigrationMarker {
  version: number;
  appliedAt: string;
}

const decodeMarkerRow = Schema.decodeUnknownOption(
  Schema.Struct({ version: Schema.Number, applied_at: Schema.String }),
);

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
  stampAgeMs: number | null;
  stageFails: boolean;
  stagedVersion: string;
  expected: { calls: string[]; exitCode: number; stampRefreshed: boolean };
}

interface CheckResult extends CheckCase {
  calls: string[];
  exitCode: number | null;
  stampRefreshed: boolean;
}

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

async function finishingRun(run: number): Promise<Attempts> {
  const startedAt = Date.now();
  stack.running = startStack(run, "none");
  const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
  appVersion ??= begun.appVersion;
  assert.equal(existsSync(haltPath), false, `run ${run} removed the reason file`);
  const finished = await waitFor(`run ${run} finishes its start`, () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null ? attempts : null;
  });
  assert.equal(finished.consecutiveFailures, 0, `run ${run} clears the count`);
  stopStack();
  const exitCode = await stack.running.exit;
  stack.running = null;
  runs.push({ run, mode: "none", exitCode, safeMode: false, attemptsAfter: readAttempts(), haltAfter: readHalt() });
  return begun;
}

async function endingRun(run: number, mode: Mode, expectedFailures: number): Promise<RunReport> {
  const startedAt = Date.now();
  if (mode === "migration") brokenMigration = breakLatestMigration();
  stack.running = startStack(run, mode);
  const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
  assert.equal(begun.appVersion, appVersion, `run ${run} has the version of run 0`);
  assert.equal(begun.consecutiveFailures, expectedFailures, `run ${run} counts the earlier failures`);
  const running = stack.running;
  let exited = false;
  void running.exit.then(() => {
    exited = true;
  });
  await waitFor(`run ${run} ends or runs the safe mode`, () => exited || safeModeIsOn());
  const safeMode = !exited;
  if (safeMode) stopStack();
  const exitCode = await running.exit;
  stack.running = null;
  if (brokenMigration) {
    repairLatestMigration(brokenMigration);
    brokenMigration = null;
  }
  const report: RunReport = { run, mode, exitCode, safeMode, attemptsAfter: readAttempts(), haltAfter: readHalt() };
  runs.push(report);
  return report;
}

function assertHalted(report: RunReport, message: string): void {
  assert.ok(report.safeMode || report.exitCode === START_LOOP_EXIT_CODE, message);
}

async function migrationFailureWithoutHalt(run: number, expectedFailures: number): Promise<void> {
  const { exitCode, safeMode } = await endingRun(run, "migration", expectedFailures);
  assert.equal(safeMode, false, `run ${run}: no safe mode`);
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

  for (const path of [attemptsPath, `${attemptsPath}.tmp`, haltPath, `${haltPath}.tmp`]) rmSync(path, { force: true });

  await finishingRun(0);
  assert.ok(appVersion, "run 0 gave the app version");
  const version: string = appVersion;

  await migrationFailureWithoutHalt(1, 0);
  await migrationFailureWithoutHalt(2, 1);
  await endingRun(3, "crash", 2);
  assert.equal(existsSync(haltPath), false, "a crash writes no reason file");

  assertHalted(await endingRun(4, "none", 3), "the halted start runs the safe mode or exits with 78");
  assertHalt("start_failed", version);
  const afterHalt = readAttempts();
  assert.equal(afterHalt?.attempt?.state, "quitting", "the halt is not a failed start");
  assert.equal(afterHalt?.consecutiveFailures, 3);

  await finishingRun(5);

  await endingRun(6, "crash", 0);
  await endingRun(7, "crash", 1);
  assertHalted(await endingRun(8, "migration", 2), "a failed migration as the third failure stops the loop");
  assertHalt("start_failed", version);
  assert.equal(readAttempts()?.attempt?.state, "failed", "the third failure counts");

  await finishingRun(9);

  setNewerDatabase(true);
  newerDatabase = true;
  assertHalted(await endingRun(10, "none", 0), "data from a newer version stops the loop at once");
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
