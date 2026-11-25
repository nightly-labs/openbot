import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { CUSTOM_AGENT_MODELS_LISTED } from "../src/backend/custom-acp-agents-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeModelListResponse } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-acp-slow-start-e2e");
const READ_LIMIT_MS = 1_000;
const SESSION_DELAY_MS = 2_500;
const EVENT_GUARD_MS = 30_000;

interface LogEntry {
  event: "start" | "request";
  method?: string;
}

interface Read {
  models: string[];
  durationMs: number;
}

interface Report {
  passed: boolean;
  error?: string;
  cold?: Read;
  announcedAfterMs?: number;
  late?: Read;
  warm?: Read;
  sessionOpens?: number;
  diagnostics?: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-custom-acp-slow-start-e2e-"));
const clients: AgentClient[] = [];
const report: Report = { passed: false };

async function readModels(client: AgentClient, timeoutMs: number): Promise<Read> {
  const startedAt = performance.now();
  const response = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse, timeoutMs));
  return {
    models: response.data.flatMap((item) => (item.model ? [item.model] : [])),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function sessionOpens(log: string): Promise<number> {
  const entries = await readJsonl<LogEntry>(log);
  return entries.filter((entry) => entry.event === "request" && entry.method === "session/new").length;
}

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const log = join(root, "slow.jsonl");
  await installFakeAgent(executable, "custom-acp");
  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  await runCauseEffect(
    store.save({
      id: "slow",
      name: "Slow",
      command: executable,
      args: ["--acp"],
      env: [
        { name: "FAKE_LOG", value: log },
        { name: "FAKE_TITLE", value: "Slow" },
        { name: "FAKE_MODELS", value: "1" },
        { name: "FAKE_SESSION_DELAY_MS", value: String(SESSION_DELAY_MS) },
      ],
      usagePrompt: null,
    }),
  );

  const driver = requireProviderDriver("acp");
  const cli = await runCauseEffect(driver.resolveCli());
  const client = driver.createClient(
    cli,
    20_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], customAgents: () => store.configs() },
    undefined,
  );
  clients.push(client);
  const diagnostics: string[] = [];
  client.on("diagnostic", (message) => diagnostics.push(message));
  const listedLate = new Promise<number>((done, fail) => {
    const guard = setTimeout(() => fail(new Error("The late model list was not announced.")), EVENT_GUARD_MS);
    client.on("notification", (notification) => {
      if (notification.method !== CUSTOM_AGENT_MODELS_LISTED) return;
      clearTimeout(guard);
      done(performance.now());
    });
  });
  client.start();

  const coldStartedAt = performance.now();
  const cold = await readModels(client, READ_LIMIT_MS);
  assert.ok(cold.durationMs < SESSION_DELAY_MS, "A cold read returns at its own limit, not after the agent start.");
  assert.deepEqual(cold.models, [], "A cold read that ends before the agent starts has no models yet.");
  assert.deepEqual(diagnostics, [], "A start that is still running shows no error.");

  const announcedAt = await listedLate;
  const announcedAfterMs = Math.round(announcedAt - coldStartedAt);
  assert.ok(announcedAfterMs >= SESSION_DELAY_MS, "The models are announced when the agent start ends.");

  const late = await readModels(client, READ_LIMIT_MS);
  for (const id of ["slow/fast", "slow/deep"]) assert.ok(late.models.includes(id), `The late read lists ${id}.`);
  assert.equal(await sessionOpens(log), 1, "The late read uses the models of the start and opens no new session.");

  const warm = await readModels(client, 10_000);
  for (const id of ["slow/fast", "slow/deep"]) assert.ok(warm.models.includes(id), `A later read lists ${id}.`);
  assert.equal(await sessionOpens(log), 2, "A later read of a running agent opens a session, as before.");
  assert.deepEqual(diagnostics, [], "No read showed an error.");

  report.cold = cold;
  report.announcedAfterMs = announcedAfterMs;
  report.late = late;
  report.warm = warm;
  report.sessionOpens = await sessionOpens(log);
  report.diagnostics = diagnostics;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
