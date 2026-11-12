// Checks the low-memory limit of the Claude background-work hold. Runs the real agent service on a
// temporary profile, with a stand-in server memory reading. Claude is the real `ClaudeAgentClient`,
// which the Claude Agent SDK connects to a stand-in `claude` executable. Each turn of the stand-in
// starts one background task, which stays running and sends nothing. Steps:
// 1. The turn ends. The task holds the process: the idle release does not close it (#1870).
// 2. A sample with normal memory does not ask for the quiet release.
// 3. A low sample asks for it, but the task was quiet for less than 30 minutes: the process stays.
// 4. A low sample with the quiet time set to 0 closes the process.
// 5. Memory is back. The next turn resumes the saved session in a new process.
// 6. The task ends, and a turn of a second agent ends before the CLI answers the result in a turn
//    of its own. The idle limit does not close the first thread, and the answer shows (#6557).
// Only the quiet time is injected; the memory guard, the provider runtime and the client are real.
// `bun run test:claude-background-hold`. Writes .openbot-build/claude-background-hold-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { HostMemory, HostMemoryLevel } from "../src/backend/host-memory";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-background-hold-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-background-hold-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const processLog = join(root, "claude-processes.jsonl");
const claudeExecutable = join(root, "claude");
const CLAUDE_MODEL = defaultProviderModel("claude");

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

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end,
// and it reports one running background task before the result, except for a message that asks
// for no background work. It logs its start and its exit. A `finish-<pid>` file ends its task, and
// an `answer-<pid>` file then sends the turn that the CLI starts by itself to answer the result.
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
const log = (entry) => fs.appendFileSync(${JSON.stringify(processLog)}, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
log({ event: "start", resume, sessionId });
let exited = false;
const exit = (reason) => {
  if (exited) return;
  exited = true;
  log({ event: "exit", reason });
  process.exit(0);
};
process.on("SIGTERM", () => exit("SIGTERM"));
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (text) => {
  const id = "msg_" + process.pid + "_" + randomUUID();
  write({ type: "assistant", message: { id, type: "message", role: "assistant", model: ${JSON.stringify(CLAUDE_MODEL)},
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
};
const result = (text) =>
  write({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionId, uuid: randomUUID(),
    duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: [] });
const turn = (background) => {
  const text = background ? "Started." : "Done.";
  answer(text);
  if (background)
    write({ type: "system", subtype: "background_tasks_changed", tasks: [{ id: "bg-" + process.pid, type: "local_bash" }],
      session_id: sessionId, uuid: randomUUID() });
  result(text);
};
const trigger = (name) => fs.existsSync(${JSON.stringify(root)} + "/" + name + "-" + process.pid);
let taskEnded = false;
let answered = false;
setInterval(() => {
  if (!taskEnded && trigger("finish")) {
    taskEnded = true;
    write({ type: "system", subtype: "task_notification", task_id: "bg-" + process.pid, status: "completed",
      summary: "Done.", output_file: "", session_id: sessionId, uuid: randomUUID() });
    write({ type: "system", subtype: "background_tasks_changed", tasks: [], session_id: sessionId, uuid: randomUUID() });
    log({ event: "task-ended" });
  }
  if (taskEnded && !answered && trigger("answer")) {
    answered = true;
    answer("Background work done.");
    result("Background work done.");
    log({ event: "answered" });
  }
}, 25).unref();
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
    else if (message.type === "user") turn(!line.includes("without background work"));
  }
});
process.stdin.on("end", () => exit("stdin"));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/** Null uses the client's own quiet time of 30 minutes. */
let quietForMs: number | null = null;
/** The quiet releases that completed. */
let quietReleases = 0;

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. The quiet release goes to the real client, with the
 * injected quiet time.
 */
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
    return this.#real
      .releaseQuietBackgroundThreads(quietForMs ?? undefined)
      .pipe(Effect.ensuring(Effect.sync(() => quietReleases++)));
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

/** A server memory reading that the check sets. A sample runs the service's listeners at once. */
let level: HostMemoryLevel = "ok";
const listeners = new Set<() => void>();
const memory: HostMemory = {
  level: () => level,
  turnLimit: () => 8,
  reserveTurn: () => () => {},
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  hostedPlan: false,
};
function sample(next: HostMemoryLevel): void {
  level = next;
  for (const listener of listeners) listener();
}

interface Step {
  name: string;
  quietReleases: number;
  live: number[];
  passed: boolean;
}
const report: { steps: Step[]; resumedSession?: string; passed: boolean; error?: string } = {
  steps: [],
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

/** Waits for a state of the service or of the stand-in's log. */
async function waitFor<T>(
  label: string,
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

interface ProcessEntry {
  pid: number;
  event: "start" | "exit" | "task-ended" | "answered";
  resume?: string | null;
  sessionId?: string;
}
function entries(): ProcessEntry[] {
  try {
    return readFileSync(processLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
const starts = () => entries().filter((entry) => entry.event === "start");
function live(): number[] {
  const exited = new Set(entries().flatMap((entry) => (entry.event === "exit" ? [entry.pid] : [])));
  return starts()
    .map((entry) => entry.pid)
    .filter((pid) => !exited.has(pid));
}

function step(name: string, check: () => void): void {
  const entry: Step = { name, quietReleases, live: live(), passed: false };
  report.steps.push(entry);
  check();
  entry.passed = true;
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const claudeClients: ClaudeStandIn[] = [];
const agents = new AgentService({
  store,
  mailbox,
  browser,
  hostMemory: memory,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
  clientFactory: (_provider, cli) => {
    const client = new ClaudeStandIn(cli);
    claudeClients.push(client);
    return client;
  },
});

const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Background hold",
      description: "Checks the low-memory limit of the background-work hold.",
      avatarSeed: "background-hold",
      avatarHue: null,
      initialMessage: "Start a background task.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the first turn to start the stand-in", () => starts().length === 1);
  await waitFor("the first turn to end", () => idle(agent.id));
  const first = starts()[0];
  assert.ok(first?.sessionId, "The stand-in logged no session.");
  const standIn = claudeClients.at(-1);
  assert.ok(standIn, "The service made no Claude client.");

  await runCauseEffect(standIn.releaseIdleThreads());
  step("the background task holds the process", () => {
    assert.deepEqual(live(), [first.pid], "The idle release must not close a thread with background work.");
  });

  sample("ok");
  step("normal memory asks for no quiet release", () => {
    assert.equal(quietReleases, 0);
    assert.deepEqual(live(), [first.pid]);
  });

  sample("low");
  await waitFor("the first low sample's quiet release", () => quietReleases === 1);
  step("work quiet for less than 30 minutes stays", () => {
    assert.deepEqual(live(), [first.pid], "Recent background work must keep its process.");
  });

  quietForMs = 0;
  sample("low");
  await waitFor("the second low sample's quiet release", () => quietReleases === 2);
  await waitFor("the stand-in to exit", () => live().length === 0);
  step("quiet background work closes at low memory", () => {
    assert.equal(starts().length, 1, "The release starts no process.");
  });

  sample("ok");
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Go on." }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "No delivery for the next message.");
  const status = await waitFor("the next turn to end", () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  assert.equal(status, "completed", mailbox.getDelivery(deliveryId)?.delivery.error ?? status);
  const resumed = starts().at(-1);
  step("the next turn resumes the session", () => {
    assert.equal(starts().length, 2, "The next turn starts one new process.");
    assert.equal(resumed?.resume, first.sessionId, "The new process resumes the saved session.");
  });
  if (resumed?.resume) report.resumedSession = resumed.resume;

  // #6557: a second agent's turn ends after the task ended and before the CLI's own answer.
  const worker = resumed?.pid;
  assert.ok(worker, "The resumed process has no pid.");
  const other = await runCauseEffect(
    agents.createAgent({
      name: "Other agent",
      description: "Ends a turn while the first agent waits for its own turn.",
      avatarSeed: "other-agent",
      avatarHue: null,
      initialMessage: "Reply without background work.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor("the second agent's process", () => starts().length === 3);
  await waitFor("the second agent's first turn to end", () => idle(other.id));
  writeFileSync(join(root, `finish-${worker}`), "");
  await waitFor("the background task to end", () =>
    entries().some((entry) => entry.pid === worker && entry.event === "task-ended"),
  );
  const otherReceipt = await runCauseEffect(
    agents.sendMessage({ agentId: other.id, text: "Again without background work." }),
  );
  const otherDelivery = otherReceipt.deliveries[0]?.id;
  assert.ok(otherDelivery, "No delivery for the second agent's message.");
  await waitFor("the second agent's turn to end", () => {
    const value = mailbox.getDelivery(otherDelivery)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  step("finished background work keeps its thread until its own turn", () => {
    assert.ok(live().includes(worker), "The idle limit closed the thread before its own turn (#6557).");
  });
  writeFileSync(join(root, `answer-${worker}`), "");
  await waitFor("the agent's own answer to show", async () =>
    JSON.stringify((await runCauseEffect(agents.readConversation(agent.id))).messages).includes(
      "Background work done.",
    ),
  );
  step("the agent's own answer shows", () => {
    assert.ok(live().includes(worker), "The thread that answered stays open.");
  });
  report.passed = report.steps.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.steps) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
