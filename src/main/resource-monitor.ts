import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { Effect, Exit, Option, Schema, Scope, Semaphore } from "effect";
import {
  app,
  BrowserWindow,
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
import {
  MainLoopProfiler,
  type MainLoopProfileSummary,
  PROFILE_STALL_MS,
  summarizeCpuProfile,
} from "./main-loop-profile";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";
import {
  addCount,
  type ChildType,
  COUNTER,
  type DeviceClass,
  decodeResourceSummaryFile,
  deviceClass,
  emptyDay,
  type GoneReason,
  goneReason,
  type LoopPhase,
  localDay,
  loopPhase,
  MAIN_LOOP_STALL_MS,
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
const STALL_PROFILES_FILE = "stall-profiles.ndjson";
const MAX_STALL_PROFILES_BYTES = 256 * 1024;
// A profile starts in a minute that follows a stall, so only stalls that come again are profiled.
const PROFILE_START_INTERVAL_MS = 30 * 60_000;
const PROFILE_KEEP_INTERVAL_MS = 6 * 60 * 60_000;
const PS_TIMEOUT_MS = 5_000;
const PS_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_ACTIVE_TURNS = 1_000;
const MAX_PENDING_GONE = 1_000;
/** Bounds on the renderer reports between two samples. A window reports at most once a minute. */
const MAX_PENDING_RENDERER_COUNT = 1_000_000;
const MAX_PENDING_INPUT_DELAYS = 1_000;
/** A window renderer that does not answer in this time, such as one in a long task, has no heap figure in the sample. */
const WINDOW_MEMORY_TIMEOUT_MS = 2_000;
/** Bounds on the figures that a window renderer sends. A renderer can send any number. */
const MAX_WINDOW_HEAP_BYTES = 1024 ** 4;
const MAX_WINDOW_DOM_NODES = 1_000_000_000;
/** The histogram's timer interval. Each recorded delay includes it, so it is subtracted. */
const LOOP_RESOLUTION_MS = 20;
// The `serviceName` that `agent-database-host-process.ts` and the voice `*-host-process.ts` files
// give `utilityProcess.fork`. Electron reports it as the `name` of a metric and of a gone process.
const UTILITY_GROUPS = new Map<string, ProcessGroup & ChildType>([
  ["OpenBot databases", "database_host"],
  ["OpenBot voice transcription", "voice_host"],
  ["OpenBot speech", "voice_host"],
]);

export interface ResourceMonitorOptions {
  userDataPath: string;
  server: boolean;
  trace: TraceFile;
  statementTimings: StatementTimings;
  tabProcessIds: () => number[];
  /**
   * The pages of the app windows (not browser tabs), for their heap figures. Without it, a sample
   * has no heap figures.
   */
  appWindowContents?: () => readonly WebContents[];
  /**
   * Whether a turn runs now. The turn count of the samples can keep a turn that ended with no
   * completion event, so the loop rest asks the turns themselves.
   */
  turnRunning: () => boolean;
  /** The directory of the application's own code. A profile names only the files in it. */
  appPath: string;
}

/** The summary of one profiled minute with a stall, as `stall-profiles.ndjson` and analytics get it. */
export interface MainLoopStallProfile extends MainLoopProfileSummary {
  stallMs: number;
  phase: LoopPhase;
  turnActive: boolean;
  hostKind: DeviceClass["hostKind"];
}

/** One sample as `resources.ndjson` and the diagnostics export hold it. Group and provider names only. */
interface ResourceSample {
  at: string;
  rssMb: Partial<Record<ProcessGroup | "total", number>>;
  /** Windows only: Electron reports private memory on no other platform. */
  privateMb: Partial<Record<ProcessGroup, number>>;
  cpuPct: Partial<Record<ProcessGroup | "total", number>>;
  providers: Partial<Record<ResourceProvider, { rssMb: number; cpuPct: number | null; processes: number }>>;
  /** The app window renderers together. Null when one of them did not answer. */
  windowMemory: WindowMemory | null;
  mainLoopMs: { p99: number; max: number; phase: LoopPhase } | null;
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
  readonly #profilesFile: { directory: string; path: string; maxBytes: number };
  readonly #profiler = new MainLoopProfiler();
  #profileStartedAt: number | null = null;
  #profileKeptAt: number | null = null;
  #lastStallProfile: (MainLoopStallProfile & { at: string }) | null = null;
  #onStallProfile: (profile: MainLoopStallProfile) => void = () => {};
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
   * The trace gets each exit at once: a main process that stops within the minute would lose it.
   */
  #gone: { kind: "renderer" | "child"; reason: GoneReason; type: ChildType | null }[] = [];
  /** Renderer reports since the last sample: long tasks, inputs, and the delays the browser timed. */
  #rendererTiming: { longTasks: number; inputs: number; inputDelaysMs: number[] } = {
    longTasks: 0,
    inputs: 0,
    inputDelaysMs: [],
  };
  /**
   * The main-loop window that the next sample closes: when it started in `performance.now()` time
   * (milliseconds after the process started), and whether a turn ran in it.
   */
  #loopWindowStartedAt = 0;
  #turnInLoopWindow = false;
  #resumedAt: number | null = null;
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
    this.#profilesFile = {
      directory,
      path: join(directory, STALL_PROFILES_FILE),
      maxBytes: MAX_STALL_PROFILES_BYTES,
    };
    this.#device = deviceClass({
      totalMemoryBytes: totalmem(),
      cpuCount: cpus().length,
      arch: process.arch,
      server: options.server,
    });
  }

  /** Loads the saved days and starts sampling. `onDayClosed` runs when a closed day waits to be sent. */
  start(onDayClosed: () => void, onStallProfile: (profile: MainLoopStallProfile) => void = () => {}): void {
    if (this.#closed || this.#timer) return;
    this.#onStallProfile = onStallProfile;
    this.#onDayClosed = onDayClosed;
    app.on("render-process-gone", this.#rendererGone);
    app.on("child-process-gone", this.#childGone);
    powerMonitor.on("suspend", this.#suspend);
    powerMonitor.on("resume", this.#resume);
    app.on("browser-window-focus", this.#measureLoop);
    // The start is measured even with no window: the first sample stops the timer if nobody uses the app.
    this.#measureLoop();
    this.#startLoopWindow();
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

  /** Counts from an app window since its last report. The next sample adds them to the day. */
  observeRendererTiming(report: { longTasks: number; inputs: number; inputDelaysMs: readonly number[] }): void {
    if (this.#closed) return;
    const pending = this.#rendererTiming;
    pending.longTasks = Math.min(MAX_PENDING_RENDERER_COUNT, pending.longTasks + report.longTasks);
    const kept = report.inputDelaysMs.slice(0, Math.max(0, MAX_PENDING_INPUT_DELAYS - pending.inputDelaysMs.length));
    pending.inputDelaysMs.push(...kept);
    // An input whose delay is dropped is not counted, so it does not show as a 0 ms input in the p95.
    const dropped = report.inputDelaysMs.length - kept.length;
    pending.inputs = Math.min(MAX_PENDING_RENDERER_COUNT, pending.inputs + report.inputs - dropped);
  }

  observeAgentEvent(event: AgentEvent): void {
    if (event.type === "turn-started") {
      this.#turnInLoopWindow = true;
      if (this.#activeTurns.size < MAX_ACTIVE_TURNS) this.#activeTurns.add(event.turnId);
      this.#measureLoop();
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
      lastStallProfile: this.#lastStallProfile,
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
    app.off("browser-window-focus", this.#measureLoop);
    this.#loop.disable();
    this.#profiler.discard();
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
  readonly #suspend = () => {
    this.#profiler.discard();
    this.#unschedule();
  };
  readonly #resume = () => {
    this.#lastSampleAt = null;
    this.#previousCpuSeconds = null;
    this.#loop.reset();
    this.#measureLoop();
    this.#startLoopWindow();
    this.#resumedAt = this.#loopWindowStartedAt;
    this.#schedule();
  };

  /**
   * The histogram wakes the main process every 20 ms, which is most of its idle energy use. It runs
   * while a window has the focus or a turn runs, and from a start or a resume to the next sample.
   * Node keeps the last tick when the timer stops, so a new start resets it: else the paused time
   * would count as one long delay.
   */
  readonly #measureLoop = () => {
    if (!this.#closed && this.#loop.enable()) this.#loop.reset();
  };

  /**
   * Stops the histogram at a sample, after its window is read, when nobody uses the app. A server
   * has no window and runs on mains power, and its remote clients feel each stall, so it never rests.
   */
  #restLoop(): void {
    if (this.#profiler.running) return;
    if (this.#options.server || this.#options.turnRunning() || BrowserWindow.getFocusedWindow() !== null) return;
    this.#loop.disable();
  }

  #startLoopWindow(): void {
    this.#loopWindowStartedAt = performance.now();
    this.#turnInLoopWindow = this.#activeTurns.size > 0;
  }

  readonly #rendererGone = (_event: Event, _contents: WebContents, details: RenderProcessGoneDetails) =>
    this.#recordGone("renderer", details.reason, null);
  // OpenBot starts and stops its utility processes itself, such as the voice host after idle time.
  readonly #childGone = (_event: Event, details: Details) => {
    if (details.type === "Utility" && details.reason === "killed") return;
    this.#recordGone("child", details.reason, childType(details));
  };

  #recordGone(kind: "renderer" | "child", reason: string, type: ChildType | null): void {
    const known = goneReason(reason);
    if (!known) return;
    const name = type ? `child_gone:${type}` : `${kind}_gone`;
    this.#options.trace.record({ kind: "crash", name, durationMs: 0, outcome: known });
    Effect.runFork(this.#options.trace.flush());
    if (this.#gone.length < MAX_PENDING_GONE) this.#gone.push({ kind, reason: known, type });
  }

  #countGone(day: ResourceDay): void {
    for (const { kind, reason, type } of this.#gone) {
      addCount(day, kind === "renderer" ? COUNTER.rendererGone : COUNTER.childGone);
      if (type) addCount(day, COUNTER.childType(type));
      addCount(day, COUNTER.goneReason(reason));
    }
    this.#gone = [];
  }

  /** An input that the browser did not time took less than 16 ms to handle; it counts as no delay. */
  #countRendererTiming(day: ResourceDay): void {
    const { longTasks, inputs, inputDelaysMs } = this.#rendererTiming;
    if (longTasks > 0) addCount(day, COUNTER.rendererLongTasks, longTasks);
    for (const delay of inputDelaysMs) recordValue(day, METRIC.rendererInput, delay);
    recordValue(day, METRIC.rendererInput, 0, inputs - inputDelaysMs.length);
    this.#rendererTiming = { longTasks: 0, inputs: 0, inputDelaysMs: [] };
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

  /**
   * Ends the profile of the minute that this sample closes, and keeps its summary when that minute
   * had a stall. Then starts a profile for the next minute when this one had a stall. The loop
   * histogram and the profile cover the same minute, because both start and end at a sample.
   */
  readonly #profileStalls = Effect.fn("ResourceMonitor.profileStalls")(function* (
    this: ResourceMonitor,
    mainLoopMs: { max: number; phase: LoopPhase } | null,
    turnActive: boolean,
  ) {
    const stalled = mainLoopMs !== null && mainLoopMs.max >= PROFILE_STALL_MS;
    const now = Date.now();
    if (this.#profiler.running) {
      const profile = yield* this.#profiler.stop();
      if (!profile || !stalled) return;
      this.#profileKeptAt = now;
      const summary: MainLoopStallProfile = {
        stallMs: Math.round(mainLoopMs.max),
        phase: mainLoopMs.phase,
        turnActive,
        hostKind: this.#device.hostKind,
        ...summarizeCpuProfile(profile, this.#options.appPath),
      };
      this.#lastStallProfile = { at: new Date(now).toISOString(), ...summary };
      yield* this.#writes
        .withPermit(appendRotatingLines(this.#profilesFile, [JSON.stringify(this.#lastStallProfile)]))
        .pipe(Effect.ignore);
      this.#onStallProfile(summary);
      return;
    }
    // The start of the app and a wake from sleep stall once; a profile of the next minute shows nothing.
    if (!stalled || mainLoopMs.phase === "startup" || mainLoopMs.phase === "resume") return;
    if (this.#profileStartedAt !== null && now - this.#profileStartedAt < PROFILE_START_INTERVAL_MS) return;
    if (this.#profileKeptAt !== null && now - this.#profileKeptAt < PROFILE_KEEP_INTERVAL_MS) return;
    this.#profileStartedAt = now;
    yield* this.#profiler.start();
    // The rest check ran before this start. The next sample needs the histogram to judge the profile.
    this.#measureLoop();
  });

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
    const privateMemory = new Map<ProcessGroup, number>();
    const cpu = new Map<ProcessGroup, number>();
    for (const metric of metrics) {
      const group = processGroup(metric, tabPids);
      rss.set(group, (rss.get(group) ?? 0) + metric.memory.workingSetSize / 1024);
      const privateKb = metric.memory.privateBytes;
      if (privateKb !== undefined) privateMemory.set(group, (privateMemory.get(group) ?? 0) + privateKb / 1024);
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
    for (const [group, value] of privateMemory) recordValue(day, METRIC.privateMemory(group), value);
    const windowMemory = this.#options.appWindowContents
      ? yield* measureWindowMemory(this.#options.appWindowContents(), tabPids)
      : null;
    if (windowMemory) {
      recordValue(day, METRIC.windowJsHeap, windowMemory.jsHeapUsedMb);
      recordValue(day, METRIC.windowJsHeapTotal, windowMemory.jsHeapTotalMb);
      if (windowMemory.domHeapMb !== null) recordValue(day, METRIC.windowDomHeap, windowMemory.domHeapMb);
      if (windowMemory.arrayBufferMb !== null) recordValue(day, METRIC.windowArrayBuffers, windowMemory.arrayBufferMb);
      if (windowMemory.domNodes !== null) recordValue(day, METRIC.windowDomNodes, windowMemory.domNodes);
    }
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
      this.#loop.count > 0
        ? {
            p99: loopDelayMs(this.#loop.percentile(99)),
            max: loopDelayMs(this.#loop.max),
            phase: loopPhase(this.#loopWindowStartedAt, this.#resumedAt),
          }
        : null;
    const turnInLoopWindow = this.#turnInLoopWindow;
    this.#loop.reset();
    this.#restLoop();
    this.#startLoopWindow();
    if (mainLoopMs) {
      if (mainLoopMs.max > (day.peaks[METRIC.mainLoop] ?? 0)) {
        day.mainLoopPeak = { phase: mainLoopMs.phase, turnActive: turnInLoopWindow };
      }
      recordValue(day, METRIC.mainLoop, mainLoopMs.p99);
      recordPeak(day, METRIC.mainLoop, mainLoopMs.max);
      if (mainLoopMs.max >= MAIN_LOOP_STALL_MS) {
        addCount(day, COUNTER.mainLoopStall);
        // The line's time is the end of the minute that held the stall.
        this.#options.trace.record({
          kind: "stall",
          name: "main_loop",
          durationMs: mainLoopMs.max,
          outcome: mainLoopMs.phase,
        });
      }
    }

    // A profile must not cost the sample, also when its summary throws.
    yield* this.#profileStalls(mainLoopMs, turnInLoopWindow).pipe(Effect.ignoreCause);
    const statements = this.#options.statementTimings.drain();
    for (const duration of statements) recordValue(day, METRIC.database, duration);
    if (statements.length > 0) {
      addCount(day, COUNTER.databaseRequests, statements.length);
      addCount(day, COUNTER.databaseSlow, statements.filter((ms) => ms > SLOW_DATABASE_STATEMENT_MS).length);
    }

    this.#countRendererTiming(day);

    const providerProcesses = sum(trees.map((tree) => tree.processCount));
    recordPeak(day, METRIC.activeTurns, this.#activeTurns.size);
    recordPeak(day, METRIC.browserTabs, tabPids.size);
    recordPeak(day, METRIC.providerProcesses, providerProcesses);
    day.samples += 1;
    if (!providerTreeSupported) day.providerTreeSupported = false;

    const sample: ResourceSample = {
      at: now.toISOString(),
      rssMb: { ...roundedEntries(rss), total: Math.round(totalRss) },
      privateMb: roundedEntries(privateMemory),
      windowMemory: windowMemory && {
        jsHeapUsedMb: Math.round(windowMemory.jsHeapUsedMb),
        jsHeapTotalMb: Math.round(windowMemory.jsHeapTotalMb),
        domHeapMb: windowMemory.domHeapMb === null ? null : Math.round(windowMemory.domHeapMb),
        arrayBufferMb: windowMemory.arrayBufferMb === null ? null : Math.round(windowMemory.arrayBufferMb),
        domNodes: windowMemory.domNodes,
        windows: windowMemory.windows,
      },
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
      mainLoopMs: mainLoopMs && {
        p99: Math.round(mainLoopMs.p99),
        max: Math.round(mainLoopMs.max),
        phase: mainLoopMs.phase,
      },
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

function childType(details: Details): ChildType {
  switch (details.type) {
    case "GPU":
      return "gpu";
    case "Utility": {
      const group = UTILITY_GROUPS.get(details.name ?? "");
      if (group) return group;
      const network = details.serviceName === "network.mojom.NetworkService" || details.name === "Network Service";
      return network ? "network" : "utility_other";
    }
    default:
      return "other";
  }
}

interface WindowMemory {
  jsHeapUsedMb: number;
  jsHeapTotalMb: number;
  /** Blink's garbage-collected heap: DOM nodes, styles and other page objects. Null when Chromium does not report it. */
  domHeapMb: number | null;
  /** ArrayBuffer and typed array memory outside the V8 heap. Null when Chromium does not report it. */
  arrayBufferMb: number | null;
  domNodes: number | null;
  windows: number;
}

const HeapBytes = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: MAX_WINDOW_HEAP_BYTES }));
const decodeHeapUsage = Schema.decodeUnknownOption(
  Schema.Struct({
    usedSize: HeapBytes,
    totalSize: HeapBytes,
    embedderHeapUsedSize: Schema.optionalKey(HeapBytes),
    backingStorageSize: Schema.optionalKey(HeapBytes),
  }),
);
const decodeDomCounters = Schema.decodeUnknownOption(
  Schema.Struct({ nodes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WINDOW_DOM_NODES })) }),
);

/**
 * The heaps of the app window renderers, through the DevTools protocol from main: the page runs no
 * script for it, and the figures are exact (`performance.memory` is rounded and cached for minutes).
 * Each renderer process is read once. The session sends only the two read commands and ends at once.
 * A renderer that has another debugger session, is loading or does not answer makes the result null:
 * a part would be too low.
 */
const measureWindowMemory = Effect.fnUntraced(function* (
  contents: readonly WebContents[],
  tabPids: ReadonlySet<number>,
) {
  const totals = { usedBytes: 0, totalBytes: 0, domHeapBytes: 0, arrayBufferBytes: 0, domNodes: 0 };
  let domHeapKnown = true;
  let arrayBufferKnown = true;
  let domNodesKnown = true;
  const measured = new Set<number>();
  for (const page of contents) {
    if (page.isDestroyed() || page.isCrashed()) continue;
    const pid = page.getOSProcessId();
    if (pid === 0 || measured.has(pid) || tabPids.has(pid)) continue;
    if (page.isLoading() || page.debugger.isAttached()) return null;
    const heap = yield* readWindowHeap(page).pipe(
      Effect.timeoutOption(WINDOW_MEMORY_TIMEOUT_MS),
      Effect.map(Option.flatten),
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(heap)) return null;
    measured.add(pid);
    const { usage, counters } = heap.value;
    totals.usedBytes += usage.usedSize;
    totals.totalBytes += usage.totalSize;
    if (usage.embedderHeapUsedSize === undefined) domHeapKnown = false;
    else totals.domHeapBytes += usage.embedderHeapUsedSize;
    if (usage.backingStorageSize === undefined) arrayBufferKnown = false;
    else totals.arrayBufferBytes += usage.backingStorageSize;
    if (Option.isNone(counters)) domNodesKnown = false;
    else totals.domNodes += counters.value.nodes;
  }
  if (measured.size === 0) return null;
  const mb = (bytes: number) => bytes / 1024 ** 2;
  return {
    jsHeapUsedMb: mb(totals.usedBytes),
    jsHeapTotalMb: mb(totals.totalBytes),
    domHeapMb: domHeapKnown ? mb(totals.domHeapBytes) : null,
    arrayBufferMb: arrayBufferKnown ? mb(totals.arrayBufferBytes) : null,
    domNodes: domNodesKnown ? totals.domNodes : null,
    windows: measured.size,
  } satisfies WindowMemory;
});

const readWindowHeap = (page: WebContents) =>
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            page.debugger.attach("1.3");
            return page.debugger;
          },
          catch: (cause) => new AnalyticsOperationFailure({ cause }),
        }),
        (session) =>
          Effect.sync(() => {
            if (!page.isDestroyed() && session.isAttached()) session.detach();
          }),
      );
      const command = (method: string) =>
        Effect.tryPromise({
          try: (): Promise<unknown> => session.sendCommand(method),
          catch: (cause) => new AnalyticsOperationFailure({ cause }),
        });
      const usage = decodeHeapUsage(yield* command("Runtime.getHeapUsage"));
      if (Option.isNone(usage)) return Option.none();
      // The node count is extra: a renderer that does not give it still has its heap figures.
      const counters = yield* command("Memory.getDOMCounters").pipe(
        Effect.map(decodeDomCounters),
        Effect.orElseSucceed(() => Option.none()),
      );
      return Option.some({ usage: usage.value, counters });
    }),
  );

function loopDelayMs(nanoseconds: number): number {
  return Math.max(0, nanoseconds / 1e6 - LOOP_RESOLUTION_MS);
}

/** All processes, for the provider trees. The output stays in memory: it holds executable paths. */
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
