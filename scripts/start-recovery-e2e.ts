// Starts the real desktop app of this worktree with `bun run dev` and makes its start fail, to check
// the start-loop recovery (`src/main/start-attempts.ts`, `src/main/start-recovery-window.ts`).
//
// Run: bun scripts/start-recovery-e2e.ts
// Stop this worktree's own dev stack first: the script starts and stops the stack eight times.
//
// The runs use their own dev profile (`OpenBot Dev wt-<hash of "start-recovery-e2e" and this path>`),
// so the worktree's normal dev data does not change. `OPENBOT_E2E_FORCE_START_FAILURE` makes a run
// fail; a packaged app ignores it.
// 0. no flag: a finished start records this version and its schema version as the last good start.
// 1. crash: the main process crashes before the database opens. Failure 1.
// 2. crash: failure 2.
// 3. hang, then one SIGTERM to its Electron: a quit during the start. The count stays at 2.
// 4. crash: failure 3.
// 5. no flag, and the file says that the last good version is 0.70.0 from an older build, which
//    did not record its schema. The released table says that 0.70.0 opens schema 61, less than the
//    database. The recovery window offers the latest version, not 0.70.0. "Quit" keeps the count.
// 6. no flag, and the file says that 0.70.0 opened this schema. The window offers 0.70.0. "Try
//    again" continues the start, and the finished start clears the count and the loop version.
// 7. no flag, with a schema row 9999 in the test profile's database and the loop version 999.0.0:
//    the newer data recovery does not offer 999.0.0 again. The script removes the row after the run.
// It writes .openbot-build/start-recovery-e2e/report.json, recovery-window-latest.png and
// recovery-window.png, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { TRANSLATED_LOCALES, translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { Option, Schema } from "effect";
import { LATEST_SCHEMA_VERSION } from "../src/backend/openbot-database-schema";
import { developmentUserDataName } from "../src/main/development-profile";
import { START_ATTEMPTS_FILE } from "../src/main/start-attempts";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

const NAME = "start-recovery-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const POLL_MS = 250;
// The first start of a stack can build the main bundle and seed the new profile.
const RUN_TIMEOUT_MS = 5 * 60_000;
const logger = createOpenBotLogger(NAME);

const instanceId = `wt-${createHash("sha256").update(`openbot:${NAME}:${ROOT}`).digest("hex")}`;
const profile = join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", instanceId));
const attemptsPath = join(profile, START_ATTEMPTS_FILE);
const databasePath = join(profile, "openbot.db");
// A schema version that no build has, for run 7.
const NEWER_SCHEMA_VERSION = 9999;
const LOOP_VERSION = "999.0.0";
// `app.getVersion()` of the app. A dev build gives the Electron version, so the first run sets it.
let appVersion: string | null = null;

// The fields of `openbot-start-attempts-v1.json`.
const AttemptsFile = Schema.Struct({
  version: Schema.Literal(1),
  appVersion: Schema.String,
  consecutiveFailures: Schema.Number,
  lastFailure: Schema.NullOr(Schema.String),
  lastGoodVersion: Schema.NullOr(Schema.String),
  lastGoodSchemaVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  loopVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  attempt: Schema.NullOr(
    Schema.Struct({
      startedAt: Schema.Number,
      state: Schema.String,
      failure: Schema.NullOr(Schema.String),
      osShutdown: Schema.Boolean,
    }),
  ),
});
type Attempts = typeof AttemptsFile.Type;
const decodeAttempts = Schema.decodeUnknownOption(AttemptsFile);

interface RunReport {
  run: number;
  mode: "crash" | "hang" | "none";
  exitCode: number | null;
  attemptsAfter: Attempts | null;
}

