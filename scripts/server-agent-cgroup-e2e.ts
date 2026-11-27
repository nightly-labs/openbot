import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { AGENT_PROCESS_VARIABLE, readCgroupRoot, readLinuxMemory, ServerMemory } from "../src/main/server-memory";

const NAME = "server-agent-cgroup-e2e";
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const SELF = join(ROOT, "scripts", `${NAME}.ts`);
const LAUNCHER = join(ROOT, "scripts", "hosting", "openbot-hosted-server");
const LAUNCHER_FUNCTIONS = ["service_openbot", "service_cgroup", "meminfo_bytes", "split_service_cgroup"];
const UNIT = "openbot";
const UNIT_MEMORY_MAX = 2 * 1024 * 1024 * 1024;
const DEADLINE_MS = 10_000;
const POLL_MS = 50;
const logger = createOpenBotLogger(NAME);

const Probe = Schema.Struct({
  ownCgroup: Schema.String,
  cgroupRoot: Schema.NullOr(Schema.String),
  memory: Schema.Struct({ unit: Schema.String, total: Schema.Number }),
  markedBefore: Schema.String,
  markedAfter: Schema.String,
  unmarkedAfter: Schema.String,
  childOfMarked: Schema.String,
  errors: Schema.Array(Schema.String),
  agentLimits: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  mainLimits: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
});
type Probe = typeof Probe.Type;
const decodeProbe = Schema.decodeUnknownSync(Schema.fromJsonString(Probe));

function readProbe(directory: string): Probe {
  return decodeProbe(readFileSync(join(directory, "probe.json"), "utf8"));
}

function runsOwnProgram(pid: number): boolean {
  try {
    return readlinkSync(`/proc/${pid}/exe`) !== readlinkSync("/proc/self/exe");
  } catch {
    return false;
  }
}

function cgroupOf(pid: number | "self"): string {
  const line = readFileSync(`/proc/${pid}/cgroup`, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("0::"));
  assert.ok(line, `process ${pid} has no cgroup v2 line`);
  return line.slice(3);
}

