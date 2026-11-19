// Starts Grok on the real `ProviderRuntime`, with a stand-in client that writes the stderr line of an
// MCP server that did not start, and the real provider log writer. Checks that the line, with its
// cause, reaches `providers.log` with the secret in it redacted, and that the "MCP server not
// started" card is still sent (#12005). Before the fix, the line went only to the console.
// `bun scripts/provider-mcp-failure-log-e2e.ts`. Writes .openbot-build/provider-mcp-failure-log-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { AppServerNotification, AppServerRequest, ResponseDecoder } from "../src/backend/protocol";
import { providerFailure, providerSync } from "../src/backend/provider-client-effects";
import { BUILT_IN_PROVIDER_DRIVERS } from "../src/backend/provider-drivers";
import { startProviderLog } from "../src/main/provider-log";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-mcp-failure-log-e2e");
const WAIT_MS = 20_000;
const SERVER = "agent_brain_tools";
const SECRET = "abcdef1234567890abcdef";
const CAUSE = "worker quit with fatal: Transport channel closed";
// The form of Grok's `rmcp` worker line, with a credential that a CLI can quote.
const LINE = `2026-11-18T13:38:26Z ERROR rmcp::transport::worker: ${CAUSE} for MCP server ${SERVER} (Authorization: Bearer ${SECRET})`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/** A Grok process that is signed in and writes one MCP failure line to its stderr as it starts. */
class GrokStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "grok";
  #running = false;

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
    this.emit("diagnostic", LINE, { duringStop: false, stderr: true });
  }

  stop() {
    return Effect.sync(() => {
      this.#running = false;
    });
  }

  request<T>(method: string, _params: unknown, decoder: ResponseDecoder<T>) {
    switch (method) {
      case "initialize":
        return providerSync(() => decoder({}));
      case "account/read":
        return providerSync(() => decoder({ account: { type: "grok" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: "grok-fake", displayName: "Grok Fake" }] }));
      default:
        return Effect.fail(providerFailure(new Error(`The Grok stand-in does not implement ${method}.`)));
    }
  }

  notify(): void {}
  respond(): void {}
  respondError(): void {}
}

const server: McpServerConfig = {
  id: "brain",
  name: SERVER,
  transport: "stdio",
  enabled: true,
  command: "agent-brain",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};

const root = await mkdtemp(join(tmpdir(), "openbot-provider-mcp-failure-log-e2e-"));
const logs = join(root, "logs");
const providersLog = join(logs, "providers", "providers.log");
const executable = join(root, "bin", "grok");
const saved = process.env.OPENBOT_GROK_PATH;
process.env.OPENBOT_GROK_PATH = executable;
const report: {
  passed: boolean;
  logLine?: string | null;
  card?: { code: string; message: string } | null;
  error?: string;
} = { passed: false };
const stopLog = startProviderLog(logs);
let runtime: ProviderRuntime | undefined;

/** The provider log's line about the MCP failure, once the asynchronous write has made it. */
async function waitForLogLine(): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const text = await readFile(providersLog, "utf8").catch(() => "");
    const line = text.split("\n").find((row) => row.includes("A provider reported an MCP server failure."));
    if (line) return line;
    if (Date.now() > deadline) throw new Error("providers.log has no line about the MCP server failure.");
    await new Promise((done) => setTimeout(done, 50));
  }
}

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(executable, "#!/bin/sh\necho grok 1.0.77\n", { mode: 0o755 });
  const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
  const cards: { code: string; message: string }[] = [];
  runtime = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "grok"),
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
    emitError: (code, error) => cards.push({ code, message: error instanceof Error ? error.message : String(error) }),
    requestTimeoutMs: 5_000,
    preferredProvider: "grok",
    clientFactory: () => new GrokStandIn(),
    bundledExecutables: {},
    credentials: { apiKey: () => null, customProviders: () => [], mcpServers: () => [server] },
    redactMcp: (text) => text,
  });
  await Effect.runPromiseExit(runtime.ensureProvider("grok"));
  const line = await waitForLogLine();
  report.logLine = line;
  report.card = cards.find((card) => card.code === "mcp_server_not_started") ?? null;
  assert.ok(line.includes(SERVER), "The log line names the server.");
  assert.ok(line.includes(CAUSE), "The log line keeps the cause that the provider wrote.");
  assert.ok(!line.includes(SECRET), "The log line does not hold the secret.");
  assert.ok(report.card?.message.includes(SERVER), "The card about the server is still sent.");
  assert.ok(!report.card?.message.includes(SECRET), "The card does not hold the secret.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (runtime) for (const client of await runCauseEffect(runtime.dispose())) await runCauseEffect(client.stop());
  stopLog();
  if (saved === undefined) delete process.env.OPENBOT_GROK_PATH;
  else process.env.OPENBOT_GROK_PATH = saved;
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
