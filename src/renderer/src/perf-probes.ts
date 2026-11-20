import { type DiagnosticEvent, OBSERVE, type Owner } from "solid-js";
import { attribution, type ChangeRecord, costs, type RerunEvent } from "solid-js/attribution";
import { setRendererPerfSink } from "./perf-count";

type TimerKind = "timeout" | "interval" | "raf" | "idle";

interface TimerStats {
  kind: TimerKind;
  site: string;
  scheduled: number;
  fired: number;
  ms: number;
}

interface CauseStats {
  runs: number;
  selfMs: number;
  wastedMs: number;
}

interface StartOptions {
  causes?: boolean;
}

interface DiagnosticStats {
  count: number;
  owners: Map<string, number>;
}

const TOP_SCOPES = 40;
const TOP_WRITES = 25;
const TOP_TIMERS = 60;
const TOP_OWNERS = 5;
const PROBE_FRAME = "perf-probes";
const LAYOUT_GETTERS: readonly [typeof Element | typeof HTMLElement, string][] = [
  [HTMLElement, "offsetHeight"],
  [HTMLElement, "offsetWidth"],
  [HTMLElement, "offsetTop"],
  [HTMLElement, "offsetLeft"],
  [Element, "clientHeight"],
  [Element, "clientWidth"],
  [Element, "scrollHeight"],
  [Element, "scrollWidth"],
  [Element, "scrollTop"],
];

interface TimerWindow {
  setTimeout(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
  setInterval(handler: TimerHandler, timeout?: number, ...args: unknown[]): number;
}

const timerWindow: TimerWindow = window;
const counters = new Map<string, number>();
const timers = new Map<string, TimerStats>();
const diagnostics = new Map<string, DiagnosticStats>();
const restorers: (() => void)[] = [];
let recording = false;
let startedAt = 0;
let stopAttribution: (() => void) | null = null;
let stopDiagnostics: (() => void) | null = null;
let mutations: MutationObserver | null = null;
let stopCauses: (() => void) | null = null;
const rootWrites = new Map<string, CauseStats>();
const scopeSites = new Map<string, CauseStats>();
const TOP_CAUSES = 40;

function bump(key: string, amount = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

function callSite(): string {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes(PROBE_FRAME)) continue;
    return line
      .trim()
      .replace(/^at /, "")
      .replace(/[a-z-]+:\/\/\S*\//g, "");
  }
  return "(unknown)";
}

function timerStats(kind: TimerKind, site: string): TimerStats {
  const key = `${kind} ${site}`;
  let stats = timers.get(key);
  if (!stats) {
    stats = { kind, site, scheduled: 0, fired: 0, ms: 0 };
    timers.set(key, stats);
  }
  return stats;
}

function measuredHandler(handler: TimerHandler, kind: TimerKind, site: string): TimerHandler {
  if (typeof handler === "string") return handler;
  return (...args: unknown[]) => {
    if (!recording) return handler(...args);
    const stats = timerStats(kind, site);
    const begin = performance.now();
    try {
      return handler(...args);
    } finally {
      stats.fired += 1;
      stats.ms += performance.now() - begin;
    }
  };
}

function scheduleCounted(kind: TimerKind): string | null {
  if (!recording) return null;
  const site = callSite();
  timerStats(kind, site).scheduled += 1;
  return site;
}

function installIntervalProbe(): void {
  const original = timerWindow.setInterval.bind(window);
  timerWindow.setInterval = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const site = callSite();
    if (recording) timerStats("interval", site).scheduled += 1;
    return original(measuredHandler(handler, "interval", site), timeout, ...args);
  };
}

function installResizeObserverProbe(): void {
  const Native = window.ResizeObserver;
  window.ResizeObserver = class CountingResizeObserver extends Native {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        if (recording) {
          bump("dom.resizeObserver.callbacks");
          bump("dom.resizeObserver.entries", entries.length);
        }
        callback(entries, observer);
      });
    }
  };
}

