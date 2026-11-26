import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Result } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-only-copy-e2e");
const NEWER = "1.5.4";

const fakeAgy = (version: string) => `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("${version}" + NL);
  process.exit(0);
}
if (fs.existsSync(process.env.FAKE_AGY_FAIL)) process.exit(1);
fs.appendFileSync(process.env.FAKE_AGY_LOG, process.pid + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
  if (message.method === "session/new")
    return write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
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
  failedUpdate?: { failed: boolean; state: string | undefined };
  laterStart?: { state: string | undefined; version: string | null | undefined };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-update-only-copy-e2e-"));
const log = join(root, "agy.log");
const failFlag = join(root, "fail");
const report: Report = { passed: false };
process.env.FAKE_AGY_LOG = log;
process.env.FAKE_AGY_FAIL = failFlag;
process.env.GEMINI_HOME = join(root, "gemini");

const newerExecutable = join(root, "agy", NEWER, "bin", "antigravity");
await mkdir(join(root, "agy", NEWER, "bin"), { recursive: true });
await writeFile(newerExecutable, fakeAgy(NEWER));
await chmod(newerExecutable, 0o755);

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
  requestTimeoutMs: 5_000,
  preferredProvider: "antigravity",
  clientFactory: null,
  bundledExecutables: { antigravity: join(root, "agy", "1.5.3", "bin", "antigravity") },
  credentials: { ...NO_PROVIDER_CREDENTIALS, providerTempDirectory: join(root, "temp") },
  redactMcp: (text) => text,
});
const row = () => providers.status().providers?.find((candidate) => candidate.id === "antigravity");

try {
  await writeFile(failFlag, "");
  const update = await runCauseEffect(
    Effect.result(
      providers.updateProviderCli(
        "antigravity",
        () => Effect.succeed(newerExecutable),
        new AbortController().signal,
        () => undefined,
      ),
    ),
  );
  report.failedUpdate = { failed: Result.isFailure(update), state: row()?.state };

  await rm(failFlag, { force: true });
  await runCauseEffect(Effect.result(providers.ensureProvider("antigravity")));
  report.laterStart = { state: row()?.state, version: row()?.version };

  report.passed =
    report.failedUpdate.failed &&
    report.failedUpdate.state !== "not-installed" &&
    report.laterStart.state === "available" &&
    report.laterStart.version === NEWER;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  const pids = (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {}
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
