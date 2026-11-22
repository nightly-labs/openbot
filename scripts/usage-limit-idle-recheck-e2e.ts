import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";

const OUT = resolve(import.meta.dirname, "../.openbot-build/usage-limit-idle-recheck-e2e");
const MODEL = "gpt-5.5";
const root = await mkdtemp(join(tmpdir(), "openbot-usage-limit-idle-recheck-"));
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
delete process.env.OPENBOT_CODEX_PATH;
mkdirSync(home, { recursive: true });

const { ConversationRuntime } = await import("../src/backend/agent/conversation-runtime");
const { ProviderRuntime } = await import("../src/backend/agent/provider-runtime");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");

const resetsAt = Math.floor(Date.now() / 1000) + 3600;

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 99.0.0\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
log({ start: true });
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const rateLimits = { limitId: "codex", primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: ${resetsAt} }, secondary: null };
const answer = (message) => {
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "${MODEL}", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: { config: { mcp_servers: {} }, layers: [] } });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    default: return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
process.stdin.on("end", () => process.exit(0));
setInterval(() => {}, 1000);
`;

interface ProtocolLine {
  pid: number;
  start?: boolean;
  method?: string | null;
}

interface Reading {
  limits: number;
  usedPercent: number | null;
}

interface Report {
  passed: boolean;
  running?: Reading;
  released?: boolean;
  afterIdleStop?: Reading;
  usageReadProcesses?: number;
  error?: string;
}

const report: Report = { passed: false };

function protocol(): ProtocolLine[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): ProtocolLine => JSON.parse(line));
  } catch {
    return [];
  }
}

async function installFakeCodex(directory: string): Promise<string> {
  const path = join(directory, "bin", "codex");
  await mkdir(join(directory, "bin"), { recursive: true });
  await writeFile(path, FAKE_CODEX);
  await chmod(path, 0o755);
  return path;
}

function reading(usage: { limits: { primary?: { usedPercent: number } | null }[] }): Reading {
  return { limits: usage.limits.length, usedPercent: usage.limits[0]?.primary?.usedPercent ?? null };
}

const executable = await installFakeCodex(join(root, "codex"));
const store = new AgentStore(join(root, "profile"), home, new OpenBotDatabase(join(root, "profile")));
const providers = new ProviderRuntime({
  offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "codex"),
  conversation: new ConversationRuntime(
    store,
    () => undefined,
    () => store.list(),
  ),
  hooks: {
    bindClient: () => undefined,
    onProvidersReady: () => Effect.void,
    onProviderLost: () => undefined,
    onClientStopped: () => Effect.void,
    isStopping: () => false,
    isProviderBusy: () => false,
    isAgentBusy: () => false,
    isProviderAssigned: () => true,
    onAgentClientLost: () => Effect.void,
    sharedRoot: () => join(root, "shared"),
    onProviderResumed: () => undefined,
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
  },
  emit: () => undefined,
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  longStartTimeoutMs: 10_000,
  preferredProvider: "codex",
  clientFactory: null,
  bundledExecutables: { codex: executable },
  credentials: NO_PROVIDER_CREDENTIALS,
  redactMcp: (text) => text,
});

try {
  await runCauseEffect(providers.start());
  report.running = reading(await runCauseEffect(providers.usage({ provider: "codex", model: MODEL })));
  const kept = await runCauseEffect(providers.releaseSharedProcess("codex"));
  report.released = !kept;
  const startsBefore = protocol().filter((line) => line.start).length;
  report.afterIdleStop = reading(await runCauseEffect(providers.usage({ provider: "codex", model: MODEL })));
  report.usageReadProcesses = protocol().filter((line) => line.start).length - startsBefore;
  report.passed =
    report.running.usedPercent === 3 &&
    report.released &&
    report.afterIdleStop.usedPercent === 3 &&
    report.usageReadProcesses === 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
