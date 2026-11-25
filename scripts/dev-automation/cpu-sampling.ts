import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export type ChromiumProcessType = "main" | "renderer" | "gpu" | "utility" | "network" | "crashpad" | "other";

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
  rssKb: number;
  cpuSeconds: number;
  command: string;
}

const PROCESS_TIME_PATTERN = /^(?:(\d+)-)?(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

export function parseProcessTime(raw: string): number | null {
  const match = PROCESS_TIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, days, first, second, third, fraction] = match;
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
const BUNDLE_EXECUTABLE = /\.app\/contents\/macos\//;

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

export const PROCESS_TABLE_PS_ARGS = ["-o", "pid=,ppid=,rss=,cputime=,command=", "-ax"] as const;

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

export type MemoryProcessKind = ChromiumProcessType | "provider" | "dev-tooling";

const PROVIDER_EXECUTABLES: ReadonlySet<string> = new Set(["claude", "codex", "grok", "opencode", "cua-driver"]);
const DEV_TOOLING =
  /(?:^|[/\s])(?:vite|electron-vite|esbuild|workerd|wrangler|dotenvx)(?:\s|$)|dev-services\.ts|bun --watch/;

const SCRIPT_RUNNERS: ReadonlySet<string> = new Set(["node", "bun"]);

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

export function classifyMemoryProcess(command: string): MemoryProcessKind {
  const [executable = "", script = ""] = command.trim().split(/\s+/);
  const name = baseName(executable);
  if (PROVIDER_EXECUTABLES.has(name)) return "provider";
  if (SCRIPT_RUNNERS.has(name) && PROVIDER_EXECUTABLES.has(baseName(script))) return "provider";
  const chromium = classifyChromiumProcess(command);
  if (chromium !== "other") return chromium;
  return DEV_TOOLING.test(command) ? "dev-tooling" : "other";
}

export interface MemoryProcess {
  pid: number;
  kind: MemoryProcessKind;
  rssMb: number;
  name: string;
}

export interface MemoryBucket {
  kind: MemoryProcessKind;
  rssMb: number;
  processes: number;
}

export interface MemoryReport {
  label: string;
  appRssMb: number;
  devToolingRssMb: number;
  buckets: MemoryBucket[];
  processes: MemoryProcess[];
}

const MEMORY_KINDS: readonly MemoryProcessKind[] = [...REPORTED_TYPES, "provider", "dev-tooling"];

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
