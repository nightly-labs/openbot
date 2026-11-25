import { existsSync } from "node:fs";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { Logger } from "@openbot/logging";
import type { Browser, Page } from "playwright-core";
import type { MetricValues } from "./bench-stats";
import type { InspectorClient } from "./inspector-client";

export const PROBES_ENVIRONMENT = { OPENBOT_PERF_PROBES: "1" } as const;

const MAIN_API = "globalThis.__openbotPerfProbes";
const RENDERER_API = "window.__openbotPerfProbes";
const RENDERER_READY_MS = 15_000;
const PER_THOUSAND = 1_000;

export interface ProbeReport {
  main: unknown;
  explain: unknown;
  renderers: { url: string; report: unknown }[];
  metrics: MetricValues;
}

export interface ProbeRecording {
  stop(normalizeBy: MetricValues): Promise<ProbeReport>;
}

export function assertBenchBuild(projectRoot: string): void {
  if (!existsSync(join(projectRoot, "out", "main", "bench-build.json"))) {
    throw new Error("--probes needs a bench build. Run `bun run build:bench` first.");
  }
}

function allPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

export interface ProbeOptions {
  solidCauses: boolean;
}

async function startRenderer(page: Page, options: ProbeOptions): Promise<boolean> {
  const startOptions = JSON.stringify({ causes: options.solidCauses });
  const started = await page
    .evaluate(`${RENDERER_API} ? (${RENDERER_API}.start(${startOptions}), true) : false`)
    .catch(() => false);
  return started === true;
}

function records(value: unknown): DynamicRecord[] {
  return Array.isArray(value) ? value.filter(isDynamicRecord) : [];
}

function numberAt(record: DynamicRecord, key: string): number {
  const value = record[key];
  return isNumber(value) ? value : 0;
}

function sumOf(rows: DynamicRecord[], key: string): number {
  return rows.reduce((total, row) => total + numberAt(row, key), 0);
}

function add(values: MetricValues, key: string, amount: number): void {
  values[key] = Math.round(((values[key] ?? 0) + amount) * 10) / 10;
}

function mainMetrics(report: unknown, explained: unknown): MetricValues {
  const values: MetricValues = {};
  if (!isDynamicRecord(report)) return values;
  const loop = isDynamicRecord(report.loop) ? report.loop : {};
  values["probe.main.cpuMsPerS"] = numberAt(loop, "cpuMsPerS");
  const db = isDynamicRecord(report.db) ? report.db : {};
  const statements = records(db.statements);
  values["probe.db.transactions"] = numberAt(db, "transactions");
  values["probe.db.statements"] = sumOf(statements, "calls");
  values["probe.db.prepares"] = sumOf(statements, "prepares");
  values["probe.db.ms"] = Math.round(sumOf(statements, "ms"));
  values["probe.db.rows"] = sumOf(statements, "rows");
  values["probe.db.paramBytes"] = sumOf(statements, "paramBytes");
  const plans = records(explained);
  values["probe.db.scanStatements"] = plans.filter((plan) => plan.scan === true).length;
  values["probe.db.tempBTreeStatements"] = plans.filter((plan) => plan.tempBTree === true).length;
  for (const measure of records(report.measures)) {
    if (!isString(measure.key)) continue;
    values[`probe.main.${measure.key}`] = numberAt(measure, "count");
    if (numberAt(measure, "ms") > 0) values[`probe.main.${measure.key}.ms`] = Math.round(numberAt(measure, "ms"));
  }
  const ipc = records(report.ipc);
  values["probe.ipc.messages"] = sumOf(ipc, "messages");
  values["probe.ipc.bytes"] = sumOf(ipc, "bytes");
  for (const row of ipc) {
    if (!isString(row.key)) continue;
    const role = row.key.split(" ", 1)[0] ?? "";
    add(values, `probe.ipc.messages.${role}`, numberAt(row, "messages"));
  }
  const timers = records(report.timers);
  values["probe.main.timerFires"] = sumOf(timers, "fired");
  return values;
}

