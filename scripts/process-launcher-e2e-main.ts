import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Effect } from "effect";
import { app } from "electron";
import type { LaunchedProcess, ProcessLaunchOptions } from "../src/backend/process-launch";
import { forkProcessLauncherHost, ProcessLauncher, type ProcessLauncherHost } from "../src/main/process-launcher";

const reportPath = process.env.PROCESS_LAUNCHER_E2E_REPORT ?? "";
const hostPath = process.env.PROCESS_LAUNCHER_E2E_HOST ?? "";
const SPAWN_SAMPLES = 20;
const LARGE_OUTPUT_BYTES = 5 * 1024 * 1024;

const ECHO_PROGRAM = `
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; process.stdout.write(String(chunk).toUpperCase()); });
process.stdin.on("end", () => { process.stderr.write("stderr:" + input.length); process.exit(7); });
`;
const WAIT_PROGRAM =
  "process.stdout.write('started'); process.stdin.on('end', () => process.exit(0)); process.stdin.resume();";
const LARGE_OUTPUT_PROGRAM = `process.stdout.write(Buffer.alloc(${LARGE_OUTPUT_BYTES}, 97), () => process.exit(0));`;
const EXIT_PROGRAM = "process.stdout.write('again'); process.exit(3);";
const FIRST_BYTE_PROGRAM = "process.stdout.write('x'); process.exit(0);";
const TREE_PROGRAM = `
const grandchild = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.stdout.write(String(grandchild.pid));
process.stdin.resume();
`;
const GRANDCHILD_EXIT_DEADLINE_MS = 10_000;

function nodeProgram(source: string): ProcessLaunchOptions {
  return {
    command: process.execPath,
    args: ["-e", source],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

interface Outcome {
  stdout: string;
  stdoutBytes: number;
  stderr: string;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
  error: { message: string; code: string | null } | null;
  exitAfterError: boolean;
}

function settle(child: LaunchedProcess, settleAfterErrorMs = 300): Promise<Outcome> {
  const outcome: Outcome = { stdout: "", stdoutBytes: 0, stderr: "", exit: null, error: null, exitAfterError: false };
  child.stdout.on("data", (chunk: Buffer) => {
    outcome.stdoutBytes += chunk.length;
    if (outcome.stdout.length < 4096) outcome.stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    outcome.stderr += chunk.toString();
  });
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      outcome.exit = { code, signal };
      if (outcome.error) outcome.exitAfterError = true;
      resolve(outcome);
    });
    child.once("error", (error) => {
      outcome.error = { message: error.message, code: "code" in error ? String(error.code) : null };
      setTimeout(() => resolve(outcome), settleAfterErrorMs);
    });
  });
}

function firstOutput(child: LaunchedProcess): Promise<void> {
  return new Promise((resolve) => child.stdout.once("data", () => resolve()));
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function grandchildStopped(pid: number): Promise<boolean> {
  const deadline = Date.now() + GRANDCHILD_EXIT_DEADLINE_MS;
  while (running(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return !running(pid);
}

async function startTree(launcher: ProcessLauncher): Promise<{ child: LaunchedProcess; grandchild: number }> {
  const child = launcher.launch(nodeProgram(TREE_PROGRAM));
  const grandchild = await new Promise<number>((resolve) =>
    child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString()))),
  );
  return { child, grandchild };
}

async function measureTreeStops(hostPath: string) {
  if (process.platform !== "win32") return null;
  const launcher = new ProcessLauncher(() => forkProcessLauncherHost(hostPath));
  const grandchildren: number[] = [];
  try {
    const killed = await startTree(launcher);
    grandchildren.push(killed.grandchild);
    const killedDone = settle(killed.child);
    killed.child.kill("SIGTERM");
    const killExit = (await killedDone).exit;
    const killEndsGrandchild = await grandchildStopped(killed.grandchild);
    const disposed = await startTree(launcher);
    grandchildren.push(disposed.grandchild);
    await Effect.runPromise(launcher.dispose());
    const disposeEndsGrandchild = await grandchildStopped(disposed.grandchild);
    return { killExit, killEndsGrandchild, disposeEndsGrandchild };
  } finally {
    for (const pid of grandchildren.filter(running)) process.kill(pid);
  }
}

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0).toFixed(3));
}

