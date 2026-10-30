// Checks that a Claude agent never resumes a session ID that another provider made (#2475). Runs the
// real agent service on a temporary profile. Claude is the real `ClaudeAgentClient`, which the
// Claude Agent SDK connects to a stand-in `claude` executable: it records its arguments, answers
// control requests, and ends each turn with a result. OpenCode is a fake client that names its
// sessions `ses_<n>`. Scenarios:
// 1. A database with an OpenCode ID in the active Claude row: the next turn starts a new Claude
//    session, and no `claude --resume ses_...` runs.
// 2. Claude -> OpenCode -> Claude with a message after each switch: each session row has the
//    provider that made its ID.
// `bun run test:claude-foreign-session`. Writes .openbot-build/claude-foreign-session-e2e/report.json.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentSummary, defaultProviderModel } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
} from "../src/backend/protocol";
import { providerFailure, providerSync, requiredString } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-foreign-session-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-foreign-session-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const spawnLog = join(root, "claude-spawns.jsonl");
const claudeExecutable = join(root, "claude");
const opencodeExecutable = join(root, "opencode");
const CLAUDE_MODEL = defaultProviderModel("claude");
const OPENCODE_MODEL = "opencode/big-pickle";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
process.env.OPENBOT_OPENCODE_PATH = opencodeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// The stand-in for the Claude CLI. Like the real CLI, it refuses a `--resume` ID that is not a UUID
// and exits. Otherwise it speaks just enough of the stream-json protocol for a turn to end.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({ pid: process.pid, argv: args }) + "\\n");
// The SDK passes \`--resume=<id>\` and \`--session-id=<id>\`; a terminal passes \`--resume <id>\`.
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const resume = option("--resume");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (resume !== null && !UUID.test(resume)) {
  process.stderr.write("Error: --resume requires a valid session ID when used with --print. Provided value \\"" + resume + "\\" is not a UUID.\\n");
  process.exit(1);
}
const sessionId = resume ?? option("--session-id") ?? randomUUID();
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
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
    else if (message.type === "user")
      write({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId, uuid: randomUUID(),
        duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 },
        permission_denials: [] });
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
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. Sessions, turns and events go to the real client.
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

/** The sessions that the fake OpenCode clients started. */
let openCodeSessions = 0;

/** An OpenCode client with no process. Its turns end by themselves with one answer. */
class FakeOpenCode extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "opencode";
  #running = false;

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  stop() {
    return Effect.sync(() => {
      this.#running = false;
    });
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>) {
    switch (method) {
      case "initialize":
      case "turn/interrupt":
        return providerSync(() => decoder({}));
      case "account/read":
        return providerSync(() => decoder({ account: { type: "opencode" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: OPENCODE_MODEL, displayName: "Big Pickle" }] }));
      case "plugin/list":
        return providerSync(() => decoder({ marketplaces: [] }));
      case "thread/start":
        return providerSync(() => decoder({ thread: { id: `ses_e2e${++openCodeSessions}` } }));
      case "thread/resume":
      case "thread/read":
        return providerSync(() => decoder({ thread: { id: requiredString(params, "threadId"), turns: [] } }));
      case "turn/start":
        return providerSync(() => {
          const threadId = requiredString(params, "threadId");
          const turnId = getString(params, "clientUserMessageId") ?? randomUUID();
          this.emit("notification", {
            method: "turn/started",
            params: { threadId, turn: { id: turnId, status: "inProgress" } },
          });
          setTimeout(() => {
            const item = { type: "agentMessage", id: `${turnId}:assistant`, text: "Done.", phase: "final_answer" };
            this.emit("notification", { method: "item/completed", params: { threadId, turnId, item } });
            this.emit("notification", {
              method: "turn/completed",
              params: { threadId, turn: { id: turnId, status: "completed" } },
            });
          }, 50);
          return decoder({ turn: { id: turnId, status: "inProgress" } });
        });
      default:
        return Effect.fail(providerFailure(new Error(`The fake OpenCode does not implement ${method}.`)));
    }
  }

  notify(): void {}
  respond(): void {}
  respondError(): void {}
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: {
  passed: boolean;
  checks: typeof checks;
  error?: string;
} = { passed: false, checks };

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
};

