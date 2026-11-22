import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentContextState } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-compaction-marker-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pi-compaction-marker-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const piDirectory = join(root, "pi-agent");
const executable = join(root, "bin", "pi");
const logPath = join(root, "pi.jsonl");
const MODEL = "openrouter/fake/cache";
const LARGE_TOKENS = 611_000;
const COMPACTED_TOKENS = 19_400;

process.env.HOME = home;
process.env.OPENBOT_PI_PATH = executable;
process.env.PI_CODING_AGENT_DIR = piDirectory;
mkdirSync(home, { recursive: true });
mkdirSync(piDirectory, { recursive: true });
writeFileSync(join(piDirectory, "auth.json"), JSON.stringify({ openrouter: { type: "api_key", key: "fake" } }));
await installFakeAgent(executable, "pi-cache", { FAKE_LOG: logPath, FAKE_DIR: root });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { requireProviderDriver } = await import("../src/backend/provider-drivers");

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

class PiStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "pi";
  readonly contextCompaction = "request";
  readonly #real: AgentClient;

  constructor(cli: AgentCliInfo) {
    super();
    this.#real = requireProviderDriver("pi").createClient(cli, 10_000, {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [],
      promptCacheTtl: () => "1h",
    });
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  promptCacheTtlMs(externalThreadId: string) {
    return this.#real.promptCacheTtlMs?.(externalThreadId) ?? null;
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "pi", email: null } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: MODEL, displayName: "Fake cache" }] }));
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(method: string, params?: unknown): void {
    this.#real.notify(method, params);
  }

  respond(id: RequestId, result: unknown): void {
    this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    this.#real.respondError(id, error);
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const report: {
  compaction?: NonNullable<AgentContextState["compaction"]>;
  usageAfter?: number | null;
  compactCommands?: number;
  passed: boolean;
  failures: string[];
  error?: string;
} = { passed: false, failures: [] };

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "pi",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "pi"),
  clientFactory: (_provider, cli) => new PiStandIn(cli),
  cacheExpiryCompaction: () => false,
});
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
const contextState = (agentId: string): AgentContextState | undefined =>
  agents.getRuntimeSnapshot().contextStates?.find((state) => state.agentId === agentId);

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Pi marker",
      description: "Checks the token counts of a Pi compaction.",
      avatarSeed: "pi-marker",
      avatarHue: null,
      initialMessage: "First message.",
      provider: "pi",
      model: MODEL,
    }),
  );
  await waitFor("the first turn to end", () => idle(agent.id) && contextState(agent.id)?.usage?.usedTokens);
  await runCauseEffect(agents.compactAgentContext(agent.id));
  const compaction = await waitFor("the compaction to end", () => {
    const current = contextState(agent.id)?.compaction;
    return current?.status === "completed" ? current : null;
  });
  report.compaction = compaction;
  report.usageAfter = contextState(agent.id)?.usage?.usedTokens ?? null;
  report.compactCommands = (await readJsonl<{ event: string }>(logPath)).filter(
    (entry) => entry.event === "compact",
  ).length;
  if (report.compactCommands !== 1) report.failures.push(`Pi got ${report.compactCommands} compact commands, not 1.`);
  if (compaction.beforeTokens !== LARGE_TOKENS)
    report.failures.push(`The marker shows ${compaction.beforeTokens} tokens before, not ${LARGE_TOKENS}.`);
  if (compaction.afterTokens !== COMPACTED_TOKENS)
    report.failures.push(`The marker shows ${compaction.afterTokens} tokens after, not ${COMPACTED_TOKENS}.`);
  if (report.usageAfter !== COMPACTED_TOKENS)
    report.failures.push(`The context usage is ${report.usageAfter} tokens, not ${COMPACTED_TOKENS}.`);
  report.passed = report.failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
