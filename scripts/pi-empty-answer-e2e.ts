import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import { installFakeAgent } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-empty-answer-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-pi-empty-answer-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const piDirectory = join(root, "pi-agent");
const executable = join(root, "bin", "pi");
const logPath = join(root, "pi.jsonl");
const PROVIDER = "openrouter";
const MODEL = "fake/empty";
const DISPLAY_NAME = agentProviderDescriptor(PROVIDER).displayName;
const NO_ANSWER = sourceText("error.provider.acpNoAnswer", { provider: DISPLAY_NAME });
const NO_ANSWER_AFTER_STEPS = sourceText("error.provider.noAnswerAfterSteps", { provider: DISPLAY_NAME });

process.env.HOME = home;
process.env.OPENBOT_PI_PATH = executable;
process.env.PI_CODING_AGENT_DIR = piDirectory;
mkdirSync(home, { recursive: true });
mkdirSync(piDirectory, { recursive: true });
await installFakeAgent(executable, "pi-empty-answer", { FAKE_LOG: logPath, FAKE_DIR: root });

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

class OpenRouterStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = PROVIDER;
  readonly contextCompaction = "request";
  readonly #real: AgentClient;

  constructor(cli: AgentCliInfo) {
    super();
    this.#real = requireProviderDriver(PROVIDER).createClient(cli, 10_000, {
      apiKey: () => "fake-key",
      customProviders: () => [],
      mcpServers: () => [],
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

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: PROVIDER, email: null } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: MODEL, displayName: "Fake empty" }] }));
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

interface CaseResult {
  status: string | null;
  runs: number;
  errors: string[];
  lastAnswer: string | null;
}

const report: {
  cases: Record<string, CaseResult>;
  passed: boolean;
  failures: string[];
  error?: string;
} = { cases: {}, passed: false, failures: [] };

const prompts = (): string[] =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          const entry = JSON.parse(line);
          return entry.event === "prompt" && typeof entry.text === "string" ? [entry.text] : [];
        })
    : [];

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: PROVIDER,
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== PROVIDER),
  clientFactory: (_provider, cli) => new OpenRouterStandIn(cli),
  cacheExpiryCompaction: () => false,
});
const errors: { agentId: string | null; message: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error") errors.push({ agentId: event.agentId ?? null, message: event.message });
});
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Empty",
      description: "Checks an OpenRouter turn that ends with no answer.",
      avatarSeed: "empty",
      avatarHue: null,
      initialMessage: "First message.",
      provider: PROVIDER,
      model: MODEL,
    }),
  );
  await waitFor("the first turn to end", () => prompts().length > 0 && idle(agent.id));
  const threadId = store.list().find((item) => item.id === agent.id)?.threadId;
  if (!threadId) throw new Error("The agent has no chat thread.");

  const runCase = async (text: string): Promise<CaseResult> => {
    const errorsBefore = errors.length;
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    const delivery = await waitFor(`the message "${text}" to settle`, () => {
      const found = agents.listQueue(agent.id).deliveries.find((item) => item.text === text);
      return found && ["completed", "failed", "interrupted", "cancelled"].includes(found.status) && idle(agent.id)
        ? found
        : null;
    });
    const shown = database.readConversationPage(agent.id, threadId, { type: "latest" }, 200).messages;
    const turnStart = shown.findLastIndex((message) => message.author === "user" && message.text === text);
    const answer = shown
      .slice(turnStart + 1)
      .findLast(
        (message) => message.author === "assistant" && message.itemType !== "commentary" && message.text.trim() !== "",
      );
    const result: CaseResult = {
      status: delivery.status,
      runs: prompts().filter((prompt) => prompt.includes(text)).length,
      errors: errors
        .slice(errorsBefore)
        .filter((error) => error.agentId === agent.id)
        .map((error) => error.message),
      lastAnswer: answer?.text ?? null,
    };
    report.cases[text] = result;
    return result;
  };
  const expect = (
    label: string,
    result: CaseResult,
    status: string,
    expectedErrors: string[],
    lastAnswer: string | null = null,
  ) => {
    if (result.status !== status)
      report.failures.push(`${label}: the message ended as ${result.status}, not ${status}.`);
    if (result.runs !== 1) report.failures.push(`${label}: the message ran ${result.runs} times, not once.`);
    if (JSON.stringify(result.errors) !== JSON.stringify(expectedErrors))
      report.failures.push(`${label}: errors ${JSON.stringify(result.errors)}, not ${JSON.stringify(expectedErrors)}.`);
    if (result.lastAnswer !== lastAnswer)
      report.failures.push(`${label}: the last answer is ${JSON.stringify(result.lastAnswer)}.`);
  };

  expect("an answer", await runCase("PLAIN"), "completed", [], "Done.");
  expect("an empty turn", await runCase("EMPTY-TURN"), "failed", [NO_ANSWER]);
  expect("reasoning and no answer", await runCase("REASONING-ONLY"), "failed", [NO_ANSWER]);
  expect("a step and no answer", await runCase("STEP-THEN-EMPTY"), "completed", [NO_ANSWER_AFTER_STEPS]);
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
