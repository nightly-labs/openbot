// Checks the background memory review: after every 20 completed turns of an agent's own chat or of
// one side thread, after a pause with 3 or more new turns, when the chat is cleared and when a side
// thread closes, one generation without tools proposes memory changes that the memory tools' checks
// apply. Runs the real agent service on a temporary profile with a fake Codex app-server. An agent
// turn calls the OpenBot tools that its input names in `<<CALLS[...]CALLS>>` and answers "Done.". A
// review generation is logged and answers the text in `control.json`, after its delay.
// Checks:
//   1. Nineteen turns start no review. The twentieth starts one, which adds a memory and shows one
//      memory-changes line with its own turn id.
//   2. A secret in the chat is not in the review prompt.
//   3. A review shows every essential memory, and of the searchable ones only those that fit its
//      budget, the ones that relate to the chat first.
//   4. A turn in which the agent saves a memory itself starts the count again.
//   5. A pause after new turns starts a review, which changes the agent's own memory, and not a
//      memory that the user wrote or chose.
//   6. A pause after fewer than three turns starts no review. Clearing the chat starts a review of
//      the chat that the clear ended.
//   7. Closing a side thread starts a review of that thread only, and its line shows in the thread.
//   8. An answer that is not JSON changes nothing and shows no error. The next review works.
//   9. A clear while another review runs is not lost: its review starts when that one ends.
//  10. An agent on a model that costs more than the provider's default model is reviewed on the
//      default model. A model with no known price is reviewed on itself.
//  11. Memory search finds another form of a word: "closing" finds "closes".
//  12. Off (interval 0): 20 turns, a closed side thread, a clear and a pause start no review.
//  13. Deleting a side thread or deleting the agent during a slow review applies nothing and shows
//      no error.
//  14. A review does not forget a memory that it sees only redacted, and does not add the text of a
//      saved memory again, which would change the user's inclusion choice.
//  15. Stopping the service during a slow review applies nothing and shows no error.
// No provider, account or network is used. `bun run test:memory-review`.
// Writes .openbot-build/memory-review-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, CONVERSATION_MEMORY_CHANGES_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/memory-review-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-memory-review-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const controlPath = join(root, "control.json");
const REVIEW_MARKER = "You keep the long-term memory of the agent";
const SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const IDLE_MS = 1_500;

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

