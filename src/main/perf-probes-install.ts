import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { DatabaseSync, type SQLInputValue, StatementSync } from "node:sqlite";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { type PerfIpcTarget, type PerfProbeSink, setPerfProbeSink } from "../backend/perf-probe-hooks";

interface StatementStats {
  calls: number;
  prepares: number;
  ms: number;
  rows: number;
  paramBytes: number;
  sourceSql: string;
  database: WeakRef<DatabaseSync> | null;
}

interface MeasureStats {
  count: number;
  ms: number;
}

interface IpcStats {
  messages: number;
  bytes: number;
}

interface TimerStats {
  kind: "timeout" | "interval" | "immediate";
  scheduled: number;
  fired: number;
  ms: number;
}

const SQL_KEY_LIMIT = 300;
const STACK_FRAMES = 6;
const MAX_ROWS = 200;
const EXPLAIN_LIMIT = 20;
const LOOP_RESOLUTION_MS = 20;
const NS_PER_MS = 1_000_000;
const US_PER_MS = 1_000;
const MS_PER_S = 1_000;
const EXPLAINABLE = /^(?:select|with|update|delete|insert|replace)\b/iu;

const statements = new Map<string, StatementStats>();
const statementKeys = new WeakMap<StatementSync, string>();
const measures = new Map<string, MeasureStats>();
const ipc = new Map<string, IpcStats>();
const timers = new Map<string, TimerStats>();
const roles = new WeakMap<WebContents, string>();
const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
let transactions = 0;
let startedAt = performance.now();
let cpuStart = process.cpuUsage();

const originalPrepare = DatabaseSync.prototype.prepare;

export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/gu, "?")
    .replace(/\b\d+(?:\.\d+)?\b/gu, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/gu, "(?…)")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SQL_KEY_LIMIT);
}

function statementStats(sql: string): StatementStats {
  const key = normalizeSql(sql);
  let stats = statements.get(key);
  if (!stats) {
    stats = { calls: 0, prepares: 0, ms: 0, rows: 0, paramBytes: 0, sourceSql: sql, database: null };
    statements.set(key, stats);
  }
  return stats;
}

function valueBytes(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "number" || typeof value === "bigint") return 8;
  if (value && typeof value === "object") {
    let total = 0;
    for (const entry of Object.values(value)) total += valueBytes(entry);
    return total;
  }
  return 0;
}

function rowCount(method: string, result: unknown): number {
  if (method === "all") return Array.isArray(result) ? result.length : 0;
  if (method === "get") return result === undefined ? 0 : 1;
  if (method === "run" && result && typeof result === "object" && "changes" in result) {
    return Number(result.changes) || 0;
  }
  return 0;
}

type StatementArgument = SQLInputValue | Record<string, SQLInputValue>;

interface StatementMethods {
  run(...args: StatementArgument[]): unknown;
  get(...args: StatementArgument[]): unknown;
  all(...args: StatementArgument[]): unknown;
  iterate(...args: StatementArgument[]): unknown;
}

type TimerCallback = (...args: unknown[]) => void;

interface TimerGlobals {
  setTimeout(callback: TimerCallback, ms?: number, ...args: unknown[]): unknown;
  setInterval(callback: TimerCallback, ms?: number, ...args: unknown[]): unknown;
  setImmediate(callback: TimerCallback, ...args: unknown[]): unknown;
}

function patchDatabase(): void {
  DatabaseSync.prototype.prepare = function prepare(this: DatabaseSync, sql: string) {
    const statement = originalPrepare.call(this, sql);
    const stats = statementStats(sql);
    stats.prepares += 1;
    stats.database = new WeakRef(this);
    statementKeys.set(statement, normalizeSql(sql));
    return statement;
  };
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function exec(this: DatabaseSync, sql: string) {
    const stats = statementStats(sql);
    if (/^\s*begin\b/iu.test(sql)) transactions += 1;
    const begin = performance.now();
    try {
      return originalExec.call(this, sql);
    } finally {
      stats.calls += 1;
      stats.ms += performance.now() - begin;
    }
  };
  for (const method of ["run", "get", "all", "iterate"] as const) {
    const methods: StatementMethods = StatementSync.prototype;
    const original = methods[method];
    methods[method] = function measured(this: StatementSync, ...args: StatementArgument[]) {
      const key = statementKeys.get(this) ?? normalizeSql(this.sourceSQL);
      const stats = statements.get(key) ?? statementStats(this.sourceSQL);
      const begin = performance.now();
      const result = original.apply(this, args);
      stats.calls += 1;
      stats.ms += performance.now() - begin;
      stats.rows += rowCount(method, result);
      for (const argument of args) stats.paramBytes += valueBytes(argument);
      return result;
    };
  }
}

