// Collects the samples `cpu-sampling.ts` does the arithmetic on. Everything
// impure lives here: the CDP calls and the one `ps` invocation.
//
// Two sources, on purpose. CDP knows which Chromium process is which without
// parsing a command line, and it is the only one that works when `ps` does not.
// `ps` is the cross-check: it is the operating system's own accounting, so when
// the two disagree the number in the report is not to be trusted. Neither is
// dropped, because a profiler nobody can falsify is a profiler nobody should
// believe.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@openbot/logging";
import type { Browser, CDPSession, Page } from "playwright-core";
import {
  type ChromiumProcessType,
  type CpuReport,
  type CpuSample,
  collectDescendants,
  type ProcessSnapshot,
  parseProcessTable,
  snapshotProcesses,
  summarize,
} from "./cpu-sampling";
import { describeTarget } from "./page-url";

const run = promisify(execFile);

export interface PageMetrics {
  target: string;
  // Style recalculations and layouts per second of wall clock. Chromium reports
  // no frame rate here - `Frames` is the document's iframe count, not a rate -
  // so these two counters are the per-frame proxy. An animation that morphs a
  // shape every frame drives both; a JS timer that touches no style drives
  // neither.
  recalcStyleCountPerSecond: number;
  layoutCountPerSecond: number;
  taskMsPerSecond: number;
  scriptMsPerSecond: number;
  recalcStyleMsPerSecond: number;
  layoutMsPerSecond: number;
}

export interface CpuProfile extends CpuReport {
  intervalMs: number;
  source: "cdp" | "ps";
  // The same run measured the other way, when both sources answered. A wide
  // gap between the two totals means the report is not to be acted on.
  crossCheck: CpuReport | null;
  pages: PageMetrics[];
}

export interface CpuProfileOptions {
  browser: Browser;
  // From the instance registry. Null when no record published this port, which
  // is the one case the `ps` cross-check cannot run: without a pid to anchor
  // on, the only way to find the tree is by name, and a name matches another
  // worktree's dev app too.
  rootPid: number | null;
  durationMs: number;
  intervalMs: number;
  label: string;
  logger: Logger;
}

// CDP names the browser process "browser"; in Electron that process is main.
// The other names are taken from what this Electron build actually reports, not
// from the protocol document: the GPU process answers "GPU" in capitals, and a
// utility process answers its Mojo service name rather than "utility". An
// unlisted name falls through to "other", which is why the `ps` cross-check is
// kept - it names the same process independently.
const CDP_PROCESS_TYPES = new Map<string, ChromiumProcessType>([
  ["browser", "main"],
  ["renderer", "renderer"],
  ["GPU", "gpu"],
  ["gpu", "gpu"],
  ["network.mojom.NetworkService", "network"],
  ["network", "network"],
  ["utility", "utility"],
  ["crashpad-handler", "crashpad"],
]);

async function sampleOverCdp(session: CDPSession): Promise<ProcessSnapshot[]> {
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  return processInfo.map((process) => ({
    pid: process.id,
    type: CDP_PROCESS_TYPES.get(process.type) ?? "other",
    cpuSeconds: process.cpuTime,
  }));
}

async function sampleOverPs(rootPid: number): Promise<ProcessSnapshot[]> {
  const { stdout } = await run("ps", ["-o", "pid=,ppid=,cputime=,command=", "-ax"], { maxBuffer: 16 * 1_024 * 1_024 });
  return snapshotProcesses(collectDescendants(parseProcessTable(stdout), rootPid));
}

const METRIC_NAMES = [
  "RecalcStyleCount",
  "LayoutCount",
  "TaskDuration",
  "ScriptDuration",
  "RecalcStyleDuration",
  "LayoutDuration",
] as const;
// The two counts are plain event counts; the four durations are seconds.
const COUNT_METRICS: ReadonlySet<MetricName> = new Set(["RecalcStyleCount", "LayoutCount"]);
type MetricName = (typeof METRIC_NAMES)[number];
type MetricReading = Partial<Record<MetricName | "Timestamp", number>>;

async function readMetrics(session: CDPSession): Promise<MetricReading> {
  const { metrics } = await session.send("Performance.getMetrics");
  const reading: MetricReading = {};
  for (const metric of metrics) {
    if (metric.name === "Timestamp") reading.Timestamp = metric.value;
    for (const name of METRIC_NAMES) {
      if (metric.name === name) reading[name] = metric.value;
    }
  }
  return reading;
}

// Chromium reports the durations in seconds, and the report is in milliseconds
// per second of wall clock - "how much of each second this page spent here". A
// missing counter reads as no work rather than as a gap, which is the right
// default: every one of them is absent only when it never ran.
function perSecond(before: MetricReading, after: MetricReading, name: MetricName, spanSeconds: number): number {
  const delta = (after[name] ?? 0) - (before[name] ?? 0);
  if (delta <= 0 || spanSeconds <= 0) return 0;
  return round(COUNT_METRICS.has(name) ? delta / spanSeconds : (delta * 1_000) / spanSeconds);
}