/** A tool call that the fake makes in an agent turn. */
interface FakeCall {
  tool: "remember" | "search_memories";
  arguments: Record<string, string>;
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const CONTROL = ${JSON.stringify(controlPath)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turn, text) => {
  const item = { type: "agentMessage", id: "message-" + turn.turnId, text, phase: "final_answer" };
  write({ method: "item/completed", params: { threadId: turn.threadId, turnId: turn.turnId, item } });
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return setTimeout(() => finish(turn, "Done."), 5);
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, turn);
  write({ id, method: "item/tool/call", params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [
      { model: "gpt-6-luna", displayName: "GPT-6 Luna" },
      { model: "gpt-6-astra", displayName: "GPT-6 Astra" },
      { model: "gpt-6-unpriced", displayName: "GPT-6 Unpriced" },
    ] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const turn = { threadId: params.threadId, turnId, calls: [] };
      if (text.includes(${JSON.stringify(REVIEW_MARKER)})) {
        const control = JSON.parse(fs.readFileSync(CONTROL, "utf8"));
        log({ method: "review", text, model: params.model });
        return setTimeout(() => finish(turn, control.answer), control.delayMs || 5);
      }
      const named = /<<CALLS([\\s\\S]*?)CALLS>>/.exec(text.split("--- current message ---").at(-1));
      turn.calls = named ? JSON.parse(named[1]) : [];
      log({ method: "turn", text });
      return callNext(turn);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
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
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ method: "toolResult", result: message.result });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const report: {
  checks: { name: string; passed: boolean; detail?: unknown }[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = { checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
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
};

/** Waits for a state of the service, its database or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function logged(method: string): { text: string; model: string; result: unknown }[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line): { method: string; text: string; model: string; result: unknown } => JSON.parse(line))
    .filter((entry) => entry.method === method);
}

function reviews(): string[] {
  return logged("review").map((entry) => entry.text);
}

function control(answer: unknown, delayMs = 5) {
  writeFileSync(
    controlPath,
    JSON.stringify({ answer: typeof answer === "string" ? answer : JSON.stringify(answer), delayMs }),
  );
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
control({ operations: [] });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
/** The app setting, as main reads it at each use. */
let reviewInterval = 20;
const service = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  memoryReviewIdleMs: IDLE_MS,
  memoryReviewInterval: () => reviewInterval,
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const events: AgentEvent[] = [];
service.on("event", (event) => events.push(event));

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

/** Creates an agent; its first message is its first counted turn. */
async function createAgent(name: string, model?: string) {
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks the background memory review.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      ...(model ? { provider: "codex" as const, model } : {}),
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s first turn`, () =>
    service.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  return agent;
}

/** Sends a message, to the agent's own chat or to its side thread, and waits for its turn to end. */
async function send(agentId: string, text: string, taskId?: string) {
  const receipt = await runCauseEffect(
    service.sendMessage({ agentId, text, attachmentDraftIds: [], ...(taskId ? { taskId } : {}) }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`"${text}" to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return ended(value) ? value : null;
  });
  assert.equal(status, "completed", `"${text}" completes.`);
}

/** Starts a side thread and waits for its first turn to end. */
async function startTask(agentId: string, text: string) {
  const task = await runCauseEffect(service.startTask({ agentId, text }));
  await waitFor(`"${text}" to end`, () =>
    service.readTask(agentId, task.id).messages.some((message) => message.text === "Done."),
  );
  return task;
}

/** Sends `count` plain messages. */
async function chat(agentId: string, count: number, prefix: string) {
  for (let index = 1; index <= count; index += 1) await send(agentId, `${prefix} message ${index}.`);
}

/** Waits for the review count to reach `count`, and for its fiber to end. */
async function reviewed(count: number) {
  await waitFor(`review ${count}`, () => reviews().length >= count);
  assert.equal(reviews().length, count, "No other review started.");
}

/** The memory-changes lines of reviews in the agent's chat or side thread, as the database holds them. */
function memoryLines(agentId: string, sideThreadId?: string) {
  const threadId = sideThreadId ?? store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
  return database
    .readConversation(agentId, threadId)
    .messages.filter(
      (message) =>
        message.itemType === CONVERSATION_MEMORY_CHANGES_ITEM_TYPE && message.turnId?.startsWith("memory-review-"),
    );
}

function errorsFor(agentId: string, since: number) {
  return events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

/** No review fiber is left; a later turn proves the counts by itself. */
const settle = () => new Promise((done) => setTimeout(done, 200));
/** Longer than the pause before an early review. */
const pause = () => new Promise((done) => setTimeout(done, IDLE_MS + 500));

try {
  await runCauseEffect(service.initialize());

  const first = await createAgent("Counter");
  await check("nineteen turns start no review, the twentieth does", async () => {
    const since = events.length;
    await send(first.id, `My deploy token is ${SECRET}, but do not keep it.`);
    await chat(first.id, 17, "Counter");
    await settle();
    assert.equal(reviews().length, 0, "Nineteen turns start no review.");
    control({ operations: [{ type: "add", text: "The user prefers green tea.", inclusion: "essential" }] });
    await send(first.id, "I always drink green tea.");
    await reviewed(1);
    await waitFor("the added memory", () =>
      service.listMemories(first.id).find((memory) => memory.text === "The user prefers green tea."),
    );
    await waitFor("the memory-changes line", () => memoryLines(first.id).length > 0);
    const shown = memoryLines(first.id);
    assert.equal(shown.length, 1, "One line shows the review's changes.");
    assert.equal(shown[0]?.memoryChanges?.[0]?.action, "saved");
    assert.equal(errorsFor(first.id, since).length, 0, "No error shows.");
    return { line: shown[0]?.id };
  });

  await check("the review prompt has no secret", async () => {
    const prompt = reviews()[0] ?? "";
    assert.ok(prompt.includes("I always drink green tea."), "The prompt has the chat.");
    assert.ok(prompt.includes("My deploy token is"), "The prompt has the message with the secret.");
    assert.ok(!prompt.includes(SECRET), "The secret is redacted.");
    return { characters: prompt.length };
  });

  await check("a review shows the related searchable memories within its budget", async () => {
    control({ operations: [] });
    const filler = " Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed eiusmod tempor.".repeat(5);
    service.createMemory({ agentId: first.id, text: `The user's favourite island is Zanzibar.${filler}` });
    for (let index = 1; index <= 40; index += 1)
      service.createMemory({ agentId: first.id, text: `Unrelated fact ${index}.${filler}` });
    await send(first.id, "Tell me about Zanzibar.");
    await runCauseEffect(service.clearAgentContext(first.id));
    await reviewed(2);
    const prompt = reviews()[1] ?? "";
    const notShown = Number(/"notShown":\s*(\d+)/.exec(prompt)?.[1]);
    assert.ok(notShown > 0, "Some searchable memories are not shown.");
    assert.ok(prompt.includes("favourite island is Zanzibar"), "The related memory is shown.");
    assert.ok(prompt.includes("The user prefers green tea."), "The essential memory is shown.");
    return { memories: service.listMemories(first.id).length, notShown, characters: prompt.length };
  });

  const second = await createAgent("Keeper");
  let own = "";
  let manual = "";
  let chosen = "";
  await check("a memory that the agent saves itself starts the count again", async () => {
    await chat(second.id, 17, "Keeper");
    await send(second.id, `Save it. ${calls({ tool: "remember", arguments: { text: "The user works in Berlin." } })}`);
    await send(second.id, `Save this too. ${calls({ tool: "remember", arguments: { text: "The user likes jazz." } })}`);
    const memories = service.listMemories(second.id);
    own = memories.find((memory) => memory.text === "The user works in Berlin.")?.id ?? "";
    chosen = memories.find((memory) => memory.text === "The user likes jazz.")?.id ?? "";
    assert.ok(own && chosen, "The agent saved both memories.");
    manual = service.createMemory({ agentId: second.id, text: "The user's cat is called Miso." }).id;
    const selection = service.getMemorySelection(second.id).selections.find((entry) => entry.memoryId === chosen);
    assert.ok(selection);
    service.setMemoryInclusion({
      agentId: second.id,
      changes: [{ memoryId: chosen, inclusion: "essential", expectedRevision: selection.revision }],
    });
    control({
      operations: [
        { type: "update", memoryId: own, text: "The user works in Munich." },
        { type: "update", memoryId: chosen, text: "The user likes rock." },
        { type: "forget", memoryId: manual },
      ],
    });
    await chat(second.id, 18, "Keeper after");
    await send(second.id, "I moved to Munich.");
    await settle();
    assert.equal(reviews().length, 2, "The agent's own saves reset the count.");
    return { own, manual, chosen };
  });

  await check("a pause after new turns starts a review of the agent's own memories", async () => {
    await reviewed(3);
    await waitFor("the updated memory", () =>
      service
        .listMemories(second.id)
        .find((memory) => memory.id === own && memory.text === "The user works in Munich."),
    );
    const memories = service.listMemories(second.id);
    assert.equal(
      memories.find((memory) => memory.id === chosen)?.text,
      "The user likes jazz.",
      "The user's choice stays.",
    );
    assert.equal(
      memories.find((memory) => memory.id === manual)?.text,
      "The user's cat is called Miso.",
      "The user's memory stays.",
    );
    return { memories: memories.map((memory) => memory.text) };
  });

  await check("clearing the chat starts a review of the chat it ended", async () => {
    control({ operations: [{ type: "add", text: "The user plans a trip to Oslo.", inclusion: "searchable" }] });
    await send(second.id, "Next month I fly to Oslo.");
    await pause();
    assert.equal(reviews().length, 3, "A pause after one turn starts no review.");
    await runCauseEffect(service.clearAgentContext(second.id));
    await reviewed(4);
    assert.ok(reviews()[3]?.includes("Next month I fly to Oslo."), "The review reads the ended chat.");
    assert.ok(
      !reviews()[3]?.includes("I moved to Munich."),
      "The review does not read the chat that the last one read.",
    );
    await waitFor("the memory from the cleared chat", () =>
      service.listMemories(second.id).some((memory) => memory.text === "The user plans a trip to Oslo."),
    );
    return { reviews: reviews().length };
  });

  const third = await createAgent("Tasks");
  await check("closing a side thread starts a review of that thread", async () => {
    await send(third.id, "Main chat only.");
    control({ operations: [{ type: "add", text: "The user keeps notes in Obsidian.", inclusion: "searchable" }] });
    const task = await startTask(third.id, "I keep my notes in Obsidian.");
    await send(third.id, "Sort them by date.", task.id);
    await settle();
    assert.equal(reviews().length, 4, "Two side-thread turns start no review.");
    await runCauseEffect(service.closeTask({ agentId: third.id, taskId: task.id }));
    await reviewed(5);
    const prompt = reviews()[4] ?? "";
    assert.ok(prompt.includes("Sort them by date."), "The review reads the side thread.");
    assert.ok(!prompt.includes("Main chat only."), "The review does not read the agent's own chat.");
    await waitFor("the line in the side thread", () => memoryLines(third.id, task.threadId).length > 0);
    assert.equal(memoryLines(third.id).length, 0, "The agent's own chat shows no line.");
    return { taskId: task.id };
  });

  await check("an answer that is not JSON changes nothing, and the next review works", async () => {
    const since = events.length;
    const before = service.listMemories(third.id).length;
    control("I think the user likes cats.");
    const failed = await startTask(third.id, "Cats are fine.");
    await runCauseEffect(service.closeTask({ agentId: third.id, taskId: failed.id }));
    await reviewed(6);
    await settle();
    assert.equal(service.listMemories(third.id).length, before, "Nothing changed.");
    assert.equal(memoryLines(third.id, failed.threadId).length, 0, "No line shows.");
    assert.equal(errorsFor(third.id, since).length, 0, "No error shows.");
    control({ operations: [{ type: "add", text: "The user has two dogs.", inclusion: "searchable" }] });
    const next = await startTask(third.id, "I have two dogs.");
    await runCauseEffect(service.closeTask({ agentId: third.id, taskId: next.id }));
    await reviewed(7);
    await waitFor("the next review's memory", () =>
      service.listMemories(third.id).some((memory) => memory.text === "The user has two dogs."),
    );
    return { reviews: reviews().length };
  });

  await check("a clear during another review starts its review when that one ends", async () => {
    await send(third.id, "I bake bread on Sundays.");
    control(
      { operations: [{ type: "add", text: "The user bakes bread on Sundays.", inclusion: "searchable" }] },
      1_500,
    );
    const task = await startTask(third.id, "I like rye.");
    await runCauseEffect(service.closeTask({ agentId: third.id, taskId: task.id }));
    await waitFor("the side thread's review", () => reviews().length >= 8);
    await runCauseEffect(service.clearAgentContext(third.id));
    await reviewed(9);
    assert.ok(reviews()[8]?.includes("I bake bread on Sundays."), "The waiting review reads the ended chat.");
    assert.ok(!reviews()[8]?.includes("I like rye."), "The waiting review does not read the side thread.");
    await waitFor("the memory", () =>
      service.listMemories(third.id).some((memory) => memory.text === "The user bakes bread on Sundays."),
    );
    return { reviews: reviews().length };
  });

  await check("a review runs on the provider's default model when that costs less", async () => {
    control({ operations: [] });
    const large = await createAgent("Large", "gpt-6-astra");
    await send(large.id, "I use a large model.");
    await runCauseEffect(service.clearAgentContext(large.id));
    await reviewed(10);
    const unpriced = await createAgent("Unpriced", "gpt-6-unpriced");
    await send(unpriced.id, "My model has no known price.");
    await runCauseEffect(service.clearAgentContext(unpriced.id));
    await reviewed(11);
    const models = logged("review").map((entry) => entry.model);
    assert.equal(models[0], "gpt-6-luna", "An agent on the default model is reviewed on it.");
    assert.deepEqual(models.slice(9), ["gpt-6-luna", "gpt-6-unpriced"]);
    return { models: models.slice(9) };
  });

  await check("memory search finds another form of a word", async () => {
    const searcher = await createAgent("Searcher");
    const fact = "The bakery closes on Tuesdays.";
    await send(searcher.id, `Save it. ${calls({ tool: "remember", arguments: { text: fact } })}`);
    await send(searcher.id, `Find it. ${calls({ tool: "search_memories", arguments: { query: "closing day" } })}`);
    const result = JSON.stringify(logged("toolResult").at(-1)?.result ?? null);
    assert.ok(result.includes(fact), "The search finds the memory.");
    assert.equal(reviews().length, 11, "No review started.");
    return { result: result.slice(0, 200) };
  });

  await check("with the setting off, no turn, side thread, clear or pause starts a review", async () => {
    reviewInterval = 0;
    control({ operations: [{ type: "add", text: "Never saved while off.", inclusion: "searchable" }] });
    const quiet = await createAgent("Quiet");
    await chat(quiet.id, 20, "Off");
    const task = await startTask(quiet.id, "Off in a side thread.");
    await send(quiet.id, "Off again.", task.id);
    await send(quiet.id, "Off once more.", task.id);
    await runCauseEffect(service.closeTask({ agentId: quiet.id, taskId: task.id }));
    await send(quiet.id, "Off before the clear.");
    await send(quiet.id, "Off before the clear, two.");
    await send(quiet.id, "Off before the clear, three.");
    await pause();
    await runCauseEffect(service.clearAgentContext(quiet.id));
    await settle();
    assert.equal(reviews().length, 11, "No review started.");
    assert.equal(service.listMemories(quiet.id).length, 0, "Nothing changed.");
    assert.equal(memoryLines(quiet.id).length, 0, "No line shows.");
    reviewInterval = 20;
    return { reviews: reviews().length };
  });

  await check("deleting a side thread during a slow review applies nothing", async () => {
    const since = events.length;
    control({ operations: [{ type: "add", text: "Never saved from a thread.", inclusion: "searchable" }] }, 3_000);
    const task = await startTask(third.id, "I like figs.");
    await runCauseEffect(service.closeTask({ agentId: third.id, taskId: task.id }));
    await reviewed(12);
    await runCauseEffect(service.deleteTask({ agentId: third.id, taskId: task.id }));
    await new Promise((done) => setTimeout(done, 3_500));
    assert.ok(
      !service.listMemories(third.id).some((memory) => memory.text === "Never saved from a thread."),
      "Nothing changed.",
    );
    assert.equal(errorsFor(third.id, since).length, 0, "No error shows.");
    return { deleted: task.id };
  });

  await check("deleting the agent during a slow review applies nothing", async () => {
    const fourth = await createAgent("Deleted");
    const since = events.length;
    control({ operations: [{ type: "add", text: "Never saved.", inclusion: "searchable" }] }, 3_000);
    await send(fourth.id, "Remember that I like plums.");
    await runCauseEffect(service.clearAgentContext(fourth.id));
    await reviewed(13);
    await runCauseEffect(service.deleteAgent(fourth.id));
    await new Promise((done) => setTimeout(done, 3_500));
    assert.ok(!store.list().some((agent) => agent.id === fourth.id), "The agent is gone.");
    assert.equal(errorsFor(fourth.id, since).length, 0, "No error shows.");
    return { deleted: fourth.id };
  });

  await check("a review does not forget a memory it sees redacted, or add the text of a saved one", async () => {
    const guarded = await createAgent("Guarded");
    const secretText = `The user's key is ${SECRET}.`;
    await send(guarded.id, `Save it. ${calls({ tool: "remember", arguments: { text: secretText } })}`);
    const hidden = service.listMemories(guarded.id).find((memory) => memory.text.includes(SECRET))?.id;
    assert.ok(hidden, "The agent saved the memory.");
    const manualText = "The user's dog is called Rex.";
    const written = service.createMemory({ agentId: guarded.id, text: manualText }).id;
    const inclusion = () =>
      service.getMemorySelection(guarded.id).selections.find((entry) => entry.memoryId === written)?.inclusion;
    const before = inclusion();
    assert.notEqual(before, "essential", "The user's memory is not essential.");
    control({
      operations: [
        { type: "forget", memoryId: hidden },
        { type: "add", text: manualText, inclusion: "essential" },
      ],
    });
    await send(guarded.id, "My dog is called Rex.");
    await runCauseEffect(service.clearAgentContext(guarded.id));
    await reviewed(14);
    await settle();
    assert.ok(!reviews()[13]?.includes(SECRET), "The review prompt has no secret.");
    const memories = service.listMemories(guarded.id);
    assert.ok(
      memories.some((memory) => memory.id === hidden),
      "The memory that the review saw redacted stays.",
    );
    assert.equal(memories.filter((memory) => memory.text === manualText).length, 1, "No copy was added.");
    assert.equal(inclusion(), before, "The user's choice stays.");
    return { memories: memories.length, inclusion: before };
  });

  await check("stopping the service during a slow review applies nothing", async () => {
    const since = events.length;
    const before = service.listMemories(third.id).length;
    control({ operations: [{ type: "add", text: "Never saved either.", inclusion: "searchable" }] }, 3_000);
    await send(third.id, "Remember that I like pears.");
    await runCauseEffect(service.clearAgentContext(third.id));
    await reviewed(15);
    const started = Date.now();
    await runCauseEffect(service.stop());
    const stopMs = Date.now() - started;
    await new Promise((done) => setTimeout(done, 3_500));
    assert.equal(service.listMemories(third.id).length, before, "Nothing changed.");
    assert.equal(errorsFor(third.id, since).length, 0, "No error shows.");
    return { stopMs };
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
