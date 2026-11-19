import { AGENT_PROVIDERS, type AgentProviderId } from "@openbot/contracts/agent-providers";
import { Schema } from "effect";

const PROCESS_GROUPS = [
  "main",
  "window",
  "browser_tab",
  "gpu",
  "database_host",
  "voice_host",
  "utility_other",
] as const;
export type ProcessGroup = (typeof PROCESS_GROUPS)[number];

const RESOURCE_PROVIDERS = [...AGENT_PROVIDERS, "other"] as const;
export type ResourceProvider = (typeof RESOURCE_PROVIDERS)[number];

const GONE_REASONS = ["crashed", "oom", "killed", "abnormal_exit", "launch_failed", "other"] as const;
export type GoneReason = (typeof GONE_REASONS)[number];

const CHILD_TYPES = ["gpu", "database_host", "voice_host", "network", "utility_other", "other"] as const;
export type ChildType = (typeof CHILD_TYPES)[number];

const LOOP_PHASES = ["startup", "resume", "first_hour", "later"] as const;
export type LoopPhase = (typeof LOOP_PHASES)[number];
const LOOP_SETTLE_MS = 2 * 60_000;
const LOOP_FIRST_HOUR_MS = 60 * 60_000;

export const MAIN_LOOP_STALL_MS = 1_000;

export const SLOW_DATABASE_STATEMENT_MS = 100;

const RAM_CLASSES = ["le8", "16", "32", "64", "gt64"] as const;
const CPU_CLASSES = ["le4", "le8", "le12", "le16", "gt16"] as const;
const ARCHITECTURES = ["arm64", "x64", "other"] as const;
const HOST_KINDS = ["desktop", "server"] as const;

export const RESOURCE_ENUMS = {
  ram_class: RAM_CLASSES,
  cpu_class: CPU_CLASSES,
  arch: ARCHITECTURES,
  host_kind: HOST_KINDS,
  main_loop_delay_max_phase: LOOP_PHASES,
} as const;

type GroupPropertyName =
  | `${ProcessGroup}_rss_mb_p95`
  | `${ProcessGroup}_private_mb_p95`
  | `${ProcessGroup}_cpu_pct_p95`;
type ProviderPropertyName = `provider_${ResourceProvider}_rss_mb_p95` | `provider_${ResourceProvider}_cpu_pct_p95`;
type GonePropertyName = `gone_${GoneReason}_count`;
type ChildGonePropertyName = `child_gone_${ChildType}_count`;

export const RESOURCE_PROPERTY_NAMES = [
  "total_rss_mb_p95",
  "total_rss_mb_max",
  "total_cpu_pct_p95",
  "total_cpu_pct_max",
  ...PROCESS_GROUPS.flatMap((group): GroupPropertyName[] => [
    `${group}_rss_mb_p95`,
    `${group}_private_mb_p95`,
    `${group}_cpu_pct_p95`,
  ]),
  "window_js_heap_mb_p95",
  "window_js_heap_total_mb_p95",
  "window_dom_heap_mb_p95",
  "window_array_buffer_mb_p95",
  "window_dom_node_count_p95",
  ...RESOURCE_PROVIDERS.flatMap((provider): ProviderPropertyName[] => [
    `provider_${provider}_rss_mb_p95`,
    `provider_${provider}_cpu_pct_p95`,
  ]),
  "main_loop_delay_ms_p95",
  "main_loop_delay_ms_max",
  "main_loop_delay_max_phase",
  "main_loop_delay_max_turn_active",
  "main_loop_stall_count",
  "db_request_ms_p95",
  "db_request_ms_max",
  "db_request_count",
  "db_slow_request_count",
  "renderer_long_task_count",
  "renderer_input_delay_ms_p95",
  "renderer_gone_count",
  "child_gone_count",
  ...CHILD_TYPES.map((type): ChildGonePropertyName => `child_gone_${type}_count`),
  ...GONE_REASONS.map((reason): GonePropertyName => `gone_${reason}_count`),
  "active_turn_count_max",
  "browser_tab_count_max",
  "provider_process_count_max",
  "ram_class",
  "cpu_class",
  "arch",
  "host_kind",
  "provider_tree_supported",
  "sample_count",
] as const;
type ResourcePropertyName = (typeof RESOURCE_PROPERTY_NAMES)[number];
export type ResourceProperties = Partial<Record<ResourcePropertyName, string | number | boolean>>;

export interface DeviceClass {
  ramClass: (typeof RAM_CLASSES)[number];
  cpuClass: (typeof CPU_CLASSES)[number];
  arch: (typeof ARCHITECTURES)[number];
  hostKind: (typeof HOST_KINDS)[number];
}

