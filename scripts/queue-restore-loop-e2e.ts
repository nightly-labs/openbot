// Checks that a queued message waits, and does not loop, while the agent's chat runs a turn that
// the Claude CLI started itself and that waits on a question nobody answers (bx_b4pehphr, 63 GB of
// `conversation.snapshot-updated`). Runs the real agent service on a temporary profile. Claude is
// the real `ClaudeAgentClient`, which the Claude Agent SDK connects to a stand-in `claude`.
// Stand-in turns: SLOW ends when the file `release` exists; LATER ends at once, and then the CLI
// starts a turn of its own that asks an AskUserQuestion permission when the file `ask` exists (as a
// steered message does when it arrives just after its turn ended); ASK asks at once; others end.
// Steps (LOOP_VARIANT=routine, the incident): 1. a LATER chat turn ends; 2. a routine that runs in
// the chat starts a SLOW turn in its own session; 3. the CLI's own turn asks; 4. the routine turn
// ends; 5. a user message queues; 6. the drain must log that the message waits, with at most one
// refused `turn/start` (a loop reaches 100 first); 7. the
// asking turn ends (file `end-ask`), and the queued message must then run and complete.
// LOOP_VARIANT=simple skips the routine. The check fails when the queued message loops: each cycle
// calls `turn/start`, gets `ProviderTurnActiveError`, and writes the chat twice.
// `bun scripts/queue-restore-loop-e2e.ts`. Writes .openbot-build/queue-restore-loop-e2e/report.json.
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { HostMemory } from "../src/backend/host-memory";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/queue-restore-loop-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-queue-restore-loop-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const processLog = join(root, "claude.jsonl");
const releaseFile = join(root, "release");
const askFile = join(root, "ask");
const endAskFile = join(root, "end-ask");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");
/** The loop count that proves the loop; a healthy queue writes a few events only. */
const LOOP_EVENTS = 200;
/** `routine` (default): a routine turn in its own session ends while the question waits; `simple`: no routine. */
const VARIANT = process.env.LOOP_VARIANT === "simple" ? "simple" : "routine";

process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { databaseRows, requiredNumberColumn, requiredStringColumn } = await import(
  "../src/backend/database/database-rows"
);

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
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
const log = (entry) => fs.appendFileSync(${JSON.stringify(processLog)}, JSON.stringify({ pid: process.pid, sessionId, at: Date.now(), ...entry }) + "\\n");
log({ event: "start" });
process.on("SIGTERM", () => { log({ event: "exit" }); process.exit(0); });
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const result = (text) => {
  const id = "msg_" + randomUUID();
  write({ type: "assistant", message: { id, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
  write({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] });
  log({ event: "result", text });
};
const turn = (message) => {
  const text = JSON.stringify(message.message?.content ?? "");
  log({ event: "turn", text: text.slice(0, 80), slow: text.includes("SLOW"), ask: text.includes("ASK") });
  // First: a routine run in its own session gets the chat's history, which has the other words.
  if (text.includes("SLOW")) {
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(releaseFile)})) return;
      clearInterval(timer);
      result("Slow done.");
    }, 25);
    return;
  }
  if (text.includes("LATER")) {
    // The turn ends; later the CLI starts a turn of its own that asks, as a steered message does
    // when it arrives just after the turn that should have taken it ended.
    result("Done.");
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(askFile)})) return;
      clearInterval(timer);
      ask();
    }, 25);
    return;
  }
  if (text.includes("ASK")) {
    ask();
    return;
  }
  result("Done.");
};
const ask = () => {
    const toolUseId = "toolu_" + randomUUID();
    write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
      content: [{ type: "tool_use", id: toolUseId, name: "AskUserQuestion", input: { questions: [{ question: "SECRET_VALUE?", header: "Secret", options: [{ label: "a", description: "a" }, { label: "b", description: "b" }], multiSelect: false }] } }],
      stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
    write({ type: "control_request", request_id: randomUUID(), request: { subtype: "can_use_tool", tool_name: "AskUserQuestion",
      input: { questions: [{ question: "SECRET_VALUE?", header: "Secret", options: [{ label: "a", description: "a" }, { label: "b", description: "b" }], multiSelect: false }] },
      tool_use_id: toolUseId } });
    log({ event: "asked" });
    // The question ends with its turn when the file \`end-ask\` exists, as an expired prompt does.
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(endAskFile)})) return;
      clearInterval(timer);
      result("Asked done.");
    }, 25);
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
process.stdin.on("end", () => { log({ event: "exit" }); process.exit(0); });
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/** The `turn/start` calls that reach the client, and the errors they end with. */
const turnStarts: { calls: number; errors: Record<string, number> } = { calls: 0, errors: {} };

/** The real Claude client; only the account, usage and model reads are answered here. */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
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

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  releaseQuietBackgroundThreads() {
    return this.#real.releaseQuietBackgroundThreads();
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
      case "turn/start":
        turnStarts.calls += 1;
        return this.#real.request(method, params, decoder, timeoutMs).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
              const name = cause instanceof Error ? `${cause.constructor.name}: ${cause.message}` : String(cause);
              turnStarts.errors[name] = (turnStarts.errors[name] ?? 0) + 1;
            }),
          ),
        );
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