function summary(samples: number[]) {
  return {
    n: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: percentile(samples, 1),
  };
}

async function measureSpawns(start: (options: ProcessLaunchOptions) => LaunchedProcess) {
  const blocking: number[] = [];
  const firstByte: number[] = [];
  for (let index = 0; index < SPAWN_SAMPLES; index += 1) {
    const before = performance.now();
    const child = start(nodeProgram(FIRST_BYTE_PROGRAM));
    blocking.push(performance.now() - before);
    const done = settle(child);
    await firstOutput(child);
    firstByte.push(performance.now() - before);
    await done;
  }
  return { mainThreadBlockingMs: summary(blocking), firstOutputMs: summary(firstByte) };
}

function directSpawn(options: ProcessLaunchOptions): LaunchedProcess {
  return spawn(options.command, [...options.args], {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function run() {
  const hosts: ProcessLauncherHost[] = [];
  const launcher = new ProcessLauncher(() => {
    const host = forkProcessLauncherHost(hostPath);
    hosts.push(host);
    return host;
  });

  const echoChild = launcher.launch(nodeProgram(ECHO_PROGRAM));
  const echoDone = settle(echoChild);
  echoChild.stdin.write("hello ");
  echoChild.stdin.end("launcher");
  const echo = await echoDone;

  const waitChild = launcher.launch(nodeProgram(WAIT_PROGRAM));
  const waitDone = settle(waitChild);
  await firstOutput(waitChild);
  const killAccepted = waitChild.kill("SIGTERM");
  const kill = { ...(await waitDone), killAccepted, killedFlag: waitChild.killed };

  const missing = await settle(
    launcher.launch({ command: "/openbot-missing/program", args: [], env: { ...process.env } }),
  );

  const large = await settle(launcher.launch(nodeProgram(LARGE_OUTPUT_PROGRAM)));

  const orphanChild = launcher.launch(nodeProgram(WAIT_PROGRAM));
  const orphanDone = settle(orphanChild);
  await firstOutput(orphanChild);
  hosts.at(-1)?.kill();
  const hostLoss = await orphanDone;
  const afterHostLoss = await settle(launcher.launch(nodeProgram(EXIT_PROGRAM)));

  const failingLauncher = new ProcessLauncher(() => {
    throw new Error("host start refused in this test");
  });
  const fallbackChild = failingLauncher.launch(nodeProgram(ECHO_PROGRAM));
  const fallbackDone = settle(fallbackChild);
  fallbackChild.stdin.end("fallback");
  const fallback = await fallbackDone;

  const launcherTiming = await measureSpawns(launcher.launch);
  const directTiming = await measureSpawns(directSpawn);

  await Effect.runPromise(launcher.dispose());
  await Effect.runPromise(failingLauncher.dispose());
  const treeStops = await measureTreeStops(hostPath);

  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        hostStarts: hosts.length,
        echo,
        kill,
        missing,
        large: { ...large, stdout: undefined, expectedBytes: LARGE_OUTPUT_BYTES },
        hostLoss,
        afterHostLoss,
        fallback,
        treeStops,
        timing: { launcher: launcherTiming, direct: directTiming },
      },
      null,
      2,
    ),
  );
}

if (process.platform === "darwin") app.dock?.hide();
app
  .whenReady()
  .then(run)
  .then(
    () => app.exit(0),
    (error: unknown) => {
      writeFileSync(reportPath, JSON.stringify({ failure: String(error instanceof Error ? error.stack : error) }));
      app.exit(1);
    },
  );