function callSite(): string {
  const holder: { stack?: string } = {};
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_FRAMES;
  Error.captureStackTrace(holder, callSite);
  Error.stackTraceLimit = limit;
  const frames = (holder.stack ?? "").split("\n").slice(1);
  for (const frame of frames) {
    if (frame.includes("perf-probes-install") || frame.includes("node:internal")) continue;
    const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/u.exec(frame.trim());
    if (!match) continue;
    const file = match[2]?.slice((match[2]?.lastIndexOf("/") ?? -1) + 1) ?? "";
    return `${match[1] ?? "(anonymous)"} ${file}:${match[3]}:${match[4]}`;
  }
  return "(unknown)";
}

function timerStats(kind: TimerStats["kind"], site: string): TimerStats {
  const key = `${kind} ${site}`;
  let stats = timers.get(key);
  if (!stats) {
    stats = { kind, scheduled: 0, fired: 0, ms: 0 };
    timers.set(key, stats);
  }
  return stats;
}

function keepTimerProperties<Timer extends object>(patched: Timer, original: Timer): Timer {
  for (const key of Object.getOwnPropertySymbols(original)) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor) Object.defineProperty(patched, key, descriptor);
  }
  return patched;
}

function measured(stats: TimerStats, callback: TimerCallback): TimerCallback {
  return (...args) => {
    const begin = performance.now();
    try {
      callback(...args);
    } finally {
      stats.fired += 1;
      stats.ms += performance.now() - begin;
    }
  };
}

function scheduledStats(kind: TimerStats["kind"]): TimerStats {
  const stats = timerStats(kind, callSite());
  stats.scheduled += 1;
  return stats;
}

function patchTimers(): void {
  const timerGlobals: TimerGlobals = globalThis;
  const { setTimeout: timeout, setInterval: interval, setImmediate: immediate } = timerGlobals;
  timerGlobals.setTimeout = keepTimerProperties(
    (callback: TimerCallback, ms?: number, ...args: unknown[]) =>
      timeout(measured(scheduledStats("timeout"), callback), ms, ...args),
    timeout,
  );
  timerGlobals.setInterval = keepTimerProperties(
    (callback: TimerCallback, ms?: number, ...args: unknown[]) =>
      interval(measured(scheduledStats("interval"), callback), ms, ...args),
    interval,
  );
  timerGlobals.setImmediate = keepTimerProperties(
    (callback: TimerCallback, ...args: unknown[]) =>
      immediate(measured(scheduledStats("immediate"), callback), ...args),
    immediate,
  );
}

function rendererRole(contents: WebContents): string {
  const known = roles.get(contents);
  if (known) return known;
  let role: string = contents.getType();
  try {
    const url = new URL(contents.getURL());
    const page = url.pathname.slice(url.pathname.lastIndexOf("/") + 1).replace(/\.html$/u, "");
    if (url.protocol === "openbot-app:" || url.hostname === "localhost") {
      role = url.searchParams.get("window") === "chat" ? "chat" : page || "app";
      if (role === "index") role = "app";
    } else {
      role = "tab";
    }
  } catch {
    return role;
  }
  roles.set(contents, role);
  return role;
}

function eventType(args: readonly unknown[]): string {
  const payload = args[0];
  if (!payload || typeof payload !== "object") return "";
  const event = "event" in payload ? payload.event : payload;
  if (event && typeof event === "object" && "type" in event && typeof event.type === "string") return event.type;
  return "";
}

function payloadBytes(args: readonly unknown[]): number {
  try {
    return JSON.stringify(args)?.length ?? 0;
  } catch {
    return 0;
  }
}

const contentsByTarget = new WeakMap<PerfIpcTarget, WebContents>();

function webContentsOf(target: PerfIpcTarget): WebContents | null {
  const known = contentsByTarget.get(target);
  if (known) return known;
  const found = webContents.getAllWebContents().find((contents) => contents === target);
  if (found) contentsByTarget.set(target, found);
  return found ?? null;
}

function recordIpc(target: PerfIpcTarget, channel: string, args: readonly unknown[]): void {
  const contents = webContentsOf(target);
  if (!contents) return;
  const window = BrowserWindow.fromWebContents(contents);
  const role = `${rendererRole(contents)}${window && !window.isVisible() ? ":hidden" : ""}`;
  const type = eventType(args);
  const key = `${role} ${channel}${type ? ` ${type}` : ""}`;
  const stats = ipc.get(key) ?? { messages: 0, bytes: 0 };
  stats.messages += 1;
  stats.bytes += payloadBytes(args);
  ipc.set(key, stats);
}

function measure(key: string): MeasureStats {
  let stats = measures.get(key);
  if (!stats) {
    stats = { count: 0, ms: 0 };
    measures.set(key, stats);
  }
  return stats;
}