interface PageProbe {
  target: string;
  session: CDPSession;
  before: MetricReading;
}

async function openPageProbes(pages: Page[], logger: Logger): Promise<PageProbe[]> {
  const probes: PageProbe[] = [];
  for (const page of pages) {
    const target = describeTarget(page.url());
    try {
      const session = await page.context().newCDPSession(page);
      await session.send("Performance.enable");
      probes.push({ target, session, before: await readMetrics(session) });
    } catch {
      // A page that closes or navigates while we attach is not one this run can
      // report on, and it must not take the whole measurement down with it.
      logger.warn(`could not attach a performance probe to ${target}`);
    }
  }
  return probes;
}

async function closePageProbes(probes: PageProbe[], wallMs: number): Promise<PageMetrics[]> {
  const measured: PageMetrics[] = [];
  for (const probe of probes) {
    try {
      const after = await readMetrics(probe.session);
      const spanSeconds =
        probe.before.Timestamp !== undefined && after.Timestamp !== undefined
          ? after.Timestamp - probe.before.Timestamp
          : wallMs / 1_000;
      measured.push({
        target: probe.target,
        recalcStyleCountPerSecond: perSecond(probe.before, after, "RecalcStyleCount", spanSeconds),
        layoutCountPerSecond: perSecond(probe.before, after, "LayoutCount", spanSeconds),
        taskMsPerSecond: perSecond(probe.before, after, "TaskDuration", spanSeconds),
        scriptMsPerSecond: perSecond(probe.before, after, "ScriptDuration", spanSeconds),
        recalcStyleMsPerSecond: perSecond(probe.before, after, "RecalcStyleDuration", spanSeconds),
        layoutMsPerSecond: perSecond(probe.before, after, "LayoutDuration", spanSeconds),
      });
    } catch {
      // The page went away mid-run. The process-level numbers still stand.
    }
    await probe.session.send("Performance.disable").catch(() => undefined);
    await probe.session.detach().catch(() => undefined);
  }
  return measured;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function profileCpu(options: CpuProfileOptions): Promise<CpuProfile> {
  const { browser, rootPid, durationMs, intervalMs, label, logger } = options;
  const pages = browser.contexts().flatMap((context) => context.pages());
  const probes = await openPageProbes(pages, logger);
  const browserSession = await browser.newBrowserCDPSession();
  const cdpSamples: CpuSample[] = [];
  const psSamples: CpuSample[] = [];
  let cdpFailed = false;
  let psFailed = rootPid === null;
  if (psFailed) logger.warn("no registry record published a pid, so the ps cross-check is skipped.");
  const startedAt = Date.now();
  try {
    // A sample before the first wait and one after the last, so the span the
    // arithmetic divides by is the span that was actually observed.
    for (;;) {
      const atMs = Date.now();
      if (!cdpFailed) {
        try {
          cdpSamples.push({ atMs, processes: await sampleOverCdp(browserSession) });
        } catch (error) {
          cdpFailed = true;
          logger.warn(`SystemInfo.getProcessInfo is unavailable: ${describeError(error)}`);
        }
      }
      if (!psFailed && rootPid !== null) {
        try {
          psSamples.push({ atMs, processes: await sampleOverPs(rootPid) });
        } catch (error) {
          psFailed = true;
          logger.warn(`ps is unavailable: ${describeError(error)}`);
        }
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= durationMs) break;
      await delay(Math.min(intervalMs, durationMs - elapsed));
    }
  } finally {
    await browserSession.detach().catch(() => undefined);
  }
  const wallMs = Date.now() - startedAt;
  const pageMetrics = await closePageProbes(probes, wallMs);
  if (cdpSamples.length < 2 && psSamples.length < 2) {
    throw new Error("Neither CDP nor ps produced two samples, so there is no interval to measure.");
  }
  const useCdp = cdpSamples.length >= 2;
  const primary = summarize(useCdp ? cdpSamples : psSamples, label);
  const other = useCdp && psSamples.length >= 2 ? summarize(psSamples, label) : null;
  return {
    ...primary,
    intervalMs,
    source: useCdp ? "cdp" : "ps",
    crossCheck: other,
    pages: pageMetrics,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface CpuComparison {
  before: string;
  after: string;
  totalCpuPercent: number;
  processes: { type: ChromiumProcessType; cpuPercent: number }[];
}

/** The signed change from one report to another. Negative is an improvement. */
export function compareProfiles(before: CpuReport, after: CpuReport): CpuComparison {
  const baseline = new Map(before.processes.map((process) => [process.type, process.cpuPercent]));
  const types = new Set([...baseline.keys(), ...after.processes.map((process) => process.type)]);
  const processes = [...types].map((type) => ({
    type,
    cpuPercent: round(
      (after.processes.find((process) => process.type === type)?.cpuPercent ?? 0) - (baseline.get(type) ?? 0),
    ),
  }));
  return {
    before: before.label,
    after: after.label,
    totalCpuPercent: round(after.totalCpuPercent - before.totalCpuPercent),
    processes,
  };
}
