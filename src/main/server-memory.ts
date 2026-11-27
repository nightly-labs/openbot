import { constants } from "node:fs";
import { access, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { getPriority, setPriority } from "node:os";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Deferred, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { HostMemory, HostMemoryLevel } from "../backend/host-memory";

const SAMPLE_INTERVAL_MS = 5_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TURN_RESERVE_BYTES = 300 * MIB;
const TURN_RESERVE_MS = 60_000;
const RECOVER_MARGIN_BYTES = 256 * MIB;
const SMALL_HOSTED_SERVER_BYTES = 7 * GIB;
const SMALL_HOSTED_SERVER_BROWSER_TABS = 5;
const CHILD_OOM_SCORE_ADJ = 500;
const PROC_READ_CONCURRENCY = 16;
export const AGENT_PROCESS_VARIABLE = "OPENBOT_AGENT_PROCESS";
const AGENT_PROCESS_ENTRY = `\0${AGENT_PROCESS_VARIABLE}=1\0`;
const AGENT_PROCESS_NICE = 10;
const STOP_GRACE_MS = 5_000;
const STOP_MIN_AGE_MS = 5_000;
const SERVICE_CGROUP = "/openbot.service";
const MAIN_CGROUP = "/main";
const AGENT_CGROUP = "/agents";

export interface ServerMemoryOptions {
  hostedPlan: boolean;
  onError: (message: string, error: unknown) => void;
  onAgentProcessStopped?: (process: StoppedAgentProcess) => void;
  now?: () => number;
}

export interface StoppedAgentProcess {
  pid: number;
  name: string;
  rssBytes: number;
  signal: "SIGTERM" | "SIGKILL";
}

export function agentProcessEnvironment(
  cpuLimitModule: string | null,
  inherited: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const preload = cpuLimitModule ? `--require=${JSON.stringify(cpuLimitModule)}` : null;
  return {
    [AGENT_PROCESS_VARIABLE]: "1",
    ...(preload ? { NODE_OPTIONS: inherited.NODE_OPTIONS ? `${inherited.NODE_OPTIONS} ${preload}` : preload } : {}),
  };
}

export interface MemorySample {
  total: number;
  available: number;
}

export class ServerMemory implements HostMemory {
  readonly #options: ServerMemoryOptions;
  readonly #listeners = new Set<() => void>();
  readonly #reservations = new Set<{ at: number }>();
  readonly #agentProcesses = new AgentProcesses();
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Deferred.Deferred<void> | null = null;
  #sample: MemorySample | null = null;
  #level: HostMemoryLevel = "ok";
  #readErrorLogged = false;
  #noCgroupLogged = false;

  readonly hostedPlan: boolean;

  constructor(options: ServerMemoryOptions) {
    this.#options = options;
    this.hostedPlan = options.hostedPlan;
  }

  start(): void {
    if (this.#timer) return;
    void Effect.runPromise(this.tick());
    this.#timer = setInterval(() => void Effect.runPromise(this.tick()), SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      return this.#pending ? Deferred.await(this.#pending) : Effect.void;
    });
  }

  level(): HostMemoryLevel {
    return this.#level;
  }

  sample(): MemorySample | null {
    return this.#sample;
  }

  turnLimit(): 2 | 8 | 16 {
    const total = this.#sample?.total ?? 0;
    if (total <= 5 * GIB) return 2;
    if (total <= 10 * GIB) return 8;
    return 16;
  }

  browserTabLimit(): typeof SMALL_HOSTED_SERVER_BROWSER_TABS | typeof INPUT_LIMITS.browserTabs {
    const total = this.#sample?.total;
    return this.hostedPlan && total !== undefined && total < SMALL_HOSTED_SERVER_BYTES
      ? SMALL_HOSTED_SERVER_BROWSER_TABS
      : INPUT_LIMITS.browserTabs;
  }

  reserveTurn(): () => void {
    const reservation = { at: this.#now() };
    this.#reservations.add(reservation);
    this.#level = this.#nextLevel();
    return () => {
      if (this.#reservations.delete(reservation)) this.#level = this.#nextLevel();
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  tick(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#pending) return Deferred.await(this.#pending);
      const pending = Deferred.makeUnsafe<void>();
      this.#pending = pending;
      return this.#tick().pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            this.#pending = null;
            yield* Deferred.done(pending, exit);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  #tick = Effect.fn("ServerMemory.tick")(function* (this: ServerMemory) {
    this.#sample = yield* this.#read();
    this.#level = this.#nextLevel();
    const stopped = yield* this.#agentProcesses.update(this.#bytesToFree(), this.#now());
    for (const agentProcess of stopped) this.#options.onAgentProcessStopped?.(agentProcess);
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#options.onError("A server memory listener failed.", error);
      }
    }
  });

  #read = Effect.fn("ServerMemory.read")(function* (this: ServerMemory) {
    const result = yield* Effect.result(readLinuxMemory());
    if (result._tag === "Success") {
      if (result.success.unit === "unknown" && !this.#noCgroupLogged) {
        this.#noCgroupLogged = true;
        this.#options.onError(
          "The server has no cgroup v2 memory limit to read. The memory guard uses the machine memory.",
          null,
        );
      }
      return result.success.sample;
    }
    if (!this.#readErrorLogged) {
      this.#readErrorLogged = true;
      this.#options.onError("The server could not read its memory use.", result.failure.cause);
    }
    return null;
  });

  #nextLevel(): HostMemoryLevel {
    const sample = this.#sample;
    if (!sample) return "ok";
    const now = this.#now();
    for (const reservation of this.#reservations) {
      if (now - reservation.at >= TURN_RESERVE_MS) this.#reservations.delete(reservation);
    }
    if (sample.available < criticalBytes(sample)) return "critical";
    const free = sample.available - this.#reservations.size * TURN_RESERVE_BYTES;
    const low = lowBytes(sample);
    if (free < low) return "low";
    if (this.#level !== "ok" && free < low + Math.min(RECOVER_MARGIN_BYTES, sample.total * 0.1)) return "low";
    return "ok";
  }

  #bytesToFree(): number {
    const sample = this.#sample;
    if (this.#level !== "critical" || !sample) return 0;
    return criticalBytes(sample) + RECOVER_MARGIN_BYTES - sample.available;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

function lowBytes(sample: MemorySample): number {
  return Math.max(criticalBytes(sample) + 64 * MIB, sample.total * 0.12, Math.min(512 * MIB, sample.total * 0.2));
}

function criticalBytes(sample: MemorySample): number {
  return Math.max(256 * MIB, sample.total * 0.06);
}

export const readLinuxMemory = Effect.fn("ServerMemory.readLinux")(function* () {
  const text = yield* memoryIO(() => readFile("/proc/meminfo", "utf8"));
  const machine = yield* Effect.try({
    try: () => parseMeminfo(text),
    catch: (cause) => new HostMemoryFailure({ cause }),
  });
  const unit = yield* readUnitMemory();
  if (typeof unit === "string") return { sample: machine, unit };
  return {
    sample: {
      total: Math.min(machine.total, unit.max),
      available: Math.min(machine.available, Math.max(0, unit.max - unit.current)),
    },
    unit: "limited" as const,
  };
});

function parseMeminfo(text: string): MemorySample {
  const kib = (name: string): number => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(text);
    if (!match?.[1]) throw new Error(`/proc/meminfo has no ${name}.`);
    return Number(match[1]) * 1024;
  };
  return { total: kib("MemTotal"), available: kib("MemAvailable") };
}

