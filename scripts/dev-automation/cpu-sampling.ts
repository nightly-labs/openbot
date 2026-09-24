// The arithmetic behind `dev:automation cpu`. Pure on purpose: no process is
// spawned and no file is read here, so every rule below is testable in Node.
//
// Why this module exists at all, rather than a one-line `ps` pipe: `ps -o %cpu`
// reports total CPU time divided by process *lifetime*. An app that was busy
// for ten seconds at start-up and idle for an hour still reports a high `%cpu`,
// and it reports it stably, run after run. That is the worst possible failure
// for an A/B comparison - a confident wrong number that does not move when the
// code gets better. The only correct reading is a delta of the cumulative
// `cputime` counter across a known wall-clock interval, which is what
// `cpuSecondsBetween` does for every consecutive pair of samples.
//
// "Percent" here is percent of one core. 100 means one core fully used; a
// machine with eight cores can therefore report more than 100 in total.

import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export type ChromiumProcessType = "main" | "renderer" | "gpu" | "utility" | "network" | "crashpad" | "other";

// One process at one instant. `cpuSeconds` is cumulative since the process
// started, never a rate.
export interface ProcessSnapshot {
  pid: number;
  type: ChromiumProcessType;
  cpuSeconds: number;
}

export interface CpuSample {
  atMs: number;
  processes: ProcessSnapshot[];
}

export interface ProcessTypeUsage {
  type: ChromiumProcessType;
  cpuPercent: number;
  processes: number;
}

export interface CpuReport {
  label: string;
  durationMs: number;
  samples: number;
  processes: ProcessTypeUsage[];
  totalCpuPercent: number;
}

export interface ProcessTableRow {
  pid: number;
  ppid: number;
  // Resident set size in kilobytes, as `ps -o rss=` prints it.
  rssKb: number;
  cpuSeconds: number;
  command: string;
}

// `ps -o cputime=` prints `MM:SS.ss`, `HH:MM:SS.ss` or `D-HH:MM:SS`. Minutes
// are unbounded in the two-field form, which is how macOS prints a process
// that has used more than an hour but less than a day.
const PROCESS_TIME_PATTERN = /^(?:(\d+)-)?(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

/**
 * Cumulative CPU seconds from a `ps -o cputime=` field, or `null` when the
 * field is not a time. `null` rather than `NaN` so a single unreadable row
 * cannot poison a sum: the caller drops the row instead of reporting a number
 * that is silently not a number.
 */
export function parseProcessTime(raw: string): number | null {
  const match = PROCESS_TIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, days, first, second, third, fraction] = match;
  // The day field only ever appears with a full `HH:MM:SS`, so `2-03:04` is
  // not a format `ps` produces and is more likely a misread column.
  if (days !== undefined && third === undefined) return null;
  const hours = third === undefined ? 0 : Number(first);
  const minutes = third === undefined ? Number(first) : Number(second);
  const seconds = third === undefined ? Number(second) : Number(third);
  if (seconds >= SECONDS_PER_MINUTE) return null;
  if (third !== undefined && minutes >= SECONDS_PER_MINUTE) return null;
  const whole = Number(days ?? 0) * SECONDS_PER_DAY + hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
  return whole + (fraction === undefined ? 0 : Number(`0.${fraction}`));
}

const CHROMIUM_TYPE_SWITCH = /--type=(\S+)/;
const UTILITY_SUB_TYPE_SWITCH = /--utility-sub-type=(\S+)/;
// A macOS bundle executable, which is what both the dev Electron binary and a
// packaged OpenBot are launched as.
const BUNDLE_EXECUTABLE = /\.app\/contents\/macos\//;

/**
 * Which part of the browser a command line belongs to.
 *
 * A Chromium child announces itself with `--type=`; the browser process - what
 * Electron calls main - is the one without it. That rule alone is not enough
 * here, because the sampled tree is rooted at the dev supervisor and also holds
 * the Vite server and Bun, which carry no `--type=` either. So a process only
 * counts as `main` when it is an Electron executable as well; everything else
 * unrecognized is `other`, which keeps dev-server cost visible without
 * mislabelling it as the app.
 */
export function classifyChromiumProcess(command: string): ChromiumProcessType {
  const type = CHROMIUM_TYPE_SWITCH.exec(command)?.[1];
  if (type === undefined) return isElectronExecutable(command) ? "main" : "other";
  if (type === "renderer") return "renderer";
  if (type === "gpu-process") return "gpu";
  if (type === "crashpad-handler") return "crashpad";
  if (type === "utility") {
    const subType = UTILITY_SUB_TYPE_SWITCH.exec(command)?.[1] ?? "";
    return subType.includes("NetworkService") ? "network" : "utility";
  }
  return "other";
}