function patchRecordingTimers(): void {
  const timeout = timerWindow.setTimeout.bind(window);
  const frame = window.requestAnimationFrame.bind(window);
  const idle = window.requestIdleCallback.bind(window);
  const originals = {
    setTimeout: timerWindow.setTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    requestIdleCallback: window.requestIdleCallback,
  };
  timerWindow.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const site = scheduleCounted("timeout");
    return timeout(site ? measuredHandler(handler, "timeout", site) : handler, delay, ...args);
  };
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const site = scheduleCounted("raf");
    if (!site) return frame(callback);
    const stats = timerStats("raf", site);
    return frame((time) => {
      const begin = performance.now();
      try {
        callback(time);
      } finally {
        stats.fired += 1;
        stats.ms += performance.now() - begin;
      }
    });
  };
  window.requestIdleCallback = (callback: IdleRequestCallback, options?: IdleRequestOptions) => {
    const site = scheduleCounted("idle");
    if (!site) return idle(callback, options);
    const stats = timerStats("idle", site);
    return idle((deadline) => {
      const begin = performance.now();
      try {
        callback(deadline);
      } finally {
        stats.fired += 1;
        stats.ms += performance.now() - begin;
      }
    }, options);
  };
  restorers.push(() => Object.assign(window, originals));
}

