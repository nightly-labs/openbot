import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "exit-watchdog-e2e");
const STATE_TIMEOUT_MS = 30_000;
const STUCK_EXIT_LIMIT_MS = 15_000;
const CLEAN_EXIT_LIMIT_MS = 5_000;
const WATCHDOG_LINE = "did not exit within";
const EXIT_COMMANDS = ["quit", "exit", "process-exit"] as const;
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

interface ExitResult {
  command: string;
  stalled: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  exitMs: number;
  watchdogLine: boolean;
}

await mkdir(OUT, { recursive: true });
if (process.platform === "win32") {
  process.stdout.write("SKIP: the exit watchdog does not run on Windows\n");
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), "openbot-exit-watchdog-"));
const bundle = join(root, "exit-watchdog-electron.mjs");
const fifo = join(root, "approval.fifo");
const children = new Set<ChildProcess>();
let launches = 0;
const results: { exits: ExitResult[]; relaunchHasLock?: boolean } = { exits: [] };
let passed = false;
let error: string | undefined;

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "exit-watchdog-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);
  const fifoMade = spawnSync("mkfifo", [fifo]);
  assert.equal(fifoMade.status, 0, `mkfifo failed: ${fifoMade.stderr.toString()}`);

  for (const stalled of [false, true]) {
    for (const command of EXIT_COMMANDS) {
      const userData = join(root, `user-data-${command}-${stalled ? "stalled" : "clean"}`);
      const app = await launch(userData);
      assert.equal(app.hasLock, true, "the launch has the single-instance lock");
      if (stalled) app.child.stdin?.write("stall\n");
      const startedAt = Date.now();
      app.child.stdin?.write(`${command}\n`);
      const limit = stalled ? STUCK_EXIT_LIMIT_MS : CLEAN_EXIT_LIMIT_MS;
      const ended = await Promise.race([app.exited, sleep(limit).then(() => null)]);
      const exitMs = Date.now() - startedAt;
      const mainLog = join(userData, "logs", "main", "main.log");
      const result: ExitResult = {
        command,
        stalled,
        code: ended?.code ?? null,
        signal: ended?.signal ?? null,
        exitMs,
        watchdogLine: existsSync(mainLog) && readFileSync(mainLog, "utf8").includes(WATCHDOG_LINE),
      };
      results.exits.push(result);
      assert.ok(ended, `${command} (${stalled ? "stalled" : "clean"}) did not end within ${limit} ms`);
      if (stalled) {
        assert.equal(result.signal, "SIGKILL", `${command}: the watchdog stops a stuck exit`);
        result.watchdogLine = await until(
          () => existsSync(mainLog) && readFileSync(mainLog, "utf8").includes(WATCHDOG_LINE),
          `${command}: the watchdog line in the main log`,
        );
      } else {
        assert.equal(result.code, 0, `${command}: a clean exit keeps code 0`);
      }
    }
  }

  for (const result of results.exits.filter((exit) => !exit.stalled)) {
    const mainLog = join(root, `user-data-${result.command}-clean`, "logs", "main", "main.log");
    result.watchdogLine = existsSync(mainLog) && readFileSync(mainLog, "utf8").includes(WATCHDOG_LINE);
    assert.equal(result.watchdogLine, false, `${result.command}: a clean exit adds no watchdog line`);
  }

  const relaunch = await launch(join(root, "user-data-process-exit-stalled"));
  results.relaunchHasLock = relaunch.hasLock;
  assert.equal(relaunch.hasLock, true, "a launch after the stopped exit has the single-instance lock");
  relaunch.child.stdin?.end("quit\n");
  assert.equal((await relaunch.exited).code, 0, "the relaunch quits cleanly");
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  for (const child of children) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, results, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

async function launch(userData: string) {
  launches += 1;
  const readyFile = join(root, `ready-${launches}.json`);
  const log = openSync(join(OUT, "electron.log"), "a");
  const child = spawn(
    electronPath,
    [bundle, `--user-data=${userData}`, `--ready-file=${readyFile}`, `--fifo=${fifo}`],
    {
      env: withoutElectronRuntimeFlags(process.env),
      stdio: ["pipe", log, log],
    },
  );
  closeSync(log);
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  await until(() => existsSync(readyFile) || stopped, "the app is ready");
  assert.equal(stopped, false, `Electron stopped before it was ready: see ${OUT}`);
  const ready = JSON.parse(readFileSync(readyFile, "utf8"));
  assert.ok(isDynamicRecord(ready) && typeof ready.hasLock === "boolean", "the ready file has the lock state");
  return { child, exited, hasLock: ready.hasLock };
}

async function until<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(100);
  }
}