function isElectronExecutable(command: string): boolean {
  const executable = command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (BUNDLE_EXECUTABLE.test(executable)) return true;
  return executable.endsWith("/electron") || executable === "electron";
}

const PROCESS_TABLE_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/;

/** The `ps` arguments whose output `parseProcessTable` reads. */
export const PROCESS_TABLE_PS_ARGS = ["-o", "pid=,ppid=,rss=,cputime=,command=", "-ax"] as const;

/**
 * Rows from `ps -o pid=,ppid=,rss=,cputime=,command= -ax`. A row whose time
 * field does not parse is dropped rather than guessed at.
 */
export function parseProcessTable(stdout: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = PROCESS_TABLE_ROW.exec(line);
    if (!match) continue;
    const cpuSeconds = parseProcessTime(match[4] ?? "");
    if (cpuSeconds === null) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      cpuSeconds,
      command: match[5] ?? "",
    });
  }
  return rows;
}

/**
 * The root and everything under it. The walk is anchored on a pid the instance
 * registry published, never on a name: matching "electron" would pick up
 * another worktree's dev app, and attribute its cost to this measurement.
 */
export function collectDescendants(rows: ProcessTableRow[], rootPid: number): ProcessTableRow[] {
  const byParent = new Map<number, ProcessTableRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.ppid);
    if (siblings) siblings.push(row);
    else byParent.set(row.ppid, [row]);
  }
  const collected: ProcessTableRow[] = [];
  const seen = new Set<number>();
  const queue = rows.filter((row) => row.pid === rootPid);
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row || seen.has(row.pid)) continue;
    seen.add(row.pid);
    collected.push(row);
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return collected;
}

export function snapshotProcesses(rows: ProcessTableRow[]): ProcessSnapshot[] {
  return rows.map((row) => ({ pid: row.pid, type: classifyChromiumProcess(row.command), cpuSeconds: row.cpuSeconds }));
}

interface ProcessCpuSeconds {
  pid: number;
  type: ChromiumProcessType;
  cpuSeconds: number;
}

// A pid in only one of the two snapshots is dropped, not counted from zero: a
// renderer that started mid-interval would otherwise report its whole lifetime
// of CPU as if it had all happened inside the interval, and a window opened
// during a run would read as a spike that is not there. A negative delta means
// the pid was recycled onto a different process, which is the same problem.
function cpuSecondsBetween(before: ProcessSnapshot[], after: ProcessSnapshot[]): ProcessCpuSeconds[] {
  const start = new Map(before.map((process) => [process.pid, process]));
  const used: ProcessCpuSeconds[] = [];
  for (const process of after) {
    const previous = start.get(process.pid);
    if (!previous) continue;
    const delta = process.cpuSeconds - previous.cpuSeconds;
    if (delta < 0) continue;
    used.push({ pid: process.pid, type: process.type, cpuSeconds: delta });
  }
  return used;
}

const REPORTED_TYPES: readonly ChromiumProcessType[] = [
  "main",
  "renderer",
  "gpu",
  "network",
  "utility",
  "crashpad",
  "other",
];

/**
 * One report from the whole run.
 *
 * CPU is accumulated over each consecutive pair of samples rather than from the
 * first sample to the last, so a renderer that opened and closed inside the run
 * still contributes the work it did. The divisor stays the full span, which is
 * what makes two runs of different length comparable.
 */