function patchLayoutReads(): void {
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function countedRect(this: Element) {
    bump("dom.getBoundingClientRect");
    return rect.call(this);
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function countedAnimate(
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    bump("dom.animate");
    return animate.call(this, keyframes, options);
  };
  const computed = window.getComputedStyle;
  window.getComputedStyle = (element: Element, pseudo?: string | null) => {
    bump("dom.getComputedStyle");
    return computed.call(window, element, pseudo);
  };
  restorers.push(() => {
    Element.prototype.getBoundingClientRect = rect;
    Element.prototype.animate = animate;
    window.getComputedStyle = computed;
  });
  for (const [owner, property] of LAYOUT_GETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(owner.prototype, property);
    const getter = descriptor?.get;
    if (!descriptor || !getter) continue;
    Object.defineProperty(owner.prototype, property, {
      ...descriptor,
      get(this: Element) {
        bump("dom.layoutRead");
        bump(`dom.layoutRead.${property}`);
        return getter.call(this);
      },
    });
    restorers.push(() => Object.defineProperty(owner.prototype, property, descriptor));
  }
}

function observeNodes(): void {
  mutations = new MutationObserver((records) => {
    for (const record of records) {
      bump("dom.nodesAdded", record.addedNodes.length);
      bump("dom.nodesRemoved", record.removedNodes.length);
    }
  });
  mutations.observe(document, { childList: true, subtree: true });
}

function recordDiagnostic(event: DiagnosticEvent): void {
  let stats = diagnostics.get(event.code);
  if (!stats) {
    stats = { count: 0, owners: new Map() };
    diagnostics.set(event.code, stats);
  }
  stats.count += 1;
  const owner = event.ownerName ?? event.nodeName ?? "(unnamed)";
  stats.owners.set(owner, (stats.owners.get(owner) ?? 0) + 1);
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function addCause(table: Map<string, CauseStats>, key: string, event: RerunEvent): void {
  const stats = table.get(key) ?? { runs: 0, selfMs: 0, wastedMs: 0 };
  stats.runs += 1;
  stats.selfMs += event.selfMs;
  if (!event.changed && !event.held) stats.wastedMs += event.selfMs;
  table.set(key, stats);
}

function collectRoots(causes: readonly ChangeRecord[], into: Map<string, string>): void {
  for (const cause of causes) {
    if (cause.kind === "derived" && cause.causes && cause.causes.length > 0) {
      collectRoots(cause.causes, into);
      continue;
    }
    const site = cause.stack?.[0]?.replace(/^at\s+/u, "").replace(/\(?[a-z-]+:\/\/[^/]*\//u, "(") ?? "";
    into.set(`${cause.name}${site ? ` @ ${site}` : ""}`, cause.name);
  }
}

function locationOf(node: Owner | null): string {
  for (let current = node; current; current = current._parent) {
    if (current._loc) return current._loc;
  }
  return "";
}

function recordRerun(event: RerunEvent, location: string): void {
  addCause(scopeSites, `${event.nodeKind} ${event.nodeName}${location ? ` @ ${location}` : ""}`, event);
  const roots = new Map<string, string>();
  collectRoots(event.causes, roots);
  for (const key of roots.keys()) addCause(rootWrites, key, event);
}

function causeRows(table: Map<string, CauseStats>) {
  return [...table]
    .sort((left, right) => right[1].selfMs - left[1].selfMs || right[1].runs - left[1].runs)
    .slice(0, TOP_CAUSES)
    .map(([name, stats]) => ({
      name,
      runs: stats.runs,
      selfMs: rounded(stats.selfMs),
      wastedMs: rounded(stats.wastedMs),
    }));
}

function solidCosts() {
  const tables = costs();
  let runs = 0;
  let selfMs = 0;
  let wastedMs = 0;
  for (const scope of tables.scopes) {
    runs += scope.runs;
    selfMs += scope.selfMs;
    wastedMs += scope.wastedMs;
  }
  return {
    observe: OBSERVE !== undefined,
    totals: { scopes: tables.scopes.length, runs, selfMs: rounded(selfMs), wastedMs: rounded(wastedMs) },
    scopesBySelfMs: tables.scopes.slice(0, TOP_SCOPES).map((scope) => ({
      name: scope.name,
      kind: scope.kind,
      runs: scope.runs,
      selfMs: rounded(scope.selfMs),
      wastedMs: rounded(scope.wastedMs),
    })),
    scopesByRuns: [...tables.scopes]
      .sort((left, right) => right.runs - left.runs)
      .slice(0, TOP_SCOPES)
      .map((scope) => ({ name: scope.name, kind: scope.kind, runs: scope.runs })),
    writes: tables.writes.slice(0, TOP_WRITES).map((write) => ({
      name: write.name,
      runs: write.runs,
      downstreamMs: rounded(write.downstreamMs),
    })),
  };
}

function start(options: StartOptions = {}): void {
  if (recording) return;
  counters.clear();
  timers.clear();
  diagnostics.clear();
  rootWrites.clear();
  scopeSites.clear();
  patchRecordingTimers();
  patchLayoutReads();
  observeNodes();
  stopAttribution = attribution.enable({ log: false, values: "none", stacks: options.causes === true });
  if (options.causes)
    stopCauses = OBSERVE?.records.subscribe("rerun", (event, node) => recordRerun(event, locationOf(node))) ?? null;
  stopDiagnostics = OBSERVE?.diagnostics.subscribe(recordDiagnostic) ?? null;
  setRendererPerfSink({ count: bump });
  startedAt = performance.now();
  recording = true;
}

function stop() {
  if (!recording) return null;
  const durationMs = Math.round(performance.now() - startedAt);
  recording = false;
  setRendererPerfSink(null);
  mutations?.takeRecords();
  mutations?.disconnect();
  mutations = null;
  for (const restore of restorers.splice(0).reverse()) restore();
  const solid = solidCosts();
  stopCauses?.();
  stopCauses = null;
  const causes = rootWrites.size > 0 ? { rootWrites: causeRows(rootWrites), scopes: causeRows(scopeSites) } : null;
  stopAttribution?.();
  stopAttribution = null;
  stopDiagnostics?.();
  stopDiagnostics = null;
  return {
    role: new URLSearchParams(window.location.search).get("window") ?? "app",
    durationMs,
    solid,
    causes,
    diagnostics: [...diagnostics]
      .sort((left, right) => right[1].count - left[1].count)
      .map(([code, stats]) => ({
        code,
        count: stats.count,
        owners: [...stats.owners]
          .sort((left, right) => right[1] - left[1])
          .slice(0, TOP_OWNERS)
          .map(([name, count]) => ({ name, count })),
      })),
    counters: Object.fromEntries([...counters].sort((left, right) => left[0].localeCompare(right[0]))),
    timers: [...timers.values()]
      .sort((left, right) => right.fired - left.fired || right.scheduled - left.scheduled)
      .slice(0, TOP_TIMERS)
      .map((stats) => ({ ...stats, ms: rounded(stats.ms) })),
  };
}

export function installRendererPerfProbes(): void {
  installIntervalProbe();
  installResizeObserverProbe();
  Object.assign(window, { __openbotPerfProbes: { start, stop } });
}
