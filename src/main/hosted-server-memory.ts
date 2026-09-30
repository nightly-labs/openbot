import { readdir, readFile, writeFile } from "node:fs/promises";
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
 * The unit starts main at -500. Each process that main starts gets this value, so the OOM killer in
 * the unit picks a provider CLI, an MCP server or an agent tool before main.
 */
const CHILD_OOM_SCORE_ADJ = 500;

export interface HostedServerMemoryOptions {
  /** The Electron processes. Chromium sets their OOM values itself. */
  electronPids: () => readonly number[];
  /** Called one time when the memory files cannot be read (the level then stays "ok"), and when a listener fails. */
  onError: (message: string, error: unknown) => void;
  now?: () => number;
}

interface MemorySample {
  total: number;
  available: number;
}

/**
 * Owns the memory reading of a hosted server. Every 5 seconds it reads the memory of the systemd unit
 * (cgroup v2) and of the machine, and gives each new child process of main a high OOM value.
 * The backend reads the level through `HostMemory` and holds new turns while it is not "ok".
 */
export class HostedServerMemory implements HostMemory {
  readonly #options: HostedServerMemoryOptions;
  readonly #listeners = new Set<() => void>();
  /** The start times of the turns reserved in the last `TURN_RESERVE_MS`. Each one is its own object, so its release removes only it. */
  readonly #reservations = new Set<{ at: number }>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Promise<void> | null = null;
  #sample: MemorySample | null = null;
  #level: HostMemoryLevel = "ok";
  #readErrorLogged = false;

  constructor(options: HostedServerMemoryOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  level(): HostMemoryLevel {
    return this.#level;
  }

  turnLimit(): 4 | 8 | 16 {
    // A margin over the plan sizes of 4 and 8 GB: the kernel keeps some memory for itself.
    const total = this.#sample?.total ?? 0;
    if (total <= 5 * GIB) return 4;
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

  tick(): Promise<void> {
    this.#pending ??= this.#tick().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #tick(): Promise<void> {
    this.#sample = await this.#read();
    this.#level = this.#nextLevel();
    await raiseChildOomScores(new Set([process.pid, ...this.#options.electronPids()]));
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#options.onError("A hosted server memory listener failed.", error);
      }
    }
  }

  async #read(): Promise<MemorySample | null> {
    try {
      const machine = parseMeminfo(await readFile("/proc/meminfo", "utf8"));
      const unit = await readUnitMemory();
      if (!unit) return machine;
      return {
        total: Math.min(machine.total, unit.max),
        available: Math.min(machine.available, Math.max(0, unit.max - unit.current)),
      };
    } catch (error) {
      if (!this.#readErrorLogged) {
        this.#readErrorLogged = true;
        this.#options.onError("The hosted server could not read its memory use.", error);
      }
      return null;
    }
  }

  #nextLevel(): HostMemoryLevel {
    const sample = this.#sample;
    if (!sample) return "ok";
    const now = this.#now();
    for (const reservation of this.#reservations) {
      if (now - reservation.at >= TURN_RESERVE_MS) this.#reservations.delete(reservation);
    }
    if (sample.available < Math.max(256 * MIB, sample.total * 0.06)) return "critical";
    const free = sample.available - this.#reservations.size * TURN_RESERVE_BYTES;
    const low = Math.max(512 * MIB, sample.total * 0.12);
    if (free < low) return "low";
    if (this.#level !== "ok" && free < low + RECOVER_MARGIN_BYTES) return "low";
    return "ok";
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

function parseMeminfo(text: string): MemorySample {
  const kib = (name: string): number => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(text);
    if (!match?.[1]) throw new Error(`/proc/meminfo has no ${name}.`);
    return Number(match[1]) * 1024;
  };
  return { total: kib("MemTotal"), available: kib("MemAvailable") };
}

/**
 * The limit and the use of the unit's cgroup, with no reclaimable file cache, or null when the unit
 * has no limit or no cgroup v2.
 */
async function readUnitMemory(): Promise<{ max: number; current: number } | null> {
  const cgroup = (await readFile("/proc/self/cgroup", "utf8")).split("\n").find((line) => line.startsWith("0::"));
  if (!cgroup) return null;
  const root = `/sys/fs/cgroup${cgroup.slice(3)}`;
  const max = (await readFile(`${root}/memory.max`, "utf8")).trim();
  if (max === "max") return null;
  const current = Number((await readFile(`${root}/memory.current`, "utf8")).trim());
  // `memory.current` counts the file cache too. The kernel takes the inactive part back before the
  // OOM killer acts, so it is free memory, as it is in `MemAvailable`.
  const inactiveFile = /^inactive_file (\d+)$/m.exec(await readFile(`${root}/memory.stat`, "utf8"))?.[1];
  return { max: Number(max), current: current - Number(inactiveFile ?? 0) };
}

/**
 * Gives each descendant of main, other than the skipped processes, at least `CHILD_OOM_SCORE_ADJ`.
 * A process can end during the walk, so each read and write can fail and is ignored.
 */
async function raiseChildOomScores(skip: ReadonlySet<number>): Promise<void> {
  const children = new Map<number, number[]>();
  const entries = await readdir("/proc").catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (!/^\d+$/.test(entry)) return;
      const stat = await readFile(`/proc/${entry}/stat`, "utf8").catch(() => null);
      if (stat === null) return;
      // The name in parentheses can hold spaces, so the fields start after the last ")".
      const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!Number.isInteger(parent)) return;
      const siblings = children.get(parent) ?? [];
      siblings.push(Number(entry));
      children.set(parent, siblings);
    }),
  );
  const descendants: number[] = [];
  const pending = [...(children.get(process.pid) ?? [])];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  await Promise.all(
    descendants
      .filter((pid) => !skip.has(pid))
      .map(async (pid) => {
        const path = `/proc/${pid}/oom_score_adj`;
        const text = await readFile(path, "utf8").catch(() => null);
        if (text !== null && Number(text.trim()) < CHILD_OOM_SCORE_ADJ) {
          await writeFile(path, String(CHILD_OOM_SCORE_ADJ)).catch(() => undefined);
        }
      }),
  );
}
