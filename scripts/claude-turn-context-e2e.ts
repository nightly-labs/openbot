// Checks that a Claude session keeps its turn context across a runtime refresh. Runs the real agent
// service on a temporary profile. Claude is the real `ClaudeAgentClient`, which the Claude Agent SDK
// connects to a stand-in `claude` executable. The stand-in logs the text blocks of each user message.
// Turns: the first chat turn, two turns after the agent gets essential memories, a runtime refresh
// (as after an MCP or skill change), and one turn in the resumed session. The refresh closes the
// process and the next turn uses `--resume`, so the conversation still holds the memory block.
// The check runs twice: once with the release before this change, which forgot the turn context,
// and once with the current release. Only the current release must send no memory block again.
// `bun run test:claude-turn-context`. Writes .openbot-build/claude-turn-context-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { isTurnContextBlock } from "../src/backend/agent/developer-instructions";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-turn-context-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-turn-context-"));
const home = join(root, "home");
const messageLog = join(root, "claude-messages.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
const MEMORIES = 6;
const memoryText = (index: number) =>
  `Fact ${index}: ${"The user ships each release on Friday after a tested database backup. ".repeat(4)}`;

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const resume = option("--resume");
const sessionId = resume ?? option("--session-id") ?? randomUUID();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const turn = (message) => {
  const content = message.message?.content;
  const blocks = typeof content === "string" ? [content]
    : Array.isArray(content) ? content.filter((block) => block.type === "text").map((block) => block.text) : [];
  fs.appendFileSync(${JSON.stringify(messageLog)}, JSON.stringify({ pid: process.pid, resume, sessionId, blocks }) + "\\n");
  const usage = { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 20 };
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant",
    model: ${JSON.stringify(CLAUDE_MODEL)}, content: [{ type: "text", text: "Done." }], stop_reason: null, usage },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  write({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0.01, usage, permission_denials: [] });
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request")
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here. With
 * `oldRelease`, a release always forgets the turn context, as the release before this change did.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly #oldRelease: boolean;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo, oldRelease: boolean) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.#oldRelease = oldRelease;
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => this.emit("notification", notification));
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get turnContext(): boolean {
    return this.#real.turnContext;
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

  releaseThread(externalThreadId: string, resumes?: boolean) {
    return this.#real.releaseThread(externalThreadId, this.#oldRelease ? false : resumes);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
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

interface LoggedMessage {
  pid: number;
  resume: string | null;
  sessionId: string;
  blocks: string[];
}

interface TurnReport {
  name: string;
  resumed: boolean;
  sessionId: string;
  contextCharacters: number;
  memoryBlock: "full" | "update" | null;
}

interface RunReport {
  release: "before" | "after";
  turns: TurnReport[];
  /** The turn context characters of the first turn after the refresh. */
  afterRefreshContextCharacters: number;
}

const report: { model: string; runs: RunReport[]; passed: boolean; error?: string } = {
  model: CLAUDE_MODEL,
  runs: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
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

/** Waits for a state of the service or of the stand-in log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function logged(): LoggedMessage[] {
  try {
    return readFileSync(messageLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function describe(name: string, message: LoggedMessage): TurnReport {
  const context = message.blocks.filter(isTurnContextBlock);
  const memory = context.find((block) => block.startsWith("<openbot_saved_memories"));
  return {
    name,
    resumed: message.resume !== null,
    sessionId: message.sessionId,
    contextCharacters: context.reduce((total, block) => total + block.length, 0),
    memoryBlock: !memory ? null : memory.startsWith("<openbot_saved_memories_update>") ? "update" : "full",
  };
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });

async function run(release: "before" | "after"): Promise<void> {
  const userData = join(root, `user-data-${release}`);
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    clientFactory: (_provider, cli) => new ClaudeStandIn(cli, release === "before"),
  });
  const turns: TurnReport[] = [];
  const idle = (agentId: string) =>
    !agents
      .listQueue(agentId)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  const turn = async (agentId: string, name: string, text: string | null) => {
    const before = logged().length;
    if (text !== null) {
      const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
      const deliveryId = receipt.deliveries[0]?.id;
      assert.ok(deliveryId, `${name}: no delivery`);
      const status = await waitFor(`${name} to end`, () => {
        const value = mailbox.getDelivery(deliveryId)?.delivery.status;
        return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
      });
      assert.equal(status, "completed", `${name}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
    }
    const message = await waitFor(`${name} to reach Claude`, () => logged()[text === null ? 0 : before]);
    await waitFor(`${name} to leave the queue`, () => idle(agentId));
    const entry = describe(name, message);
    turns.push(entry);
    return entry;
  };
  try {
    await runCauseEffect(agents.initialize());
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Context ${release}`,
        description: "Checks the Claude turn context after a runtime refresh.",
        avatarSeed: `context-${release}`,
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "claude",
        model: CLAUDE_MODEL,
      }),
    );
    await turn(agent.id, "first chat turn", null);
    for (let index = 0; index < MEMORIES; index++) agents.createMemory({ agentId: agent.id, text: memoryText(index) });
    // A person makes them essential, so each prompt gets them.
    const selections = agents.getMemorySelection(agent.id).selections;
    agents.setMemoryInclusion({
      agentId: agent.id,
      changes: selections.map((selection) => ({
        memoryId: selection.memoryId,
        inclusion: "essential",
        expectedRevision: selection.revision,
      })),
    });
    const withMemories = await turn(agent.id, "turn after new memories", "Read the memories.");
    assert.ok(
      withMemories.memoryBlock !== null && withMemories.contextCharacters > MEMORIES * memoryText(0).length,
      `${release}: the turn after new memories sends them`,
    );
    const same = await turn(agent.id, "turn with the same memories", "Say one word.");
    assert.equal(same.memoryBlock, null, `${release}: the same memories are not sent again`);
    await runCauseEffect(agents.refreshAgentRuntime(agent.id));
    const refreshed = await turn(agent.id, "turn after a runtime refresh", "Say one more word.");
    assert.ok(refreshed.resumed, `${release}: the turn after the refresh resumes the session`);
    assert.equal(refreshed.sessionId, same.sessionId, `${release}: the resumed session is the same conversation`);
    if (release === "before") assert.equal(refreshed.memoryBlock, "full", "before: the old release sends all again");
    else assert.equal(refreshed.memoryBlock, null, "after: the resumed session gets no memory block again");
  } finally {
    report.runs.push({ release, turns, afterRefreshContextCharacters: turns.at(-1)?.contextCharacters ?? 0 });
    await runCauseEffect(agents.stop()).catch(() => {});
    database.close();
  }
}

try {
  for (const release of ["before", "after"] as const) {
    await rm(messageLog, { force: true });
    await run(release);
  }
  const [before, after] = report.runs;
  assert.ok(before && after && after.afterRefreshContextCharacters < before.afterRefreshContextCharacters);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const run of report.runs)
    process.stdout.write(
      `${run.release}: ${run.afterRefreshContextCharacters} turn context characters after the refresh\n`,
    );
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
