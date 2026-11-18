// Checks issue #11713 on the real Codex driver and `ProviderRuntime`, with a fake Codex app-server
// that answers `account/read` with an account only while `$CODEX_HOME/auth.json` exists.
// 1. ChatGPT connects with the sign-in file.
// 2. The file goes, and an update of the CLI starts the new copy while the old process runs. The
//    update succeeds, and the row asks for a sign-in.
// 3. The file comes back, as after `codex login` or a token that another Codex process saved. The
//    row connects again on the new copy, with no Connect and no restart.
// `bun run test:codex-sign-in-watch`. Writes .openbot-build/codex-sign-in-watch-e2e/report.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { AgentProviderState } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-sign-in-watch-e2e");
const WAIT_MS = 15_000;
const root = await mkdtemp(join(tmpdir(), "openbot-codex-sign-in-watch-"));
const home = join(root, "home");
const codexHome = join(home, ".codex");
const authPath = join(codexHome, "auth.json");
const logPath = join(root, "protocol.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = codexHome;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
delete process.env.OPENBOT_CODEX_PATH;
mkdirSync(codexHome, { recursive: true });

const { ConversationRuntime } = await import("../src/backend/agent/conversation-runtime");
const { ProviderRuntime } = await import("../src/backend/agent/provider-runtime");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");

// The version is high, so the managed copy runs and not a Codex on this computer. Codex 0.160.1 and
// later answer with no account after a refresh that fails for good; a missing file gives the same answer.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 99.0.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, executable: __filename }) + "\\n");
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const signedIn = () => fs.existsSync(path.join(process.env.CODEX_HOME, "auth.json"));
const answer = (message) => {
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read":
      return write({ id: message.id, result: { account: signedIn() ? { type: "chatgpt", email: "codex@example.com" } : null, requiresOpenaiAuth: true } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
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
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
setInterval(() => {}, 1000);
`;

interface Report {
  passed: boolean;
  connected?: { state: AgentProviderState | null; email: string | null };
  update?: { succeeded: boolean; error: string | null; state: AgentProviderState | null; message: string | null };
  signInFileBack?: { states: (AgentProviderState | undefined)[]; email: string | null; onNewCopy: boolean };
  error?: string;
}

const report: Report = { passed: false };

/** The executable of each Codex process that started, in order. */
function starts(): string[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).executable);
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

const executable = await installFakeCodex(join(root, "codex", "1"));
const updatedExecutable = await installFakeCodex(join(root, "codex", "2"));
const store = new AgentStore(join(root, "profile"), home, new OpenBotDatabase(join(root, "profile")));
/** The Codex row state of each status event that changed it, in order. */
const codexStates: (AgentProviderState | undefined)[] = [];
let onStatus = () => {};
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
  emit: (event) => {
    if (event.type !== "status") return;
    const state = event.status.providers?.find((row) => row.id === "codex")?.state;
    if (codexStates.at(-1) !== state) codexStates.push(state);
    onStatus();
  },
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "codex",
  clientFactory: null,
  bundledExecutables: { codex: executable },
  credentials: NO_PROVIDER_CREDENTIALS,
  redactMcp: (text) => text,
});

const codexRow = () => providers.status().providers?.find((row) => row.id === "codex");

/** Resolves when the Codex row has gone through `states` in order, counting from `from` in `codexStates`. */
function waitForCodexStates(from: number, states: readonly AgentProviderState[]): Promise<void> {
  const reached = () => {
    let next = 0;
    for (const state of codexStates.slice(from)) if (state === states[next]) next += 1;
    return next >= states.length;
  };
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for Codex to go through ${states.join(", ")}.`)),
      WAIT_MS,
    );
    onStatus = () => {
      if (!reached()) return;
      clearTimeout(timer);
      resolveWait();
    };
    onStatus();
  });
}

try {
  // 1. Connected with the sign-in file.
  writeFileSync(authPath, JSON.stringify({ tokens: { refresh_token: "rt-1" } }));
  await runCauseEffect(providers.start());
  report.connected = { state: codexRow()?.state ?? null, email: codexRow()?.email ?? null };

  // 2. The sign-in is gone, and the update starts the new copy while the old process runs.
  await rm(authPath);
  const update = await Effect.runPromise(
    Effect.result(
      providers.updateProviderCli(
        "codex",
        () => Effect.succeed(updatedExecutable),
        new AbortController().signal,
        () => undefined,
      ),
    ),
  );
  report.update = {
    succeeded: Result.isSuccess(update),
    error: Result.isFailure(update)
      ? update.failure.cause instanceof Error
        ? update.failure.cause.message
        : String(update.failure.cause)
      : null,
    state: codexRow()?.state ?? null,
    message: codexRow()?.message ?? null,
  };

  // 3. The sign-in file comes back. The host checks the account again by itself.
  const from = codexStates.length;
  writeFileSync(authPath, JSON.stringify({ tokens: { refresh_token: "rt-2" } }));
  await waitForCodexStates(from, ["available"]);
  report.signInFileBack = {
    states: codexStates.slice(from),
    email: codexRow()?.email ?? null,
    onNewCopy: starts().at(-1) === updatedExecutable,
  };

  report.passed =
    report.connected.state === "available" &&
    report.connected.email === "codex@example.com" &&
    report.update.succeeded &&
    report.update.state === "sign-in-required" &&
    report.update.message === agentProviderDescriptor("codex").signInMessage &&
    report.signInFileBack.email === "codex@example.com" &&
    report.signInFileBack.onNewCopy;
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
