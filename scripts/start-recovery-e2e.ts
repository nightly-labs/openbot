// Starts the real desktop app of this worktree with `bun run dev` and makes its start fail, to check
// the start-loop recovery (`src/main/start-attempts.ts`, `src/main/start-recovery-window.ts`).
//
// Run: bun scripts/start-recovery-e2e.ts
// Stop this worktree's own dev stack first: the script starts and stops the stack five times.
//
// The runs use their own dev profile (`OpenBot Dev wt-<hash of "start-recovery-e2e" and this path>`),
// so the worktree's normal dev data does not change. `OPENBOT_E2E_FORCE_START_FAILURE` makes a run
// fail; a packaged app ignores it.
// 1. crash: the main process crashes before the database opens. Failure 1.
// 2. crash: failure 2.
// 3. hang, then one SIGTERM to its Electron: a quit during the start. The count stays at 2.
// 4. crash: failure 3.
// 5. no flag: the recovery window shows before the start. "Try again" continues the start, and the
//    finished start clears the count.
// It writes .openbot-build/start-recovery-e2e/report.json and recovery-window.png, and exits
// non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
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
// `app.getVersion()` of the app. A dev build gives the Electron version, so the first run sets it.
let appVersion: string | null = null;

// The fields of `openbot-start-attempts-v1.json` that the test reads.
const AttemptsFile = Schema.Struct({
  appVersion: Schema.String,
  consecutiveFailures: Schema.Number,
  lastFailure: Schema.NullOr(Schema.String),
  lastGoodVersion: Schema.NullOr(Schema.String),
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
let recovery: { locale: string; snapshot: string; screenshot: string } | null = null;
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
    assert.equal(begun.appVersion, appVersion, `run ${run} has the version of run 1`);
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

  await failingRun(1, "crash", 0);
  await failingRun(2, "crash", 1);
  await failingRun(3, "hang", 2);
  await failingRun(4, "crash", 2);

  // Run 5: three failures, so the recovery window shows before the start.
  const startedAt = Date.now();
  stack.running = startStack(5, "none");
  const begun = await waitFor("run 5 records its attempt", () => startedAfter(startedAt));
  assert.equal(begun.consecutiveFailures, 3, "a quit during the start did not count");
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
    "startup.recoveryPreviousVersion",
    "startup.recoveryExportDiagnostics",
    "startup.recoveryOpenDataFolder",
    "startup.recoveryQuit",
  ] as const)
    assert.ok(snapshot.includes(translate(key)), `the recovery window has ${key}`);
  // `dev:automation` writes screenshots only into its own build folder.
  const captured = join(ROOT, ".openbot-build", "dev-automation", `${NAME}-recovery-window.png`);
  automation(["screenshot", "--page=data:", `--out=${captured}`]);
  const screenshot = join(OUT, "recovery-window.png");
  copyFileSync(captured, screenshot);
  recovery = { locale, snapshot, screenshot };

  try {
    automation([
      "click",
      "--page=data:",
      "--role=link",
      `--name=${translate("startup.recoveryRetry")}`,
      "--allow-mutations",
    ]);
  } catch (cause) {
    // "Try again" closes the window, so the snapshot that `dev:automation` takes after the click
    // fails. The finished start below shows that the click worked.
    const output =
      cause instanceof Error && "stderr" in cause && "stdout" in cause ? `${cause.stdout}${cause.stderr}` : "";
    if (!output.includes("has been closed")) throw cause;
  }
  const finished = await waitFor("the start finishes after Try again", () => {
    const attempts = readAttempts();
    return attempts && attempts.attempt === null ? attempts : null;
  });
  assert.equal(finished.consecutiveFailures, 0, "a finished start clears the count");
  assert.equal(finished.lastGoodVersion, appVersion);
  stopStack();
  const exitCode = await stack.running.exit;
  stack.running = null;
  const after = readAttempts();
  runs.push({ run: 5, mode: "none", exitCode, attemptsAfter: after });
  assert.equal(after?.attempt, null, "a normal quit after the start leaves no attempt");
  assert.equal(after?.consecutiveFailures, 0);
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (stack.running) {
    stopStack();
    await stack.running.exit;
  }
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, appVersion, instanceId, runs, recovery, error }, null, 2)}\n`,
  );
  logger.info(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}`);
  if (!passed) {
    logger.error(error ?? "unknown failure");
    process.exitCode = 1;
  }
}
