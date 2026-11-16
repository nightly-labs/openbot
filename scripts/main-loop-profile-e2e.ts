// Runs the real Electron with the main-loop stall profiler:
// 1. An in-process inspector session records a CPU profile of the main process, and the summary
//    names the function that blocked the main thread.
// 2. The summary holds no directory: only frames of the shape that analytics accepts.
// 3. With `--trigger` (about 5 minutes): the resource monitor starts a profile after a minute with a
//    stall, keeps it when the next minute stalls too, and writes `logs/stall-profiles.ndjson`.
//
// Run: bun scripts/main-loop-profile-e2e.ts [--trigger]
// It writes .openbot-build/main-loop-profile-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isProfileFrame, isProfileStack, type MainLoopProfileSummary } from "../src/main/main-loop-profile";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "main-loop-profile-e2e");
const TRIGGER = process.argv.includes("--trigger");
const TIMEOUT_MS = TRIGGER ? 8 * 60_000 : 60_000;
const BLOCKER = "blockMainLoopForTest app:main-loop-profile-electron.mjs:";
// The Electron binary itself, not the `.bin/electron` Node wrapper.
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

await mkdir(OUT, { recursive: true });
const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-main-loop-profile-")));
const bundle = join(root, "main-loop-profile-electron.mjs");
const userData = join(root, "user-data");
const resultFile = join(root, "result.json");
let child: ChildProcess | undefined;
let passed = false;
let error: string | undefined;
let results: unknown;

function check(summary: MainLoopProfileSummary, minSelfPct: number): void {
  const blocker = summary.top.find((entry) => entry.frame.startsWith(BLOCKER));
  assert.ok(blocker, "the summary names the function that blocked the main thread");
  assert.ok(blocker.selfPct >= minSelfPct, `the blocking function has ${blocker.selfPct}% of the time`);
  assert.ok(summary.busyPct >= minSelfPct, `the main thread was busy for ${summary.busyPct}% of the time`);
  for (const entry of summary.top) {
    assert.ok(isProfileFrame(entry.frame), `frame shape: ${entry.frame}`);
    assert.ok(isProfileStack(entry.stack), `stack shape: ${entry.stack}`);
  }
}

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "main-loop-profile-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  const log = openSync(join(OUT, "electron.log"), "w");
  const app = spawn(
    electronPath,
    [bundle, `--user-data=${userData}`, `--result-file=${resultFile}`, ...(TRIGGER ? ["--trigger"] : [])],
    { env: withoutElectronRuntimeFlags(process.env), stdio: ["ignore", log, log] },
  );
  child = app;
  closeSync(log);
  const code = await new Promise<number | null>((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Electron did not finish in time")), TIMEOUT_MS);
    app.once("exit", (exitCode) => {
      clearTimeout(timer);
      done(exitCode);
    });
  });
  assert.equal(code, 0, `Electron quits cleanly: see ${OUT}`);
  const text = readFileSync(resultFile, "utf8");
  const result: { direct: MainLoopProfileSummary | null; triggered: MainLoopProfileSummary | null } = JSON.parse(text);
  results = result;
  assert.ok(!text.includes(root) && !text.includes(ROOT), "the summaries hold no directory");
  assert.ok(result.direct, "the inspector session returns a profile in the Electron main process");
  check(result.direct, 50);
  if (TRIGGER) {
    assert.ok(result.triggered, "the resource monitor reports a profile");
    check(result.triggered, 5);
    const lines = readFileSync(join(userData, "logs", "stall-profiles.ndjson"), "utf8")
      .trim()
      .split("\n");
    assert.equal(lines.length, 1, "one line in stall-profiles.ndjson");
    assert.ok(!lines.join("").includes(root), "the file holds no directory");
  }
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, trigger: TRIGGER, results, error }, null, 2)}\n`,
  );
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}
