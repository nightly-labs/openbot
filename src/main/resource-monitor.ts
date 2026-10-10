import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { Effect, Exit, Option, Scope, Semaphore } from "effect";
import {
  app,
  type Details,
  type Event,
  type ProcessMetric,
  powerMonitor,
  type RenderProcessGoneDetails,
  type WebContents,
} from "electron";
import { providerProcessIds } from "../backend/provider-processes";
import type { AnalyticsResourceSource } from "./analytics";
import { AnalyticsOperationFailure, toAnalyticsOperationFailure } from "./analytics-effects";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";
import {
  addCount,
  COUNTER,
  type DeviceClass,
  decodeResourceSummaryFile,
  deviceClass,
  emptyDay,
  type GoneReason,
  goneReason,
  localDay,
  METRIC,
  type ProcessGroup,
  type ProviderTreeUsage,
  parsePsOutput,
  providerTrees,
  type ResourceDay,
  type ResourceProvider,
  recordPeak,
  recordValue,
  resourceEventProperties,
  SLOW_DATABASE_STATEMENT_MS,
  type StatementTimings,
  summarizeDay,
} from "./resource-summary";
import { appendRotatingLines, type TraceFile } from "./trace-file";

const SAMPLE_INTERVAL_MS = 60_000;
const PERSIST_INTERVAL_MS = 15 * 60_000;
const RESOURCE_SUMMARY_FILE = "openbot-resource-summary-v1.json";
const SAMPLES_FILE = "resources.ndjson";
const MAX_SAMPLES_BYTES = 1024 * 1024;
const PS_TIMEOUT_MS = 5_000;
const PS_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_ACTIVE_TURNS = 1_000;
const MAX_PENDING_GONE = 1_000;
/** The histogram's timer interval. Each recorded delay includes it, so it is subtracted. */
const LOOP_RESOLUTION_MS = 20;
// The `serviceName` that `agent-database-host-process.ts` and `voice-transcription-host-process.ts`
// give `utilityProcess.fork`. Electron reports it as the metric's `name`.
const UTILITY_GROUPS = new Map<string, ProcessGroup>([
  ["OpenBot databases", "database_host"],
  ["OpenBot voice transcription", "voice_host"],
]);

export interface ResourceMonitorOptions {
  userDataPath: string;
  server: boolean;
  trace: TraceFile;
  statementTimings: StatementTimings;
  tabProcessIds: () => number[];
}

/** One sample as `resources.ndjson` and the diagnostics export hold it. Group and provider names only. */
interface ResourceSample {
  at: string;
  rssMb: Partial<Record<ProcessGroup | "total", number>>;
  cpuPct: Partial<Record<ProcessGroup | "total", number>>;
  providers: Partial<Record<ResourceProvider, { rssMb: number; cpuPct: number | null; processes: number }>>;
  mainLoopMs: { p99: number; max: number } | null;
  database: { statements: number; maxMs: number };
  activeTurns: number;
  browserTabs: number;
  providerTreeSupported: boolean;
}

/**
 * Samples the CPU and memory of OpenBot's own processes and of the provider CLIs it starts, once a
 * minute, and keeps a summary for each local day. The summary goes into the diagnostics export, and
 * analytics sends the summary of the last closed day once. A failed sample is skipped: this must not
 * become the failure it would have recorded.
 */
export class ResourceMonitor implements AnalyticsResourceSource {
  readonly #options: ResourceMonitorOptions;
  readonly #summaryPath: string;
  readonly #samplesFile: { directory: string; path: string; maxBytes: number };
  readonly #device: DeviceClass;
  readonly #loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  readonly #activeTurns = new Set<string>();
  readonly #writes = Semaphore.makeUnsafe(1);
  /** The load and the samples. `close` waits for them. */
  readonly #scope = Scope.makeUnsafe();
  #day: ResourceDay = emptyDay(localDay(new Date()));
  #previous: ResourceDay | null = null;
  #previousHandled = false;
  #lastSample: ResourceSample | null = null;
  #lastSampleAt: number | null = null;
  #previousCpuSeconds: Map<number, number> | null = null;
  /**
   * Process exits since the last sample. A stop signal can end the child processes before the main
   * process starts its teardown, so an exit counts only when the app still runs at the next sample.
   */
  #gone: { kind: "renderer" | "child"; reason: GoneReason }[] = [];
  #persistedAt = 0;
  #timer: NodeJS.Timeout | null = null;
  #sampling = false;
  #closed = false;
  /** False until the saved days are read, so a quit before that does not overwrite them. */
  #loaded = false;
  #onDayClosed: () => void = () => {};

