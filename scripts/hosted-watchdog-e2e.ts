import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const NAME = "hosted-watchdog-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const LAUNCHER = join(ROOT, "scripts", "hosting", "openbot-hosted-server");
const INTERVAL_SECONDS = 1;
const LIMIT = 3;
const BEATS_BEFORE_FREEZE = 3;
const DEADLINE_MS = 60_000;
const HEARTBEAT_LOOP =
  'i=0; while :; do i=$((i + 1)); printf "%s\\n" "$i" >"$1.tmp" && /bin/mv -f "$1.tmp" "$1"; sleep 0.2; done';
const logger = createOpenBotLogger(NAME);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
symlinkSync("/bin/bash", join(OUT, "openbot"));
symlinkSync("/bin/bash", join(OUT, "not-openbot"));

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface Case {
  name: string;
  app: ChildProcess;
  appExit: Promise<Exit>;
  watchdog: ChildProcess;
  watchdogExit: Promise<Exit>;
  heartbeat: string;
  stderr: string[];
}

const exitOf = (child: ChildProcess): Promise<Exit> =>
  new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));

function withDeadline<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise((resolveValue, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not happen in ${DEADLINE_MS} ms.`)), DEADLINE_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveValue(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function startCase(name: string, binary: "openbot" | "not-openbot", beats: boolean): Case {
  const directory = join(OUT, name);
  mkdirSync(directory);
  const heartbeat = join(directory, "openbot-run-marker-v1.json");
  const pidFile = join(directory, "openbot.pid");
  writeFileSync(heartbeat, "previous run\n");
  const app = spawn(
    join(OUT, binary),
    ["-c", beats ? HEARTBEAT_LOOP : "while :; do sleep 0.2; done", binary, heartbeat],
    {
      stdio: "ignore",
    },
  );
  assert.ok(app.pid, `${name}: the fake app did not start.`);
  writeFileSync(pidFile, `${app.pid}\n`);
  const watchdog = spawn(LAUNCHER, ["--watchdog", pidFile, heartbeat, String(INTERVAL_SECONDS), String(LIMIT)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: string[] = [];
  watchdog.stderr?.setEncoding("utf8").on("data", (chunk: string) => stderr.push(chunk));
  return { name, app, appExit: exitOf(app), watchdog, watchdogExit: exitOf(watchdog), heartbeat, stderr };
}

async function beatsWritten(testCase: Case, count: number): Promise<void> {
  await withDeadline(
    new Promise<void>((resolveBeats) => {
      const check = setInterval(() => {
        const value = Number.parseInt(readFileSync(testCase.heartbeat, "utf8"), 10);
        if (Number.isInteger(value) && value >= count) {
          clearInterval(check);
          resolveBeats();
        }
      }, 50);
    }),
    `${testCase.name}: ${count} heartbeats`,
  );
}

const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

const healthy = startCase("healthy", "openbot", true);
const neverArmed = startCase("never-armed", "openbot", false);
const otherProcess = startCase("other-process", "not-openbot", true);
const frozen = startCase("frozen", "openbot", true);
const cases = [healthy, neverArmed, otherProcess, frozen];

try {
  await beatsWritten(otherProcess, BEATS_BEFORE_FREEZE);
  otherProcess.app.kill("SIGSTOP");
  await beatsWritten(frozen, BEATS_BEFORE_FREEZE);
  frozen.app.kill("SIGSTOP");

  const frozenExit = await withDeadline(frozen.appExit, "frozen: the watchdog kill");
  const frozenWatchdogExit = await withDeadline(frozen.watchdogExit, "frozen: the watchdog exit");
  const frozenMessage = frozen.stderr.join("");

  const later = startCase("frozen-later", "openbot", true);
  cases.push(later);
  await beatsWritten(later, BEATS_BEFORE_FREEZE);
  later.app.kill("SIGSTOP");
  const laterExit = await withDeadline(later.appExit, "frozen-later: the watchdog kill");
  assert.equal(laterExit.signal, "SIGKILL", "The watchdog did not kill the second frozen app with SIGKILL.");

  assert.equal(frozenExit.signal, "SIGKILL", "The watchdog did not kill the frozen app with SIGKILL.");
  assert.equal(frozenWatchdogExit.code, 0, "The watchdog did not exit with 0 after the kill.");
  assert.match(frozenMessage, /did not update its heartbeat for 3 seconds/u);
  assert.ok(alive(healthy.app), "The watchdog stopped an app that writes its heartbeat.");
  assert.ok(alive(neverArmed.app), "The watchdog stopped an app that never wrote a heartbeat in this run.");
  assert.ok(alive(otherProcess.app), "The watchdog stopped a process that is not openbot.");
  for (const testCase of [healthy, neverArmed, otherProcess])
    assert.ok(alive(testCase.watchdog), `${testCase.name}: the watchdog stopped.`);

  const report = {
    intervalSeconds: INTERVAL_SECONDS,
    limit: LIMIT,
    frozen: { appExit: frozenExit, watchdogExit: frozenWatchdogExit, message: frozenMessage.trim() },
    frozenLater: { appExit: laterExit },
    healthy: { appAlive: alive(healthy.app), beats: readFileSync(healthy.heartbeat, "utf8").trim() },
    neverArmed: { appAlive: alive(neverArmed.app) },
    otherProcess: { appAlive: alive(otherProcess.app) },
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`The hosted watchdog E2E test passed. Report: ${join(OUT, "report.json")}`);
} finally {
  for (const testCase of cases) {
    testCase.watchdog.kill("SIGKILL");
    testCase.app.kill("SIGKILL");
  }
}