function readAttempts(): Attempts | null {
  try {
    return Option.getOrNull(decodeAttempts(JSON.parse(readFileSync(attemptsPath, "utf8"))));
  } catch {
    return null;
  }
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

/** Changes the start attempts file as an older or a newer build would have written it. */
function editAttempts(change: (record: Attempts) => Attempts): void {
  const record = readAttempts();
  assert.ok(record, "the start attempts file is readable");
  writeFileSync(attemptsPath, `${JSON.stringify(change(record))}\n`);
}

/** Runs one statement on the test profile's database, with the stack stopped. */
function sqlite(statement: string): string {
  return execFileSync("sqlite3", [databasePath, statement], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function removeNewerSchemaRow(): void {
  try {
    sqlite(`DELETE FROM schema_migrations WHERE version = ${NEWER_SCHEMA_VERSION};`);
  } catch {
    // No database yet.
  }
}

function startStack(run: number, mode: RunReport["mode"]): { child: ChildProcess; exit: Promise<number | null> } {
  const logFile = openSync(join(OUT, `run-${run}.log`), "w");
  const env: NodeJS.ProcessEnv = { ...process.env, OPENBOT_DEV_INSTANCE_ID: instanceId };
  // An Electron harness shell sets it, and Electron then starts as Node.
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "none") delete env.OPENBOT_E2E_FORCE_START_FAILURE;
  else env.OPENBOT_E2E_FORCE_START_FAILURE = mode;
  const child = spawn("bun", ["run", "dev"], { cwd: ROOT, env, stdio: ["ignore", logFile, logFile] });
  const exit = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  void exit.then(() => closeSync(logFile));
  return { child, exit };
}

function automation(args: string[]): string {
  return execFileSync("bun", ["run", "--silent", "dev:automation", ...args, `--instance=${instanceId}`], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
}

function stopStack(): void {
  execFileSync("bun", ["run", "dev:stop"], { cwd: ROOT, stdio: "inherit" });
}

/** The parent pid of a process, or null when it is gone. */
function parentPid(pid: number): number | null {
  try {
    const parent = Number.parseInt(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }), 10);
    return Number.isInteger(parent) && parent > 1 ? parent : null;
  } catch {
    return null;
  }
}

/**
 * Quits the Electron main process of this run as another app or a logout does: one SIGTERM.
 * `bun run dev:stop` signals the Electron group and electron-vite then forwards a second SIGTERM.
 * Chromium restores the default action after the first one, so the second one kills Electron
 * during its quit, which no user quit does. The pid comes from this run's profile lock, and the
 * test signals it only when it descends from the `bun run dev` that the test started.
 */
function quitElectron(stackPid: number): void {
  const pid = Number.parseInt(readlinkSync(join(profile, "SingletonLock")).split("-").at(-1) ?? "", 10);
  assert.ok(Number.isInteger(pid) && pid > 1, "the profile lock names the Electron pid");
  let ancestor: number | null = pid;
  while (ancestor !== null && ancestor !== stackPid) ancestor = parentPid(ancestor);
  assert.equal(ancestor, stackPid, "the locked Electron belongs to this run");
  process.kill(pid, "SIGTERM");
}

/** A new attempt of this run is on disk. */
function startedAfter(time: number): Attempts | null {
  const attempts = readAttempts();
  return attempts?.attempt && attempts.attempt.startedAt >= time ? attempts : null;
}

mkdirSync(OUT, { recursive: true });
const runs: RunReport[] = [];
let recovery: {
  locale: string;
  snapshot: string;
  screenshot: string;
  latestSnapshot: string;
  latestScreenshot: string;
} | null = null;
let newerData: string | null = null;
let passed = false;
let error: string | undefined;
// The stack of the current run, so that `finally` can stop it.
const stack: { running: ReturnType<typeof startStack> | null } = { running: null };
try {
  // Only this test's file in this test's profile. The rest of the profile stays.
  rmSync(attemptsPath, { force: true });
  rmSync(`${attemptsPath}.tmp`, { force: true });

  const failingRun = async (run: number, mode: "crash" | "hang", expectedFailures: number) => {
    const startedAt = Date.now();
    stack.running = startStack(run, mode);
    const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
    appVersion ??= begun.appVersion;
    assert.equal(begun.appVersion, appVersion, `run ${run} has the version of run 0`);
    assert.equal(begun.consecutiveFailures, expectedFailures, `run ${run} counts the earlier failures`);
    if (mode === "hang") {
      // The forced hang is after the attempt is written, so the start is still running here.
      const stackPid = stack.running.child.pid;
      assert.ok(stackPid, "the run has a pid");
      quitElectron(stackPid);
      await waitFor("run 3 records its quit", () => readAttempts()?.attempt?.state !== "starting", 60_000);
      // Electron wrote its sign. The rest of the stack can stop now.
      stopStack();
    }
    const exitCode = await stack.running.exit;
    stack.running = null;
    const after = readAttempts();
    runs.push({ run, mode, exitCode, attemptsAfter: after });
    assert.equal(after?.attempt?.state, mode === "hang" ? "quitting" : "starting", `run ${run} left its attempt`);
  };

  // Run 0: a finished start, so the database has this build's schema and the file has a good start.
  removeNewerSchemaRow();
  stack.running = startStack(0, "none");
  const first = await waitFor("run 0 finishes its start", () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null && attempts.lastGoodVersion !== null ? attempts : null;
  });
  appVersion = first.appVersion;
  assert.ok(existsSync(databasePath), "the start made the database");
  assert.equal(first.lastGoodVersion, appVersion);
  assert.equal(first.lastGoodSchemaVersion, LATEST_SCHEMA_VERSION, "a finished start records its schema version");
  assert.equal(first.loopVersion ?? null, null);
  stopStack();
  runs.push({ run: 0, mode: "none", exitCode: await stack.running.exit, attemptsAfter: readAttempts() });
  stack.running = null;

  await failingRun(1, "crash", 0);
  await failingRun(2, "crash", 1);
  await failingRun(3, "hang", 2);
  await failingRun(4, "crash", 2);

  /** Starts a run that shows the recovery window, and reads the window. */
  const windowRun = async (run: number) => {
    const startedAt = Date.now();
    const running = startStack(run, "none");
    stack.running = running;
    const begun = await waitFor(`run ${run} records its attempt`, () => startedAfter(startedAt));
    assert.equal(begun.consecutiveFailures, 3, "a quit during the start did not count");
    assert.equal(begun.loopVersion, appVersion, "three failures in a row record the loop version");
    const pages = await waitFor(
      "the recovery window",
      () => {
        try {
          const listed = automation(["pages"]);
          return listed.includes("data:") ? listed : null;
        } catch {
          return null;
        }
      },
      60_000,
    );
    assert.ok(!/localhost:\d+/.test(pages.replace(/data:[^\n]*/g, "")), "the main window waits for the choice");
    const snapshot = automation(["snapshot", "--page=data:"]);
    const locale = TRANSLATED_LOCALES.find((candidate) =>
      snapshot.includes(translateFor(candidate)("startup.recoveryTitle")),
    );
    assert.ok(locale, "the recovery window shows its title in a catalog language");
    const translate = translateFor(locale);
    for (const key of [
      "startup.recoveryRetry",
      "startup.recoveryExportDiagnostics",
      "startup.recoveryOpenDataFolder",
      "startup.recoveryQuit",
    ] as const)
      assert.ok(snapshot.includes(translate(key)), `the recovery window has ${key}`);
    return { locale, snapshot, translate, running };
  };

  const capture = (name: string): string => {
    // `dev:automation` writes screenshots only into its own build folder.
    const captured = join(ROOT, ".openbot-build", "dev-automation", `${NAME}-${name}`);
    automation(["screenshot", "--page=data:", `--out=${captured}`]);
    const screenshot = join(OUT, name);
    copyFileSync(captured, screenshot);
    return screenshot;
  };

  /** Clicks a link that closes the window. */
  const choose = (label: string) => {
    try {
      automation(["click", "--page=data:", "--role=link", `--name=${label}`, "--allow-mutations"]);
    } catch (cause) {
      // The choice closes the window, so the snapshot that `dev:automation` takes after the click
      // fails. The state that the test reads next shows that the click worked.
      const output =
        cause instanceof Error && "stderr" in cause && "stdout" in cause ? `${cause.stdout}${cause.stderr}` : "";
      if (!output.includes("has been closed")) throw cause;
    }
  };

  // Run 5: an older build wrote the file, so the last good version has no schema version.
  editAttempts(({ lastGoodSchemaVersion: _removed, ...record }) => ({ ...record, lastGoodVersion: "0.70.0" }));
  const latest = await windowRun(5);
  for (const key of ["startup.recoveryLatestVersion", "startup.recoveryHintLatest"] as const)
    assert.ok(latest.snapshot.includes(latest.translate(key)), `the window that offers the latest version has ${key}`);
  assert.ok(
    !latest.snapshot.includes(latest.translate("startup.recoveryPreviousVersion")),
    `it does not offer 0.70.0, which cannot open schema ${LATEST_SCHEMA_VERSION}`,
  );
  const latestScreenshot = capture("recovery-window-latest.png");
  choose(latest.translate("startup.recoveryQuit"));
  const quitExit = await latest.running.exit;
  stack.running = null;
  const afterQuit = readAttempts();
  runs.push({ run: 5, mode: "none", exitCode: quitExit, attemptsAfter: afterQuit });
  assert.equal(afterQuit?.attempt?.state, "quitting", "Quit in the window is a quit, not a failure");

  // Run 6: a build with this change opened this schema as 0.70.0.
  editAttempts((record) => ({ ...record, lastGoodSchemaVersion: LATEST_SCHEMA_VERSION }));
  const previous = await windowRun(6);
  for (const key of ["startup.recoveryPreviousVersion", "startup.recoveryHint"] as const)
    assert.ok(previous.snapshot.includes(previous.translate(key)), `the window that offers 0.70.0 has ${key}`);
  assert.ok(
    !previous.snapshot.includes(previous.translate("startup.recoveryLatestVersion")),
    "it does not offer the latest version",
  );
  recovery = {
    locale: previous.locale,
    snapshot: previous.snapshot,
    screenshot: capture("recovery-window.png"),
    latestSnapshot: latest.snapshot,
    latestScreenshot,
  };
  choose(previous.translate("startup.recoveryRetry"));
  const finished = await waitFor("the start finishes after Try again", () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null ? attempts : null;
  });
  assert.equal(finished.consecutiveFailures, 0, "a finished start clears the count");
  assert.equal(finished.lastGoodVersion, appVersion);
  assert.equal(finished.lastGoodSchemaVersion, LATEST_SCHEMA_VERSION);
  assert.equal(finished.loopVersion, null, "a finished start of the loop version clears it");
  stopStack();
  const exitCode = await previous.running.exit;
  stack.running = null;
  const after = readAttempts();
  runs.push({ run: 6, mode: "none", exitCode, attemptsAfter: after });
  assert.equal(after?.attempt, null, "a normal quit after the start leaves no attempt");
  assert.equal(after?.consecutiveFailures, 0);

  // Run 7: a newer build saved the data, and that build is the one that did not start.
  sqlite(`INSERT INTO schema_migrations (version, applied_at) VALUES (${NEWER_SCHEMA_VERSION}, datetime('now'));`);
  editAttempts((record) => ({ ...record, loopVersion: LOOP_VERSION }));
  const loopStartedAt = Date.now();
  const runLog = join(OUT, "run-7.log");
  stack.running = startStack(7, "none");
  const loopBegun = await waitFor("run 7 records its attempt", () => startedAfter(loopStartedAt));
  assert.equal(loopBegun.loopVersion, LOOP_VERSION, "a new start keeps the loop version");
  newerData = await waitFor(
    "the newer data recovery refuses the loop version",
    () => {
      const line = readFileSync(runLog, "utf8")
        .split("\n")
        .find((candidate) => candidate.includes(`OpenBot ${LOOP_VERSION} did not start. Not installing it.`));
      return line ?? null;
    },
    RUN_TIMEOUT_MS,
  );
  // The dialog is native, so the stack stops here.
  stopStack();
  const loopExit = await stack.running.exit;
  stack.running = null;
  runs.push({ run: 7, mode: "none", exitCode: loopExit, attemptsAfter: readAttempts() });
  removeNewerSchemaRow();
  assert.equal(
    sqlite(`SELECT COUNT(*) FROM schema_migrations WHERE version = ${NEWER_SCHEMA_VERSION};`),
    "0",
    "the test removed its schema row",
  );
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (stack.running) {
    stopStack();
    await stack.running.exit;
  }
  removeNewerSchemaRow();
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify(
      { passed, appVersion, schemaVersion: LATEST_SCHEMA_VERSION, instanceId, runs, recovery, newerData, error },
      null,
      2,
    )}\n`,
  );
  logger.info(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}`);
  if (!passed) {
    logger.error(error ?? "unknown failure");
    process.exitCode = 1;
  }
}
