import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { MachineMetrics } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { readCgroupRoot, readLinuxMemory } from "./server-memory";

const VM_STAT_TIMEOUT_MS = 5_000;
const CPU_FIRST_SAMPLE_MS = 1_000;

interface CpuSample {
  at: number;
  busy: number;
  capacity: number | null;
  cores: number;
}

interface DiskReading {
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
}

interface MemoryReading {
  availableBytes: number;
  totalBytes: number;
}

export class MachineMetricsSampler {
  readonly #dataPath: string;
  readonly #platform: NodeJS.Platform;
  #previous: CpuSample | null = null;

  constructor(dataPath: string, platform: NodeJS.Platform = process.platform) {
    this.#dataPath = dataPath;
    this.#platform = platform;
  }

  readonly read = Effect.fn("MachineMetrics.read")(function* (this: MachineMetricsSampler) {
    const [disk, memory, cpu] = yield* Effect.all([readDisk(this.#dataPath), readMemory(this.#platform), this.#cpu()], {
      concurrency: "unbounded",
    });
    return {
      diskUsedBytes: disk?.usedBytes ?? null,
      diskFreeBytes: disk?.freeBytes ?? null,
      diskTotalBytes: disk?.totalBytes ?? null,
      memoryAvailableBytes: memory?.availableBytes ?? null,
      memoryTotalBytes: memory?.totalBytes ?? null,
      cpuPercent: cpu.percent,
      cpuMillicores: Math.round(cpu.cores * 1000),
      checkedAt: new Date().toISOString(),
    } satisfies MachineMetrics;
  });

  #cpu = Effect.fn("MachineMetrics.cpu")(function* (this: MachineMetricsSampler) {
    let previous = this.#previous;
    let current = yield* readCpu(this.#platform);
    if (!previous || current.at - previous.at < CPU_FIRST_SAMPLE_MS || current.cores !== previous.cores) {
      previous = current;
      yield* Effect.sleep(CPU_FIRST_SAMPLE_MS);
      current = yield* readCpu(this.#platform);
    }
    this.#previous = current;
    const capacity =
      current.capacity !== null && previous.capacity !== null
        ? current.capacity - previous.capacity
        : (current.at - previous.at) * 1000 * current.cores;
    const percent =
      capacity > 0 ? Math.round(Math.min(1, Math.max(0, (current.busy - previous.busy) / capacity)) * 100) : null;
    return { percent, cores: current.cores };
  });
}

function readCpu(platform: NodeJS.Platform): Effect.Effect<CpuSample> {
  const machine = Effect.sync(machineCpu);
  if (platform !== "linux") return machine;
  return readCgroupCpu().pipe(
    Effect.map((sample) => sample ?? machineCpu()),
    Effect.catch(() => machine),
  );
}

function machineCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  const cores = cpus();
  for (const { times } of cores) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { at: Date.now(), busy: (total - idle) * 1000, capacity: total * 1000, cores: Math.max(1, cores.length) };
}

const readCgroupCpu = Effect.fn("MachineMetrics.cgroupCpu")(function* () {
  const root = yield* readCgroupRoot();
  if (!root) return null;
  const machineCores = cpus().length;
  const cpuset = yield* Effect.tryPromise(() => readFile(`${root}/cpuset.cpus.effective`, "utf8")).pipe(
    Effect.map(cpuListSize),
    Effect.catch(() => Effect.succeed(null)),
  );
  const allowedCores = Math.min(cpuset ?? Number.POSITIVE_INFINITY, machineCores || Number.POSITIVE_INFINITY);
  const [quota, period] = (yield* Effect.tryPromise(() => readFile(`${root}/cpu.max`, "utf8"))).trim().split(/\s+/u);
  const quotaCores = quota === "max" ? Number.POSITIVE_INFINITY : Number(quota) / Number(period);
  const limit = Math.min(quotaCores, allowedCores);
  if (!Number.isFinite(limit) || limit <= 0 || (quotaCores === Number.POSITIVE_INFINITY && limit >= machineCores))
    return null;
  const usage = /^usage_usec (\d+)$/mu.exec(yield* Effect.tryPromise(() => readFile(`${root}/cpu.stat`, "utf8")))?.[1];
  if (usage === undefined) return null;
  return { at: Date.now(), busy: Number(usage), capacity: null, cores: limit };
});

function cpuListSize(list: string): number | null {
  let size = 0;
  for (const part of list.trim().split(",")) {
    const [first, end] = part.split("-").map(Number);
    const last = end ?? first;
    if (
      first === undefined ||
      last === undefined ||
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      last < first
    )
      return null;
    size += last - first + 1;
  }
  return size > 0 ? size : null;
}

const readDisk = Effect.fn("MachineMetrics.disk")((path: string) =>
  Effect.tryPromise(() => statfs(path)).pipe(
    Effect.map((filesystem): DiskReading | null => {
      const usedBytes = (filesystem.blocks - filesystem.bfree) * filesystem.bsize;
      const freeBytes = filesystem.bavail * filesystem.bsize;
      const totalBytes = filesystem.blocks * filesystem.bsize;
      return [usedBytes, freeBytes, totalBytes].every((value) => Number.isSafeInteger(value) && value >= 0)
        ? { usedBytes, freeBytes, totalBytes }
        : null;
    }),
    Effect.catch(() => Effect.succeed(null)),
  ),
);

function readMemory(platform: NodeJS.Platform): Effect.Effect<MemoryReading | null> {
  if (platform === "linux")
    return readLinuxMemory().pipe(
      Effect.map(({ sample }) => ({ availableBytes: sample.available, totalBytes: sample.total })),
      Effect.catch(() => Effect.succeed(null)),
    );
  if (platform === "darwin")
    return readVmStat.pipe(
      Effect.map((text) => darwinMemory(text, totalmem())),
      Effect.catch(() => Effect.succeed(null)),
    );
  return Effect.sync(() => ({ availableBytes: freemem(), totalBytes: totalmem() }));
}

const readVmStat = Effect.callback<string, Error>((resume) => {
  const child = execFile("vm_stat", [], { encoding: "utf8", timeout: VM_STAT_TIMEOUT_MS }, (error, stdout) => {
    resume(error ? Effect.fail(error) : Effect.succeed(stdout));
  });
  return Effect.sync(() => {
    child.kill();
  });
});

function darwinMemory(text: string, totalBytes: number): MemoryReading | null {
  const pageSize = Number(/page size of (\d+) bytes/u.exec(text)?.[1]);
  const pages = (label: string): number => Number(new RegExp(`^${label}:\\s+(\\d+)\\.`, "mu").exec(text)?.[1]);
  const used =
    (pages("Anonymous pages") -
      pages("Pages purgeable") +
      pages("Pages wired down") +
      pages("Pages occupied by compressor")) *
    pageSize;
  if (!Number.isFinite(used) || used < 0 || totalBytes <= 0) return null;
  return { availableBytes: Math.max(0, Math.round(totalBytes - used)), totalBytes };
}
