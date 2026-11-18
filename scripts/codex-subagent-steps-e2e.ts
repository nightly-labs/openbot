// Checks that a Codex subagent's own work shows as steps of its card. Runs the real agent service on a
// temporary profile with a fake Codex app-server. In a turn, the fake:
// 1. starts a subagent with a `spawnAgent` collab tool call that names the child thread `child-1`,
// 2. sends items of the child thread (a command, a thought, a message) and an item of an unknown thread,
// 3. ends the subagent with a `wait` call whose `agentsStates` holds its report,
// 4. sends one more child item, which the ended subagent does not take.
// The stored `<turn>:subagents` message must hold the child's steps in order and the report.
// Before the subagent ends, Codex asks for MCP tool consent from its subagent threads (#8188): from
// `child-1`, from `child-2` that a `subAgentActivity` item names, from an unknown thread, and from
// `child-2` after it ended. The two running subagents must get a card in the parent chat and turn,
// and the answer "Allow once"; the others are declined.
// The same four threads call the `openbot` tool `read_agent` (#8657). The two running subagents must
// get the parent agent; the unknown thread and the ended subagent get an error.
// `bun run test:codex-subagent-steps`. Writes .openbot-build/codex-subagent-steps-e2e/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type ConversationSubagent,
  MCP_ELICITATION_DECISION_QUESTION_ID,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-subagent-steps-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-subagent-steps-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const step = (ms) => new Promise((done) => setTimeout(done, ms));
const answers = new Map();
let consents = 0;
// Codex asks before a tool of an MCP server runs, from the thread of the agent that calls the tool.
const consent = (threadId, turnId) =>
  new Promise((done) => {
    const id = "consent-" + ++consents;
    answers.set(id, done);
    write({ id, method: "mcpServer/elicitation/request", params: { threadId, turnId, serverName: "probe", mode: "form",
      message: 'Allow the probe MCP server to run tool "echo"?', requestedSchema: { type: "object", properties: {} },
      _meta: { codex_approval_kind: "mcp_tool_call", persist: ["always"] } } });
  }).then((result) => (result && result.action) || "error");
let toolCalls = 0;
// A subagent has the parent's dynamic tools, and calls them from its own thread.
const readAgent = (threadId, turnId) =>
  new Promise((done) => {
    const id = "tool-" + ++toolCalls;
    answers.set(id, done);
    write({ id, method: "item/tool/call", params: { threadId, turnId, callId: id, namespace: "openbot", tool: "read_agent", arguments: {} } });
  }).then((result) => (result && result.success ? JSON.parse(result.contentItems[0].text).id : "error"));
