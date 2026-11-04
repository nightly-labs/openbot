// Checks issue #4995 on the real Codex driver and `ProviderRuntime`, with a fake Codex app-server.
// 1. A launch of two providers gives Codex the long start timeout: a first `initialize` that takes
//    longer than the request timeout connects on the same process. A stop at the request timeout made Codex keep
//    the lease of its state database backfill for 15 minutes.
// 2. A start that exits with "timed out waiting for state db backfill" shows
//    `error.provider.codexStateBusy`, not the CLI's words.
// 3. An update whose new copy fails the same way keeps the copy, and does not report
//    `error.provider.cliUpdateFailed`.
// `bun run test:codex-state-busy`. Writes .openbot-build/codex-state-busy-e2e/report.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-state-busy-e2e");
const REQUEST_TIMEOUT_MS = 1_000;
/** Longer than the request timeout, and shorter than the long start timeout below. */
const SLOW_INITIALIZE_MS = 2_500;
const LONG_START_TIMEOUT_MS = 8_000;
const root = await mkdtemp(join(tmpdir(), "openbot-codex-state-busy-"));
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const modePath = join(root, "mode.json");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_MODE = modePath;
delete process.env.OPENBOT_CODEX_PATH;
// A second provider that is on makes the launch a start of several providers, as on a hosted server.
// Its CLI path names no file, so it fails at once and starts no process.
process.env.OPENBOT_OPENCODE_PATH = join(root, "no-opencode");
mkdirSync(home, { recursive: true });

const { ConversationRuntime } = await import("../src/backend/agent/conversation-runtime");
const { ProviderRuntime } = await import("../src/backend/agent/provider-runtime");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");

// The mode applies to each process that starts while it is set: `slow` answers `initialize` late,
// `busy` exits at once with the Codex 0.160 backfill error, and another mode answers at once. The version is
// high, so the managed copy runs and not a Codex on this computer.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 99.0.0\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
const mode = JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_MODE, "utf8")).mode;
log({ start: true, mode });
if (mode === "busy") {
  process.stderr.write("Error: failed to initialize sqlite state runtime at /home/user/.codex: timed out waiting for state db backfill at /home/user/.codex (status: running)\\n");
  process.exit(1);
}
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const config = { config: { mcp_servers: {} }, layers: [] };
const answer = (message) => {
  switch (message.method) {
    case "initialize": return setTimeout(() => write({ id: message.id, result: {} }), mode === "slow" ? ${SLOW_INITIALIZE_MS} : 0);
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
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
setInterval(() => {}, 1000);
`;

interface ProtocolLine {
  pid: number;
  start?: boolean;
  mode?: string;
  method?: string | null;
}

interface Report {
  passed: boolean;
  slowLaunch?: { state: string | null; message: string | null; starts: number; opencodeState: string | null };
  busyStart?: { state: string | null; message: string | null };
  busyUpdate?: { succeeded: boolean; error: string | null; message: string | null; starts: number };
  error?: string;
}

const report: Report = { passed: false };
const setMode = (mode: "slow" | "busy") => writeFileSync(modePath, JSON.stringify({ mode }));

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

/** Writes the fake Codex as a managed copy under `directory`, and returns its path. */
async function installFakeCodex(directory: string): Promise<string> {
  const path = join(directory, "bin", "codex");
  await mkdir(join(directory, "bin"), { recursive: true });
  await writeFile(path, FAKE_CODEX);
  await chmod(path, 0o755);
  return path;
}

function runtime(executable: string) {
  const store = new AgentStore(join(root, "profile"), home, new OpenBotDatabase(join(root, "profile")));
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter(
      (id) => id !== "codex" && id !== "opencode",
    ),
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
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    longStartTimeoutMs: LONG_START_TIMEOUT_MS,
    preferredProvider: "codex",
    clientFactory: null,
    bundledExecutables: { codex: executable },
    credentials: NO_PROVIDER_CREDENTIALS,
    redactMcp: (text) => text,
  });
  return { providers, store };
}

/** `dispose` hands the running clients to its caller, which stops them, as `AgentService` does. */
async function stopAll(providers: InstanceType<typeof ProviderRuntime>): Promise<void> {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
}

const codexRow = (providers: InstanceType<typeof ProviderRuntime>) =>
  providers.status().providers?.find((row) => row.id === "codex");

const executable = await installFakeCodex(join(root, "codex", "1"));
const updatedExecutable = await installFakeCodex(join(root, "codex", "2"));

try {
  // 1. A slow first `initialize` at launch connects on the first process.
  setMode("slow");
  const slow = runtime(executable);
  await runCauseEffect(slow.providers.start());
  const slowRow = codexRow(slow.providers);
  report.slowLaunch = {
    state: slowRow?.state ?? null,
    message: slowRow?.message ?? null,
    starts: protocol().filter((line) => line.start).length,
    opencodeState: slow.providers.status().providers?.find((row) => row.id === "opencode")?.state ?? null,
  };
  await stopAll(slow.providers);

  // 2. A start that meets the backfill lease shows the catalog text.
  setMode("busy");
  const busy = runtime(executable);
  await runCauseEffect(busy.providers.start());
  const busyRow = codexRow(busy.providers);
  report.busyStart = { state: busyRow?.state ?? null, message: busyRow?.message ?? null };

  // 3. An update whose new copy meets the lease keeps the copy.
  const update = await Effect.runPromise(
    Effect.result(
      busy.providers.updateProviderCli(
        "codex",
        () => Effect.succeed(updatedExecutable),
        new AbortController().signal,
        () => undefined,
      ),
    ),
  );
  const updateRow = codexRow(busy.providers);
  report.busyUpdate = {
    succeeded: Result.isSuccess(update),
    error: Result.isFailure(update)
      ? update.failure.cause instanceof Error
        ? update.failure.cause.message
        : String(update.failure.cause)
      : null,
    message: updateRow?.message ?? null,
    starts: protocol().filter((line) => line.start && line.mode === "busy").length,
  };
  await stopAll(busy.providers);

  const busyText = sourceText("error.provider.codexStateBusy");
  report.passed =
    report.slowLaunch.state === "available" &&
    report.slowLaunch.starts === 1 &&
    report.busyStart.state === "error" &&
    report.busyStart.message === busyText &&
    report.busyUpdate.succeeded &&
    report.busyUpdate.message === busyText &&
    // One start for the failed start, and one for the new copy.
    report.busyUpdate.starts === 2;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
