import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PromptCacheTtl } from "@openbot/contracts/ipc";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-cache-expiry-compaction-e2e");
const HOUR_MS = 60 * 60_000;
const COMPACTED_TOKENS = 19_400;

interface LogEntry {
  event: "prompt" | "compact";
  longCache?: boolean;
  tokensBefore?: number;
}

interface CaseReport {
  ttl: PromptCacheTtl;
  longCacheRequested: boolean;
  promptCacheTtlMs: number | null;
  compacted?: { tokensBefore: number | null; usageAfter: number | null };
}

const report: { passed: boolean; cases: CaseReport[]; failures: string[]; error?: string } = {
  passed: false,
  cases: [],
  failures: [],
};
const root = await mkdtemp(join(tmpdir(), "openbot-pi-cache-e2e-"));
const clients: AgentClient[] = [];

function waitForUsage(client: AgentClient, thread: string): Promise<number> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("No context usage after the compaction.")), 10_000);
    const listener = (notification: AppServerNotification) => {
      if (notification.method !== "thread/tokenUsage/updated") return;
      if (getString(notification.params, "threadId") !== thread) return;
      const tokens = getRecord(getRecord(notification.params, "tokenUsage"), "last")?.totalTokens;
      if (typeof tokens !== "number") return;
      clearTimeout(timer);
      client.off("notification", listener);
      done(tokens);
    };
    client.on("notification", listener);
  });
}

async function runCase(ttl: PromptCacheTtl, compact: boolean): Promise<void> {
  const dir = join(root, ttl);
  const log = join(dir, "agent.jsonl");
  const executable = join(dir, "bin", "pi");
  await installFakeAgent(executable, "pi-cache", { FAKE_LOG: log, FAKE_DIR: dir });
  const client = requireProviderDriver("deepseek").createClient(
    { executable, version: "1.6.0", source: "managed" },
    10_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], promptCacheTtl: () => ttl },
  );
  clients.push(client);
  client.start();
  const thread = await startThread(client, { cwd: dir });
  const turn = await runTurn(client, thread, { timeoutMs: 20_000 });
  if (turn.status !== "completed") report.failures.push(`${ttl}: the turn ended as ${turn.status}.`);
  const prompts = (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "prompt");
  const entry: CaseReport = {
    ttl,
    longCacheRequested: prompts.at(-1)?.longCache === true,
    promptCacheTtlMs: client.promptCacheTtlMs?.(thread) ?? null,
  };
  report.cases.push(entry);
  const expectLong = ttl === "1h";
  if (entry.longCacheRequested !== expectLong)
    report.failures.push(`${ttl}: Pi got PI_CACHE_RETENTION=long ${entry.longCacheRequested}, not ${expectLong}.`);
  if (entry.promptCacheTtlMs !== (expectLong ? HOUR_MS : null))
    report.failures.push(`${ttl}: the client reports a cache time of ${entry.promptCacheTtlMs}.`);
  if (!compact) return;
  const usage = waitForUsage(client, thread);
  await runCauseEffect(client.request("thread/compact/start", { threadId: thread }, (value) => value));
  const usageAfter = await usage;
  const compacted = (await readJsonl<LogEntry>(log)).find((item) => item.event === "compact");
  entry.compacted = { tokensBefore: compacted?.tokensBefore ?? null, usageAfter };
  if (!compacted) report.failures.push(`${ttl}: Pi got no compact command.`);
  if (usageAfter !== COMPACTED_TOKENS)
    report.failures.push(`${ttl}: the context usage after the compaction is ${usageAfter}, not ${COMPACTED_TOKENS}.`);
}

try {
  await runCase("1h", true);
  await runCase("5m", false);
  report.passed = report.failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