async function runTurn(threadId, turnId) {
  const parent = (method, item) => write({ method, params: { threadId, turnId, item } });
  const child = (childThread, method, item) =>
    write({ method, params: { threadId: childThread, turnId: "child-turn", item } });
  const spawn = { type: "collabAgentToolCall", id: "spawn-1", tool: "spawnAgent", status: "inProgress",
    senderThreadId: threadId, receiverThreadIds: [], prompt: "Run the tests\\nand report failures.", model: "gpt-5.5", agentsStates: {} };
  parent("item/started", spawn);
  await step(20);
  parent("item/completed", { ...spawn, status: "completed", receiverThreadIds: ["child-1"],
    agentsStates: { "child-1": { status: "running", message: null } } });
  await step(20);
  const activity = (kind) => ({ type: "subAgentActivity", id: "activity-" + kind, kind, agentThreadId: "child-2", agentPath: "/root/review" });
  parent("item/started", activity("started"));
  parent("item/completed", activity("started"));
  await step(20);
  const consented = {
    v1: await consent("child-1", "child-turn"),
    v2: await consent("child-2", "child-turn-2"),
    unknown: await consent("child-unknown", "child-turn-x"),
  };
  const readers = {
    v1: await readAgent("child-1", "child-turn"),
    v2: await readAgent("child-2", "child-turn-2"),
    unknown: await readAgent("child-unknown", "child-turn-x"),
  };
  parent("item/completed", activity("completed"));
  await step(20);
  consented.ended = await consent("child-2", "child-turn-2");
  readers.ended = await readAgent("child-2", "child-turn-2");
  parent("item/completed", { type: "agentMessage", id: "consents-" + turnId, text: "Consents: " + JSON.stringify(consented) });
  parent("item/completed", { type: "agentMessage", id: "readers-" + turnId, text: "Readers: " + JSON.stringify(readers) });
  const command = { type: "commandExecution", id: "cmd-1", command: "bun test", status: "inProgress" };
  child("child-1", "item/started", command);
  child("child-1", "item/completed", { ...command, status: "completed" });
  child("child-1", "item/completed", { type: "reasoning", id: "think-1", summary: ["Two tests fail."], content: [] });
  child("child-unknown", "item/completed", { type: "commandExecution", id: "cmd-x", command: "rm -rf /tmp/x" });
  child("child-1", "item/completed", { type: "agentMessage", id: "msg-1", text: "Fixing the parser." });
  await step(20);
  const wait = { type: "collabAgentToolCall", id: "wait-1", tool: "wait", status: "completed",
    senderThreadId: threadId, receiverThreadIds: ["child-1"],
    agentsStates: { "child-1": { status: "completed", message: "All tests pass." } } };
  parent("item/started", { ...wait, status: "inProgress", agentsStates: {} });
  parent("item/completed", wait);
  await step(20);
  child("child-1", "item/completed", { type: "commandExecution", id: "cmd-late", command: "git status" });
  await step(20);
  parent("item/completed", { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
}
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid, turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      void runTurn(params.threadId, turnId);
      return;
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
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
      else if (answers.has(message.id)) {
        answers.get(message.id)(message.result);
        answers.delete(message.id);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
setInterval(() => {}, 1000);
`;

interface Card {
  title: string;
  agentType: string | null;
  prompt: string | null;
  status: ConversationSubagent["status"];
  error: string | null;
  steps: string[];
}

interface ConsentCard {
  threadId: string;
  turnId: string;
  header: string;
}

interface Report {
  passed: boolean;
  cards?: Card[];
  consents?: Record<string, string>;
  readers?: Record<string, string>;
  consentCards?: ConsentCard[];
  declineNotices?: number;
  error?: string;
}

const report: Report = { passed: false };

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

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  requestTimeoutMs: 5_000,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

const consentCards: ConsentCard[] = [];
let declineNotices = 0;
agents.on("event", (event) => {
  if (event.type === "error" && event.code === "mcp_safety_handoff") declineNotices += 1;
  if (event.type !== "prompt") return;
  consentCards.push({ threadId: event.threadId, turnId: event.turnId, header: event.questions[0]?.header ?? "" });
  const answer = { [MCP_ELICITATION_DECISION_QUESTION_ID]: ["Allow once"] };
  runCauseEffect(agents.respondToPrompt({ requestId: event.requestId, answers: answer })).catch((error: unknown) => {
    report.error = `The card answer failed: ${String(error)}`;
  });
});

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Codex subagents",
      description: "Checks the steps of a Codex subagent.",
      avatarSeed: "codex-subagents",
      avatarHue: null,
      initialMessage: "Run the tests with a subagent.",
    }),
  );
  const idle = () =>
    !agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  await waitFor("the turn to start", () => !idle());
  await waitFor("the turn to end", idle);
  const snapshot = await runCauseEffect(agents.readConversation(agent.id));
  const subagents = snapshot.messages.find((message) => message.id.endsWith(":subagents"))?.subagents ?? [];
  report.cards = subagents.map((subagent) => ({
    title: subagent.title,
    agentType: subagent.agentType,
    prompt: subagent.prompt,
    status: subagent.status,
    error: subagent.error,
    steps: subagent.steps.map((step) => `${step.kind}: ${step.text}`),
  }));
  const expected: Card[] = [
    {
      title: "Run the tests",
      agentType: "gpt-5.5",
      prompt: "Run the tests\nand report failures.",
      status: "completed",
      error: null,
      steps: ["command: bun test", "thinking: Two tests fail.", "text: Fixing the parser.", "text: All tests pass."],
    },
  ];
  const consentText = snapshot.messages.find((message) => message.text.startsWith("Consents: "))?.text ?? "";
  report.consents = consentText ? JSON.parse(consentText.slice("Consents: ".length)) : {};
  report.consentCards = consentCards;
  report.declineNotices = declineNotices;
  const expectedConsents = { v1: "accept", v2: "accept", unknown: "decline", ended: "decline" };
  // A running subagent's OpenBot tool call runs as the parent agent (#8657).
  const readersText = snapshot.messages.find((message) => message.text.startsWith("Readers: "))?.text ?? "";
  report.readers = readersText ? JSON.parse(readersText.slice("Readers: ".length)) : {};
  const expectedReaders = { v1: agent.id, v2: agent.id, unknown: "error", ended: "error" };
  // A subagent's card shows in the parent chat, in the parent turn.
  const cardsInParent =
    consentCards.length === 2 &&
    consentCards.every(
      (card) => card.threadId === snapshot.threadId && card.turnId.startsWith("turn-") && card.header === "probe",
    );
  report.passed =
    JSON.stringify(report.cards) === JSON.stringify(expected) &&
    JSON.stringify(report.consents) === JSON.stringify(expectedConsents) &&
    JSON.stringify(report.readers) === JSON.stringify(expectedReaders) &&
    cardsInParent &&
    declineNotices === 2;
  if (!report.passed)
    report.error ??= `Expected cards ${JSON.stringify(expected)}, consents ${JSON.stringify(expectedConsents)}, readers ${JSON.stringify(expectedReaders)}, two consent cards in the parent chat and turn, and two decline notices.`;
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
