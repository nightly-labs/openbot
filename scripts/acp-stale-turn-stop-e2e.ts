import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-stale-turn-stop-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-acp-stale-stop-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeAgy = join(root, "antigravity", "1.5.15", "bin", "antigravity");
const QUEUED_MESSAGE = "Message that waits behind the stale turn.";

process.env.HOME = home;
process.env.GEMINI_HOME = join(home, ".gemini");
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { NO_PROVIDER_CREDENTIALS, requireProviderDriver } = await import("../src/backend/provider-drivers");

const FAKE_AGY = `#!/usr/bin/env node
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") { process.stdout.write("1.5.15" + NL); process.exit(0); }
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const models = { availableModels: [{ modelId: "gemini-flash", name: "gemini-flash" }], currentModelId: "gemini-flash" };
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "agy-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") {
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } } });
    return write({ id: message.id, result: { stopReason: "end_turn" } });
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

const lostTurnEvents: { active: boolean; dropped: string[] } = { active: false, dropped: [] };

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

class AntigravityStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "antigravity";
  readonly #real: AgentClient;
  readonly readHistory: ReadProviderHistory | undefined;

  constructor(cli: AgentCliInfo) {
    super();
    this.#real = requireProviderDriver("antigravity").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (
        lostTurnEvents.active &&
        (notification.method === "turn/started" || notification.method === "turn/completed")
      ) {
        lostTurnEvents.dropped.push(notification.method);
        return;
      }
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message, origin) => this.emit("diagnostic", message, origin));
    this.#real.once("exit", (error) => this.emit("exit", error));
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
    return this.#real.request(method, params, decoder, timeoutMs);
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
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const report: {
  staleTurnId?: string;
  droppedEvents?: string[];
  beforeStop?: { queued: string | undefined };
  afterStop?: { activeTurnId: string | null; queued: string | undefined };
  passed: boolean;
  error?: string;
} = { passed: false };

await mkdir(join(root, "antigravity", "1.5.15", "bin"), { recursive: true });
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
  busyMessageMode: () => "queue",
  clientFactory: (_provider, cli) => new AntigravityStandIn(cli),
});
const deliveryStatus = (deliveryId: string) => mailbox.getDelivery(deliveryId)?.delivery.status;
const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Stale turn",
      description: "Checks Stop on a turn that Gemini does not run.",
      avatarSeed: "stale-turn",
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-flash",
      initialMessage: "Start.",
    }),
  );
  await waitFor("the first turn to end", () => idle(agent.id));

  lostTurnEvents.active = true;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "A turn whose events are lost." }));
  await waitFor("Gemini to end the turn", () => lostTurnEvents.dropped.includes("turn/completed"));
  lostTurnEvents.active = false;
  const conversation = await runCauseEffect(agents.readConversation(agent.id));
  const turnId = conversation.activeTurnId;
  assert.ok(turnId, "The chat keeps the turn that Gemini ended as active.");
  report.staleTurnId = turnId;
  report.droppedEvents = [...lostTurnEvents.dropped];

  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: QUEUED_MESSAGE }));
  const queuedId = receipt.deliveries[0]?.id;
  assert.ok(queuedId, "The new message has a delivery.");
  report.beforeStop = { queued: deliveryStatus(queuedId) };
  assert.equal(report.beforeStop.queued, "queued", "The new message waits behind the stale turn.");

  await runCauseEffect(agents.interrupt(agent.id, turnId));
  await waitFor("the queued message to run after Stop", () => deliveryStatus(queuedId) === "completed", 10_000).catch(
    () => null,
  );
  const after = await runCauseEffect(agents.readConversation(agent.id));
  report.afterStop = { activeTurnId: after.activeTurnId, queued: deliveryStatus(queuedId) };
  assert.notEqual(report.afterStop.activeTurnId, turnId, "Stop ends the stale turn.");
  assert.equal(report.afterStop.queued, "completed", "The queued message runs after Stop.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