export function deviceClass(input: {
  totalMemoryBytes: number;
  cpuCount: number;
  arch: string;
  server: boolean;
}): DeviceClass {
  const gb = input.totalMemoryBytes / 1024 ** 3;
  const ramClass = gb <= 8.5 ? "le8" : gb <= 16.5 ? "16" : gb <= 32.5 ? "32" : gb <= 64.5 ? "64" : "gt64";
  const cores = input.cpuCount;
  const cpuClass = cores <= 4 ? "le4" : cores <= 8 ? "le8" : cores <= 12 ? "le12" : cores <= 16 ? "le16" : "gt16";
  const arch = input.arch === "arm64" || input.arch === "x64" ? input.arch : "other";
  return { ramClass, cpuClass, arch, hostKind: input.server ? "server" : "desktop" };
}

export interface OsProcess {
  pid: number;
  ppid: number;
  rssKb: number;
  cpuSeconds: number;
  command: string;
}

export function parsePsOutput(text: string): OsProcess[] {
  const processes: OsProcess[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const [, pid, ppid, rss, time, command] = match;
    const cpuSeconds = parseCpuTime(time ?? "");
    if (cpuSeconds === null || !command) continue;
    processes.push({ pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), cpuSeconds, command });
  }
  return processes;
}

function parseCpuTime(text: string): number | null {
  const [days, clock] = text.includes("-") ? text.split("-", 2) : ["0", text];
  const parts = (clock ?? "").split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0 || part === "") return null;
    seconds = seconds * 60 + value;
  }
  const dayCount = Number(days);
  if (!Number.isInteger(dayCount) || dayCount < 0) return null;
  return dayCount * 86_400 + seconds;
}

const PROVIDER_EXECUTABLES = new Map<string, AgentProviderId>([
  ["claude", "claude"],
  ["codex", "codex"],
  ["opencode", "opencode"],
  ["grok", "grok"],
]);

function executableProvider(command: string): AgentProviderId | undefined {
  const name = command
    .split(/[\\/]/u)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/u, "");
  return name ? PROVIDER_EXECUTABLES.get(name) : undefined;
}

export interface ProviderTreeUsage {
  provider: ResourceProvider;
  rssMb: number;
  cpuPct: number | null;
  processCount: number;
}

export function providerTrees(input: {
  processes: readonly OsProcess[];
  rootPid: number;
  excludedPids: ReadonlySet<number>;
  registry: ReadonlyMap<number, AgentProviderId>;
  previousCpuSeconds: ReadonlyMap<number, number> | null;
  elapsedSeconds: number;
}): { usage: ProviderTreeUsage[]; cpuSeconds: Map<number, number> } {
  const children = new Map<number, OsProcess[]>();
  for (const process of input.processes) {
    const siblings = children.get(process.ppid);
    if (siblings) siblings.push(process);
    else children.set(process.ppid, [process]);
  }
  const totals = new Map<ResourceProvider, { rssKb: number; cpuSeconds: number; count: number }>();
  const cpuSeconds = new Map<number, number>();
  const stack: { process: OsProcess; inherited: AgentProviderId | undefined }[] = (
    children.get(input.rootPid) ?? []
  ).map((process) => ({ process, inherited: undefined }));
  const visited = new Set<number>();
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const { process } = next;
    if (visited.has(process.pid) || input.excludedPids.has(process.pid)) continue;
    visited.add(process.pid);
    const provider = input.registry.get(process.pid) ?? next.inherited ?? executableProvider(process.command);
    const key: ResourceProvider = provider ?? "other";
    const previous = input.previousCpuSeconds?.get(process.pid);
    const usedSeconds = Math.max(0, process.cpuSeconds - (previous ?? 0));
    const total = totals.get(key) ?? { rssKb: 0, cpuSeconds: 0, count: 0 };
    total.rssKb += process.rssKb;
    total.cpuSeconds += usedSeconds;
    total.count += 1;
    totals.set(key, total);
    cpuSeconds.set(process.pid, process.cpuSeconds);
    for (const child of children.get(process.pid) ?? []) stack.push({ process: child, inherited: provider });
  }
  const measured = input.previousCpuSeconds !== null && input.elapsedSeconds > 0;
  return {
    usage: [...totals].map(([provider, total]) => ({
      provider,
      rssMb: total.rssKb / 1024,
      cpuPct: measured ? (total.cpuSeconds / input.elapsedSeconds) * 100 : null,
      processCount: total.count,
    })),
    cpuSeconds,
  };
}

const Counts = Schema.Record(Schema.String, Schema.Finite);

