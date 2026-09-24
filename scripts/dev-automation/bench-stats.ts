// The arithmetic behind `bun run dev:bench`: what one sample of the process
// tree weighs, how a run's samples reduce to peak, mean and settled values, how
// several runs reduce to a median with its spread, and how two reports compare.
// Pure, so the numbers a PR quotes can be tested without launching the app.

import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type MemoryProcessKind, type ProcessTableRow, summarizeMemory } from "./cpu-sampling";

// One flat reading. Keys are stable metric names such as `rss.main` or
// `cpu.provider`, so a report can gain a metric without a format change.
export type MetricValues = Record<string, number>;

export interface MetricStats {
  peak: number;
  mean: number;
}

export interface RunResult {
  durationMs: number;
  samples: number;
  // Over the action window, one entry per metric.
  series: Record<string, MetricStats>;
  // Read once after the scenario settled and garbage was collected: what the
  // app keeps, as opposed to what it touched on the way.
  settled: MetricValues;
}

export interface Spread {
  median: number;
  min: number;
  max: number;
}

export interface MetricSummary {
  peak: Spread | null;
  mean: Spread | null;
  settled: Spread | null;
}

export interface ScenarioReport {
  scenario: string;
  description: string;
  runs: RunResult[];
  metrics: Record<string, MetricSummary>;
}

export interface BenchReport {
  label: string;
  createdAt: string;
  build: string;
  scenarios: ScenarioReport[];
}

const KB_PER_MB = 1_024;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export function spread(values: readonly number[]): Spread | null {
  if (values.length === 0) return null;
  return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}

/**
 * `footprint -f bytes --noCategories -p <pid>...` output as bytes by pid. The
 * physical footprint is what Activity Monitor calls Memory: private dirty and
 * compressed pages, without the shared framework pages RSS counts once in
 * every helper process. A block's `phys_footprint` line is that value; the
 * header total is the fallback when the tool prints no auxiliary data.
 */
export function parseFootprint(stdout: string): Map<number, number> {
  const footprints = new Map<number, number>();
  let pid: number | null = null;
  for (const line of stdout.split("\n")) {
    const header = /\[(\d+)\]: .*Footprint: (\d+) B/u.exec(line);
    if (header) {
      pid = Number(header[1]);
      footprints.set(pid, Number(header[2]));
      continue;
    }
    const physical = /^\s*phys_footprint: (\d+) B/u.exec(line);
    if (physical && pid !== null) footprints.set(pid, Number(physical[1]));
  }
  return footprints;
}

/**
 * Resident memory, physical footprint and process counts of one reading, by
 * kind. A provider child (an MCP server) counts as provider, and dev tooling is
 * left out of the totals because a packaged build has none of it. Provider
 * memory is also split by executable, so a report says which CLI holds it.
 */
export function processMetrics(rows: ProcessTableRow[], footprints: Map<number, number> = new Map()): MetricValues {
  const report = summarizeMemory(rows, "sample");
  const values: MetricValues = { "rss.total": report.appRssMb };
  for (const bucket of report.buckets) {
    if (bucket.kind === "dev-tooling") continue;
    values[`rss.${bucket.kind}`] = bucket.rssMb;
    values[`procs.${bucket.kind}`] = bucket.processes;
  }
  // Summed unrounded, then rounded once, so a total of many small processes
  // does not drift.
  const sums = new Map<string, number>();
  const add = (key: string, amount: number): void => {
    sums.set(key, (sums.get(key) ?? 0) + amount);
  };
  for (const entry of report.processes) {
    if (entry.kind === "dev-tooling") continue;
    const footprint = footprints.get(entry.pid);
    if (footprint !== undefined) {
      add(`mem.${entry.kind}`, footprint / (KB_PER_MB * KB_PER_MB));
      add("mem.total", footprint / (KB_PER_MB * KB_PER_MB));
    }
    if (entry.kind === "provider") {
      const name = entry.name.toLowerCase().replaceAll(/[^a-z0-9-]/gu, "_") || "unknown";
      add(`rss.provider.${name}`, entry.rssMb);
      if (footprint !== undefined) add(`mem.provider.${name}`, footprint / (KB_PER_MB * KB_PER_MB));
      values[`procs.provider.${name}`] = (values[`procs.provider.${name}`] ?? 0) + 1;
    }
  }
  for (const [key, sum] of sums) values[key] = round(sum);
  return values;
}

