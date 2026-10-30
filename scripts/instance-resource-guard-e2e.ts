// End-to-end check of the resource handling of agent processes on a server (docs/docker.md#cpu-and-memory-of-the-instances):
//
// - `resources/agent-runtime/cpu-limit.cjs` makes os.cpus() follow the CPU limit of a container, for
//   CommonJS and for ESM imports, in a real Node 24 container with `--cpus 2`.
// - `ServerMemory` from src/main/server-memory.ts runs as "main" in a Bun container with a 1 GiB
//   memory limit and no swap, behind docker-init as PID 1, as OpenBot runs behind tini. It must give
//   marked agent processes nice 10 and an OOM value of 500, also after they leave its tree; leave an
//   unmarked orphan (as Xvfb is) and itself alone; and when a marked detached job fills the memory,
//   stop the job's largest leaf with SIGTERM before the kernel OOM killer acts, so the shell of the
//   job still runs its next command, which reports exit status 143.
//
//   bun scripts/instance-resource-guard-e2e.ts
//
// It needs Docker and network access for the images. The report is
// `.openbot-build/instance-resource-guard-e2e/report.json`.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getPriority } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";

const NODE_IMAGE = "node:24-slim";
const BUN_IMAGE = "oven/bun:1.4.2";
const root = resolve(import.meta.dirname, "..");
const reportRoot = join(root, ".openbot-build/instance-resource-guard-e2e");
const INSIDE = "--inside";
const WAKE_FILE = "/tmp/openbot-e2e-wake";
interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

/** A line that `report` printed in the guard container. */
function isCheckResult(value: unknown): value is CheckResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "detail" in value &&
    typeof value.detail === "string"
  );
}

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "pass" : "FAIL"} ${name}: ${detail}\n`);
}

function docker(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function nodeCpus(preload: boolean, module: boolean): string {
  const code = module
    ? 'import { cpus } from "node:os"; console.log(cpus().length)'
    : 'console.log(require("node:os").cpus().length)';
  const result = docker([
    "run",
    "--rm",
    "--cpus",
    "2",
    "--volume",
    `${join(root, "resources/agent-runtime")}:/agent-runtime:ro`,
    ...(preload ? ["--env", 'NODE_OPTIONS=--require="/agent-runtime/cpu-limit.cjs"'] : []),
    NODE_IMAGE,
    "node",
    ...(module ? ["--input-type=module"] : []),
    "-e",
    code,
  ]);
  return result.status === 0 ? result.stdout : `exit ${result.status}: ${result.stderr}`;
}

async function outside(): Promise<void> {
  await mkdir(reportRoot, { recursive: true });
  const host = nodeCpus(false, false);
  check(
    "without the module, os.cpus() lists the CPUs of the host",
    /^\d+$/.test(host) && Number(host) > 2,
    `os.cpus().length = ${host}`,
  );
  const required = nodeCpus(true, false);
  check("require: os.cpus() follows --cpus 2", required === "2", `os.cpus().length = ${required}`);
  const imported = nodeCpus(true, true);
  check("import: os.cpus() follows --cpus 2", imported === "2", `cpus().length = ${imported}`);

  const guard = docker([
    "run",
    "--rm",
    "--init",
    "--memory",
    "1g",
    "--memory-swap",
    "1g",
    "--volume",
    `${root}:/repo:ro`,
    "--workdir",
    "/repo",
    BUN_IMAGE,
    "bun",
    "scripts/instance-resource-guard-e2e.ts",
    INSIDE,
  ]);
  const inner = guard.stdout.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return isCheckResult(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
  for (const result of inner) check(result.name, result.ok, result.detail);
  check("the guard container finished", guard.status === 0 && inner.length > 0, `exit ${guard.status} ${guard.stderr}`);

  const report = { generatedAt: new Date().toISOString(), images: [NODE_IMAGE, BUN_IMAGE], results };
  await writeFile(join(reportRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(reportRoot, "report.json")}\n`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

/** One check, as a JSON line for `outside`. */
function report(name: string, ok: boolean, detail: string): void {
  process.stdout.write(`${JSON.stringify({ name, ok, detail })}\n`);
}

async function procValue(pid: number, file: string): Promise<string | null> {
  return readFile(`/proc/${pid}/${file}`, "utf8").then(
    (text) => text.trim(),
    () => null,
  );
}

/** Field 4 of /proc/<pid>/stat. */
function parentOf(stat: string | null): string | undefined {
  return stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[1];
}

function nice(pid: number): number | null {
  try {
    return getPriority(pid);
  } catch {
    return null;
  }
}

/** The pid of the only process with this command line, or null. */
async function findProcess(command: string): Promise<number | null> {
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const line = (await procValue(Number(entry), "cmdline"))?.replaceAll("\0", " ").trim();
    if (line === command) return Number(entry);
  }
  return null;
}