const readOwnCgroup = Effect.fn("ServerMemory.readOwnCgroup")(function* () {
  const cgroup = (yield* memoryIO(() => readFile("/proc/self/cgroup", "utf8")))
    .split("\n")
    .find((line) => line.startsWith("0::"));
  return cgroup ? cgroup.slice(3) : null;
});

function splitServiceCgroup(path: string): string | null {
  return path.endsWith(`${SERVICE_CGROUP}${MAIN_CGROUP}`) ? path.slice(0, -MAIN_CGROUP.length) : null;
}

export const readCgroupRoot = Effect.fn("ServerMemory.readCgroupRoot")(function* () {
  const path = yield* readOwnCgroup();
  return path === null ? null : `/sys/fs/cgroup${splitServiceCgroup(path) ?? path}`;
});

interface AgentCgroup {
  procs: string;
  mainMembership: string;
}

const readAgentCgroup = Effect.fn("ServerMemory.readAgentCgroup")(function* () {
  const path = yield* readOwnCgroup();
  const service = path === null ? null : splitServiceCgroup(path);
  if (path === null || service === null) return null;
  const procs = `/sys/fs/cgroup${service}${AGENT_CGROUP}/cgroup.procs`;
  const writable = yield* optionalMemoryIO(() => access(procs, constants.W_OK).then(() => true));
  if (writable !== true) return null;
  return { procs, mainMembership: `0::${path}` } satisfies AgentCgroup;
});

