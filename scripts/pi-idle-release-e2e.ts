import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-idle-release-e2e");

interface LogEntry {
  event: "start" | "switch_session" | "prompt" | "exit";
  pid: number;
  sessionFile?: string;
  reason?: string;
}

interface Report {
  passed: boolean;
  steps: { name: string; alive: Record<string, number | null> }[];
  resumed?: { pid: number; sessionFile: string };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-idle-e2e-"));
const log = join(root, "agent.jsonl");
const report: Report = { passed: false, steps: [] };
const clients: AgentClient[] = [];

async function processOf(session: string): Promise<number | null> {
  const entries = await readJsonl<LogEntry>(log);
  const exited = new Set(entries.filter((entry) => entry.event === "exit").map((entry) => entry.pid));
  const owners = new Map<number, string>();
  for (const entry of entries) if (entry.sessionFile) owners.set(entry.pid, entry.sessionFile);
  const live = [...owners].filter(([pid, file]) => file === session && !exited.has(pid)).map(([pid]) => pid);
  assert.ok(live.length <= 1, `More than one live process has ${session} open.`);
  return live[0] ?? null;
}

async function waitFor<T>(what: string, ready: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await ready();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

async function step(name: string, threads: Record<string, string>): Promise<void> {
  const alive: Record<string, number | null> = {};
  for (const [label, id] of Object.entries(threads)) alive[label] = await processOf(id);
  report.steps.push({ name, alive });
}

try {
  const executable = join(root, "bin", "pi");
  await installFakeAgent(executable, "pi-idle", { FAKE_LOG: log, FAKE_DIR: root });
  const client = requireProviderDriver("deepseek").createClient(
    { executable, version: "1.4.0", source: "managed" },
    10_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [] },
  );
  clients.push(client);
  client.start();

  const first = await startThread(client, { cwd: root });
  const firstTurn = await runTurn(client, first, { timeoutMs: 20_000 });
  assert.equal(firstTurn.status, "completed");
  const firstPid = await processOf(first);
  assert.ok(firstPid, "The first thread has a process after its turn.");
  await step("first thread idle", { first });

  const second = await startThread(client, { cwd: root });
  const secondTurn = await runTurn(client, second, { timeoutMs: 20_000 });
  assert.equal(secondTurn.status, "completed");
  await waitFor("the first thread's process to exit", async () => ((await processOf(first)) === null ? true : null));
  assert.ok(await processOf(second), "The second thread keeps its process.");
  await step("second thread idle", { first, second });

  const resumedTurn = await runTurn(client, first, { timeoutMs: 20_000 });
  assert.equal(resumedTurn.status, "completed");
  const resumedPid = await processOf(first);
  assert.ok(resumedPid && resumedPid !== firstPid, "The next turn starts a new process.");
  const entries = await readJsonl<LogEntry>(log);
  const started = entries.find((entry) => entry.pid === resumedPid && entry.event === "start");
  assert.equal(started?.sessionFile, first, "The new process starts on the same session file.");
  assert.ok(
    !entries.some((entry) => entry.pid === resumedPid && entry.event === "switch_session"),
    "The new process does not replace its session, so Pi extensions start only once.",
  );
  const prompted = entries.find((entry) => entry.pid === resumedPid && entry.event === "prompt");
  assert.equal(prompted?.sessionFile, first, "The prompt goes to the resumed session.");
  report.resumed = { pid: resumedPid, sessionFile: first };
  await waitFor("the second thread's process to exit", async () => ((await processOf(second)) === null ? true : null));
  await step("first thread resumed", { first, second });

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
