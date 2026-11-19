import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { countCrashDumps } from "../src/main/run-marker";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "linux-gpu-fallback-e2e");
const STATE_TIMEOUT_MS = 30_000;
const GPU_START_FILE = "gpu-start.json";
const GPU_CRASH_FILE = "gpu-crash.json";
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

if (process.platform !== "linux") {
  process.stdout.write("SKIP: Linux only\n");
  process.exit(0);
}

interface ReadyLine {
  pid: number;
  mode: { hardwareAcceleration: boolean; reason: string };
  hardwareAccelerationEnabled: boolean;
  gpuCompositing: string;
  webglRenderer: string | null;
  crashDumps: string;
}

interface Step {
  step: string;
  ready: ReadyLine;
  gpuProcess?: number;
}

interface Launch {
  child: ChildProcess;
  ready: ReadyLine;
  exited: Promise<number | null>;
}

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-linux-gpu-"));
const bundle = join(root, "linux-gpu-fallback-electron.mjs");
const steps: Step[] = [];
const children: ChildProcess[] = [];
let launchCount = 0;
let passed = false;
let error: string | undefined;

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "linux-gpu-fallback-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  const data = join(root, "user-data");
  let launch = await start(data, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "default" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, true);
  assert.equal(existsSync(join(data, GPU_START_FILE)), true, "the start file exists while the start is new");
  await until(() => !existsSync(join(data, GPU_START_FILE)), "the confirmed start removes the start file");
  const gpuProcess = await until(() => descendantWithType(launch.ready.pid, "gpu-process"), "a GPU process");
  steps.push({ step: "gpu start", ready: launch.ready, gpuProcess });
  process.kill(gpuProcess, "SIGSEGV");
  await until(() => existsSync(join(data, GPU_CRASH_FILE)), "the GPU crash writes the crash file");
  await quit(launch);

  launch = await start(data, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "gpu-process-crash" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, false);
  assert.equal(existsSync(join(data, GPU_START_FILE)), false, "a software start writes no start file");
  steps.push({ step: "after gpu crash", ready: launch.ready });
  let softwareGpuProcess = await until(() => descendantWithType(launch.ready.pid, "gpu-process"), "a GPU process");
  for (let exit = 0; exit < 3; exit += 1) softwareGpuProcess = await stopGpuProcess(launch, softwareGpuProcess);
  steps.push({ step: "software start after 3 GPU process exits", ready: launch.ready, gpuProcess: softwareGpuProcess });
  await quit(launch);
  launch = await start(data, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "gpu-process-crash" });
  softwareGpuProcess = await until(() => descendantWithType(launch.ready.pid, "gpu-process"), "a GPU process");
  let looping = true;
  void launch.exited.then(() => {
    looping = false;
  });
  while (looping) {
    process.kill(softwareGpuProcess, "SIGKILL");
    const previous = softwareGpuProcess;
    const next = await until(
      () => !looping || descendantWithType(launch.ready.pid, "gpu-process", previous),
      "a new GPU process or the quit",
    );
    if (typeof next === "number") softwareGpuProcess = next;
  }
  assert.equal(await launch.exited, 0, "a GPU process restart loop ends with a clean quit");
  steps.push({ step: "software start with a GPU process restart loop", ready: launch.ready });
  launch = await start(data, 1_000, { OPENBOT_DISABLE_GPU: "0" });
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "environment-on" });
  steps.push({ step: "OPENBOT_DISABLE_GPU=0", ready: launch.ready });
  await quit(launch);

  await writeFile(join(data, GPU_CRASH_FILE), JSON.stringify({ version: 1, chromium: "0" }));
  launch = await start(data, 600_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "default" });
  await quit(launch);
  assert.equal(existsSync(join(data, GPU_START_FILE)), false, "a clean quit removes the start file");
  steps.push({ step: "crash from another Chromium major version", ready: launch.ready });
  const contextLost = join(root, "context-lost");
  launch = await start(contextLost, 1_000, {}, ["--context-lost"]);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "default" });
  assert.equal(existsSync(join(contextLost, GPU_CRASH_FILE)), false, "a context-loss exit writes no crash file");
  await quit(launch);
  launch = await start(contextLost, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "default" });
  steps.push({ step: "after a GPU context loss", ready: launch.ready });
  await quit(launch);

  const killed = join(root, "killed-start");
  launch = await start(killed, 600_000);
  await killTree(launch.ready.pid, launch.exited);
  assert.equal(existsSync(join(killed, GPU_START_FILE)), true, "a killed start leaves the start file");
  launch = await start(killed, 600_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "unfinished-start-retry" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, true);
  steps.push({ step: "retry after a killed start", ready: launch.ready });
  await killTree(launch.ready.pid, launch.exited);
  launch = await start(killed, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "unfinished-start" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, false);
  steps.push({ step: "after a killed retry", ready: launch.ready });
  await quit(launch);
  const crashed = join(root, "crashed-start");
  launch = await start(crashed, 600_000);
  launch.child.stdin?.write("crash\n");
  await launch.exited;
  const crashDumps = launch.ready.crashDumps;
  await until(
    () => countCrashDumps(crashDumps, 0, Number.POSITIVE_INFINITY) > 0,
    "the main process crash writes a dump",
  );
  launch = await start(crashed, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "unfinished-start" });
  steps.push({ step: "after a crashed start", ready: launch.ready });
  await quit(launch);
  const hung = join(root, "hung-quit");
  launch = await start(hung, 600_000, {}, ["--hang-on-quit"]);
  launch.child.stdin?.write("quit\n");
  await until(() => !existsSync(join(hung, GPU_START_FILE)), "a quit that starts removes the start file");
  await killTree(launch.ready.pid, launch.exited);
  launch = await start(hung, 1_000);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "default" });
  steps.push({ step: "after a killed teardown", ready: launch.ready });
  await quit(launch);

  const forced = join(root, "forced-software");
  launch = await start(forced, 1_000, { OPENBOT_DISABLE_GPU: "1" });
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "environment-off" });
  assert.equal(existsSync(join(forced, GPU_START_FILE)), false);
  steps.push({ step: "OPENBOT_DISABLE_GPU=1", ready: launch.ready });
  await quit(launch);

  const server = join(root, "server");
  launch = await start(server, 1_000, { OPENBOT_DISABLE_GPU: "0" }, ["--server"]);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: true, reason: "server" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, true);
  assert.equal(launch.ready.gpuCompositing.startsWith("enabled"), false, "a server composites on the CPU");
  assert.notEqual(launch.ready.webglRenderer, null, "a server page gets a WebGL context");
  assert.equal(existsSync(join(server, GPU_START_FILE)), false, "a server writes no start file");
  const serverGpuProcess = await until(() => descendantWithType(launch.ready.pid, "gpu-process"), "a GPU process");
  steps.push({ step: "server", ready: launch.ready, gpuProcess: serverGpuProcess });
  process.kill(serverGpuProcess, "SIGSEGV");
  await until(() => existsSync(join(server, GPU_CRASH_FILE)), "a server GPU crash writes the crash file");
  await quit(launch);
  launch = await start(server, 1_000, {}, ["--server"]);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "gpu-process-crash" });
  assert.equal(launch.ready.hardwareAccelerationEnabled, false);
  steps.push({ step: "server after gpu crash", ready: launch.ready });
  await quit(launch);
  launch = await start(join(root, "server-forced-software"), 1_000, { OPENBOT_DISABLE_GPU: "1" }, ["--server"]);
  assert.deepEqual(launch.ready.mode, { hardwareAcceleration: false, reason: "environment-off" });
  steps.push({ step: "server with OPENBOT_DISABLE_GPU=1", ready: launch.ready });
  await quit(launch);
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  for (const child of children) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      await killTree(child.pid, once(child));
    }
  }
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, steps, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