  constructor(options: ResourceMonitorOptions) {
    this.#options = options;
    this.#summaryPath = join(options.userDataPath, RESOURCE_SUMMARY_FILE);
    const directory = join(options.userDataPath, "logs");
    this.#samplesFile = { directory, path: join(directory, SAMPLES_FILE), maxBytes: MAX_SAMPLES_BYTES };
    this.#device = deviceClass({
      totalMemoryBytes: totalmem(),
      cpuCount: cpus().length,
      arch: process.arch,
      server: options.server,
    });
  }

  /** Loads the saved days and starts sampling. `onDayClosed` runs when a closed day waits to be sent. */
  start(onDayClosed: () => void): void {
    if (this.#closed || this.#timer) return;
    this.#onDayClosed = onDayClosed;
    app.on("render-process-gone", this.#rendererGone);
    app.on("child-process-gone", this.#childGone);
    powerMonitor.on("suspend", this.#suspend);
    powerMonitor.on("resume", this.#resume);
    this.#loop.enable();
    this.#fork(
      this.#load().pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.#loaded = true;
            this.#schedule();
            this.#onDayClosed();
          }),
        ),
      ),
    );
  }

  observeAgentEvent(event: AgentEvent): void {
    if (event.type === "turn-started") {
      if (this.#activeTurns.size < MAX_ACTIVE_TURNS) this.#activeTurns.add(event.turnId);
    } else if (event.type === "turn-completed") {
      this.#activeTurns.delete(event.turnId);
    }
  }

  previousDay(): { day: string; properties: ReturnType<typeof resourceEventProperties> } | null {
    const previous = this.#previous;
    if (!previous || previous.samples === 0 || this.#previousHandled) return null;
    return { day: previous.day, properties: resourceEventProperties(previous, this.#device) };
  }

  clearPreviousDay(day: string): Effect.Effect<void, AnalyticsOperationFailure> {
    return Effect.suspend(() => {
      if (this.#previous?.day !== day || this.#previousHandled) return Effect.void;
      this.#previousHandled = true;
      return this.#persist().pipe(toAnalyticsOperationFailure);
    });
  }

  /** The last sample and the summaries of today and the last closed day, for the diagnostics export. */
  diagnostics() {
    return {
      device: this.#device,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      lastSample: this.#lastSample,
      today: summarizeDay(this.#day),
      previousDay: this.#previous ? summarizeDay(this.#previous) : null,
    };
  }

  /** Stops sampling, waits for a sample that runs, and saves the day. */
  readonly close = Effect.fn("ResourceMonitor.close")(function* (this: ResourceMonitor) {
    if (this.#closed) return;
    this.#closed = true;
    this.#unschedule();
    app.off("render-process-gone", this.#rendererGone);
    app.off("child-process-gone", this.#childGone);
    powerMonitor.off("suspend", this.#suspend);
    powerMonitor.off("resume", this.#resume);
    this.#loop.disable();
    yield* Scope.close(this.#scope, Exit.void);
    if (this.#loaded) yield* this.#persist().pipe(Effect.ignore);
  });

  #fork(effect: Effect.Effect<void, unknown>): void {
    Effect.runFork(effect.pipe(Effect.ignoreCause, Effect.forkIn(this.#scope, { startImmediately: true })));
  }

  #schedule(): void {
    if (this.#closed || this.#timer || !this.#loaded) return;
    this.#timer = setInterval(() => {
      if (this.#sampling) return;
      this.#sampling = true;
      this.#fork(
        this.#sample().pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.#sampling = false;
            }),
          ),
        ),
      );
    }, SAMPLE_INTERVAL_MS);
    this.#timer.unref();
  }

  #unschedule(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  // Sleep is not load. The first sample after a resume has no CPU baseline, so it records no CPU.
  readonly #suspend = () => this.#unschedule();
  readonly #resume = () => {
    this.#lastSampleAt = null;
    this.#previousCpuSeconds = null;
    this.#loop.reset();
    this.#schedule();
  };

  readonly #rendererGone = (_event: Event, _contents: WebContents, details: RenderProcessGoneDetails) =>
    this.#recordGone("renderer", details.reason);
  // OpenBot starts and stops its utility processes itself, such as the voice host after idle time.
  readonly #childGone = (_event: Event, details: Details) => {
    if (details.type === "Utility" && details.reason === "killed") return;
    this.#recordGone("child", details.reason);
  };

  #recordGone(kind: "renderer" | "child", reason: string): void {
    const known = goneReason(reason);
    if (known && this.#gone.length < MAX_PENDING_GONE) this.#gone.push({ kind, reason: known });
  }

  #countGone(day: ResourceDay): void {
    for (const { kind, reason } of this.#gone) {
      addCount(day, kind === "renderer" ? COUNTER.rendererGone : COUNTER.childGone);
      addCount(day, COUNTER.goneReason(reason));
      this.#options.trace.record({ kind: "crash", name: `${kind}_gone`, durationMs: 0, outcome: reason });
    }
    this.#gone = [];
  }

  readonly #load = Effect.fn("ResourceMonitor.load")(function* (this: ResourceMonitor) {
    const saved = yield* readPreferenceFile(this.#summaryPath, (value) =>
      Option.getOrThrow(decodeResourceSummaryFile(value)),
    ).pipe(Effect.option);
    if (Option.isNone(saved)) return;
    const { current, previous, previousHandled } = saved.value;
    if (current.day === this.#day.day) {
      this.#day = structuredClone(current);
    } else if (current.samples > 0) {
      this.#previous = structuredClone(current);
      return;
    }
    this.#previous = previous ? structuredClone(previous) : null;
    this.#previousHandled = previousHandled;
  });

  #persist(): Effect.Effect<void, AnalyticsOperationFailure> {
    return this.#writes
      .withPermit(
        Effect.suspend(() => {
          this.#persistedAt = Date.now();
          return writePreferenceFile(this.#summaryPath, {
            version: 1,
            current: this.#day,
            previous: this.#previous,
            previousHandled: this.#previousHandled,
          });
        }),
      )
      .pipe(toAnalyticsOperationFailure, Effect.uninterruptible);
  }

  readonly #sample = Effect.fn("ResourceMonitor.sample")(function* (this: ResourceMonitor) {
    const now = new Date();
    const today = localDay(now);
    let closedDay = false;
    if (this.#day.day !== today) {
      if (this.#day.samples > 0) {
        this.#previous = this.#day;
        this.#previousHandled = false;
      }
      this.#day = emptyDay(today);
      closedDay = true;
    }
    const day = this.#day;
    this.#countGone(day);
    const measured = this.#lastSampleAt !== null;
    const elapsedSeconds = measured ? (now.getTime() - (this.#lastSampleAt ?? 0)) / 1_000 : 0;
    this.#lastSampleAt = now.getTime();

    const metrics = app.getAppMetrics();
    const tabPids = new Set(this.#options.tabProcessIds());
    const rss = new Map<ProcessGroup, number>();
    const cpu = new Map<ProcessGroup, number>();
    for (const metric of metrics) {
      const group = processGroup(metric, tabPids);
      rss.set(group, (rss.get(group) ?? 0) + metric.memory.workingSetSize / 1024);
      cpu.set(group, (cpu.get(group) ?? 0) + metric.cpu.percentCPUUsage);
    }

    let providerTreeSupported = process.platform !== "win32";
    // A failed `ps` gives a total with no providers in it, which is too low.
    const totalKnown = () => providerTreeSupported || process.platform === "win32";
    let trees: ProviderTreeUsage[] = [];
    if (providerTreeSupported) {
      const listed = yield* listProcesses.pipe(Effect.option);
      if (Option.isSome(listed)) {
        const excludedPids = new Set(metrics.map((metric) => metric.pid));
        if (listed.value.pid !== undefined) excludedPids.add(listed.value.pid);
        const result = providerTrees({
          processes: parsePsOutput(listed.value.text),
          rootPid: process.pid,
          excludedPids,
          registry: providerProcessIds(),
          previousCpuSeconds: this.#previousCpuSeconds,
          elapsedSeconds,
        });
        trees = result.usage;
        this.#previousCpuSeconds = result.cpuSeconds;
      } else {
        providerTreeSupported = false;
        this.#previousCpuSeconds = null;
      }
    }

    for (const [group, value] of rss) recordValue(day, METRIC.rss(group), value);
    if (measured) for (const [group, value] of cpu) recordValue(day, METRIC.cpu(group), value);
    for (const tree of trees) {
      recordValue(day, METRIC.providerRss(tree.provider), tree.rssMb);
      if (tree.cpuPct !== null) recordValue(day, METRIC.providerCpu(tree.provider), tree.cpuPct);
    }
    const totalRss = sum(rss.values()) + sum(trees.map((tree) => tree.rssMb));
    if (totalKnown()) recordValue(day, METRIC.rss("total"), totalRss);
    const treeCpu = trees.every((tree) => tree.cpuPct !== null) ? sum(trees.map((tree) => tree.cpuPct ?? 0)) : null;
    const totalCpu = measured && treeCpu !== null ? sum(cpu.values()) + treeCpu : null;
    if (totalCpu !== null && totalKnown()) recordValue(day, METRIC.cpu("total"), totalCpu);

    // Each window's p99, so one long task shows in the peak and not in every percentile.
    const mainLoopMs =
      this.#loop.count > 0 ? { p99: loopDelayMs(this.#loop.percentile(99)), max: loopDelayMs(this.#loop.max) } : null;
    this.#loop.reset();
    if (mainLoopMs) {
      recordValue(day, METRIC.mainLoop, mainLoopMs.p99);
      recordPeak(day, METRIC.mainLoop, mainLoopMs.max);
    }

    const statements = this.#options.statementTimings.drain();
    for (const duration of statements) recordValue(day, METRIC.database, duration);
    if (statements.length > 0) {
      addCount(day, COUNTER.databaseRequests, statements.length);
      addCount(day, COUNTER.databaseSlow, statements.filter((ms) => ms > SLOW_DATABASE_STATEMENT_MS).length);
    }

    const providerProcesses = sum(trees.map((tree) => tree.processCount));
    recordPeak(day, METRIC.activeTurns, this.#activeTurns.size);
    recordPeak(day, METRIC.browserTabs, tabPids.size);
    recordPeak(day, METRIC.providerProcesses, providerProcesses);
    day.samples += 1;
    if (!providerTreeSupported) day.providerTreeSupported = false;

    const sample: ResourceSample = {
      at: now.toISOString(),
      rssMb: { ...roundedEntries(rss), total: Math.round(totalRss) },
      cpuPct: measured ? { ...roundedEntries(cpu), ...(totalCpu === null ? {} : { total: Math.round(totalCpu) }) } : {},
      providers: Object.fromEntries(
        trees.map((tree) => [
          tree.provider,
          {
            rssMb: Math.round(tree.rssMb),
            cpuPct: tree.cpuPct === null ? null : Math.round(tree.cpuPct),
            processes: tree.processCount,
          },
        ]),
      ),
      mainLoopMs: mainLoopMs && { p99: Math.round(mainLoopMs.p99), max: Math.round(mainLoopMs.max) },
      database: { statements: statements.length, maxMs: Math.round(Math.max(0, ...statements)) },
      activeTurns: this.#activeTurns.size,
      browserTabs: tabPids.size,
      providerTreeSupported,
    };
    this.#lastSample = sample;
    yield* this.#writes
      .withPermit(appendRotatingLines(this.#samplesFile, [JSON.stringify(sample)]))
      .pipe(Effect.ignore, Effect.uninterruptible);
    if (closedDay || Date.now() - this.#persistedAt >= PERSIST_INTERVAL_MS) yield* this.#persist().pipe(Effect.ignore);
    if (closedDay) this.#onDayClosed();
  });
}

function processGroup(metric: ProcessMetric, tabPids: ReadonlySet<number>): ProcessGroup {
  switch (metric.type) {
    case "Browser":
      return "main";
    case "GPU":
      return "gpu";
    case "Tab":
      return tabPids.has(metric.pid) ? "browser_tab" : "window";
    case "Utility":
      return UTILITY_GROUPS.get(metric.name ?? "") ?? "utility_other";
    default:
      return "utility_other";
  }
}

/** All processes, for the provider trees. The output stays in memory: it holds executable paths. */
function loopDelayMs(nanoseconds: number): number {
  return Math.max(0, nanoseconds / 1e6 - LOOP_RESOLUTION_MS);
}

const listProcesses = Effect.callback<{ text: string; pid: number | undefined }, AnalyticsOperationFailure>(
  (resume) => {
    const child = execFile(
      "ps",
      ["-A", "-o", "pid=,ppid=,rss=,time=,comm="],
      { encoding: "utf8", timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER },
      (error, stdout) => {
        resume(
          error
            ? Effect.fail(new AnalyticsOperationFailure({ cause: error }))
            : Effect.succeed({ text: stdout, pid: child.pid }),
        );
      },
    );
    return Effect.sync(() => {
      child.kill();
    });
  },
);

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function roundedEntries(values: ReadonlyMap<ProcessGroup, number>): Partial<Record<ProcessGroup, number>> {
  return Object.fromEntries([...values].map(([group, value]) => [group, Math.round(value)]));
}
