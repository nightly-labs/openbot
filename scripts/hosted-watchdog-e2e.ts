import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";

const NAME = "hosted-watchdog-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const LAUNCHER = join(ROOT, "scripts", "hosting", "openbot-hosted-server");
const RUN_MARKER = "openbot-run-marker-v1.json";
const START_ATTEMPTS = "openbot-start-attempts-v1.json";
const INTERVAL_SECONDS = 1;
const LIMIT = 3;
const BEATS_BEFORE_FREEZE = 3;
const DEADLINE_MS = 60_000;
const POLL_MS = 50;
const HEARTBEAT_LOOP =
  'i=0; while :; do i=$((i + 1)); printf \'{"state":"%s","beat":%s}\\n\' "$2" "$i" >"$1.tmp" && /bin/mv -f "$1.tmp" "$1"; sleep 0.2; done';
const IDLE_LOOP = "while :; do sleep 0.2; done";
const logger = createOpenBotLogger(NAME);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
symlinkSync("/bin/bash", join(OUT, "openbot"));
symlinkSync("/bin/bash", join(OUT, "not-openbot"));

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface CaseOptions {
  binary: "openbot" | "not-openbot";
  beats: boolean;
  state: "running" | "quitting";
  startFinished: boolean;
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

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen in ${DEADLINE_MS} ms.`);
    await delay(POLL_MS);
  }
}

const sleeping = (watchdog: ChildProcess): boolean =>
  spawnSync("pgrep", ["-P", String(watchdog.pid), "-x", "sleep"], { stdio: "ignore" }).status === 0;

async function startCase(name: string, options: CaseOptions): Promise<Case> {
  const userData = join(OUT, name);
  mkdirSync(userData);
  const heartbeat = join(userData, RUN_MARKER);
  const pidFile = join(userData, "openbot.pid");
  writeFileSync(heartbeat, '{"state":"running","beat":"previous run"}\n');
  writeFileSync(
    join(userData, START_ATTEMPTS),
    options.startFinished ? '{"attempt":null}\n' : '{"attempt":{"state":"starting"}}\n',
  );
  const watchdog = spawn(LAUNCHER, ["--watchdog", pidFile, userData, String(INTERVAL_SECONDS), String(LIMIT)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: string[] = [];
  watchdog.stderr?.setEncoding("utf8").on("data", (chunk: string) => stderr.push(chunk));
  const watchdogExit = exitOf(watchdog);
  await until(() => sleeping(watchdog), `${name}: the first watchdog read`);
  const app = spawn(
    join(OUT, options.binary),
    ["-c", options.beats ? HEARTBEAT_LOOP : IDLE_LOOP, options.binary, heartbeat, options.state],
    { stdio: "ignore" },
  );
  assert.ok(app.pid, `${name}: the fake app did not start.`);
  writeFileSync(pidFile, `${app.pid}\n`);
  return { name, app, appExit: exitOf(app), watchdog, watchdogExit, heartbeat, stderr };
}

function beat(testCase: Case): number {
  const match = /"beat":(\d+)/u.exec(readFileSync(testCase.heartbeat, "utf8"));
  return match ? Number(match[1]) : 0;
}

async function freezeAfterBeats(testCase: Case): Promise<void> {
  await until(() => beat(testCase) >= BEATS_BEFORE_FREEZE, `${testCase.name}: ${BEATS_BEFORE_FREEZE} heartbeats`);
  testCase.app.kill("SIGSTOP");
}

const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

const cases: Case[] = [];
const started = async (name: string, options: CaseOptions): Promise<Case> => {
  const testCase = await startCase(name, options);
  cases.push(testCase);
  return testCase;
};

try {
  const healthy = await started("healthy", { binary: "openbot", beats: true, state: "running", startFinished: true });
  const neverArmed = await started("never-armed", {
    binary: "openbot",
    beats: false,
    state: "running",
    startFinished: true,
  });
  const otherProcess = await started("other-process", {
    binary: "not-openbot",
    beats: true,
    state: "running",
    startFinished: true,
  });
  const starting = await started("starting", {
    binary: "openbot",
    beats: true,
    state: "running",
    startFinished: false,
  });
  const quitting = await started("quitting", {
    binary: "openbot",
    beats: true,
    state: "quitting",
    startFinished: true,
  });
  const frozen = await started("frozen", { binary: "openbot", beats: true, state: "running", startFinished: true });
  const notKilled = [healthy, neverArmed, otherProcess, starting, quitting];

  for (const testCase of [otherProcess, starting, quitting, frozen]) await freezeAfterBeats(testCase);

  const frozenExit = await withDeadline(frozen.appExit, "frozen: the watchdog kill");
  const frozenWatchdogExit = await withDeadline(frozen.watchdogExit, "frozen: the watchdog exit");
  const frozenMessage = frozen.stderr.join("");

  const later = await started("frozen-later", {
    binary: "openbot",
    beats: true,
    state: "running",
    startFinished: true,
  });
  await freezeAfterBeats(later);
  const laterExit = await withDeadline(later.appExit, "frozen-later: the watchdog kill");

  assert.equal(frozenExit.signal, "SIGKILL", "The watchdog did not kill the frozen app with SIGKILL.");
  assert.equal(laterExit.signal, "SIGKILL", "The watchdog did not kill the second frozen app with SIGKILL.");
  assert.equal(frozenWatchdogExit.code, 0, "The watchdog did not exit with 0 after the kill.");
  assert.match(frozenMessage, /did not update its heartbeat for 3 seconds/u);
  for (const testCase of notKilled) {
    assert.ok(alive(testCase.app), `${testCase.name}: the watchdog stopped the app.`);
    assert.ok(alive(testCase.watchdog), `${testCase.name}: the watchdog stopped.`);
  }

  const report = {
    intervalSeconds: INTERVAL_SECONDS,
    limit: LIMIT,
    frozen: { appExit: frozenExit, watchdogExit: frozenWatchdogExit, message: frozenMessage.trim() },
    frozenLater: { appExit: laterExit },
    notKilled: Object.fromEntries(notKilled.map((testCase) => [testCase.name, { appAlive: alive(testCase.app) }])),
    healthyBeats: beat(healthy),
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`The hosted watchdog E2E test passed. Report: ${join(OUT, "report.json")}`);
} finally {
  for (const testCase of cases) {
    testCase.watchdog.kill("SIGKILL");
    testCase.app.kill("SIGKILL");
  }
}
