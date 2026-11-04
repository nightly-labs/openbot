import { appPort } from "./app-port";

/** Tasks longer than this count. The browser reports tasks from 50 ms. */
const LONG_TASK_MS = 200;
/** The browser times an input only when its handling takes at least this long. */
const EVENT_THRESHOLD_MS = 16;
const REPORT_INTERVAL_MS = 60_000;
const MAX_LONG_TASKS = 10_000;
const MAX_INPUTS = 100_000;
const MAX_INPUT_DELAYS = 64;
const MAX_INPUT_DELAY_MS = 600_000;
const INPUTS = ["pointerdown", "keydown"] as const;

// The DOM library of TypeScript does not declare the Event Timing option yet.
const eventTimingInit: PerformanceObserverInit & { durationThreshold: number } = {
  type: "event",
  durationThreshold: EVENT_THRESHOLD_MS,
};

let longTasks = 0;
let inputs = 0;
let inputDelaysMs: number[] = [];
let started = false;

function supports(type: string): boolean {
  return typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes(type);
}

function isInputTiming(entry: PerformanceEntry): entry is PerformanceEventTiming {
  return INPUTS.some((name) => name === entry.name) && "processingStart" in entry;
}

function report(workspaceReady: boolean): void {
  if (!workspaceReady && longTasks === 0 && inputs === 0) return;
  const payload = {
    ...(workspaceReady ? { workspaceReady: true as const } : {}),
    longTasks,
    inputs,
    // The browser can time an input before the capture listener counts it.
    inputDelaysMs: inputDelaysMs.slice(0, inputs),
  };
  longTasks = 0;
  inputs = 0;
  inputDelaysMs = [];
  void appPort()
    .reportRendererTiming(payload)
    .catch(() => undefined);
}

/**
 * Counts long tasks and input delays of this window for the daily `system_resources` summary. Only
 * counts and delays leave the window: no event target, key or position.
 */
export function startRendererTiming(): void {
  if (started) return;
  started = true;
  if (supports("longtask")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > LONG_TASK_MS) longTasks = Math.min(MAX_LONG_TASKS, longTasks + 1);
      }
    }).observe({ type: "longtask" });
  }
  if (supports("event")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isInputTiming(entry) || inputDelaysMs.length >= MAX_INPUT_DELAYS) continue;
        const delay = Math.round(entry.processingStart - entry.startTime);
        if (Number.isFinite(delay)) inputDelaysMs.push(Math.min(MAX_INPUT_DELAY_MS, Math.max(0, delay)));
      }
    }).observe(eventTimingInit);
  }
  const countInput = () => {
    inputs = Math.min(MAX_INPUTS, inputs + 1);
  };
  for (const name of INPUTS) window.addEventListener(name, countInput, { capture: true, passive: true });
  window.setInterval(() => report(false), REPORT_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report(false);
  });
}

/** The main window's workspace finished its first load. Main reads the time on its own clock. */
export function reportWorkspaceReady(): void {
  report(true);
}