async function start(
  userData: string,
  confirmMs: number,
  environment: Record<string, string> = {},
  extraArguments: string[] = [],
): Promise<Launch> {
  const { OPENBOT_DISABLE_GPU: _inherited, ...base } = withoutElectronRuntimeFlags(process.env);
  launchCount += 1;
  const readyFile = join(root, `ready-${launchCount}.json`);
  const log = openSync(join(OUT, `electron-${launchCount}.log`), "w");
  const child = spawn(
    electronPath,
    [bundle, `--user-data=${userData}`, `--confirm-ms=${confirmMs}`, `--ready-file=${readyFile}`, ...extraArguments],
    { env: { ...base, ...environment }, stdio: ["pipe", log, log] },
  );
  closeSync(log);
  children.push(child);
  const exited = once(child);
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  await until(() => existsSync(readyFile) || stopped, "the app is ready");
  assert.equal(stopped, false, `Electron stopped before it was ready: see ${OUT}`);
  return { child, ready: JSON.parse(readFileSync(readyFile, "utf8")), exited };
}

function once(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((done) => child.once("exit", (code) => done(code)));
}

async function killTree(pid: number, exited: Promise<number | null>): Promise<void> {
  const descendants = descendantsOf(pid);
  process.kill(pid, "SIGKILL");
  await exited;
  for (const pid of descendants) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

async function quit(launch: Launch): Promise<void> {
  launch.child.stdin?.end("quit\n");
  assert.equal(await launch.exited, 0, "Electron quits cleanly");
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

function descendantsOf(root: number): number[] {
  const parents = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      parents.set(pid, Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
    } catch {}
  }
  return [...parents.keys()].filter((pid) => {
    let parent = parents.get(pid);
    while (parent !== undefined && parent !== root && parent > 1) parent = parents.get(parent);
    return parent === root;
  });
}

async function stopGpuProcess(launch: Launch, gpuProcess: number): Promise<number> {
  process.kill(gpuProcess, "SIGKILL");
  const next = await until(() => descendantWithType(launch.ready.pid, "gpu-process", gpuProcess), "a new GPU process");
  assert.equal(launch.child.exitCode ?? launch.child.signalCode, null, "the app runs after a GPU process exit");
  return next;
}

function descendantWithType(root: number, type: string, except?: number): number | undefined {
  return descendantsOf(root).find((pid) => {
    if (pid === except) return false;
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/u).includes(`--type=${type}`);
    } catch {
      return false;
    }
  });
}