/** Each start of the stand-in Claude CLI for a session: its pid and its session arguments. */
function claudeSpawns(): { pid: number; resume: string | null; sessionId: string | null }[] {
  let text = "";
  try {
    text = readFileSync(spawnLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => spawnEntry(JSON.parse(line)));
}

function spawnEntry(entry: unknown) {
  const argv = isRecord(entry) && Array.isArray(entry.argv) ? entry.argv.map(String) : [];
  const option = (name: string) => {
    const index = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
    if (index < 0) return null;
    return argv[index] === name ? (argv[index + 1] ?? null) : (argv[index]?.slice(name.length + 1) ?? null);
  };
  const pid = isRecord(entry) && typeof entry.pid === "number" ? entry.pid : 0;
  return { pid, resume: option("--resume"), sessionId: option("--session-id") };
}

/** Waits for a state of the service or of a stand-in. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Waits for a state, and gives null instead of a stop when it does not come. */
async function settle<T>(label: string, read: () => T | null | undefined | false, timeoutMs?: number) {
  return waitFor(label, read, timeoutMs).catch(() => null);
}

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
await writeFile(opencodeExecutable, "#!/bin/sh\necho 1.14.0\n", { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude" && provider !== "opencode"),
  clientFactory: (provider, cli) => (provider === "claude" ? new ClaudeStandIn(cli) : new FakeOpenCode()),
});

function agentNow(agentId: string): AgentSummary {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} is gone.`);
  return agent;
}

function sessions(agentId: string) {
  const threadId = agentNow(agentId).threadId;
  return threadId ? store.database.listProviderSessions(threadId) : [];
}

function sessionSummary(agentId: string) {
  return sessions(agentId).map(({ provider, externalSessionId, state }) => ({ provider, externalSessionId, state }));
}

/** A Claude ID is a UUID and an OpenCode ID starts with `ses_`. */
function rowsMatchTheirProvider(agentId: string): boolean {
  return sessions(agentId).every((session) =>
    session.provider === "claude"
      ? UUID.test(session.externalSessionId)
      : session.provider === "opencode"
        ? session.externalSessionId.startsWith("ses_")
        : false,
  );
}

function idle(agentId: string): boolean {
  return !agents
    .listQueue(agentId)
    .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
}

async function createClaudeAgent(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks which provider owns each session ID.",
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage: "First message.",
      provider: "claude",
      model: CLAUDE_MODEL,
    }),
  );
  await waitFor(`the first turn of ${name} to end`, () => idle(agent.id) && sessions(agent.id).length > 0);
  return agent;
}

/** Sends one message and waits for its final state. */
async function send(agentId: string, text: string) {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  if (!deliveryId) throw new Error("The message has no delivery.");
  const status = await settle("the message to end", () => {
    const current = mailbox.getDelivery(deliveryId)?.delivery.status;
    return current === "completed" || current === "failed" || current === "interrupted" ? current : null;
  });
  return { status, error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null };
}

function switchTo(agentId: string, provider: "claude" | "opencode") {
  return runCauseEffect(
    agents.updateAgent({ agentId, provider, model: provider === "claude" ? CLAUDE_MODEL : OPENCODE_MODEL }),
  );
}

try {
  await runCauseEffect(agents.initialize());

  // 1. A database that #2475 broke: the active Claude row holds an OpenCode ID.
  const broken = await createClaudeAgent("Broken database");
  const brokenThread = agentNow(broken.id).threadId;
  if (!brokenThread) throw new Error("The agent has no thread.");
  store.database.bindProviderSession({
    threadId: brokenThread,
    provider: "claude",
    externalSessionId: "ses_e2eForeign",
    model: CLAUDE_MODEL,
    effort: agentNow(broken.id).reasoningEffort,
  });
  const spawnsBefore = claudeSpawns().length;
  const healed = await send(broken.id, "A message after the damage.");
  const healSpawns = claudeSpawns().slice(spawnsBefore);
  const healRows = sessionSummary(broken.id);
  check(
    "1. no Claude CLI starts with --resume ses_",
    healSpawns.length > 0 && healSpawns.every((spawn) => UUID.test(spawn.resume ?? spawn.sessionId ?? "")),
    { spawns: healSpawns },
  );
  check(
    "1. the ses_ row is no longer active",
    healRows.some((row) => row.externalSessionId === "ses_e2eForeign" && row.state !== "active"),
    { rows: healRows },
  );
  const healedActive = healRows.find((row) => row.state === "active");
  check(
    "1. the new active row is a Claude UUID session",
    healedActive?.provider === "claude" && UUID.test(healedActive.externalSessionId),
    { active: healedActive ?? null },
  );
  check("1. the message after the damage completes", healed.status === "completed", healed);

  // 2. Claude -> OpenCode -> Claude, as in the report, with a message after each switch.
  const switching = await createClaudeAgent("Provider switch");
  await switchTo(switching.id, "opencode");
  const onOpenCode = await send(switching.id, "A message on OpenCode.");
  await switchTo(switching.id, "claude");
  const backSpawnsBefore = claudeSpawns().length;
  const backOnClaude = await send(switching.id, "A message back on Claude.");
  const backSpawns = claudeSpawns().slice(backSpawnsBefore);
  const switchRows = sessionSummary(switching.id);
  check(
    "2. each turn after a switch completes",
    onOpenCode.status === "completed" && backOnClaude.status === "completed",
    { onOpenCode, backOnClaude },
  );
  check(
    "2. each session row has the provider that made its ID",
    rowsMatchTheirProvider(switching.id) && switchRows.some((row) => row.provider === "opencode"),
    { rows: switchRows },
  );
  check(
    "2. the last Claude turn resumes no ses_ ID",
    backSpawns.length > 0 &&
      backSpawns.every(
        (spawn) => !spawn.resume?.startsWith("ses_") && UUID.test(spawn.resume ?? spawn.sessionId ?? ""),
      ),
    { spawns: backSpawns },
  );

  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
