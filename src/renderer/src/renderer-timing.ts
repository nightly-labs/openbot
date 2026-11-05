import { RENDERER_TIMING_LIMITS } from "@openbot/contracts/ipc";
import { appPort } from "./app-port";

/** Tasks longer than this count. The browser reports tasks from 50 ms. */
const LONG_TASK_MS = 200;
/** The browser times an input only when its handling takes at least this long. */
const EVENT_THRESHOLD_MS = 16;
const REPORT_INTERVAL_MS = 60_000;
const INPUTS = ["pointerdown", "keydown"] as const;

// The DOM library of TypeScript does not declare the Event Timing option yet.
const eventTimingInit: PerformanceObserverInit & { durationThreshold: number } = {
  type: "event",
  durationThreshold: EVENT_THRESHOLD_MS,
};

let longTasks = 0;
let inputs = 0;
let inputDelaysMs: number[] = [];
/** Timed inputs past the delay limit. They leave the input count too, so they do not show as 0 ms. */
let droppedDelays = 0;
let started = false;

function supports(type: string): boolean {
  return typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes(type);
}

function isInputTiming(entry: PerformanceEntry): entry is PerformanceEventTiming {
  return INPUTS.some((name) => name === entry.name) && "processingStart" in entry;
}

function report(workspaceReady: boolean): void {
  if (!workspaceReady && longTasks === 0 && inputs === 0) return;
  // The browser can time an input before the capture listener counts it.
  const delays = inputDelaysMs.slice(0, inputs);
  const payload = {
    ...(workspaceReady ? { workspaceReady: true as const } : {}),
    longTasks,
    inputs: Math.max(delays.length, inputs - droppedDelays),
    inputDelaysMs: delays,
  };
  longTasks = 0;
  inputs = 0;
  inputDelaysMs = [];
  droppedDelays = 0;
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
        if (entry.duration > LONG_TASK_MS) longTasks = Math.min(RENDERER_TIMING_LIMITS.longTasks, longTasks + 1);
      }
    }).observe({ type: "longtask" });
  }
  if (supports("event")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!isInputTiming(entry)) continue;
        if (inputDelaysMs.length >= RENDERER_TIMING_LIMITS.inputDelays) {
          droppedDelays += 1;
          continue;
        }
        const delay = Math.round(entry.processingStart - entry.startTime);
        if (Number.isFinite(delay))
          inputDelaysMs.push(Math.min(RENDERER_TIMING_LIMITS.inputDelayMs, Math.max(0, delay)));
      }
    }).observe(eventTimingInit);
  }
  const countInput = () => {
    inputs = Math.min(RENDERER_TIMING_LIMITS.inputs, inputs + 1);
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