const moveToAgentCgroup = Effect.fn("ServerMemory.moveToAgentCgroup")(function* (cgroup: AgentCgroup, pid: number) {
  const membership = yield* optionalMemoryIO(() => readFile(`/proc/${pid}/cgroup`, "utf8"));
  if (membership?.trim() !== cgroup.mainMembership) return;
  yield* optionalMemoryIO(() => writeFile(cgroup.procs, String(pid)));
});

const readUnitMemory = Effect.fn("ServerMemory.readUnit")(function* () {
  const root = yield* readCgroupRoot();
  if (!root) return "unknown";
  const max = (yield* memoryIO(() => readFile(`${root}/memory.max`, "utf8")).pipe(
    Effect.catchIf(
      ({ cause }) => cause instanceof Error && "code" in cause && cause.code === "ENOENT",
      () => Effect.succeed(null),
    ),
  ))?.trim();
  if (max === undefined) return "unknown";
  if (max === "max") return "unlimited";
  const current = Number((yield* memoryIO(() => readFile(`${root}/memory.current`, "utf8"))).trim());
  const stat = yield* memoryIO(() => readFile(`${root}/memory.stat`, "utf8"));
  const statBytes = (name: string): number => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(stat)?.[1] ?? 0);
  const reclaimable = statBytes("inactive_file") + Math.floor(statBytes("active_file") / 2);
  return { max: Number(max), current: current - reclaimable };
});

interface ProcessEntry {
  pid: number;
  parent: number;
  name: string;
  state: string;
  start: string;
}

interface Classification {
  start: string;
  exe: string | null;
  marked: boolean;
  seenAt: number;
  parent: boolean;
  grouped: boolean;
}

class AgentProcesses {
  readonly #known = new Map<number, Classification>();
  #agentCgroup: AgentCgroup | null | undefined;
  readonly #stopping = new Map<number, { start: string; at: number; killed: boolean }>();

