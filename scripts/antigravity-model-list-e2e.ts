// Lists the Gemini (Antigravity) models end to end on the real driver and `ProviderRuntime`, with a
// fake ACP server that answers each `session/new` slowly, as Antigravity does on a busy computer
// (#3546). The model list opens a probe session, so it takes longer than 5 s. With the request
// timeout of the app (30 s), the picker must still get the Gemini models and keep no error.
// `bun scripts/antigravity-model-list-e2e.ts`. Writes .openbot-build/antigravity-model-list-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { ANTIGRAVITY_MANIFEST } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-model-list-e2e");
/** The request timeout that `src/main/application-services.ts` gives the provider runtime. */
const APP_REQUEST_TIMEOUT_MS = 30_000;
/** Longer than the 5 s model-list timeout, and far shorter than the app's request timeout. */
const SLOW_SESSION_MS = 7_000;

// Answers ACP. Each `session/new` waits `FAKE_AGY_SESSION_MS` before it answers with one model.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ pid: process.pid }) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    setTimeout(() => write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } }), Number(process.env.FAKE_AGY_SESSION_MS));
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface Report {
  passed: boolean;
  requestTimeoutMs: number;
  sessionDelayMs: number;
  geminiModels?: string[];
  state?: string | undefined;
  lastError?: string | null;
  catalogLog?: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-model-list-e2e-"));
const log = join(root, "agy.jsonl");
const report: Report = { passed: false, requestTimeoutMs: APP_REQUEST_TIMEOUT_MS, sessionDelayMs: SLOW_SESSION_MS };
process.env.FAKE_AGY_LOG = log;
process.env.FAKE_AGY_SESSION_MS = String(SLOW_SESSION_MS);

async function starts(): Promise<{ pid: number }[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const executable = join(root, "agy", "1.2.1", "bin", "agy_acp_server");
const logLines: string[] = [];
const stopTee = teeLogLines(["provider-runtime"], (line) => logLines.push(line));
try {
  await mkdir(join(root, "agy", "1.2.1", "bin"), { recursive: true });
  await writeFile(join(root, "agy", "1.2.1", ANTIGRAVITY_MANIFEST), JSON.stringify({ version: "1.2.1" }));
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);

  const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "antigravity"),
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
    requestTimeoutMs: APP_REQUEST_TIMEOUT_MS,
    preferredProvider: "antigravity",
    clientFactory: null,
    bundledExecutables: { antigravity: executable },
    credentials: {
      ...NO_PROVIDER_CREDENTIALS,
      providerTempDirectory: join(root, "temp"),
      availableDiskBytes: () => Number.MAX_SAFE_INTEGER,
    },
    redactMcp: (text) => text,
  });

  // Starting the provider refreshes the catalogue, which sends `model/list`.
  await runCauseEffect(providers.ensureProvider("antigravity"));
  const row = providers.status().providers?.find((entry) => entry.id === "antigravity");
  report.geminiModels = providers
    .listModels()
    .filter((model) => model.provider === "antigravity")
    .map((model) => model.id);
  report.state = row?.state;
  report.lastError = providers.lastError("antigravity");
  report.catalogLog = logLines.filter((line) => /A provider (did not list|listed) its models/u.test(line));
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());

  assert.equal(report.state, "available");
  assert.deepEqual(report.geminiModels, ["gemini-fake"], "the picker gets the Gemini model");
  assert.equal(report.lastError, null, "the model list did not time out");
  report.passed = true;
} finally {
  stopTee();
  // A failed step can leave the fake process that this script started; stop it.
  for (const { pid } of await starts()) if (running(pid)) process.kill(pid);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
