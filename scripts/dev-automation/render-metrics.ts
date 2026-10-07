// Renderer work and startup marks for `dev:bench`.
//
// Layout and style counts come from CDP `Performance.getMetrics`, so they are counts, not times,
// and repeat from run to run. Long tasks come from a passive `PerformanceObserver`. Two readings
// change what they measure, so they are opt-in: `--frames` runs a `requestAnimationFrame` loop that
// keeps the renderer drawing, and `--call-counts` turns on V8 precise coverage, which slows
// JavaScript down.

import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { Page } from "playwright-core";
import type { MetricValues } from "./bench-stats";
import type { InspectorClient } from "./inspector-client";

export interface RenderRecordingOptions {
  frames: boolean;
  callCounts: boolean;
}

export interface FunctionCallCount {
  function: string;
  calls: number;
}

export interface RenderRecording {
  values: MetricValues;
  /** The functions called most often while the scenario ran, or null without `--call-counts`. */
  topCalls: FunctionCallCount[] | null;
}

// CDP metric name, the bench metric name, and the factor to its unit (CDP times are seconds).
const PERFORMANCE_METRICS: readonly [string, string, number][] = [
  ["LayoutCount", "render.layouts", 1],
  ["RecalcStyleCount", "render.styleRecalcs", 1],
  ["ScriptDuration", "render.scriptMs", 1000],
  ["TaskDuration", "render.taskMs", 1000],
];
const TOP_CALLS = 25;
const PAGE_STATE = "__openbotBenchRender";

/** Installs the observers in the app window. A gap over a second is a hidden window, not a slow frame. */
function installObservers(frames: boolean): string {
  return `(() => {
    const state = { longTasks: 0, longTaskMs: 0, frames: 0, framesOver17ms: 0, framesOver50ms: 0, running: true };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks += 1;
        state.longTaskMs += entry.duration;
      }
    });
    observer.observe({ type: "longtask" });
    let last = 0;
    const frame = (now) => {
      if (!state.running) return;
      const gap = last === 0 ? 0 : now - last;
      last = now;
      if (gap > 0 && gap < 1000) {
        state.frames += 1;
        if (gap > 17) state.framesOver17ms += 1;
        if (gap > 50) state.framesOver50ms += 1;
      }
      requestAnimationFrame(frame);
    };
    if (${frames}) requestAnimationFrame(frame);
    window.${PAGE_STATE} = {
      stop() {
        state.running = false;
        observer.disconnect();
        const { running, ...values } = state;
        return values;
      },
    };
  })()`;
}

const STOP_OBSERVERS = `window.${PAGE_STATE}?.stop() ?? null`;

function cdpMetrics(result: { metrics: { name: string; value: number }[] }): Map<string, number> {
  return new Map(result.metrics.map((metric) => [metric.name, metric.value]));
}

/** Starts recording the app window's work. The returned function stops it and gives the readings. */
export async function startRenderRecording(
  page: Page,
  options: RenderRecordingOptions,
): Promise<() => Promise<RenderRecording>> {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const before = cdpMetrics(await session.send("Performance.getMetrics"));
  await page.evaluate(installObservers(options.frames));
  if (options.callCounts) {
    await session.send("Profiler.enable");
    await session.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  }
  return async () => {
    try {
      const values: MetricValues = {};
      const after = cdpMetrics(await session.send("Performance.getMetrics"));
      for (const [name, metric, factor] of PERFORMANCE_METRICS) {
        const start = before.get(name);
        const end = after.get(name);
        if (start !== undefined && end !== undefined) values[metric] = Math.round((end - start) * factor);
      }
      // The page can reload during a scenario, which removes the observers with it.
      const observed = await page.evaluate(STOP_OBSERVERS).catch(() => null);
      if (isDynamicRecord(observed)) {
        for (const [key, value] of Object.entries(observed)) {
          if (!isNumber(value) || (!options.frames && key.startsWith("frames"))) continue;
          values[`render.${key}`] = Math.round(value);
        }
      }
      let topCalls: FunctionCallCount[] | null = null;
      if (options.callCounts) {
        const coverage = await session.send("Profiler.takePreciseCoverage");
        await session.send("Profiler.stopPreciseCoverage");
        const calls = new Map<string, number>();
        let total = 0;
        for (const script of coverage.result) {
          // Only the app's own bundle: extensions and DevTools scripts are not the app's work.
          if (!script.url.startsWith("openbot-app://")) continue;
          const file = script.url.slice(script.url.lastIndexOf("/") + 1);
          for (const fn of script.functions) {
            const count = fn.ranges[0]?.count ?? 0;
            if (count === 0) continue;
            total += count;
            const name = `${fn.functionName || "(anonymous)"} ${file}:${fn.ranges[0]?.startOffset ?? 0}`;
            calls.set(name, (calls.get(name) ?? 0) + count);
          }
        }
        values["render.calls"] = total;
        topCalls = [...calls]
          .sort((left, right) => right[1] - left[1])
          .slice(0, TOP_CALLS)
          .map(([name, count]) => ({ function: name, calls: count }));
      }
      return { values, topCalls };
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
}

const READ_MARKS = `performance.getEntriesByType("mark").filter((mark) => mark.name.startsWith("openbot:")).map((mark) => [mark.name, mark.startTime])`;

function markValues(prefix: string, marks: unknown): MetricValues {
  const values: MetricValues = {};
  if (!Array.isArray(marks)) return values;
  for (const mark of marks) {
    if (!Array.isArray(mark)) continue;
    const [name, startTime]: unknown[] = mark;
    if (!isString(name) || !isNumber(startTime)) continue;
    const key = `${prefix}.${name.slice("openbot:".length)}`;
    // A mark can repeat, such as when the splash shows again. The first one is the startup.
    values[key] ??= Math.round(startTime);
  }
  return values;
}

/**
 * Reads the startup marks in milliseconds. Main-process marks count from process start; app
 * window marks count from the start of its navigation.
 */
export async function readStartupMarks(page: Page, inspector: InspectorClient | null): Promise<MetricValues> {
  const main = inspector ? await inspector.evaluate(READ_MARKS).catch(() => null) : null;
  const renderer = await page.evaluate(READ_MARKS).catch(() => null);
  return { ...markValues("startup.main", main), ...markValues("startup.renderer", renderer) };
}