const ResourceDaySchema = Schema.Struct({
  day: Schema.String,
  samples: Schema.Finite,
  providerTreeSupported: Schema.Boolean,
  histograms: Schema.Record(Schema.String, Counts),
  peaks: Counts,
  counters: Counts,
  mainLoopPeak: Schema.optionalKey(Schema.Struct({ phase: Schema.String, turnActive: Schema.Boolean })),
});
export interface ResourceDay {
  day: string;
  samples: number;
  providerTreeSupported: boolean;
  histograms: Record<string, Record<string, number>>;
  peaks: Record<string, number>;
  counters: Record<string, number>;
  mainLoopPeak?: { phase: string; turnActive: boolean };
}

const ResourceSummaryFile = Schema.Struct({
  version: Schema.Literal(1),
  current: ResourceDaySchema,
  previous: Schema.NullOr(ResourceDaySchema),
  previousHandled: Schema.Boolean,
});
export const decodeResourceSummaryFile = Schema.decodeUnknownOption(ResourceSummaryFile);

export function emptyDay(day: string): ResourceDay {
  return { day, samples: 0, providerTreeSupported: true, histograms: {}, peaks: {}, counters: {} };
}

export function quantize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 100) return Math.round(value);
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / step) * step;
}

export function recordValue(day: ResourceDay, metric: string, value: number, count = 1): void {
  if (!Number.isFinite(value) || value < 0 || count < 1) return;
  const histogram = day.histograms[metric] ?? {};
  const key = String(quantize(value));
  histogram[key] = (histogram[key] ?? 0) + count;
  day.histograms[metric] = histogram;
  recordPeak(day, metric, value);
}

export function recordPeak(day: ResourceDay, metric: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  day.peaks[metric] = Math.max(day.peaks[metric] ?? 0, value);
}

export function addCount(day: ResourceDay, counter: string, amount = 1): void {
  day.counters[counter] = (day.counters[counter] ?? 0) + amount;
}

function percentile(day: ResourceDay, metric: string, fraction: number): number | undefined {
  const histogram = day.histograms[metric];
  if (!histogram) return undefined;
  const entries = Object.entries(histogram)
    .map(([value, count]) => [Number(value), count] as const)
    .sort(([left], [right]) => left - right);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return undefined;
  const rank = Math.ceil(total * fraction);
  let seen = 0;
  for (const [value, count] of entries) {
    seen += count;
    if (seen >= rank) return value;
  }
  return entries.at(-1)?.[0];
}

export const METRIC = {
  rss: (target: string) => `rss_mb.${target}`,
  cpu: (target: string) => `cpu_pct.${target}`,
  privateMemory: (target: string) => `private_mb.${target}`,
  providerRss: (provider: ResourceProvider) => `rss_mb.provider.${provider}`,
  providerCpu: (provider: ResourceProvider) => `cpu_pct.provider.${provider}`,
  mainLoop: "loop_ms.main",
  database: "db_ms",
  rendererInput: "renderer_input_ms",
  windowJsHeap: "js_heap_mb.window",
  windowJsHeapTotal: "js_heap_total_mb.window",
  windowDomHeap: "dom_heap_mb.window",
  windowArrayBuffers: "array_buffer_mb.window",
  windowDomNodes: "count.window_dom_nodes",
  activeTurns: "count.active_turns",
  browserTabs: "count.browser_tabs",
  providerProcesses: "count.provider_processes",
} as const;

export const COUNTER = {
  rendererGone: "gone.renderer",
  childGone: "gone.child",
  childType: (type: ChildType) => `gone.child_type.${type}`,
  mainLoopStall: "loop.stalls",
  goneReason: (reason: GoneReason) => `gone.reason.${reason}`,
  databaseRequests: "db.requests",
  databaseSlow: "db.slow",
  rendererLongTasks: "renderer.long_tasks",
} as const;

const MB_STEP = 50;
const roundMb = (value: number | undefined) =>
  value === undefined ? undefined : Math.round(value / MB_STEP) * MB_STEP;
const roundWhole = (value: number | undefined) => (value === undefined ? undefined : Math.round(value));

