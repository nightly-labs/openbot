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
const RUN_TIMEOUT_MS = 5 * 60_000;
const logger = createOpenBotLogger(NAME);

const instanceId = `wt-${createHash("sha256").update(`openbot:${NAME}:${ROOT}`).digest("hex")}`;
const profile = join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", instanceId));
const attemptsPath = join(profile, START_ATTEMPTS_FILE);
const databasePath = join(profile, "openbot.db");
const NEWER_SCHEMA_VERSION = 9999;
const LOOP_VERSION = "999.0.0";
let appVersion: string | null = null;

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

function editAttempts(change: (record: Attempts) => Attempts): void {
  const record = readAttempts();
  assert.ok(record, "the start attempts file is readable");
  writeFileSync(attemptsPath, `${JSON.stringify(change(record))}\n`);
}

function sqlite(statement: string): string {
  return execFileSync("sqlite3", [databasePath, statement], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function removeNewerSchemaRow(): void {
  try {
    sqlite(`DELETE FROM schema_migrations WHERE version = ${NEWER_SCHEMA_VERSION};`);
  } catch {}
}

function startStack(
  run: number,
  mode: RunReport["mode"],
  rendererStop: "first-load" | "recovery" | null = null,
): { child: ChildProcess; exit: Promise<number | null> } {
  const logFile = openSync(join(OUT, `run-${run}.log`), "w");
  const env: NodeJS.ProcessEnv = { ...process.env, OPENBOT_DEV_INSTANCE_ID: instanceId };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "none") delete env.OPENBOT_E2E_FORCE_START_FAILURE;
  else env.OPENBOT_E2E_FORCE_START_FAILURE = mode;
  if (rendererStop) env.OPENBOT_E2E_STOP_RENDERER = rendererStop;
  else delete env.OPENBOT_E2E_STOP_RENDERER;
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

function parentPid(pid: number): number | null {
  try {
    const parent = Number.parseInt(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }), 10);
    return Number.isInteger(parent) && parent > 1 ? parent : null;
  } catch {
    return null;
  }
}

function quitElectron(stackPid: number): void {
  const pid = Number.parseInt(readlinkSync(join(profile, "SingletonLock")).split("-").at(-1) ?? "", 10);
  assert.ok(Number.isInteger(pid) && pid > 1, "the profile lock names the Electron pid");
  let ancestor: number | null = pid;
  while (ancestor !== null && ancestor !== stackPid) ancestor = parentPid(ancestor);
  assert.equal(ancestor, stackPid, "the locked Electron belongs to this run");
  process.kill(pid, "SIGTERM");
}

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
let rendererStop: { firstLoadRetry: string; recoveryDialog: string } | null = null;
let passed = false;
let error: string | undefined;
const stack: { running: ReturnType<typeof startStack> | null } = { running: null };
try {
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
      const stackPid = stack.running.child.pid;
      assert.ok(stackPid, "the run has a pid");
      quitElectron(stackPid);
      await waitFor("run 3 records its quit", () => readAttempts()?.attempt?.state !== "starting", 60_000);
      stopStack();
    }
    const exitCode = await stack.running.exit;
    stack.running = null;
    const after = readAttempts();
    runs.push({ run, mode, exitCode, attemptsAfter: after });
    assert.equal(after?.attempt?.state, mode === "hang" ? "quitting" : "starting", `run ${run} left its attempt`);
  };

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
    const captured = join(ROOT, ".openbot-build", "dev-automation", `${NAME}-${name}`);
    automation(["screenshot", "--page=data:", `--out=${captured}`]);
    const screenshot = join(OUT, name);
    copyFileSync(captured, screenshot);
    return screenshot;
  };

  const choose = (label: string) => {
    try {
      automation(["click", "--page=data:", "--role=link", `--name=${label}`, "--allow-mutations"]);
    } catch (cause) {
      const output =
        cause instanceof Error && "stderr" in cause && "stdout" in cause ? `${cause.stdout}${cause.stderr}` : "";
      if (!output.includes("has been closed")) throw cause;
    }
  };

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

  const logLine = (run: number, text: string) =>
    readFileSync(join(OUT, `run-${run}.log`), "utf8")
      .split("\n")
      .find((line) => line.includes(text)) ?? null;

  editAttempts((record) => ({
    ...record,
    consecutiveFailures: 0,
    lastFailure: null,
    loopVersion: null,
    attempt: null,
  }));
  const firstLoadStartedAt = Date.now();
  stack.running = startStack(8, "none", "first-load");
  await waitFor("run 8 records its attempt", () => startedAfter(firstLoadStartedAt));
  const firstLoad = await waitFor("run 8 finishes its start after its first renderer stopped", () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null ? attempts : null;
  });
  assert.equal(firstLoad.consecutiveFailures, 0, "a start that loads on the second try is not a failure");
  assert.ok(logLine(8, "The main window renderer stopped."), "the log records the renderer exit");
  const firstLoadRetry = logLine(8, "The main window did not load (attempt 1 of 3). Loading it again.");
  assert.ok(firstLoadRetry, "the first load is tried again");
  stopStack();
  runs.push({ run: 8, mode: "none", exitCode: await stack.running.exit, attemptsAfter: readAttempts() });
  stack.running = null;

  editAttempts((record) => ({
    ...record,
    consecutiveFailures: 3,
    lastFailure: "error",
    loopVersion: record.appVersion,
    attempt: null,
  }));
  const dialogStartedAt = Date.now();
  stack.running = startStack(9, "none", "recovery");
  const dialogBegun = await waitFor("run 9 records its attempt", () => startedAfter(dialogStartedAt));
  assert.equal(dialogBegun.consecutiveFailures, 3, "run 9 starts in the start loop");
  const recoveryDialog = await waitFor(
    "the recovery dialog replaces the recovery window that cannot show",
    () => logLine(9, "Showing the recovery dialog."),
    60_000,
  );
  assert.equal(readAttempts()?.attempt?.state, "starting", "the start waits for the choice in the dialog");
  rendererStop = { firstLoadRetry, recoveryDialog };
  stopStack();
  runs.push({ run: 9, mode: "none", exitCode: await stack.running.exit, attemptsAfter: readAttempts() });
  stack.running = null;
  editAttempts((record) => ({
    ...record,
    consecutiveFailures: 0,
    lastFailure: null,
    loopVersion: null,
    attempt: null,
  }));
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
      {
        passed,
        appVersion,
        schemaVersion: LATEST_SCHEMA_VERSION,
        instanceId,
        runs,
        recovery,
        newerData,
        rendererStop,
        error,
      },
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
