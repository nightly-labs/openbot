import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, agentProviderDescriptor, defaultProviderModel } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import {
  type AppServerNotification,
  type AppServerRequest,
  getArray,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
} from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-safety-block-e2e");
const BLOCKED = "BLOCKED-REQUEST";
const root = await mkdtemp(join(tmpdir(), "openbot-claude-safety-block-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const providerState = join(root, "provider-state");
const CLAUDE_MODEL = defaultProviderModel("claude");
const CLAUDE = agentProviderDescriptor("claude").displayName;
const DROPPED = sourceText("error.provider.claudeSafetyBlocked", { provider: CLAUDE });
const KEPT = sourceText("error.provider.claudeSafetyBlockedKept", { provider: CLAUDE });

const requests: string[][] = [];
const userTexts = (body: unknown): string[] =>
  getArray(body, "messages")
    .filter((message) => getString(message, "role") === "user")
    .flatMap((message) => {
      const content = isRecord(message) ? message.content : undefined;
      if (typeof content === "string") return [content];
      return getArray(message, "content").flatMap((part) =>
        getString(part, "type") === "text" ? [getString(part, "text") ?? ""] : [],
      );
    });
const event = <Data extends object>(type: string, data: Data) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const stream = (text: string, stopReason: string) =>
  [
    event("message_start", {
      message: {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: CLAUDE_MODEL,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    event("content_block_stop", { index: 0 }),
    event("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } }),
    event("message_stop", {}),
  ].join("");
const api = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (body.stream !== true) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "msg_check",
          type: "message",
          role: "assistant",
          model: CLAUDE_MODEL,
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      return;
    }
    const texts = userTexts(body);
    const marked = texts.filter((text) => text.includes("E2E-"));
    if (marked.length > 0)
      requests.push(marked.map((text) => text.slice(text.indexOf("E2E-"), text.indexOf("E2E-") + 40)));
    response.setHeader("content-type", "text/event-stream");
    response.end(texts.some((text) => text.includes(BLOCKED)) ? stream("", "refusal") : stream("Done.", "end_turn"));
  });
});
await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));

process.env.HOME = home;
process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
process.env.OPENBOT_CLAUDE_PATH = process.env.OPENBOT_E2E_CLAUDE_CLI ?? join(homedir(), ".local", "bin", "claude");
const address = api.address();
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
process.env.ANTHROPIC_API_KEY = "sk-ant-e2e";
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

class ClaudeWithFakeAccount extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(
      cli,
      undefined,
      undefined,
      30_000,
      undefined,
      undefined,
      undefined,
      undefined,
      providerState,
    );
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
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

  canReleaseProcess = () => this.#real.canReleaseProcess();

  holdsBackgroundWork(externalThreadId: string) {
    return this.#real.holdsBackgroundWork(externalThreadId);
  }

  wakesAfterBackgroundWork(externalThreadId: string) {
    return this.#real.wakesAfterBackgroundWork(externalThreadId);
  }

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "apiKey" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: CLAUDE_MODEL, displayName: "Claude" }] }));
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

interface Step {
  text: string;
  status: string | null;
  errors: string[];
  sentToClaude: string[] | null;
}

const report: {
  cli: string;
  steps: Record<string, Step>;
  passed: boolean;
  failures: string[];
  error?: string;
} = { cli: process.env.OPENBOT_CLAUDE_PATH, steps: {}, passed: false, failures: [] };

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const errors: { agentId: string | null; message: string }[] = [];
const startService = async () => {
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    clientFactory: (_provider, cli) => new ClaudeWithFakeAccount(cli),
  });
  service.on("event", (event) => {
    if (event.type === "error") errors.push({ agentId: event.agentId ?? null, message: event.message });
  });
  await runCauseEffect(service.initialize());
  return service;
};

let agents = await startService();
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
const settled = (agentId: string, text: string) =>
  waitFor(`"${text}" to settle`, () => {
    const found = agents.listQueue(agentId).deliveries.find((item) => item.text === text);
    return found && ["completed", "failed", "interrupted", "cancelled"].includes(found.status) && idle(agentId)
      ? found
      : null;
  });
const send = async (label: string, agentId: string, text: string): Promise<Step> => {
  const errorsBefore = errors.length;
  const requestsBefore = requests.length;
  await runCauseEffect(agents.sendMessage({ agentId, text }));
  const delivery = await settled(agentId, text);
  const step: Step = {
    text,
    status: delivery.status,
    errors: errors
      .slice(errorsBefore)
      .filter((error) => error.agentId === agentId)
      .map((error) => error.message),
    sentToClaude: requests.slice(requestsBefore).findLast((sent) => sent.some((item) => item.startsWith(text))) ?? null,
  };
  report.steps[label] = step;
  return step;
};
const expect = (label: string, step: Step, status: string, shown: string[], withoutBlocked: boolean) => {
  if (step.status !== status) report.failures.push(`${label}: the message ended as ${step.status}, not ${status}.`);
  if (JSON.stringify(step.errors) !== JSON.stringify(shown))
    report.failures.push(`${label}: the chat showed ${JSON.stringify(step.errors)}, not ${JSON.stringify(shown)}.`);
  if (withoutBlocked && (!step.sentToClaude || step.sentToClaude.some((text) => text.includes(BLOCKED))))
    report.failures.push(
      `${label}: Claude got ${JSON.stringify(step.sentToClaude)}, which still has the refused message.`,
    );
};

try {
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Safety",
      description: "Checks a message that Claude's safety check refuses.",
      avatarSeed: "safety",
      avatarHue: null,
      initialMessage: "E2E-first message.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn", () => requests.length > 0 && idle(agent.id));

  expect("refused message", await send("refused message", agent.id, `E2E-${BLOCKED} one`), "failed", [DROPPED], false);
  expect("next message", await send("next message", agent.id, "E2E-after the refusal"), "completed", [], true);

  expect("second refusal", await send("second refusal", agent.id, `E2E-${BLOCKED} two`), "failed", [DROPPED], false);
  await runCauseEffect(agents.stop());
  agents = await startService();
  expect("after a restart", await send("after a restart", agent.id, "E2E-after the restart"), "completed", [], true);

  expect("third refusal", await send("third refusal", agent.id, `E2E-${BLOCKED} three`), "failed", [DROPPED], false);
  await runCauseEffect(agents.stop());
  const drops = join(providerState, "claude-turn-drops");
  const saved = readdirSync(drops);
  if (saved.length !== 1) report.failures.push(`third refusal: ${saved.length} saved drops, not 1.`);
  for (const file of saved)
    writeFileSync(
      join(drops, file),
      JSON.stringify({ resumeSessionAt: crypto.randomUUID(), resumeDropsTurn: crypto.randomUUID() }),
    );
  agents = await startService();
  expect(
    "after a rejected drop",
    await send("after a rejected drop", agent.id, "E2E-after a rejected drop"),
    "failed",
    [DROPPED],
    false,
  );

  const first = await runCauseEffect(
    agents.createAgent({
      name: "First",
      description: "Checks a refusal of the first message of a session.",
      avatarSeed: "first",
      avatarHue: null,
      initialMessage: "E2E-hello",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn of the second agent", () => idle(first.id));
  await runCauseEffect(agents.clearAgentContext(first.id));
  expect(
    "refused first message",
    await send("refused first message", first.id, `E2E-${BLOCKED} first`),
    "failed",
    [KEPT],
    false,
  );

  report.passed = report.failures.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  api.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