function rendererMetrics(report: unknown, values: MetricValues): void {
  if (!isDynamicRecord(report)) return;
  const role = isString(report.role) ? report.role : "app";
  const solid = isDynamicRecord(report.solid) ? report.solid : {};
  const totals = isDynamicRecord(solid.totals) ? solid.totals : {};
  add(values, "probe.solid.runs", numberAt(totals, "runs"));
  add(values, "probe.solid.selfMs", numberAt(totals, "selfMs"));
  add(values, "probe.solid.wastedMs", numberAt(totals, "wastedMs"));
  add(values, `probe.solid.runs.${role}`, numberAt(totals, "runs"));
  for (const diagnostic of records(report.diagnostics)) {
    if (isString(diagnostic.code)) add(values, `probe.solid.diag.${diagnostic.code}`, numberAt(diagnostic, "count"));
  }
  const counters = isDynamicRecord(report.counters) ? report.counters : {};
  for (const [key, count] of Object.entries(counters)) {
    if (isNumber(count)) add(values, `probe.renderer.${key}`, count);
  }
  const timers = records(report.timers);
  add(values, "probe.renderer.timerFires", sumOf(timers, "fired"));
  add(
    values,
    "probe.renderer.rafFires",
    sumOf(
      timers.filter((timer) => timer.kind === "raf"),
      "fired",
    ),
  );
}

const NORMALIZED = [
  "probe.db.statements",
  "probe.db.prepares",
  "probe.db.ms",
  "probe.db.paramBytes",
  "probe.ipc.messages",
  "probe.ipc.bytes",
  "probe.solid.runs",
  "probe.solid.wastedMs",
  "probe.renderer.dom.nodesAdded",
  "probe.renderer.dom.layoutRead",
  "probe.renderer.conversation.cleanTextChars",
  "probe.main.runtime.snapshot",
  "probe.main.conversation.emit",
] as const;

function normalize(values: MetricValues, normalizeBy: MetricValues): void {
  const deltas = normalizeBy["stream.deltas"] ?? 0;
  const flushes = values["probe.main.delta.flush"] ?? 0;
  for (const key of NORMALIZED) {
    const value = values[key];
    if (value === undefined) continue;
    if (deltas > 0) values[`${key}.per1kDeltas`] = Math.round((value / deltas) * PER_THOUSAND * 10) / 10;
    if (flushes > 0) values[`${key}.perFlush`] = Math.round((value / flushes) * 100) / 100;
  }
}

export async function startProbes(
  inspector: InspectorClient | null,
  browser: Browser,
  logger: Logger,
  options: ProbeOptions,
): Promise<ProbeRecording> {
  if (!inspector) throw new Error("--probes needs the main-process inspector.");
  if ((await inspector.evaluate(`typeof ${MAIN_API}`)) !== "object") {
    throw new Error("The app has no main-process probes. Use a `bun run build:bench` build.");
  }
  await inspector.evaluate(`${MAIN_API}.reset()`);
  const started = new Set<Page>();
  for (const page of allPages(browser)) {
    if (await startRenderer(page, options)) started.add(page);
  }
  if (started.size === 0) logger.warn("no renderer has probes; renderer counts are missing");
  const onPage = (page: Page) => {
    void page
      .waitForFunction(`Boolean(${RENDERER_API})`, undefined, { timeout: RENDERER_READY_MS })
      .then(() => startRenderer(page, options))
      .then((ok) => {
        if (ok) started.add(page);
      })
      .catch(() => undefined);
  };
  for (const context of browser.contexts()) context.on("page", onPage);
  return {
    stop: async (normalizeBy) => {
      for (const context of browser.contexts()) context.off("page", onPage);
      const main = await inspector.evaluate(`${MAIN_API}.snapshot()`);
      const explained = await inspector.evaluate(`${MAIN_API}.explain()`);
      const values = mainMetrics(main, explained);
      const renderers: { url: string; report: unknown }[] = [];
      for (const page of started) {
        if (page.isClosed()) continue;
        const report = await page.evaluate(`${RENDERER_API}.stop()`).catch(() => null);
        renderers.push({ url: page.url().replace(/^[a-z-]+:\/\/[^?]*/u, ""), report });
        rendererMetrics(report, values);
      }
      normalize(values, normalizeBy);
      return { main, explain: explained, renderers, metrics: values };
    },
  };
}