const memory: HostMemory = {
  level: () => "ok",
  turnLimit: () => 8,
  reserveTurn: () => () => {},
  subscribe: () => () => {},
  hostedPlan: false,
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function logEntries(): Array<{
  event: string;
  text?: string;
  slow?: boolean;
  ask?: boolean;
  sessionId: string;
  at: number;
}> {
  if (!existsSync(processLog)) return [];
  return readFileSync(processLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

interface Report {
  steps: Array<{ name: string; at: number; detail?: unknown }>;
  snapshotEvents: { before: number; after: number; windowMs: number };
  turnStarts: typeof turnStarts;
  eventTypes: Record<string, number>;
  statusChanges: number;
  deliveries: unknown[];
  loop: boolean;
  hold: string | null;
  followUpCompleted: boolean;
  passed: boolean;
  error?: string;
}
const report: Report = {
  steps: [],
  snapshotEvents: { before: 0, after: 0, windowMs: 0 },
  turnStarts,
  eventTypes: {},
  statusChanges: 0,
  deliveries: [],
  loop: false,
  hold: null,
  followUpCompleted: false,
  passed: false,
};
const started = Date.now();
const step = (name: string, detail?: unknown) => report.steps.push({ name, at: Date.now() - started, detail });

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  hostMemory: memory,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  clientFactory: (_provider, cli) => new ClaudeStandIn(cli),
});

const snapshotEvents = (threadId: string) =>
  requiredNumberColumn(
    databaseRows(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = 'conversation.snapshot-updated'",
        )
        .all(threadId),
    )[0] ?? { count: 0 },
    "count",
  );

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Udvikling",
      description: "Checks the queue under a waiting question.",
      avatarSeed: "queue-loop",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  const idle = () =>
    !agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  await waitFor("the first turn to end", idle);
  const threadId = store.list().find((candidate) => candidate.id === agent.id)?.threadId;
  if (!threadId) throw new Error("The agent has no thread.");
  step("agent ready", { threadId });

  const queueBrief = () =>
    agents.listQueue(agent.id).deliveries.map((delivery) => `${delivery.text.slice(0, 20)}:${delivery.status}`);
  // 1. A chat turn ends, and the CLI is about to start a turn of its own (a steered message that came late).
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "LATER steer." }));
  await waitFor("the LATER turn to end", idle);
  step("chat turn ended", queueBrief());

  const routine = agents.createRoutine({
    agentId: agent.id,
    name: "Gate",
    instruction: "SLOW routine run.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    runIn: "chat",
  });
  if (VARIANT === "routine") {
    // 2. A routine in the chat runs a slow turn in its own session.
    await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor("the slow routine turn", () => logEntries().some((entry) => entry.slow === true));
    step("routine turn running", queueBrief());
  }

  // 3. The CLI's own turn asks a question that nobody answers.
  writeFileSync(askFile, "");
  await waitFor("the question", () => logEntries().some((entry) => entry.event === "asked"));
  step("CLI turn asked", queueBrief());

  if (VARIANT === "routine") {
    // 4. The routine turn ends.
    writeFileSync(releaseFile, "");
    await waitFor("the slow routine result", () => logEntries().some((entry) => entry.text === "Slow done."));
    step("routine turn ended", queueBrief());
  }

  // 5. More work queues behind the waiting question. The drain logs once why it holds a message.
  const holds: string[] = [];
  const stopTee = teeLogLines(["drain-scheduler"], (line) => {
    if (line.includes("A queued message waits.") && line.includes(agent.id)) holds.push(line);
  });
  report.snapshotEvents.before = snapshotEvents(threadId);
  const watchStart = Date.now();
  const startsBefore = turnStarts.calls;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Plain follow-up." }));
  step("message queued", queueBrief());

  // 6. The drain holds the message, or loops. Each cycle of the loop calls `turn/start` and gets
  // `ProviderTurnActiveError`; a held queue calls it at most once, when only the provider knew of its turn.
  const looping = () => turnStarts.calls - startsBefore >= LOOP_EVENTS / 2;
  await waitFor("the queue to hold the message, or the loop", () => holds.length > 0 || looping());
  stopTee();
  report.snapshotEvents.after = snapshotEvents(threadId);
  report.snapshotEvents.windowMs = Date.now() - watchStart;
  report.hold = holds[0]?.match(/"reason":"([^"]+)"/)?.[1] ?? null;
  report.loop = looping() || turnStarts.calls - startsBefore > 1;
  for (const row of databaseRows(
    database.connection
      .prepare(
        "SELECT event_type AS type, COUNT(*) AS count FROM orchestration_events WHERE aggregate_type = 'thread' AND aggregate_id = ? GROUP BY event_type",
      )
      .all(threadId),
  ))
    report.eventTypes[requiredStringColumn(row, "type")] = requiredNumberColumn(row, "count");
  report.deliveries = agents
    .listQueue(agent.id)
    .deliveries.map((delivery) => ({ id: delivery.id, status: delivery.status, position: delivery.position }));
  step("watch ended", { log: logEntries().map((entry) => `${entry.event}:${entry.text ?? ""}`) });
  // 7. The asking turn ends, and the held message runs: the hold must end with that turn.
  if (!report.loop) {
    writeFileSync(endAskFile, "");
    await waitFor("the queued message to complete", () =>
      agents
        .listQueue(agent.id)
        .deliveries.some((delivery) => delivery.text === "Plain follow-up." && delivery.status === "completed"),
    );
    report.followUpCompleted = true;
    step("held message completed", queueBrief());
  }
  report.passed = !report.loop && report.followUpCompleted;
  step("variant", VARIANT);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  step("failed", {
    log: logEntries(),
    queue: agents.listQueue(store.list()[0]?.id ?? "").deliveries.map((d) => `${d.text.slice(0, 20)}:${d.status}`),
  });
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify(report.snapshotEvents)} ${JSON.stringify(report.turnStarts)} loop=${report.loop}\n`,
  );
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
