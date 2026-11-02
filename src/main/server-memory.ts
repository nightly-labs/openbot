import { readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { getPriority, setPriority } from "node:os";
import { Deferred, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { HostMemory, HostMemoryLevel } from "../backend/host-memory";

const SAMPLE_INTERVAL_MS = 5_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** A turn that starts counts this much until its provider processes have grown. */
const TURN_RESERVE_BYTES = 300 * MIB;
const TURN_RESERVE_MS = 60_000;
/** A low level goes back to "ok" only this far above the low threshold, so it does not flap. */
const RECOVER_MARGIN_BYTES = 256 * MIB;
/**
 * `openbot.service` starts main at -500, and a container starts it at 0. Each process that main starts
 * gets this value, so the OOM killer picks a provider CLI, an MCP server or an agent tool before main.
 */
const CHILD_OOM_SCORE_ADJ = 500;
const PROC_READ_CONCURRENCY = 16;
/**
 * Every process that a provider starts for an agent on a server has this variable, and keeps it when
 * it leaves main's tree. Xvfb, D-Bus and the keyring of a container start before main and do not.
 */
export const AGENT_PROCESS_VARIABLE = "OPENBOT_AGENT_PROCESS";
const AGENT_PROCESS_ENTRY = `\0${AGENT_PROCESS_VARIABLE}=1\0`;
/** Agent processes run at this nice value, so main and the WebRTC host keep the CPU when builds fill it. */
const AGENT_PROCESS_NICE = 10;
/** An orphan that SIGTERM has not ended after this long gets SIGKILL. */
const STOP_GRACE_MS = 5_000;
/** A process younger than this is never stopped, such as the wake-up command that a stopped job's shell runs. */
const STOP_MIN_AGE_MS = 5_000;

export interface ServerMemoryOptions {
  /** True on a hosted server, whose plan sets the memory. */
  hostedPlan: boolean;
  /** Called one time when the memory files cannot be read (the level then stays "ok"), and when a listener fails. */
  onError: (message: string, error: unknown) => void;
  /** Called for each leftover agent process that the server signals to free memory. */
  onAgentProcessStopped?: (process: StoppedAgentProcess) => void;
  now?: () => number;
}

/** The name is the kernel's short process name. The command line can hold secrets, so it is never read. */
export interface StoppedAgentProcess {
  pid: number;
  name: string;
  rssBytes: number;
  signal: "SIGTERM" | "SIGKILL";
}

/**
 * The variables that each provider process on a server gets, and so every process an agent starts:
 * the marker of `AgentProcesses`, and `cpuLimitModule` (`resources/agent-runtime/cpu-limit.cjs`) in
 * NODE_OPTIONS after the options that OpenBot runs with. Node does not start when a `--require` file
 * is missing, so without the file NODE_OPTIONS stays as it is.
 */
export function agentProcessEnvironment(
  cpuLimitModule: string | null,
  inherited: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  // Node reads a quoted value in NODE_OPTIONS as one option, so a path with a space works.
  const preload = cpuLimitModule ? `--require=${JSON.stringify(cpuLimitModule)}` : null;
  return {
    [AGENT_PROCESS_VARIABLE]: "1",
    ...(preload ? { NODE_OPTIONS: inherited.NODE_OPTIONS ? `${inherited.NODE_OPTIONS} ${preload}` : preload } : {}),
  };
}

export interface MemorySample {
  /** The effective memory ceiling: the smaller of the machine memory and the cgroup limit. */
  total: number;
  available: number;
}

/**
 * Owns the memory reading of a hosted, self-hosted or container server. Every 5 seconds it reads the
 * memory of its cgroup (v2), such as the systemd unit or the container, and of the machine, and tunes
 * the agent processes (`AgentProcesses`). The backend reads the level through `HostMemory` and holds
 * new turns while it is not "ok". The desktop app does not use it.
 */
export class ServerMemory implements HostMemory {
  readonly #options: ServerMemoryOptions;
  readonly #listeners = new Set<() => void>();
  /** The start times of the turns reserved in the last `TURN_RESERVE_MS`. Each one is its own object, so its release removes only it. */
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

  /** The last reading, or null before the first one and when the memory files cannot be read. */
  sample(): MemorySample | null {
    return this.#sample;
  }

  turnLimit(): 2 | 8 | 16 {
    // A margin over the plan sizes of 4 and 8 GB: the kernel keeps some memory for itself. On 4 GB,
    // four turns that start together reserve enough `TURN_RESERVE_BYTES` to reach the low level.
    const total = this.#sample?.total ?? 0;
    if (total <= 5 * GIB) return 2;
    if (total <= 10 * GIB) return 8;
    return 16;
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
        // In a container on cgroup v1, the machine memory is the memory of the host, not the limit.
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
    const low = Math.max(512 * MIB, sample.total * 0.12);
    if (free < low) return "low";
    if (this.#level !== "ok" && free < low + RECOVER_MARGIN_BYTES) return "low";
    return "ok";
  }

  /** At the critical level, the memory that brings it back above that level by the recover margin. */
  #bytesToFree(): number {
    const sample = this.#sample;
    if (this.#level !== "critical" || !sample) return 0;
    return criticalBytes(sample) + RECOVER_MARGIN_BYTES - sample.available;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

function criticalBytes(sample: MemorySample): number {
  return Math.max(256 * MIB, sample.total * 0.06);
}

/**
 * The memory of a Linux machine, or of main's cgroup when it has a smaller limit. `unit` says which
 * one limits it. Server settings read it too, for the machine part of Storage.
 */
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

/** The cgroup v2 folder of main, or null on cgroup v1 or a hybrid hierarchy. */
export const readCgroupRoot = Effect.fn("ServerMemory.readCgroupRoot")(function* () {
  const cgroup = (yield* memoryIO(() => readFile("/proc/self/cgroup", "utf8")))
    .split("\n")
    .find((line) => line.startsWith("0::"));
  // A container with its own cgroup namespace sees "0::/", and its limits at /sys/fs/cgroup.
  return cgroup ? `/sys/fs/cgroup${cgroup.slice(3)}` : null;
});

/**
 * The limit and the use of main's cgroup, with no reclaimable file cache. "unlimited" when the cgroup
 * has no limit, and "unknown" when there is no cgroup v2 memory controller to read (cgroup v1 or a
 * hybrid hierarchy).
 */
const readUnitMemory = Effect.fn("ServerMemory.readUnit")(function* () {
  const root = yield* readCgroupRoot();
  if (!root) return "unknown";
  // Only a missing file means no memory controller. Another failure is a read error.
  const max = (yield* memoryIO(() => readFile(`${root}/memory.max`, "utf8")).pipe(
    Effect.catchIf(
      ({ cause }) => cause instanceof Error && "code" in cause && cause.code === "ENOENT",
      () => Effect.succeed(null),
    ),
  ))?.trim();
  if (max === undefined) return "unknown";
  if (max === "max") return "unlimited";
  const current = Number((yield* memoryIO(() => readFile(`${root}/memory.current`, "utf8"))).trim());
  // `memory.current` counts the file cache too. The kernel takes the inactive part back before the
  // OOM killer acts, so it is free memory, as it is in `MemAvailable`.
  const inactiveFile = /^inactive_file (\d+)$/m.exec(
    yield* memoryIO(() => readFile(`${root}/memory.stat`, "utf8")),
  )?.[1];
  return { max: Number(max), current: current - Number(inactiveFile ?? 0) };
});

interface ProcessEntry {
  pid: number;
  parent: number;
  name: string;
  /** Z for a zombie, which holds no memory. */
  state: string;
  /** The start time in clock ticks since boot. With the pid, it names one process: a pid is reused. */
  start: string;
}

interface Classification {
  start: string;
  exe: string | null;
  marked: boolean;
  /** When this pass first saw the program. */
  seenAt: number;
  /** True once the process had a child: a shell or a build that runs others is never stopped. */
  parent: boolean;
}

/**
 * Tunes the processes that agents start on a server, and stops leftover ones when memory runs out.
 *
 * Main's descendants, other than the Electron processes, get at least `CHILD_OOM_SCORE_ADJ`. A
 * process with `AGENT_PROCESS_VARIABLE` gets it too, and each of its threads gets the nice value
 * `AGENT_PROCESS_NICE`. The variable is the test because a job that an agent detaches, and the
 * workers of a build whose parent the OOM killer took, leave main's tree: the kernel gives them to
 * PID 1. Such an orphan is not part of a provider that runs. When the level is critical, this stops
 * the largest orphans that never had a child and that run for at least `STOP_MIN_AGE_MS`. A shell or
 * a build that runs other programs is never stopped, so the shell of a detached job runs its next
 * command, such as the one that wakes the agent with the exit status, and that new short command is
 * too young to be stopped. A job of one process, such as a preview server, is stopped.
 * A process can end during the pass, so each read, write and signal can fail and is ignored.
 *
 * An Electron process runs the same binary as main. Chromium sets the values of its renderers and GPU
 * process itself, and the zygotes and the GPU broker keep the value of main (-500 in the unit, 0 in a
 * container). `app.getAppMetrics()` does not list the zygotes or the broker, so the binary is the
 * test: with 500, the OOM killer could kill a zygote, and then no new renderer can start. The WebRTC
 * host is a renderer, so the Electron processes also keep their nice value.
 */
class AgentProcesses {
  readonly #known = new Map<number, Classification>();
  /** The orphans that got SIGTERM, when, and whether they got SIGKILL after it. */
  readonly #stopping = new Map<number, { start: string; at: number; killed: boolean }>();

  /** `neededBytes` is the memory to free, 0 when the level is not critical. Returns the processes it signalled. */
  update = Effect.fn("ServerMemory.agentProcesses")(function* (this: AgentProcesses, neededBytes: number, now: number) {
    const electron = yield* optionalMemoryIO(() => readlink("/proc/self/exe"));
    if (electron === null) return [];
    const entries = (yield* Effect.forEach(
      (yield* optionalMemoryIO(() => readdir("/proc"))) ?? [],
      (entry) => (/^\d+$/.test(entry) ? readProcessEntry(Number(entry)) : Effect.succeed(null)),
      // A self-hosted machine can have thousands of processes. Each read holds a file descriptor.
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
          // A new program replaces the environment too. Between its fork and its exec, a child of main
          // still runs Electron with main's environment.
          const exe = yield* optionalMemoryIO(() => readlink(`/proc/${entry.pid}/exe`));
          let known = this.#known.get(entry.pid);
          if (known?.start !== entry.start || known.exe !== exe) {
            // Another user's process cannot be read, and is not an agent's.
            const environment = yield* optionalMemoryIO(() => readFile(`/proc/${entry.pid}/environ`, "latin1"));
            known = {
              start: entry.start,
              exe,
              marked: environment !== null && `\0${environment}`.includes(AGENT_PROCESS_ENTRY),
              seenAt: now,
              parent: false,
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
          // Only a marked process: main also starts the Computer Use driver and remote desktop, which
          // answer the user. The nice value belongs to each thread, and a new thread copies the one of
          // the thread that starts it, so each tick looks at every thread again.
          if (!known.marked) return;
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
      // One SIGKILL: a process in uninterruptible sleep or a zombie stays listed for a while after it.
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
  // The name can hold spaces and parentheses, so the fields start after the last ")". After it come
  // field 3 (the state), field 4 (the parent) and, at index 19, field 22 (the start time).
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

/** False when the process is gone or is not this user's. */
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