/** Starts a shell command whose job leaves this process's tree when the shell ends. */
function detach(command: string, marked: boolean): ChildProcess {
  const { AGENT_PROCESS_VARIABLE } = serverMemoryModule;
  return spawn("sh", ["-c", `nohup sh -c '${command}' >/dev/null 2>&1 &`], {
    stdio: "ignore",
    env: marked ? { ...process.env, [AGENT_PROCESS_VARIABLE]: "1" } : { ...process.env },
  });
}

async function until<A>(label: string, read: () => Promise<A | null>, timeoutMs = 30_000): Promise<A> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

let serverMemoryModule: typeof import("../src/main/server-memory");

async function inside(): Promise<void> {
  serverMemoryModule = await import("../src/main/server-memory");
  const stopped: import("../src/main/server-memory").StoppedAgentProcess[] = [];
  const memory = new serverMemoryModule.ServerMemory({
    hostedPlan: false,
    onError: (message) => process.stderr.write(`${message}\n`),
    onAgentProcessStopped: (agentProcess) => stopped.push(agentProcess),
  });
  // Xvfb starts before main, so it is never main's descendant. The unmarked orphan here leaves the
  // tree before the first tick for the same reason.
  detach("exec sleep 3602", false);
  const unmarked = await until("the unmarked orphan", async () => {
    const pid = await findProcess("sleep 3602");
    return pid !== null && parentOf(await procValue(pid, "stat")) === "1" ? pid : null;
  });
  // The pass runs on each tick. A tick every 100 ms keeps ahead of the memory job below.
  let ticking = true;
  const ticks = (async () => {
    while (ticking) {
      await Effect.runPromise(memory.tick());
      await new Promise((done) => setTimeout(done, 100));
    }
  })();

  try {
    detach("exec sleep 3601", true);
    const child = spawn("sleep", ["3603"], {
      stdio: "ignore",
      env: { ...process.env, [serverMemoryModule.AGENT_PROCESS_VARIABLE]: "1" },
    });
    const orphan = await until("the marked orphan", async () => {
      const pid = await findProcess("sleep 3601");
      return pid !== null && parentOf(await procValue(pid, "stat")) === "1" ? pid : null;
    });
    report("the detached job left main's tree", true, `pid ${orphan}, parent 1`);
    await until("the marked orphan's values", async () =>
      nice(orphan) === 10 && (await procValue(orphan, "oom_score_adj")) === "500" ? true : null,
    );
    report("a marked orphan gets nice 10 and OOM 500", true, `pid ${orphan}`);
    await until("the marked child's values", async () =>
      child.pid !== undefined && nice(child.pid) === 10 && (await procValue(child.pid, "oom_score_adj")) === "500"
        ? true
        : null,
    );
    report("a marked child of main gets nice 10 and OOM 500", true, `pid ${child.pid}`);
    report(
      "an unmarked orphan keeps its values",
      nice(unmarked) === 0 && (await procValue(unmarked, "oom_score_adj")) === "0",
      `nice ${nice(unmarked)}, OOM ${await procValue(unmarked, "oom_score_adj")}`,
    );
    report(
      "main keeps its values",
      nice(process.pid) === 0 && (await procValue(process.pid, "oom_score_adj")) === "0",
      `nice ${nice(process.pid)}, OOM ${await procValue(process.pid, "oom_score_adj")}`,
    );

    // A detached job whose leaf, `tail`, holds all it reads: about 50 MB a second, until it is stopped.
    // The guard stops only a process that runs for 5 s, and the limit is reached after about 13 s.
    // The shell then writes the exit status, as a routine wake-up command reports it.
    detach(`(while :; do head -c 20000000 /dev/zero || exit; sleep 0.4; done) | tail; echo "$?" > ${WAKE_FILE}`, true);
    const status = await until(
      "the wake-up file",
      () =>
        readFile(WAKE_FILE, "utf8").then(
          (text) => text.trim(),
          () => null,
        ),
      60_000,
    );
    const tail = stopped.find((agentProcess) => agentProcess.name === "tail");
    report(
      "at the critical level, the guard stops the largest leaf",
      tail?.signal === "SIGTERM" && tail.rssBytes > 256 * 1024 * 1024,
      JSON.stringify(stopped),
    );
    report("the job's shell runs its next command with exit 143", status === "143", `exit status ${status}`);
    report(
      "the guard stopped nothing else",
      stopped.every((agentProcess) => agentProcess.name === "tail"),
      stopped.map((agentProcess) => agentProcess.name).join(", "),
    );
    report(
      "the other orphans live",
      (await findProcess("sleep 3601")) !== null && (await findProcess("sleep 3602")) !== null,
      "",
    );
    child.kill();
  } catch (error) {
    report("the guard checks ran", false, error instanceof Error ? error.message : String(error));
  } finally {
    ticking = false;
    await ticks;
  }
}

if (process.argv.includes(INSIDE)) await inside();
else await outside();
