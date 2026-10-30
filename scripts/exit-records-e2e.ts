// Runs the real Electron with the exit records of #2675:
// 1. A renderer crash reaches `logs/trace.ndjson` as a `renderer_gone` span within seconds, not at the
//    next one-minute resource sample, and the crash reporter keeps a dump in the crash dump folder.
// 2. A line of the `main` logger reaches `logs/main/main.log`.
//
// Run: bun scripts/exit-records-e2e.ts
// It writes .openbot-build/exit-records-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "exit-records-e2e");
const STATE_TIMEOUT_MS = 30_000;
// The resource monitor samples once a minute. The trace must have the exit long before that.
const CRASH_RECORD_LIMIT_MS = 5_000;
// The Electron binary itself, not the `.bin/electron` Node wrapper.
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-exit-records-"));
const bundle = join(root, "exit-records-electron.mjs");
const userData = join(root, "user-data");
let child: ChildProcess | undefined;
let passed = false;
let error: string | undefined;
interface TraceLine {
  kind: string;
  name: string;
  outcome: string;
}
const results: { crashRecordMs?: number; crashSpan?: TraceLine; dumpCount?: number; mainLogHasQuit?: boolean } = {};

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "exit-records-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  const readyFile = join(root, "ready.json");
  const log = openSync(join(OUT, "electron.log"), "w");
  const app = spawn(electronPath, [bundle, `--user-data=${userData}`, `--ready-file=${readyFile}`], {
    env: withoutElectronRuntimeFlags(process.env),
    stdio: ["pipe", log, log],
  });
  child = app;
  closeSync(log);
  const exited = new Promise<number | null>((done) => app.once("exit", (code) => done(code)));
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  await until(() => existsSync(readyFile) || stopped, "the app is ready");
  assert.equal(stopped, false, `Electron stopped before it was ready: see ${OUT}`);
  const ready = JSON.parse(readFileSync(readyFile, "utf8"));
  assert.ok(isDynamicRecord(ready) && typeof ready.crashDumps === "string", "the ready file names the dump folder");
  const crashDumps = ready.crashDumps;

  // 1. The renderer crash is in the trace at once, and a dump exists.
  const tracePath = join(userData, "logs", "trace.ndjson");
  const crashedAt = Date.now();
  app.stdin?.write("crash\n");
  const span = await until(
    () => readLines(tracePath).find((line) => line.kind === "crash" && line.name === "renderer_gone"),
    "a renderer_gone span in the trace",
  );
  const crashRecordMs = Date.now() - crashedAt;
  results.crashRecordMs = crashRecordMs;
  results.crashSpan = span;
  assert.ok(crashRecordMs < CRASH_RECORD_LIMIT_MS, `the crash reached the trace after ${crashRecordMs} ms`);
  assert.equal(span.outcome, "crashed");
  const dumps = await until(() => {
    const found = filesUnder(crashDumps).filter((path) => path.endsWith(".dmp"));
    return found.length ? found : undefined;
  }, "a crash dump");
  results.dumpCount = dumps.length;
  assert.ok(
    dumps.every((path) => path.startsWith(join(userData, "Crashpad"))),
    "dumps are under the user data",
  );

  // 2. The main logger line is in the main log.
  app.stdin?.end("quit\n");
  assert.equal(await exited, 0, "Electron quits cleanly");
  const mainLog = readFileSync(join(userData, "logs", "main", "main.log"), "utf8");
  results.mainLogHasQuit = mainLog.includes("Quitting: quit.");
  assert.ok(results.mainLogHasQuit, "the main log has the quit line");
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, results, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

function readLines(path: string): TraceLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => parseLine(line) ?? []);
}

// An append that is still running can leave a last line cut short.
function parseLine(line: string): TraceLine | null {
  let value = null;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !isDynamicRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.name !== "string" ||
    typeof value.outcome !== "string"
  )
    return null;
  return { kind: value.kind, name: value.name, outcome: value.outcome };
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).map((path) => join(directory, path));
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