/**
 * CPU percent by kind between two readings, from the cumulative `cputime`
 * counter. A pid in only one reading is dropped rather than counted from zero:
 * a process that started in between would otherwise report its whole lifetime
 * as work done inside one second.
 */
export function cpuMetrics(previous: ProcessTableRow[], current: ProcessTableRow[], elapsedMs: number): MetricValues {
  if (elapsedMs <= 0) return {};
  const kinds = new Map<number, MemoryProcessKind>(
    summarizeMemory(current, "cpu").processes.map((process) => [process.pid, process.kind]),
  );
  const before = new Map(previous.map((row) => [row.pid, row.cpuSeconds]));
  const seconds = new Map<MemoryProcessKind, number>();
  for (const row of current) {
    const kind = kinds.get(row.pid);
    const start = before.get(row.pid);
    if (kind === undefined || kind === "dev-tooling" || start === undefined) continue;
    const delta = row.cpuSeconds - start;
    if (delta < 0) continue;
    seconds.set(kind, (seconds.get(kind) ?? 0) + delta);
  }
  const values: MetricValues = {};
  let total = 0;
  for (const [kind, used] of seconds) {
    const percent = (used / (elapsedMs / 1_000)) * 100;
    values[`cpu.${kind}`] = round(percent);
    total += percent;
  }
  values["cpu.total"] = round(total);
  return values;
}

// Which samples a metric is read from when a sample lacks it.
function sampleCovers(key: string, sample: MetricValues): boolean {
  // A kind with no process in one sample reads as zero there, not as a gap: a
  // provider CLI that exits mid-run did release its memory.
  if (key.startsWith("rss.") || key.startsWith("procs.")) return true;
  // Footprint is read in the same tick as `ps`, when the tool could read any.
  if (key.startsWith("mem.")) return sample["mem.total"] !== undefined;
  // The same for CPU, but only in samples that measured an interval at all.
  if (key.startsWith("cpu.")) return sample["cpu.total"] !== undefined;
  // Heap and DOM readings are taken every few ticks; the others are gaps.
  return sample[key] !== undefined;
}

export function seriesStats(samples: readonly MetricValues[]): Record<string, MetricStats> {
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample)));
  const stats: Record<string, MetricStats> = {};
  for (const key of [...keys].sort()) {
    const values = samples.filter((sample) => sampleCovers(key, sample)).map((sample) => sample[key] ?? 0);
    if (values.length === 0) continue;
    stats[key] = {
      peak: round(Math.max(...values)),
      mean: round(values.reduce((total, value) => total + value, 0) / values.length),
    };
  }
  return stats;
}

export function summarizeRuns(runs: readonly RunResult[]): Record<string, MetricSummary> {
  const keys = new Set(runs.flatMap((run) => [...Object.keys(run.series), ...Object.keys(run.settled)]));
  const metrics: Record<string, MetricSummary> = {};
  // A run without a process kind had none of it, as in one sample: a run whose providers were all
  // released must pull the median down, not drop out of it.
  const read = (key: string, values: MetricValues) => (sampleCovers(key, values) ? [values[key] ?? 0] : []);
  const stat = (run: RunResult, name: keyof MetricStats) =>
    Object.fromEntries(Object.entries(run.series).map(([key, stats]) => [key, stats[name]]));
  for (const key of [...keys].sort()) {
    const peaks = runs.flatMap((run) => read(key, stat(run, "peak")));
    const means = runs.flatMap((run) => read(key, stat(run, "mean")));
    const settled = runs.flatMap((run) => read(key, run.settled));
    metrics[key] = { peak: spread(peaks), mean: spread(means), settled: spread(settled) };
  }
  return metrics;
}

export function kilobytesToMegabytes(kilobytes: number): number {
  return round(kilobytes / KB_PER_MB);
}

// The metrics a table shows, in reading order. Everything else stays in the
// JSON, where a follow-up question can still find it.
const HEADLINE_METRICS: readonly string[] = [
  "mem.total",
  "mem.main",
  "mem.renderer",
  "mem.gpu",
  "mem.utility",
  "mem.network",
  "mem.provider",
  "rss.total",
  "rss.main",
  "rss.renderer",
  "rss.gpu",
  "rss.utility",
  "rss.network",
  "rss.provider",
  "procs.renderer",
  "procs.provider",
  "heap.main",
  "heap.main.external",
  "heap.renderer.app",
  "heap.renderer.all",
  "dom.nodes.app",
  "cpu.total",
  "cpu.main",
  "cpu.renderer",
  "cpu.gpu",
  "cpu.utility",
  "cpu.provider",
  "time.readyMs",
];