  update = Effect.fn("ServerMemory.agentProcesses")(function* (this: AgentProcesses, neededBytes: number, now: number) {
    const electron = yield* optionalMemoryIO(() => readlink("/proc/self/exe"));
    if (electron === null) return [];
    if (this.#agentCgroup === undefined) {
      this.#agentCgroup = yield* readAgentCgroup().pipe(Effect.catch(() => Effect.succeed(null)));
    }
    const agentCgroup = this.#agentCgroup;
    const entries = (yield* Effect.forEach(
      (yield* optionalMemoryIO(() => readdir("/proc"))) ?? [],
      (entry) => (/^\d+$/.test(entry) ? readProcessEntry(Number(entry)) : Effect.succeed(null)),
      { concurrency: PROC_READ_CONCURRENCY },
    )).filter((entry) => entry !== null);
    const children = new Map<number, number[]>();
    for (const entry of entries) {
      const siblings = children.get(entry.parent) ?? [];
      siblings.push(entry.pid);
      children.set(entry.parent, siblings);
    }
    const descendants = new Set<number>();
    const pending = [...(children.get(process.pid) ?? [])];
    for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
      descendants.add(pid);
      pending.push(...(children.get(pid) ?? []));
    }
    const current = new Map(entries.map((entry) => [entry.pid, entry.start]));
    for (const [pid, known] of this.#known) if (current.get(pid) !== known.start) this.#known.delete(pid);
    for (const [pid, stopping] of this.#stopping) if (current.get(pid) !== stopping.start) this.#stopping.delete(pid);

    const classified = yield* Effect.forEach(
      entries.filter((entry) => entry.pid !== process.pid),
      (entry) =>
        Effect.gen({ self: this }, function* () {
          const exe = yield* optionalMemoryIO(() => readlink(`/proc/${entry.pid}/exe`));
          let known = this.#known.get(entry.pid);
          if (known?.start !== entry.start || known.exe !== exe) {
            const environment = yield* optionalMemoryIO(() => readFile(`/proc/${entry.pid}/environ`, "latin1"));
            known = {
              start: entry.start,
              exe,
              marked: environment !== null && `\0${environment}`.includes(AGENT_PROCESS_ENTRY),
              seenAt: now,
              parent: false,
              grouped: false,
            };
            this.#known.set(entry.pid, known);
          }
          if (children.has(entry.pid)) known.parent = true;
          return { entry, known };
        }),
      { concurrency: PROC_READ_CONCURRENCY },
    );
    const agents = classified.filter(
      ({ entry, known }) => known.exe !== electron && (known.marked || descendants.has(entry.pid)),
    );
    yield* Effect.forEach(
      agents,
      ({ entry, known }) =>
        Effect.gen(function* () {
          const path = `/proc/${entry.pid}/oom_score_adj`;
          const text = yield* optionalMemoryIO(() => readFile(path, "utf8"));
          if (text !== null && Number(text.trim()) < CHILD_OOM_SCORE_ADJ) {
            yield* optionalMemoryIO(() => writeFile(path, String(CHILD_OOM_SCORE_ADJ)));
          }
          if (!known.marked) return;
          if (agentCgroup !== null && !known.grouped) {
            known.grouped = true;
            yield* moveToAgentCgroup(agentCgroup, entry.pid);
          }
          for (const thread of (yield* optionalMemoryIO(() => readdir(`/proc/${entry.pid}/task`))) ?? []) {
            const tid = Number(thread);
            if ((optionalSync(() => getPriority(tid)) ?? AGENT_PROCESS_NICE) < AGENT_PROCESS_NICE) {
              optionalSync(() => setPriority(tid, AGENT_PROCESS_NICE));
            }
          }
        }),
      { concurrency: PROC_READ_CONCURRENCY, discard: true },
    );

    const stopped: StoppedAgentProcess[] = [];
    const orphans = agents.filter(({ entry, known }) => known.marked && !descendants.has(entry.pid));
    let freeing = 0;
    for (const { entry } of orphans) {
      const stopping = this.#stopping.get(entry.pid);
      if (!stopping) continue;
      const rssBytes = (yield* readRssBytes(entry.pid)) ?? 0;
      freeing += rssBytes;
      if (!stopping.killed && now - stopping.at >= STOP_GRACE_MS && signal(entry.pid, "SIGKILL")) {
        stopping.killed = true;
        stopped.push({ pid: entry.pid, name: entry.name, rssBytes, signal: "SIGKILL" });
      }
    }
    if (neededBytes <= freeing) return stopped;
    const leaves = yield* Effect.forEach(
      orphans.filter(
        ({ entry, known }) =>
          entry.state !== "Z" &&
          !known.parent &&
          now - known.seenAt >= STOP_MIN_AGE_MS &&
          !this.#stopping.has(entry.pid),
      ),
      ({ entry }) => Effect.map(readRssBytes(entry.pid), (rssBytes) => ({ entry, rssBytes: rssBytes ?? 0 })),
      { concurrency: PROC_READ_CONCURRENCY },
    );
    for (const { entry, rssBytes } of leaves.sort((left, right) => right.rssBytes - left.rssBytes)) {
      if (freeing >= neededBytes) break;
      if (!signal(entry.pid, "SIGTERM")) continue;
      this.#stopping.set(entry.pid, { start: entry.start, at: now, killed: false });
      freeing += rssBytes;
      stopped.push({ pid: entry.pid, name: entry.name, rssBytes, signal: "SIGTERM" });
    }
    return stopped;
  });
}

const readProcessEntry = Effect.fn("ServerMemory.readProcess")(function* (pid: number) {
  const stat = yield* optionalMemoryIO(() => readFile(`/proc/${pid}/stat`, "utf8"));
  if (stat === null) return null;
  const close = stat.lastIndexOf(")");
  const fields = stat.slice(close + 2).split(" ");
  const state = fields[0];
  const parent = Number(fields[1]);
  const start = fields[19];
  if (state === undefined || !Number.isInteger(parent) || start === undefined) return null;
  return { pid, parent, name: stat.slice(stat.indexOf("(") + 1, close), state, start } satisfies ProcessEntry;
});

const readRssBytes = Effect.fn("ServerMemory.readRss")(function* (pid: number) {
  const status = yield* optionalMemoryIO(() => readFile(`/proc/${pid}/status`, "utf8"));
  const kib = status === null ? undefined : /^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1];
  return kib === undefined ? null : Number(kib) * 1024;
});

function signal(pid: number, name: "SIGTERM" | "SIGKILL"): boolean {
  return optionalSync(() => process.kill(pid, name)) !== null;
}

function optionalSync<A>(operation: () => A): A | null {
  try {
    return operation();
  } catch {
    return null;
  }
}

class HostMemoryFailure extends Schema.TaggedError<HostMemoryFailure>()("HostMemoryFailure", {
  cause: Schema.Defect(),
}) {}

const { io: memoryIO } = causeHelpers(HostMemoryFailure);

function optionalMemoryIO<A>(operation: () => Promise<A>): Effect.Effect<A | null> {
  return memoryIO(operation).pipe(Effect.catch(() => Effect.succeed(null)));
}