const sink: PerfProbeSink = {
  count(key, amount) {
    measure(key).count += amount;
  },
  time(key, ms) {
    const stats = measure(key);
    stats.count += 1;
    stats.ms += ms;
  },
  ipcSend: recordIpc,
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function topRows<Value>(map: Map<string, Value>, weight: (value: Value) => number) {
  return [...map]
    .sort((left, right) => weight(right[1]) - weight(left[1]))
    .slice(0, MAX_ROWS)
    .map(([key, value]) => ({ key, ...value }));
}

function reset(): void {
  statements.forEach((stats) => {
    stats.calls = 0;
    stats.prepares = 0;
    stats.ms = 0;
    stats.rows = 0;
    stats.paramBytes = 0;
  });
  measures.clear();
  ipc.clear();
  timers.forEach((stats) => {
    stats.scheduled = 0;
    stats.fired = 0;
    stats.ms = 0;
  });
  transactions = 0;
  loopDelay.reset();
  cpuStart = process.cpuUsage();
  startedAt = performance.now();
}

function cpuMsPerSecond(elapsedMs: number): number {
  const { user, system } = process.cpuUsage(cpuStart);
  return elapsedMs > 0 ? round((user + system) / US_PER_MS / (elapsedMs / MS_PER_S)) : 0;
}

function snapshot() {
  const elapsedMs = performance.now() - startedAt;
  const activeStatements = new Map([...statements].filter(([, stats]) => stats.calls > 0 || stats.prepares > 0));
  return {
    elapsedMs: Math.round(elapsedMs),
    loop: {
      cpuMsPerS: cpuMsPerSecond(elapsedMs),
      delayP99Ms: round(loopDelay.percentile(99) / NS_PER_MS),
      delayMaxMs: round(loopDelay.max / NS_PER_MS),
    },
    db: {
      transactions,
      statements: topRows(activeStatements, (stats) => stats.ms).map(({ sourceSql, database, ms, ...row }) => ({
        ...row,
        ms: round(ms),
      })),
    },
    measures: topRows(measures, (stats) => stats.ms + stats.count).map((row) => ({ ...row, ms: round(row.ms) })),
    ipc: topRows(ipc, (stats) => stats.messages),
    timers: topRows(
      new Map([...timers].filter(([, stats]) => stats.scheduled > 0 || stats.fired > 0)),
      (stats) => stats.fired,
    ).map((row) => ({ ...row, ms: round(row.ms) })),
  };
}

function explain(limit = EXPLAIN_LIMIT) {
  return [...statements]
    .filter(([, stats]) => stats.calls > 0 && EXPLAINABLE.test(stats.sourceSql.trim()))
    .sort((left, right) => right[1].ms - left[1].ms)
    .slice(0, limit)
    .map(([key, stats]) => {
      const database = stats.database?.deref();
      if (!database) return { key, plan: [], scan: false, tempBTree: false, error: "closed" };
      try {
        const rows = originalPrepare.call(database, `EXPLAIN QUERY PLAN ${stats.sourceSql}`).all();
        const plan = rows.map((row) => String(row.detail ?? ""));
        return {
          key,
          plan,
          scan: plan.some((detail) => /^SCAN\b/u.test(detail) && !/USING (?:COVERING )?INDEX/u.test(detail)),
          tempBTree: plan.some((detail) => detail.includes("TEMP B-TREE")),
          error: null,
        };
      } catch (error) {
        return { key, plan: [], scan: false, tempBTree: false, error: error instanceof Error ? error.name : "error" };
      }
    });
}

type UtilityKind = "utility.database" | "utility.network" | "utility.voice" | "utility.other";

function utilityKind(service: string): UtilityKind {
  if (service === "OpenBot databases") return "utility.database";
  if (service.includes("NetworkService") || service === "Network Service") return "utility.network";
  if (service.startsWith("OpenBot ")) return "utility.voice";
  return "utility.other";
}

function processKinds() {
  const kinds = new Map<number, string>();
  for (const metric of app.getAppMetrics()) {
    const type = metric.type.toLowerCase();
    if (type === "browser") kinds.set(metric.pid, "main");
    else if (type === "gpu") kinds.set(metric.pid, "gpu");
    else if (type === "utility") kinds.set(metric.pid, utilityKind(metric.serviceName ?? metric.name ?? ""));
    else kinds.set(metric.pid, type);
  }
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    const pid = contents.getOSProcessId();
    const window = BrowserWindow.fromWebContents(contents);
    const role = rendererRole(contents);
    kinds.set(pid, `renderer.${window && !window.isVisible() && role !== "tab" ? "hidden" : role}`);
  }
  return [...kinds].map(([pid, kind]) => ({ pid, kind }));
}

export function installPerfProbes(): void {
  patchDatabase();
  patchTimers();
  loopDelay.enable();
  setPerfProbeSink(sink);
  Object.assign(globalThis, { __openbotPerfProbes: { reset, snapshot, explain, processKinds } });
}