export function resourceEventProperties(day: ResourceDay, device: DeviceClass): ResourceProperties {
  const properties: { [Name in ResourcePropertyName]?: string | number | boolean | undefined } = {
    total_rss_mb_p95: roundMb(percentile(day, METRIC.rss("total"), 0.95)),
    total_rss_mb_max: roundMb(day.peaks[METRIC.rss("total")]),
    total_cpu_pct_p95: roundWhole(percentile(day, METRIC.cpu("total"), 0.95)),
    total_cpu_pct_max: roundWhole(day.peaks[METRIC.cpu("total")]),
    main_loop_delay_ms_p95: roundWhole(percentile(day, METRIC.mainLoop, 0.95)),
    main_loop_delay_ms_max: roundWhole(day.peaks[METRIC.mainLoop]),
    main_loop_delay_max_phase: LOOP_PHASES.find((phase) => phase === day.mainLoopPeak?.phase),
    main_loop_delay_max_turn_active: day.mainLoopPeak?.turnActive,
    main_loop_stall_count: day.counters[COUNTER.mainLoopStall] ?? 0,
    db_request_ms_p95: roundWhole(percentile(day, METRIC.database, 0.95)),
    db_request_ms_max: roundWhole(day.peaks[METRIC.database]),
    db_request_count: day.counters[COUNTER.databaseRequests] ?? 0,
    db_slow_request_count: day.counters[COUNTER.databaseSlow] ?? 0,
    renderer_long_task_count: day.counters[COUNTER.rendererLongTasks] ?? 0,
    renderer_input_delay_ms_p95: roundWhole(percentile(day, METRIC.rendererInput, 0.95)),
    window_js_heap_mb_p95: roundMb(percentile(day, METRIC.windowJsHeap, 0.95)),
    window_js_heap_total_mb_p95: roundMb(percentile(day, METRIC.windowJsHeapTotal, 0.95)),
    window_dom_heap_mb_p95: roundMb(percentile(day, METRIC.windowDomHeap, 0.95)),
    window_array_buffer_mb_p95: roundMb(percentile(day, METRIC.windowArrayBuffers, 0.95)),
    window_dom_node_count_p95: roundWhole(percentile(day, METRIC.windowDomNodes, 0.95)),
    renderer_gone_count: day.counters[COUNTER.rendererGone] ?? 0,
    child_gone_count: day.counters[COUNTER.childGone] ?? 0,
    active_turn_count_max: roundWhole(day.peaks[METRIC.activeTurns]),
    browser_tab_count_max: roundWhole(day.peaks[METRIC.browserTabs]),
    provider_process_count_max: roundWhole(day.peaks[METRIC.providerProcesses]),
    ram_class: device.ramClass,
    cpu_class: device.cpuClass,
    arch: device.arch,
    host_kind: device.hostKind,
    provider_tree_supported: day.providerTreeSupported,
    sample_count: day.samples,
  };
  for (const group of PROCESS_GROUPS) {
    properties[`${group}_rss_mb_p95`] = roundMb(percentile(day, METRIC.rss(group), 0.95));
    properties[`${group}_private_mb_p95`] = roundMb(percentile(day, METRIC.privateMemory(group), 0.95));
    properties[`${group}_cpu_pct_p95`] = roundWhole(percentile(day, METRIC.cpu(group), 0.95));
  }
  for (const provider of RESOURCE_PROVIDERS) {
    properties[`provider_${provider}_rss_mb_p95`] = roundMb(percentile(day, METRIC.providerRss(provider), 0.95));
    properties[`provider_${provider}_cpu_pct_p95`] = roundWhole(percentile(day, METRIC.providerCpu(provider), 0.95));
  }
  for (const type of CHILD_TYPES) {
    const count = day.counters[COUNTER.childType(type)];
    if (count) properties[`child_gone_${type}_count`] = count;
  }
  for (const reason of GONE_REASONS) {
    const count = day.counters[COUNTER.goneReason(reason)];
    if (count) properties[`gone_${reason}_count`] = count;
  }
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

export function loopPhase(windowStartedAtMs: number, resumedAtMs: number | null): LoopPhase {
  if (windowStartedAtMs < LOOP_SETTLE_MS) return "startup";
  if (resumedAtMs !== null && windowStartedAtMs - resumedAtMs < LOOP_SETTLE_MS) return "resume";
  return windowStartedAtMs < LOOP_FIRST_HOUR_MS ? "first_hour" : "later";
}

export function goneReason(reason: string): GoneReason | null {
  switch (reason) {
    case "clean-exit":
      return null;
    case "crashed":
    case "oom":
    case "killed":
      return reason;
    case "abnormal-exit":
      return "abnormal_exit";
    case "launch-failed":
      return "launch_failed";
    default:
      return "other";
  }
}

export class StatementTimings {
  #durations: number[] = [];

  record(durationMs: number): void {
    if (this.#durations.length >= 10_000) return;
    this.#durations.push(durationMs);
  }

  drain(): number[] {
    const durations = this.#durations;
    this.#durations = [];
    return durations;
  }
}

export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function summarizeDay(day: ResourceDay) {
  return {
    day: day.day,
    samples: day.samples,
    providerTreeSupported: day.providerTreeSupported,
    metrics: Object.fromEntries(
      Object.keys(day.histograms)
        .sort()
        .map((metric) => [
          metric,
          {
            p50: percentile(day, metric, 0.5) ?? 0,
            p95: percentile(day, metric, 0.95) ?? 0,
            max: Math.round((day.peaks[metric] ?? 0) * 10) / 10,
          },
        ]),
    ),
    counters: { ...day.counters },
  };
}