function formatSpread(value: Spread | null): string {
  if (!value) return "–";
  if (value.min === value.max) return `${value.median}`;
  return `${value.median} (${value.min}–${value.max})`;
}

export function renderScenarioTable(scenario: ScenarioReport): string {
  const lines = [
    `### ${scenario.scenario}: ${scenario.description}`,
    "",
    `${scenario.runs.length} run(s). Median (min–max). MB for rss/heap, % of one core for cpu.`,
    "",
    "| Metric | Peak | Mean | Settled |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const key of HEADLINE_METRICS) {
    const summary = scenario.metrics[key];
    if (!summary) continue;
    lines.push(
      `| ${key} | ${formatSpread(summary.peak)} | ${formatSpread(summary.mean)} | ${formatSpread(summary.settled)} |`,
    );
  }
  return lines.join("\n");
}

export function renderReport(report: BenchReport): string {
  return [
    `## dev:bench ${report.label}`,
    "",
    `Build: ${report.build}. Created ${report.createdAt}.`,
    "",
    ...report.scenarios.map((scenario) => `${renderScenarioTable(scenario)}\n`),
  ].join("\n");
}

export interface MetricDelta {
  scenario: string;
  metric: string;
  stat: "peak" | "mean" | "settled";
  before: number;
  after: number;
  delta: number;
  percent: number | null;
}

// Medians only: the spread says whether a delta is noise, and the table shows
// both reports' spreads for that.
export function compareReports(before: BenchReport, after: BenchReport): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  for (const scenario of after.scenarios) {
    const baseline = before.scenarios.find((candidate) => candidate.scenario === scenario.scenario);
    if (!baseline) continue;
    for (const metric of HEADLINE_METRICS) {
      for (const stat of ["peak", "mean", "settled"] as const) {
        const was = baseline.metrics[metric]?.[stat];
        const now = scenario.metrics[metric]?.[stat];
        if (!was || !now) continue;
        const delta = round(now.median - was.median);
        deltas.push({
          scenario: scenario.scenario,
          metric,
          stat,
          before: was.median,
          after: now.median,
          delta,
          percent: was.median === 0 ? null : round((delta / was.median) * 100),
        });
      }
    }
  }
  return deltas;
}

export function renderComparison(before: BenchReport, after: BenchReport): string {
  const deltas = compareReports(before, after);
  const lines = [
    `## dev:bench ${before.label} → ${after.label}`,
    "",
    "| Scenario | Metric | Stat | Before | After | Δ | Δ % |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const delta of deltas) {
    const sign = delta.delta > 0 ? "+" : "";
    const percent = delta.percent === null ? "–" : `${sign}${delta.percent}%`;
    lines.push(
      `| ${delta.scenario} | ${delta.metric} | ${delta.stat} | ${delta.before} | ${delta.after} | ${sign}${delta.delta} | ${percent} |`,
    );
  }
  return lines.join("\n");
}

function parseSpread(value: unknown): Spread | null | undefined {
  if (value === null) return null;
  if (!isDynamicRecord(value)) return undefined;
  const { median: middle, min, max } = value;
  if (!isNumber(middle) || !isNumber(min) || !isNumber(max)) return undefined;
  return { median: middle, min, max };
}

/**
 * A report read back for `--compare`, or `null` when the file is not one. Only
 * the medians are needed, so the per-run detail is not validated beyond its
 * shape.
 */
export function parseBenchReport(value: unknown): BenchReport | null {
  if (!isDynamicRecord(value)) return null;
  const { label, createdAt, build, scenarios } = value;
  if (!isString(label) || !isString(createdAt) || !isString(build) || !Array.isArray(scenarios)) return null;
  const parsed: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    if (!isDynamicRecord(scenario)) return null;
    const { scenario: id, description, runs, metrics } = scenario;
    if (!isString(id) || !isString(description) || !Array.isArray(runs) || !isDynamicRecord(metrics)) return null;
    const summaries: Record<string, MetricSummary> = {};
    for (const [key, summary] of Object.entries(metrics)) {
      if (!isDynamicRecord(summary)) return null;
      const peak = parseSpread(summary.peak);
      const mean = parseSpread(summary.mean);
      const settled = parseSpread(summary.settled);
      if (peak === undefined || mean === undefined || settled === undefined) return null;
      summaries[key] = { peak, mean, settled };
    }
    parsed.push({ scenario: id, description, runs: [], metrics: summaries });
  }
  return { label, createdAt, build, scenarios: parsed };
}