export function summarize(samples: CpuSample[], label: string): CpuReport {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationMs = first && last ? last.atMs - first.atMs : 0;
  if (!first || !last || durationMs <= 0) {
    return { label, durationMs: 0, samples: samples.length, processes: [], totalCpuPercent: 0 };
  }
  const secondsByType = new Map<ChromiumProcessType, number>();
  const pidsByType = new Map<ChromiumProcessType, Set<number>>();
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    for (const process of cpuSecondsBetween(previous.processes, current.processes)) {
      secondsByType.set(process.type, (secondsByType.get(process.type) ?? 0) + process.cpuSeconds);
      const pids = pidsByType.get(process.type) ?? new Set<number>();
      pids.add(process.pid);
      pidsByType.set(process.type, pids);
    }
  }
  const processes = REPORTED_TYPES.filter((type) => pidsByType.has(type)).map((type) => ({
    type,
    cpuPercent: round(((secondsByType.get(type) ?? 0) / (durationMs / 1_000)) * 100),
    processes: pidsByType.get(type)?.size ?? 0,
  }));
  return {
    label,
    durationMs,
    samples: samples.length,
    processes,
    totalCpuPercent: round(processes.reduce((total, process) => total + process.cpuPercent, 0)),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const PROCESS_TYPES: readonly ChromiumProcessType[] = REPORTED_TYPES;

/**
 * A report read back from `--out`, or `null` when the file is not one.
 *
 * `--compare` points at a file a developer chose, so it can be stale, truncated
 * or from another tool. Answering `null` lets the caller say which file is
 * wrong, instead of printing a delta against undefined.
 */
export function parseCpuReport(value: unknown): CpuReport | null {
  if (!isDynamicRecord(value)) return null;
  const { label, durationMs, samples, processes, totalCpuPercent } = value;
  if (!isString(label) || !isNumber(durationMs) || !isNumber(samples) || !isNumber(totalCpuPercent)) return null;
  if (!Array.isArray(processes)) return null;
  const parsed: ProcessTypeUsage[] = [];
  for (const process of processes) {
    if (!isDynamicRecord(process)) return null;
    if (!isOneOf(PROCESS_TYPES, process.type)) return null;
    if (!isNumber(process.cpuPercent) || !isNumber(process.processes)) return null;
    parsed.push({ type: process.type, cpuPercent: process.cpuPercent, processes: process.processes });
  }
  return { label, durationMs, samples, processes: parsed, totalCpuPercent };
}

// Memory, for `dev:automation memory`. Unlike CPU, resident memory is a level,
// not a counter, so one `ps` reading is a complete answer and no interval is
// needed.

export type MemoryProcessKind = ChromiumProcessType | "provider" | "dev-tooling";

// The provider command-line tools the app starts, by executable name. Each one
// can hold hundreds of megabytes, and with `other` they would hide in the noise.
const PROVIDER_EXECUTABLES: ReadonlySet<string> = new Set(["claude", "codex", "grok", "opencode", "cua-driver"]);
// What `bun run dev` adds around the app. A packaged build has none of it, so
// it is reported apart from the app total rather than inside it.
const DEV_TOOLING =
  /(?:^|[/\s])(?:vite|electron-vite|esbuild|workerd|wrangler|dotenvx)(?:\s|$)|dev-services\.ts|bun --watch/;

export function classifyMemoryProcess(command: string): MemoryProcessKind {
  const executable = command.trim().split(/\s+/)[0] ?? "";
  const name = executable.slice(executable.lastIndexOf("/") + 1).toLowerCase();
  if (PROVIDER_EXECUTABLES.has(name)) return "provider";
  const chromium = classifyChromiumProcess(command);
  if (chromium !== "other") return chromium;
  return DEV_TOOLING.test(command) ? "dev-tooling" : "other";
}

export interface MemoryProcess {
  pid: number;
  kind: MemoryProcessKind;
  rssMb: number;
  // The executable name only: a full command line can carry a path or a token.
  name: string;
}

export interface MemoryBucket {
  kind: MemoryProcessKind;
  rssMb: number;
  processes: number;
}

export interface MemoryReport {
  label: string;
  // Everything except dev tooling: what a packaged build would hold.
  appRssMb: number;
  devToolingRssMb: number;
  buckets: MemoryBucket[];
  processes: MemoryProcess[];
}

const MEMORY_KINDS: readonly MemoryProcessKind[] = [...REPORTED_TYPES, "provider", "dev-tooling"];

/**
 * One memory report from the rows `collectDescendants` returned.
 *
 * A child of a provider counts as provider too: the MCP servers a provider
 * starts live and die with it, so they are part of what releasing it saves.
 */
export function summarizeMemory(rows: ProcessTableRow[], label: string): MemoryReport {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const kinds = new Map<number, MemoryProcessKind>();
  const kindOf = (row: ProcessTableRow): MemoryProcessKind => {
    const known = kinds.get(row.pid);
    if (known) return known;
    const own = classifyMemoryProcess(row.command);
    const parent = byPid.get(row.ppid);
    const kind =
      own !== "provider" && parent && parent.pid !== row.pid && kindOf(parent) === "provider" ? "provider" : own;
    kinds.set(row.pid, kind);
    return kind;
  };
  const processes = rows
    .map((row) => {
      const executable = row.command.trim().split(/\s+/)[0] ?? "";
      return {
        pid: row.pid,
        kind: kindOf(row),
        rssMb: round(row.rssKb / 1_024),
        name: executable.slice(executable.lastIndexOf("/") + 1),
      };
    })
    .sort((left, right) => right.rssMb - left.rssMb);
  const buckets = MEMORY_KINDS.map((kind) => {
    const members = processes.filter((process) => process.kind === kind);
    return {
      kind,
      rssMb: round(members.reduce((total, process) => total + process.rssMb, 0)),
      processes: members.length,
    };
  }).filter((bucket) => bucket.processes > 0);
  const devToolingRssMb = buckets.find((bucket) => bucket.kind === "dev-tooling")?.rssMb ?? 0;
  const totalRssMb = buckets.reduce((total, bucket) => total + bucket.rssMb, 0);
  return { label, appRssMb: round(totalRssMb - devToolingRssMb), devToolingRssMb, buckets, processes };
}