async function waitFor<A>(read: () => A | null, label: string): Promise<A> {
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${label}`);
    await delay(POLL_MS);
  }
}

function readOptional(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

async function probe(directory: string): Promise<Probe> {
  mkdirSync(directory, { recursive: true });
  const trigger = join(directory, "trigger");
  const childFile = join(directory, "child-pid");
  rmSync(trigger, { force: true });
  rmSync(childFile, { force: true });
  const children: ChildProcess[] = [];
  let childPid: number | null = null;
  const marked = spawn(
    "bash",
    [
      "-c",
      'while :; do if [ -e "$1" ]; then sleep 60 & echo $! >"$2"; wait; exit; fi; sleep 0.05; done',
      "marked",
      trigger,
      childFile,
    ],
    { env: { ...process.env, [AGENT_PROCESS_VARIABLE]: "1" }, stdio: "ignore" },
  );
  const unmarked = spawn("sleep", ["60"], { env: { ...process.env, [AGENT_PROCESS_VARIABLE]: "" }, stdio: "ignore" });
  children.push(marked, unmarked);
  try {
    const markedPid = await waitFor(() => marked.pid ?? null, "the marked process");
    const unmarkedPid = await waitFor(() => unmarked.pid ?? null, "the unmarked process");
    await waitFor(() => (runsOwnProgram(markedPid) && runsOwnProgram(unmarkedPid) ? true : null), "the exec of both");
    const markedBefore = cgroupOf(markedPid);
    const errors: string[] = [];
    const memory = new ServerMemory({ hostedPlan: false, onError: (message) => errors.push(message) });
    await Effect.runPromise(memory.tick());
    const markedAfter = cgroupOf(markedPid);
    const unmarkedAfter = cgroupOf(unmarkedPid);
    writeFileSync(trigger, "");
    childPid = await waitFor(() => {
      const text = readOptional(childFile);
      return text ? Number(text) : null;
    }, "the child of the marked process");
    const childOfMarked = cgroupOf(childPid);
    const cgroupRoot = await Effect.runPromise(readCgroupRoot());
    const { sample, unit } = await Effect.runPromise(readLinuxMemory());
    const limits = (child: string, files: string[]) =>
      Object.fromEntries(
        files.map((file) => [file, cgroupRoot === null ? null : readOptional(join(cgroupRoot, child, file))]),
      );
    const agentLimits = limits("agents", ["cpu.weight", "memory.high", "memory.max", "memory.swap.max"]);
    const mainLimits = limits("main", ["cpu.weight", "memory.low"]);
    return {
      ownCgroup: cgroupOf("self"),
      cgroupRoot,
      memory: { unit, total: sample.total },
      markedBefore,
      markedAfter,
      unmarkedAfter,
      childOfMarked,
      errors,
      agentLimits,
      mainLimits,
    };
  } finally {
    if (childPid !== null) stopProcess(childPid);
    for (const child of children) child.kill("SIGKILL");
  }
}

function stopProcess(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function swapTotalBytes(): number {
  const kib = /^SwapTotal:\s+(\d+) kB$/mu.exec(readFileSync("/proc/meminfo", "utf8"))?.[1];
  assert.ok(kib !== undefined, "/proc/meminfo has no SwapTotal");
  return Number(kib) * 1024;
}

function expectedMemoryLimits(memoryMax: number, swap: number) {
  const gib = 1024 * 1024 * 1024;
  const reserve = Math.max(Math.floor((memoryMax * 15) / 100), gib);
  const high = Math.max(memoryMax - reserve, Math.floor(memoryMax / 2));
  const agentsMax = memoryMax - 256 * 1024 * 1024;
  return {
    low: String(reserve),
    high: String(high),
    max: agentsMax > high ? String(agentsMax) : "max",
    swap: String(Math.max(swap - reserve, Math.floor(swap / 2))),
  };
}

function launcherFunctions(): string {
  const text = readFileSync(LAUNCHER, "utf8");
  return LAUNCHER_FUNCTIONS.map((name) => {
    const start = text.indexOf(`\n${name}() {\n`);
    assert.ok(start >= 0, `the launcher has no ${name} function`);
    const end = text.indexOf("\n}\n", start);
    return text.slice(start + 1, end + 3);
  }).join("\n");
}

function runInPrivateProcessView(args: string[]): void {
  const result = spawnSync("unshare", ["-Urpf", "--mount-proc", process.execPath, SELF, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `the probe failed: ${result.stderr}`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--probe") {
    const directory = process.argv[3];
    assert.ok(directory, "the probe needs an output directory");
    writeFileSync(join(directory, "probe.json"), `${JSON.stringify(await probe(directory), null, 2)}\n`);
    return;
  }
  assert.equal(process.platform, "linux", "this test needs Linux");
  assert.equal(spawnSync("systemctl", ["--user", "is-system-running"]).error, undefined, "systemctl is missing");
  rmSync(OUT, { recursive: true, force: true });
  const desktop = join(OUT, "desktop");
  const server = join(OUT, "server");
  mkdirSync(desktop, { recursive: true });
  mkdirSync(server, { recursive: true });

  runInPrivateProcessView(["--probe", desktop]);
  const desktopProbe = readProbe(desktop);
  assert.equal(desktopProbe.cgroupRoot, `/sys/fs/cgroup${desktopProbe.ownCgroup}`);
  assert.equal(desktopProbe.markedAfter, desktopProbe.markedBefore, "a process moved outside a split unit");

  const unitScript = join(server, "unit.sh");
  writeFileSync(
    unitScript,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      launcherFunctions(),
      "split_service_cgroup",
      `exec unshare -Urpf --mount-proc ${JSON.stringify(process.execPath)} ${JSON.stringify(SELF)} --probe ${JSON.stringify(server)}`,
      "",
    ].join("\n"),
  );
  const run = spawnSync(
    "systemd-run",
    [
      "--user",
      `--unit=${UNIT}`,
      "--wait",
      "--collect",
      "--quiet",
      "-p",
      "Delegate=yes",
      "-p",
      `MemoryMax=${UNIT_MEMORY_MAX}`,
      "-p",
      `WorkingDirectory=${ROOT}`,
      "-E",
      `PATH=${process.env.PATH ?? ""}`,
      "bash",
      unitScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, `the unit failed: ${run.stderr}`);
  const serverProbe = readProbe(server);
  const unitCgroup = serverProbe.ownCgroup.replace(/\/main$/u, "");
  assert.match(serverProbe.ownCgroup, /\/openbot\.service\/main$/u, "main is not in the main child cgroup");
  assert.equal(serverProbe.cgroupRoot, `/sys/fs/cgroup${unitCgroup}`, "the cgroup root is not the unit");
  assert.equal(serverProbe.memory.unit, "limited");
  assert.equal(serverProbe.memory.total, UNIT_MEMORY_MAX, "the memory guard does not read the unit limit");
  assert.equal(serverProbe.markedBefore, serverProbe.ownCgroup);
  assert.equal(serverProbe.markedAfter, `${unitCgroup}/agents`, "the agent process did not move");
  assert.equal(serverProbe.unmarkedAfter, serverProbe.ownCgroup, "a process that is not an agent moved");
  assert.equal(serverProbe.childOfMarked, `${unitCgroup}/agents`, "a new agent child did not start in agents");
  assert.deepEqual(serverProbe.errors, []);
  const memoryDelegated = serverProbe.agentLimits["memory.high"] !== null;
  if (memoryDelegated) {
    const expected = expectedMemoryLimits(UNIT_MEMORY_MAX, swapTotalBytes());
    assert.equal(serverProbe.mainLimits["memory.low"], expected.low, "main has the wrong memory.low");
    assert.equal(serverProbe.agentLimits["memory.high"], expected.high, "agents have the wrong memory.high");
    assert.equal(serverProbe.agentLimits["memory.max"], expected.max, "agents have the wrong memory.max");
    assert.equal(serverProbe.agentLimits["memory.swap.max"], expected.swap, "agents have the wrong memory.swap.max");
  }
  const cpuDelegated = serverProbe.agentLimits["cpu.weight"] !== null;
  if (cpuDelegated) {
    assert.equal(serverProbe.mainLimits["cpu.weight"], "100");
    assert.equal(serverProbe.agentLimits["cpu.weight"], "20");
  }

  const report = { ok: true, memoryDelegated, cpuDelegated, desktop: desktopProbe, server: serverProbe };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`The server agent cgroup E2E test passed. Report: ${join(OUT, "report.json")}`);
}

await main();
