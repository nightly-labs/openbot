// Starts the real `ProviderRuntime` with two providers on fake CLIs, Pi (the provider that chat uses)
// and Codex, and checks the order of a launch: Pi starts first and alone, chat is ready before the
// Codex process starts, and Codex is available when the start ends.
// `bun scripts/provider-launch-order-e2e.ts`. Writes .openbot-build/provider-launch-order-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-launch-order-e2e");

// Each fake writes one line when its provider process starts. A `--version` check writes nothing.
const FAKE_PI = `#!${process.execPath}
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("1.2.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, "pi\\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
  if (message.type === "get_available_models")
    return reply({ models: [{ provider: "openai", id: "gpt-fake", name: "GPT Fake" }] });
  reply({});
});
`;
const FAKE_CODEX = `#!${process.execPath}
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.164.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, "codex\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize": result = {}; break;
    case "account/read": result = { account: { type: "chatgpt", email: "fixture@example.com" } }; break;
    case "account/rateLimits/read": result = { rateLimits: null, rateLimitsByLimitId: null }; break;
    case "model/list": result = { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] }; break;
    case "plugin/list": result = { marketplaces: [] }; break;
    case "config/read": result = { config: { mcp_servers: {} }, layers: [] }; break;
    case "config/batchWrite": result = {}; break;
    default: return write({ id: message.id, error: { code: -32601, message: "Unsupported fixture method" } });
  }
  write({ id: message.id, result });
});
`;

interface Report {
  passed: boolean;
  /** The provider processes, in the order in which they started. */
  processOrder?: string[];
  /** The processes that had started when chat became ready. */
  startedAtChatReady?: string[];
  /** The Codex row when chat became ready. */
  codexAtChatReady?: string | null;
  /** The Codex row at each call of the ready hook, which settles the turns of a restart. */
  codexAtReadyHook?: (string | null)[];
  atEnd?: { phase: string; pi: string | null; codex: string | null };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-launch-order-e2e-"));
const log = join(root, "launch.log");
const pi = join(root, "bin", "pi");
const codex = join(root, "bin", "codex");
const piDirectory = join(root, "pi-agent");
const report: Report = { passed: false };
const names = ["OPENBOT_PI_PATH", "OPENBOT_CODEX_PATH", "PI_CODING_AGENT_DIR", "FAKE_LAUNCH_LOG"] as const;
const saved = names.map((name) => [name, process.env[name]] as const);
process.env.OPENBOT_PI_PATH = pi;
process.env.OPENBOT_CODEX_PATH = codex;
process.env.PI_CODING_AGENT_DIR = piDirectory;
process.env.FAKE_LAUNCH_LOG = log;

const started = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);

const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
/** Set at the first status event that says chat is ready. */
const chatReady: Promise<{ started: string[]; codex: string | null }>[] = [];
const codexAtReadyHook: (string | null)[] = [];
const providers = new ProviderRuntime({
  offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "pi" && id !== "codex"),
  conversation: new ConversationRuntime(
    store,
    () => undefined,
    () => store.list(),
  ),
  hooks: {
    bindClient: () => undefined,
    onProvidersReady: () => Effect.sync(() => void codexAtReadyHook.push(row("codex"))),
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
  emit: (event) => {
    if (event.type !== "status" || chatReady.length > 0 || event.status.capabilities.chat !== "ready") return;
    const codexRow = event.status.providers?.find((row) => row.id === "codex")?.state ?? null;
    chatReady.push(started().then((processes) => ({ started: processes, codex: codexRow })));
  },
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "pi",
  bundledExecutables: {},
  credentials: NO_PROVIDER_CREDENTIALS,
  redactMcp: (text) => text,
  clientFactory: (provider, cli) =>
    provider === "codex"
      ? new CodexAppServerClient(cli.executable, 5_000, { CODEX_HOME: join(root, "codex-home") })
      : requireProviderDriver(provider).createClient(cli, 5_000, NO_PROVIDER_CREDENTIALS),
});

const row = (id: string) => providers.status().providers?.find((candidate) => candidate.id === id)?.state ?? null;

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(piDirectory, { recursive: true });
  await writeFile(join(piDirectory, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
  await writeFile(pi, FAKE_PI);
  await writeFile(codex, FAKE_CODEX);
  await chmod(pi, 0o755);
  await chmod(codex, 0o755);

  await runCauseEffect(providers.start());
  const atChatReady = await chatReady[0];
  report.processOrder = await started();
  const startedAtChatReady = atChatReady?.started ?? [];
  report.startedAtChatReady = startedAtChatReady;
  report.codexAtChatReady = atChatReady?.codex ?? null;
  report.atEnd = { phase: providers.status().phase, pi: row("pi"), codex: row("codex") };

  assert.ok(atChatReady, "chat became ready");
  assert.equal(report.processOrder[0], "pi", "the provider that chat uses starts first");
  assert.ok(!startedAtChatReady.includes("codex"), "chat is ready before the other provider starts");
  assert.notEqual(report.codexAtChatReady, "available");
  report.codexAtReadyHook = codexAtReadyHook;
  assert.ok(codexAtReadyHook.length > 0, "the ready hook ran before the start ended");
  assert.ok(
    codexAtReadyHook.every((state) => state === "available"),
    "the ready hook does not run while a provider of the launch has no client",
  );
  assert.deepEqual(report.atEnd, { phase: "ready", pi: "available", codex: "available" });
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
