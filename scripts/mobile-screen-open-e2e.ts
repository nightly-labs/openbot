import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import WebSocket from "ws";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-screen-open");
const APP_ID = "run.openbot.mobile";
const PROBE = "__openbotScreenOpen";
const DEFAULT_RUNS = 10;
const PROBE_TIMEOUT_MS = 120_000;
const EVALUATE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

const logger = createOpenBotLogger("mobile-screen-open-e2e");
const run = promisify(execFile);

interface InspectorTarget {
  deviceName: string | null;
  webSocketDebuggerUrl: string;
}

interface ProbeInfo {
  dev: boolean;
  platform: string;
  ready: boolean;
  focused: string | null;
}

interface ProbeTargets {
  agentId: string | null;
  agentServerId: string | null;
  serverId: string | null;
}

interface OpenSample {
  focusMs: number;
  paintMs: number;
}

interface ScreenCase {
  name: string;
  href: unknown;
  pathname: string;
}

interface Stats {
  count: number;
  p50: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

interface ScreenReport {
  name: string;
  pathname: string;
  samples: OpenSample[];
  cold: OpenSample | null;
  warm: { focusMs: Stats; paintMs: Stats };
  all: { focusMs: Stats; paintMs: Stats };
}

interface Report {
  label: string;
  createdAt: string;
  commit: string | null;
  metro: string;
  device: string | null;
  app: ProbeInfo;
  runs: number;
  screens: ScreenReport[];
  baseline?: { file: string; label: string; delta: BaselineDelta[] };
}

interface BaselineDelta {
  name: string;
  focusP50Ms: number | null;
  focusP90Ms: number | null;
  paintP50Ms: number | null;
  paintP90Ms: number | null;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

function positiveInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, got "${value}".`);
  return parsed;
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return roundMs(sorted[rank - 1] ?? Number.NaN);
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    min: sorted.length ? roundMs(sorted[0] ?? Number.NaN) : null,
    max: sorted.length ? roundMs(sorted[sorted.length - 1] ?? Number.NaN) : null,
  };
}

function summary(samples: OpenSample[]) {
  return {
    focusMs: stats(samples.map((sample) => sample.focusMs)),
    paintMs: stats(samples.map((sample) => sample.paintMs)),
  };
}

function parseRecord(text: unknown, label: string): DynamicRecord {
  const value = isString(text) ? JSON.parse(text) : null;
  if (!isDynamicRecord(value)) throw new Error(`The probe sent no ${label}.`);
  return value;
}

function textOrNull(value: unknown): string | null {
  return isString(value) && value ? value : null;
}

function decodeInfo(text: unknown): ProbeInfo {
  const value = parseRecord(text, "app information");
  if (!isBoolean(value.dev) || !isString(value.platform) || !isBoolean(value.ready)) {
    throw new Error("The probe sent unexpected app information.");
  }
  return { dev: value.dev, platform: value.platform, ready: value.ready, focused: textOrNull(value.focused) };
}

function decodeTargets(text: unknown): ProbeTargets {
  const value = parseRecord(text, "workspace targets");
  return {
    agentId: textOrNull(value.agentId),
    agentServerId: textOrNull(value.agentServerId),
    serverId: textOrNull(value.serverId),
  };
}

function decodeSample(text: unknown): OpenSample {
  const value = parseRecord(text, "open time");
  if (!isNumber(value.focusMs) || !isNumber(value.paintMs)) throw new Error("The probe sent an unexpected open time.");
  return { focusMs: value.focusMs, paintMs: value.paintMs };
}

function difference(next: number | null, previous: number | null | undefined): number | null {
  return next === null || previous === null || previous === undefined ? null : roundMs(next - previous);
}

async function inspectorTarget(metro: string, deviceName: string | null): Promise<InspectorTarget> {
  const response = await fetch(`${metro}/json/list`);
  if (!response.ok) throw new Error(`Metro at ${metro} answered ${response.status}.`);
  const targets = await response.json();
  const found = (Array.isArray(targets) ? targets : [])
    .filter(isDynamicRecord)
    .findLast(
      (entry) =>
        entry.appId === APP_ID &&
        isString(entry.webSocketDebuggerUrl) &&
        (!deviceName || entry.deviceName === deviceName),
    );
  if (!found || !isString(found.webSocketDebuggerUrl)) {
    throw new Error(`No ${APP_ID} app is attached to Metro at ${metro}.`);
  }
  return { deviceName: textOrNull(found.deviceName), webSocketDebuggerUrl: found.webSocketDebuggerUrl };
}

class Inspector {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.receive(String(data)));
    socket.on("close", () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error("The inspector socket closed."));
      this.pending.clear();
    });
  }

  static async connect(target: InspectorTarget, metro: string): Promise<Inspector> {
    const url = target.webSocketDebuggerUrl;
    const socket = new WebSocket(url, { headers: { origin: new URL(metro).origin }, perMessageDeflate: false });
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    return new Inspector(socket);
  }

  private receive(text: string) {
    const reply = JSON.parse(text);
    if (!isDynamicRecord(reply) || !isNumber(reply.id)) return;
    const waiter = this.pending.get(reply.id);
    if (!waiter) return;
    this.pending.delete(reply.id);
    const result = isDynamicRecord(reply.result) ? reply.result : null;
    const exception = isDynamicRecord(result?.exceptionDetails) ? result.exceptionDetails : null;
    const thrown = isDynamicRecord(exception?.exception) ? exception.exception : null;
    if (isDynamicRecord(reply.error)) {
      waiter.reject(new Error(isString(reply.error.message) ? reply.error.message : "Inspector error."));
    } else if (exception) {
      waiter.reject(new Error(isString(thrown?.description) ? thrown.description : "The expression threw."));
    } else {
      waiter.resolve(isDynamicRecord(result?.result) ? result.result.value : undefined);
    }
  }

  evaluate(expression: string): Promise<unknown> {
    const id = this.nextId++;
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`No answer for ${expression} after ${EVALUATE_TIMEOUT_MS} ms.`));
      }, EVALUATE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    this.socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
    return reply;
  }

  close() {
    this.socket.close();
  }
}

async function waitForProbe(inspector: Inspector): Promise<ProbeInfo> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await inspector.evaluate(`typeof ${PROBE} === "object" ? ${PROBE}.info() : null`).catch(() => null);
    if (isString(info)) {
      const parsed = decodeInfo(info);
      if (parsed.ready) return parsed;
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(
    "The app has no ready screen-open probe. Sign in, open the agent list, and use a development bundle or EXPO_PUBLIC_OPENBOT_SCREEN_METRICS=1.",
  );
}

function screenCases(targets: ProbeTargets, only: string[] | null): ScreenCase[] {
  const agentId = option("agent-id") ?? targets.agentId;
  const agentServerId = option("agent-server-id") ?? targets.agentServerId;
  const serverId = option("server-id") ?? targets.serverId;
  if (!agentId || !agentServerId || !serverId) {
    throw new Error("The workspace has no agent. Pass --agent-id, --agent-server-id and --server-id.");
  }
  const cases: ScreenCase[] = [
    {
      name: "chat",
      href: { pathname: "/chat/[agentId]", params: { agentId, serverId: agentServerId } },
      pathname: `/chat/${agentId}`,
    },
    {
      name: "agent-info",
      href: { pathname: "/agent-info/[agentId]", params: { agentId, serverId: agentServerId } },
      pathname: `/agent-info/${agentId}`,
    },
    { name: "settings", href: "/settings", pathname: "/settings" },
    {
      name: "server-settings",
      href: { pathname: "/server-settings", params: { serverId } },
      pathname: "/server-settings",
    },
    { name: "hidden-chats-sheet", href: "/hidden-chats", pathname: "/hidden-chats" },
  ];
  if (!only) return cases;
  const unknown = only.filter((name) => !cases.some((item) => item.name === name));
  if (unknown.length) throw new Error(`Unknown screens: ${unknown.join(", ")}.`);
  return cases.filter((item) => only.includes(item.name));
}

async function commit(): Promise<string | null> {
  try {
    return (await run("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
  } catch {
    return null;
  }
}

function warmPercentiles(value: unknown): { p50: number | null; p90: number | null } {
  const record = isDynamicRecord(value) ? value : {};
  return { p50: isNumber(record.p50) ? record.p50 : null, p90: isNumber(record.p90) ? record.p90 : null };
}

function decodeBaseline(text: string) {
  const value = parseRecord(text, "baseline");
  const warm = new Map<
    string,
    { focusMs: { p50: number | null; p90: number | null }; paintMs: { p50: number | null; p90: number | null } }
  >();
  for (const screen of Array.isArray(value.screens) ? value.screens.filter(isDynamicRecord) : []) {
    if (!isString(screen.name) || !isDynamicRecord(screen.warm)) continue;
    warm.set(screen.name, {
      focusMs: warmPercentiles(screen.warm.focusMs),
      paintMs: warmPercentiles(screen.warm.paintMs),
    });
  }
  return { label: isString(value.label) ? value.label : "baseline", warm };
}

function compare(report: Report, file: string): Report["baseline"] {
  const baseline = decodeBaseline(readFileSync(resolve(file), "utf8"));
  return {
    file,
    label: baseline.label,
    delta: report.screens.map((screen) => {
      const before = baseline.warm.get(screen.name);
      return {
        name: screen.name,
        focusP50Ms: difference(screen.warm.focusMs.p50, before?.focusMs.p50),
        focusP90Ms: difference(screen.warm.focusMs.p90, before?.focusMs.p90),
        paintP50Ms: difference(screen.warm.paintMs.p50, before?.paintMs.p50),
        paintP90Ms: difference(screen.warm.paintMs.p90, before?.paintMs.p90),
      };
    }),
  };
}

async function main() {
  const metro = option("metro") ?? `http://127.0.0.1:${option("metro-port") ?? "8081"}`;
  const runs = positiveInteger(option("runs"), DEFAULT_RUNS);
  const label = option("label") ?? "current";
  const only = option("screens")?.split(",").filter(Boolean) ?? null;
  const target = await inspectorTarget(metro, option("device"));
  const inspector = await Inspector.connect(target, metro);
  try {
    const app = await waitForProbe(inspector);
    const targets = decodeTargets(await inspector.evaluate(`${PROBE}.targets()`));
    const cases = screenCases(targets, only);
    const samples = new Map<string, OpenSample[]>(cases.map((item) => [item.name, []]));
    for (let round = 1; round <= runs; round++) {
      for (const screen of cases) {
        await inspector.evaluate(`${PROBE}.home()`);
        const result = await inspector.evaluate(
          `${PROBE}.open(${JSON.stringify(screen.href)}, ${JSON.stringify(screen.pathname)})`,
        );
        const sample = decodeSample(result);
        samples.get(screen.name)?.push(sample);
        logger.info(
          `${screen.name} run ${round}: focus ${roundMs(sample.focusMs)} ms, paint ${roundMs(sample.paintMs)} ms`,
        );
      }
    }
    await inspector.evaluate(`${PROBE}.home()`);
    const report: Report = {
      label,
      createdAt: new Date().toISOString(),
      commit: await commit(),
      metro,
      device: target.deviceName ?? null,
      app,
      runs,
      screens: cases.map((screen) => {
        const list = samples.get(screen.name) ?? [];
        return {
          name: screen.name,
          pathname: screen.pathname,
          samples: list,
          cold: list[0] ?? null,
          warm: summary(list.slice(1)),
          all: summary(list),
        };
      }),
    };
    const baseline = option("baseline");
    if (baseline) report.baseline = compare(report, baseline);
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `${label}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    for (const screen of report.screens) {
      logger.info(
        `${screen.name}: warm focus p50 ${screen.warm.focusMs.p50} ms, p90 ${screen.warm.focusMs.p90} ms; paint p50 ${screen.warm.paintMs.p50} ms, p90 ${screen.warm.paintMs.p90} ms`,
      );
    }
    logger.info(`Wrote ${file}.`);
  } finally {
    inspector.close();
  }
}

await main();
