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
//  16. After a restart, a review reads only the messages after the saved cursor of the last review.
//      Without a saved cursor, it reads the latest messages again, as before.
//  17. A review with no memory change can ask the user to save a skill. Its prompt lists the agent's
//      skills, which of them can take an update, and the work steps. The user's next message brings
//      the question to the agent; the message after it does not. A later review sees the question.
//  18. A suggestion is dropped when it updates a skill that is not in the local library or that the
//      agent does not have, when a new skill takes the name of one the agent has, or when it has a
//      bad shape. The memory changes of the same answer still apply.
//  19. When a clear starts the review, the user's next message brings the cleared chat with the
//      question, so the agent can write the skill from it. Without a clear, the note has no chat.
//  20. Skill learning "automatic": the review saves a new skill with no question to the user. The
//      writer reads the lesson and the redacted chat. The chat shows the saved skill, the next
//      message brings no question, and a later review sees the saved skill.
//  21. "automatic" revises a local skill from its current text, at its current revision.
//  22. When the writer answer is not JSON or the save fails, the review asks the user instead.
//  23. "off": the review prompt asks for no skill, and a skill in the answer shows nothing.
//  24. When the review looks for skills, a turn in which the agent saved a memory stays in the next
//      review: the memory does not hold how the agent did the task.
//  25. "ask": Save writes the skill with the background writer, not in an agent turn. Two presses
//      save once, a later press sees the saved skill, and the next message brings no question. Save
//      also revises a local skill. When the writer fails, Save reports false and the yes still works.
//  26. A review adds a memory with a site, as a host. A site that is not a host is dropped, and the
//      fact is kept. The review prompt shows the site of a memory.
//  27. "Learn from my browsing": the review reads the steps that the user did in the agent's tabs,
//      redacted, and adds a site memory from them. It deletes the steps it read; the next review has
//      none. A step older than 30 days is deleted, and a review never reads it. The steps stay on
//      the file across a new log.
// No provider, account or network is used. `bun run test:memory-review`.
// Writes .openbot-build/memory-review-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  type SkillConversationEvent,
  type SkillLearningMode,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { LearnedSkillDraft, SkillLearner } from "../src/backend/agent/skill-learning";
import type { LocalSkillTools } from "../src/backend/agent/skill-tools";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/memory-review-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-memory-review-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const controlPath = join(root, "control.json");
const REVIEW_MARKER = "You keep the long-term memory of the agent";
const WRITER_MARKER = "You keep the skills of the agent";
const writerPath = join(root, "writer.json");
const SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const IDLE_MS = 1_500;
const LOCAL_SKILL_ID = "local-skill-00000000-0000-4000-8000-000000000001";
const REVIEW_SKILLS = [
  { skillId: LOCAL_SKILL_ID, name: "Release notes", description: "How the user wants release notes." },
  { skillId: "docs-style", name: "Docs style", description: "A Marketplace skill." },
];

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { USER_BROWSING_RETENTION_MS, UserBrowsingLog } = await import("../src/backend/user-browsing-log");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** A tool call that the fake makes in an agent turn. */
interface FakeCall {
  tool: "remember" | "search_memories" | "revise_skill";
  arguments: Record<string, string | number>;
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
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
      if (text.includes(${JSON.stringify(WRITER_MARKER)})) {
        log({ method: "writer", text, model: params.model });
        return setTimeout(() => finish(turn, JSON.parse(fs.readFileSync(${JSON.stringify(writerPath)}, "utf8")).answer), 5);
      }
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
/** Only revise works: it returns revision 2 of the local skill, as the library does after a revision. */
const LOCAL_SKILL_TOOLS: LocalSkillTools = {
  create: unused,
  revise: () =>
    Effect.succeed({
      id: LOCAL_SKILL_ID,
      slug: "release-notes",
      name: "Release notes",
      description: "How the user wants release notes.",
      category: "other",
      creatorName: "",
      version: 2,
      installs: 0,
      featured: false,
      iconUrl: null,
      updatedAt: new Date().toISOString(),
      versionId: `${LOCAL_SKILL_ID}:2`,
      bundleSha256: "0".repeat(64),
      files: ["SKILL.md"],
      instructions: "How the user wants release notes.",
    }),
  list: unused,
  get: unused,
  install: unused,
  listInstalled: unused,
  setEnabled: unused,
  uninstall: unused,
};

const LEARNED_SKILL_ID = "local-skill-00000000-0000-4000-8000-000000000002";
/** The drafts that the reviews saved, in order. */
const learned: { agentId: string; draft: LearnedSkillDraft }[] = [];
/** True makes the next saves fail, as a failed install does. */
let saveFails = false;
/** Saves as the local library does: a new skill gets revision 1, a change the next revision. */
const SKILL_LEARNER: SkillLearner = {
  read: (skillId) =>
    skillId === LOCAL_SKILL_ID
      ? Effect.succeed({
          description: "How the user wants release notes.",
          instructions: "Write release notes as a short list.",
          revision: 1,
        })
      : Effect.fail(new Error("No such skill.")),
  save: (agentId, draft) =>
    saveFails
      ? Effect.fail(new Error("The install failed."))
      : Effect.sync((): SkillConversationEvent => {
          learned.push({ agentId, draft });
          return draft.action === "create"
            ? { action: "created", skillId: LEARNED_SKILL_ID, revision: 1, skillName: draft.name }
            : { action: "revised", skillId: draft.skillId, revision: 2, skillName: "Release notes" };
        }),
};

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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
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

/** The prompts of the generations that write a learned skill. */
function writers(): string[] {
  return logged("writer").map((entry) => entry.text);
}

/** The answer of the next skill writer generations. */
function writer(answer: unknown) {
  writeFileSync(writerPath, JSON.stringify({ answer: typeof answer === "string" ? answer : JSON.stringify(answer) }));
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
writer("Not JSON.");
/** The app setting, as main reads it at each use. */
let reviewInterval = 20;
/** The server setting. "ask" keeps the earlier skill checks as they were. */
let skillLearningMode: SkillLearningMode = "ask";
const events: AgentEvent[] = [];
/** The service on the profile. Check 16 starts it again, as an app restart does. */
/** The steps of "Learn from my browsing", on a file of the profile, as the host keeps them. */
const browsingFile = join(userData, "openbot-browsing-steps-v1.json");
let browsingNow = Date.now();
const userBrowsing = new UserBrowsingLog(browsingFile, () => browsingNow);

function open() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    memoryReviewIdleMs: IDLE_MS,
    memoryReviewInterval: () => reviewInterval,
    reviewSkills: () => Effect.succeed(REVIEW_SKILLS),
    localSkillTools: () => LOCAL_SKILL_TOOLS,
    skillLearning: () => skillLearningMode,
    skillLearner: () => SKILL_LEARNER,
    userBrowsing,
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  });
  service.on("event", (event) => events.push(event));
  return { database, store, mailbox, service };
}
let { database, store, mailbox, service } = open();
/** Stops the service and starts it again on the same profile. */
async function restart(edit?: () => void) {
  await runCauseEffect(service.stop());
  database.close();
  edit?.();
  ({ database, store, mailbox, service } = open());
  await runCauseEffect(service.initialize());
}

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

/** The skill questions of reviews in the agent's chat, as the database holds them. */
function suggestionLines(agentId: string) {
  const threadId = store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
  return database
    .readConversation(agentId, threadId)
    .messages.filter((message) => message.itemType?.startsWith("skill-suggestion:"));
}

/** The skills that reviews saved, as the chat of the agent shows them. */
function learnedLines(agentId: string) {
  const threadId = store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
  return database
    .readConversation(agentId, threadId)
    .messages.filter(
      (message) => message.itemType?.startsWith("skill-event:") && message.turnId?.startsWith("memory-review-"),
    );
}

/** The prompt of the agent turn that sent `text`. */
function turnPrompt(text: string) {
  return logged("turn").find((entry) => entry.text.includes(text))?.text ?? "";
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

  await check("after a restart, a review reads only the messages after its saved cursor", async () => {
    await restart();
    reviewInterval = 3;
    control({ operations: [] });
    const count = reviews().length;
    // The first message and two more are the three turns of one review.
    const saved = await createAgent("Saved");
    await chat(saved.id, 2, "Saved old");
    await reviewed(count + 1);
    const unsaved = await createAgent("Unsaved");
    await chat(unsaved.id, 2, "Unsaved old");
    await reviewed(count + 2);
    const cursors = join(userData, "memory-review-cursors.json");
    const stored = await waitFor("the saved cursors", () => {
      try {
        const value = JSON.parse(readFileSync(cursors, "utf8"));
        const ids = value.cursors.map((cursor: { agentId: string }) => cursor.agentId);
        return ids.includes(saved.id) && ids.includes(unsaved.id) && value;
      } catch {
        return null;
      }
    });
    // The second agent has no saved cursor after the restart, as with the release before this change.
    await restart(() =>
      writeFileSync(
        cursors,
        JSON.stringify({
          ...stored,
          cursors: stored.cursors.filter((cursor: { agentId: string }) => cursor.agentId !== unsaved.id),
        }),
      ),
    );
    const before = reviews().length;
    await chat(saved.id, 3, "Saved new");
    await reviewed(before + 1);
    await chat(unsaved.id, 3, "Unsaved new");
    await reviewed(before + 2);
    const [withCursor = "", withoutCursor = ""] = reviews().slice(before);
    assert.ok(withCursor.includes("Saved new message 3."), "The review reads the new messages.");
    assert.ok(!withCursor.includes("Saved old message"), "A saved cursor skips the reviewed messages.");
    assert.ok(withoutCursor.includes("Unsaved old message 1."), "No cursor reads the latest messages again.");
    return { withCursorCharacters: withCursor.length, withoutCursorCharacters: withoutCursor.length };
  });

  const learner = await createAgent("Learner");
  const question =
    "I learned that a Worker deploy must wait for the D1 migration. Should I save it as the skill Cloudflare Worker deploys?";
  await check("a review asks once to save a skill, and the next message brings the question", async () => {
    const count = reviews().length;
    control({
      operations: [],
      skill: { action: "create", name: "Cloudflare Worker deploys", message: question },
    });
    await chat(learner.id, 2, "Learner deploy");
    await reviewed(count + 1);
    const line = await waitFor("the skill question", () => suggestionLines(learner.id)[0]);
    assert.equal(line.itemType, "skill-suggestion:create");
    assert.equal(line.text, question);
    assert.equal(line.skillSuggestion?.name, "Cloudflare Worker deploys", "The card has the skill name.");
    assert.equal(memoryLines(learner.id).length, 0, "No memory line shows.");
    const prompt = reviews().at(-1) ?? "";
    assert.ok(prompt.includes(`"id":"${LOCAL_SKILL_ID}"`), "The prompt lists the local skill.");
    assert.ok(/"name":"Release notes"[^}]*"canUpdate":true/.test(prompt), "A local skill can take an update.");
    assert.ok(/"name":"Docs style"[^}]*"canUpdate":false/.test(prompt), "A Marketplace skill cannot.");
    assert.ok(prompt.includes("<work_steps>"), "The prompt has the work steps.");
    assert.ok(prompt.includes("<earlier_skill_questions>\n[]\n"), "No question came before.");
    control({ operations: [] });
    await send(learner.id, "Yes, save it.");
    const agreed = turnPrompt("Yes, save it.");
    assert.ok(agreed.includes("--- suggestion ---"), "The answer brings the question.");
    assert.ok(agreed.includes(question), "The question is in the agent's input.");
    assert.ok(agreed.includes("create_skill"), "The note names the tool.");
    assert.ok(!agreed.includes("<reviewed_chat>"), "The provider still has the chat, so the note does not repeat it.");
    await send(learner.id, "Thanks.");
    assert.ok(!turnPrompt("Thanks.").includes("--- suggestion ---"), "A later message has no note.");
    await send(learner.id, "One more thing.");
    await reviewed(count + 2);
    assert.ok((reviews().at(-1) ?? "").includes(question), "A later review sees the earlier question.");
    assert.equal(suggestionLines(learner.id).length, 1, "The empty answer asks nothing.");
    return { agreedCharacters: agreed.length };
  });

  await check("a suggestion that does not fit is dropped, and the memory changes apply", async () => {
    const answers = [
      {
        text: "The user deploys on Fridays.",
        skill: { action: "update", skillId: "docs-style", name: "Docs style", message: "Add it to Docs style?" },
      },
      {
        text: "The user deploys from main.",
        skill: {
          action: "update",
          skillId: "local-skill-00000000-0000-4000-8000-000000000009",
          name: "Gone",
          message: "Add it to Gone?",
        },
      },
      {
        text: "The user reads release notes.",
        skill: { action: "create", name: "release notes", message: "Save it as release notes?" },
      },
      { text: "The user tags releases.", skill: { action: "delete", name: "Bad", message: "Delete it?" } },
    ];
    for (const answer of answers) {
      const count = reviews().length;
      control({ operations: [{ type: "add", text: answer.text, inclusion: "searchable" }], skill: answer.skill });
      await chat(learner.id, 3, `Learner ${answer.text}`);
      await reviewed(count + 1);
      await waitFor(`the memory "${answer.text}"`, () =>
        service.listMemories(learner.id).find((memory) => memory.text === answer.text),
      );
    }
    await settle();
    assert.equal(suggestionLines(learner.id).length, 1, "No other question shows.");
    return { dropped: answers.length };
  });

  await check("after a clear, the answer to a skill question brings the cleared chat", async () => {
    control({ operations: [] });
    const before = reviews().length;
    const clearer = await createAgent("Clearer");
    await chat(clearer.id, 2, "Clearer table");
    /* The interval review must end first: when it starts late, it reads the next turn, and the clear has nothing new. */
    await reviewed(before + 1);
    await send(clearer.id, "Clearer table message 3.");
    const count = reviews().length;
    control({
      operations: [],
      skill: {
        action: "create",
        name: "CSV tables",
        message: "Should I save the table method as the skill CSV tables?",
      },
    });
    await runCauseEffect(service.clearAgentContext(clearer.id));
    await reviewed(count + 1);
    await waitFor("the skill question after the clear", () => suggestionLines(clearer.id)[0]);
    control({ operations: [] });
    await send(clearer.id, "Yes, save the table method.");
    const agreed = turnPrompt("Yes, save the table method.");
    assert.ok(agreed.includes("--- suggestion ---"), "The answer brings the question.");
    assert.ok(agreed.includes("<reviewed_chat>"), "The note repeats the cleared chat.");
    assert.ok(agreed.includes("Clearer table message 1."), "The first message of the cleared chat is in it.");
    assert.ok(agreed.includes("Clearer table message 3."), "The last message of the cleared chat is in it.");
    assert.ok(!agreed.includes("Learner deploy"), "No other agent's chat is in it.");
    return { agreedCharacters: agreed.length };
  });

  await check("an update question names the skill from the library, not the model's name", async () => {
    const updater = await createAgent("Updater");
    const count = reviews().length;
    control({
      operations: [],
      skill: {
        action: "update",
        skillId: LOCAL_SKILL_ID,
        name: "Notes",
        message: "Add the tag rule to Release notes?",
      },
    });
    await chat(updater.id, 2, "Updater notes");
    await reviewed(count + 1);
    const line = await waitFor("the update question", () => suggestionLines(updater.id)[0]);
    assert.equal(line.itemType, `skill-suggestion:update:${LOCAL_SKILL_ID}`);
    assert.equal(line.skillSuggestion?.name, "Release notes", "The card names the library skill.");
    control({ operations: [] });
    return { name: line.skillSuggestion?.name };
  });

  await check("no update question for a skill that the agent revised in the reviewed turns", async () => {
    const reviser = await createAgent("Reviser");
    const count = reviews().length;
    control({
      operations: [],
      skill: {
        action: "update",
        skillId: LOCAL_SKILL_ID,
        name: "Release notes",
        message: "Add the tag rule to Release notes?",
      },
    });
    await send(
      reviser.id,
      `Fix the tag rule. ${calls({ tool: "revise_skill", arguments: { skillId: LOCAL_SKILL_ID, expectedRevision: 1, sourcePath: "notes" } })}`,
    );
    await chat(reviser.id, 1, "Reviser notes");
    await reviewed(count + 1);
    await settle();
    const threadId = store.list().find((agent) => agent.id === reviser.id)?.threadId ?? null;
    const revised = database
      .readConversation(reviser.id, threadId)
      .messages.filter((message) => message.itemType === `skill-event:revised:${LOCAL_SKILL_ID}:2`);
    assert.equal(revised.length, 1, "The chat shows the revised skill.");
    assert.equal(suggestionLines(reviser.id).length, 0, "The review does not ask to change it again.");
    control({ operations: [] });
    return { revisedLines: revised.length };
  });

  const WORKER_SKILL = {
    description: "Deploys a Cloudflare Worker after its D1 migration.",
    instructions: "1. Run the D1 migration.\n2. Deploy the Worker.",
  };
  await check("ask first: Save writes the skill in the background, with no agent turn", async () => {
    const asker = await createAgent("Asker");
    let count = reviews().length;
    const lesson = "Should I save the D1 step before a Worker deploy as the skill Worker deploys?";
    control({ operations: [], skill: { action: "create", name: "Worker deploys", message: lesson } });
    await send(asker.id, `My deploy token is ${SECRET}.`);
    await chat(asker.id, 1, "Asker deploy");
    await reviewed(count + 1);
    const question = await waitFor("the skill question", () => suggestionLines(asker.id)[0]);
    control({ operations: [] });
    const turns = logged("turn").length;
    const writes = writers().length;
    const saves = learned.length;
    writer(WORKER_SKILL);
    const save = (messageId: string) => runCauseEffect(service.saveSkillSuggestion({ agentId: asker.id, messageId }));
    const [first, second] = await Promise.all([save(question.id), save(question.id)]);
    assert.deepEqual([first, second], [{ saved: true }, { saved: true }], "Both presses report the save.");
    const line = await waitFor("the saved skill line", () => learnedLines(asker.id)[0]);
    assert.equal(line.itemType, `skill-event:created:${LEARNED_SKILL_ID}:1`);
    assert.equal(writers().length, writes + 1, "One writer ran for two presses.");
    assert.equal(learned.length, saves + 1, "The skill was saved once.");
    assert.deepEqual(learned.at(-1), {
      agentId: asker.id,
      draft: { action: "create", name: "Worker deploys", ...WORKER_SKILL },
    });
    assert.equal(logged("turn").length, turns, "No agent turn ran.");
    const prompt = writers().at(-1) ?? "";
    assert.ok(prompt.includes(JSON.stringify(lesson)), "The writer reads the question.");
    assert.ok(prompt.includes("Asker deploy message 1."), "The writer reads the chat.");
    assert.ok(!prompt.includes(SECRET), "The writer prompt has no secret.");
    assert.deepEqual(await save(question.id), { saved: true }, "A later press sees the saved skill.");
    assert.equal(writers().length, writes + 1, "A later press writes nothing.");
    assert.deepEqual(await save("message-gone"), { saved: false }, "A message that is not there saves nothing.");
    await send(asker.id, "Thanks.");
    assert.ok(!turnPrompt("Thanks.").includes("--- suggestion ---"), "The next message brings no question.");

    count = reviews().length;
    control({
      operations: [],
      skill: {
        action: "update",
        skillId: LOCAL_SKILL_ID,
        name: "Notes",
        message: "Tag each release before the notes?",
      },
    });
    await chat(asker.id, 2, "Asker notes");
    await reviewed(count + 1);
    const update = await waitFor("the update question", () => suggestionLines(asker.id)[1]);
    control({ operations: [] });
    const revised = { description: "How the user wants release notes.", instructions: "Tag each release first." };
    writer(revised);
    const turnsBeforeUpdate = logged("turn").length;
    assert.deepEqual(await save(update.id), { saved: true });
    const revisedLine = await waitFor("the revised skill line", () => learnedLines(asker.id)[1]);
    assert.equal(revisedLine.itemType, `skill-event:revised:${LOCAL_SKILL_ID}:2`);
    assert.deepEqual(learned.at(-1)?.draft, {
      action: "update",
      skillId: LOCAL_SKILL_ID,
      expectedRevision: 1,
      ...revised,
    });
    assert.ok((writers().at(-1) ?? "").includes("<current_skill>"), "The writer reads the current skill.");
    assert.equal(logged("turn").length, turnsBeforeUpdate, "No agent turn ran for the update.");

    count = reviews().length;
    control({
      operations: [],
      skill: { action: "create", name: "Invoice export", message: "Save the invoice export?" },
    });
    await chat(asker.id, 3, "Asker invoice");
    await reviewed(count + 1);
    const failing = await waitFor("the third question", () => suggestionLines(asker.id)[2]);
    control({ operations: [] });
    writer("Not JSON.");
    assert.deepEqual(await save(failing.id), { saved: false }, "A bad writer answer lets the card send the yes.");
    assert.equal(learnedLines(asker.id).length, 2, "No saved skill line shows.");
    await send(asker.id, "Yes, save it.");
    assert.ok(turnPrompt("Yes, save it.").includes("--- suggestion ---"), "The yes still brings the question.");
    return { writerCharacters: prompt.length };
  });

  await check("automatic: a review saves the skill it learns and shows it, with no question", async () => {
    skillLearningMode = "automatic";
    const auto = await createAgent("Automatic");
    const count = reviews().length;
    const writes = writers().length;
    const lesson = "A Worker deploy must wait for the D1 migration.";
    writer(WORKER_SKILL);
    control({ operations: [], skill: { action: "create", name: "Worker deploys", message: lesson } });
    await send(auto.id, `My deploy token is ${SECRET}.`);
    await chat(auto.id, 1, "Automatic deploy");
    await reviewed(count + 1);
    const line = await waitFor("the saved skill line", () => learnedLines(auto.id)[0]);
    assert.equal(line.itemType, `skill-event:created:${LEARNED_SKILL_ID}:1`);
    assert.equal(line.text, "Worker deploys");
    assert.equal(suggestionLines(auto.id).length, 0, "No question shows.");
    assert.deepEqual(learned.at(-1), {
      agentId: auto.id,
      draft: { action: "create", name: "Worker deploys", ...WORKER_SKILL },
    });
    assert.ok(
      (reviews().at(-1) ?? "").includes("First decide whether to save a skill."),
      "The review saves, not asks.",
    );
    assert.equal(writers().length, writes + 1, "One writer ran.");
    const prompt = writers().at(-1) ?? "";
    assert.ok(prompt.includes(JSON.stringify(lesson)), "The writer reads the lesson.");
    assert.ok(prompt.includes("Automatic deploy message 1."), "The writer reads the chat.");
    assert.ok(!prompt.includes(SECRET), "The writer prompt has no secret.");
    assert.ok(!prompt.includes("<current_skill>"), "A new skill has no current text.");
    control({ operations: [] });
    await send(auto.id, "Thanks.");
    assert.ok(!turnPrompt("Thanks.").includes("--- suggestion ---"), "The next message brings no question.");
    await chat(auto.id, 2, "Automatic later");
    await reviewed(count + 2);
    const later = reviews().at(-1) ?? "";
    assert.ok(
      later.includes("Saved a change to the skill") && later.includes("Worker deploys"),
      "A later review sees it.",
    );
    return { writerCharacters: prompt.length };
  });

  await check("automatic: a review revises a local skill from its current text", async () => {
    const improver = await createAgent("Improver");
    const count = reviews().length;
    const revised = {
      description: "How the user wants release notes.",
      instructions: "Write release notes as a short list.\nTag each release first.",
    };
    writer(revised);
    control({
      operations: [],
      skill: {
        action: "update",
        skillId: LOCAL_SKILL_ID,
        name: "Notes",
        message: "Tag each release before the notes.",
      },
    });
    await chat(improver.id, 2, "Improver notes");
    await reviewed(count + 1);
    const line = await waitFor("the revised skill line", () => learnedLines(improver.id)[0]);
    assert.equal(line.itemType, `skill-event:revised:${LOCAL_SKILL_ID}:2`);
    assert.equal(line.text, "Release notes", "The line names the library skill.");
    assert.deepEqual(learned.at(-1)?.draft, {
      action: "update",
      skillId: LOCAL_SKILL_ID,
      expectedRevision: 1,
      ...revised,
    });
    const prompt = writers().at(-1) ?? "";
    assert.ok(prompt.includes("<current_skill>"), "The writer reads the current skill.");
    assert.ok(prompt.includes("Write release notes as a short list."), "It has the current instructions.");
    control({ operations: [] });
    return { writerCharacters: prompt.length };
  });

  await check("automatic: the next lesson revises a skill that an earlier review saved in the same chat", async () => {
    const improver = store.list().find((agent) => agent.name === "Improver");
    assert.ok(improver, "The agent of the last check is there.");
    const count = reviews().length;
    writer({ description: "How the user wants release notes.", instructions: "Write release notes as a short list." });
    control({
      operations: [],
      skill: { action: "update", skillId: LOCAL_SKILL_ID, name: "Notes", message: "Link each issue in the notes." },
    });
    await chat(improver.id, 3, "Improver links");
    await reviewed(count + 1);
    const lines = await waitFor("the second revised skill line", () => {
      const all = learnedLines(improver.id);
      return all.length === 2 ? all : undefined;
    });
    assert.equal(suggestionLines(improver.id).length, 0, "No question shows.");
    control({ operations: [] });
    return { revisedLines: lines.length };
  });

  await check("automatic: when the writer or the save fails, the review asks the user instead", async () => {
    const fallback = await createAgent("Fallback");
    const saves = learned.length;
    let count = reviews().length;
    writer("Not JSON.");
    control({
      operations: [],
      skill: { action: "create", name: "Invoice export", message: "Should I save the invoice export as a skill?" },
    });
    await chat(fallback.id, 2, "Fallback invoice");
    await reviewed(count + 1);
    const first = await waitFor("the question after a bad writer answer", () => suggestionLines(fallback.id)[0]);
    assert.equal(first.itemType, "skill-suggestion:create");
    count = reviews().length;
    writer(WORKER_SKILL);
    saveFails = true;
    control({
      operations: [],
      skill: { action: "create", name: "Invoice reminders", message: "Should I save the reminders as a skill?" },
    });
    await chat(fallback.id, 3, "Fallback reminder");
    await reviewed(count + 1);
    const second = await waitFor("the question after a failed save", () => suggestionLines(fallback.id)[1]);
    saveFails = false;
    assert.equal(second.skillSuggestion?.name, "Invoice reminders");
    assert.equal(learnedLines(fallback.id).length, 0, "No saved skill shows.");
    assert.equal(learned.length, saves, "Nothing was saved.");
    control({ operations: [] });
    return { questions: suggestionLines(fallback.id).length };
  });

  await check("off: a review does not look for skills", async () => {
    skillLearningMode = "off";
    const quiet = await createAgent("Quiet");
    const count = reviews().length;
    const writes = writers().length;
    control({
      operations: [{ type: "add", text: "The user exports invoices on Mondays.", inclusion: "searchable" }],
      skill: { action: "create", name: "Invoice export", message: "Should I save the invoice export as a skill?" },
    });
    await chat(quiet.id, 2, "Quiet invoice");
    await reviewed(count + 1);
    await waitFor("the memory of the review", () =>
      service.listMemories(quiet.id).find((memory) => memory.text === "The user exports invoices on Mondays."),
    );
    await settle();
    assert.ok(!(reviews().at(-1) ?? "").includes("<earlier_skill_questions>"), "The prompt asks for no skill.");
    assert.equal(suggestionLines(quiet.id).length, 0, "No question shows.");
    assert.equal(learnedLines(quiet.id).length, 0, "No skill is saved.");
    assert.equal(writers().length, writes, "No writer ran.");
    control({ operations: [] });
    return { memories: service.listMemories(quiet.id).length };
  });

  await check("a turn in which the agent saves a memory stays in the review that looks for skills", async () => {
    skillLearningMode = "automatic";
    const saver = await createAgent("Saver");
    const count = reviews().length;
    control({ operations: [] });
    await send(
      saver.id,
      `Run the D1 step before the deploy. ${calls({ tool: "remember", arguments: { text: "The user deploys Workers." } })}`,
    );
    await chat(saver.id, 3, "Saver");
    await reviewed(count + 1);
    assert.ok(
      (reviews().at(-1) ?? "").includes("Run the D1 step before the deploy."),
      "The review reads the turn with the memory save.",
    );
    return { reviews: reviews().length };
  });

  await check("a review adds a site memory, keeps a fact whose site is bad or null, and shows each site", async () => {
    const browsing = await createAgent("Browsing");
    const count = reviews().length;
    control({
      operations: [
        {
          type: "add",
          text: "Example login: the Continue button is below the cookie banner.",
          inclusion: "searchable",
          site: "https://www.Example.com/login",
        },
        { type: "add", text: "The status page lists outages first.", inclusion: "searchable", site: "not a host" },
        // A model can write null for a general memory.
        { type: "add", text: "Reports are due on Fridays.", inclusion: "searchable", site: null },
      ],
    });
    await send(
      browsing.id,
      `Log in to example.com. ${calls({ tool: "remember", arguments: { text: "Docs search is in the top bar.", site: "docs.example.org" } })}`,
    );
    await chat(browsing.id, 3, "Browsing");
    await reviewed(count + 1);
    const memories = await waitFor("the memories of the review", () => {
      const list = service.listMemories(browsing.id);
      return list.length === 4 ? list : null;
    });
    const site = (text: string) => memories.find((memory) => memory.text === text)?.site;
    assert.equal(site("Example login: the Continue button is below the cookie banner."), "example.com");
    assert.equal(site("The status page lists outages first."), undefined, "A bad site is dropped, not the fact.");
    assert.equal(site("Reports are due on Fridays."), undefined, "A null site makes a general memory.");
    assert.equal(site("Docs search is in the top bar."), "docs.example.org", "The agent's own save keeps its site.");
    assert.ok((reviews().at(-1) ?? "").includes('"site":"docs.example.org"'), "The review shows the site.");
    control({ operations: [] });
    return { memories: memories.length };
  });

  await check("a review learns from the user's browsing steps, redacted, and deletes them", async () => {
    const learner = await createAgent("Learner");
    // A step from 31 days ago, then the steps of today.
    browsingNow = Date.now() - USER_BROWSING_RETENTION_MS - 24 * 60 * 60 * 1000;
    await Effect.runPromise(userBrowsing.record(learner.id, { kind: "page", host: "old.example", path: "/gone" }));
    browsingNow = Date.now();
    const steps = [
      { kind: "page", host: "shop.example", path: "/cart", title: "Your cart" },
      { kind: "click", host: "shop.example", path: "/cart", role: "button", name: "Proceed to checkout" },
      { kind: "click", host: "shop.example", path: "/checkout", role: "textbox", name: `Code ${SECRET}` },
    ] as const;
    for (const step of steps) await Effect.runPromise(userBrowsing.record(learner.id, step));
    // A new log on the same file reads the saved steps.
    const reloaded = new UserBrowsingLog(browsingFile);
    const pendingBefore = await Effect.runPromise(reloaded.pending(learner.id));
    assert.deepEqual(
      pendingBefore.map((step) => step.host),
      ["shop.example", "shop.example", "shop.example"],
      "The step older than 30 days is deleted.",
    );
    assert.ok(!readFileSync(browsingFile, "utf8").includes("old.example"), "The file has no old step.");
    const count = reviews().length;
    control({
      operations: [
        {
          type: "add",
          text: "Shop checkout: Proceed to checkout is on the cart page.",
          inclusion: "searchable",
          site: "shop.example",
        },
      ],
    });
    await chat(learner.id, 3, "Learner");
    await reviewed(count + 1);
    const prompt = reviews().at(-1) ?? "";
    assert.ok(prompt.includes("<user_browsing>"), "The review prompt has the browsing steps.");
    assert.ok(prompt.includes("Proceed to checkout"), "The prompt has the name of the clicked control.");
    assert.ok(prompt.includes("/cart"), "The prompt has the path.");
    assert.ok(!prompt.includes(SECRET), "The secret in a step is redacted.");
    assert.ok(!prompt.includes("old.example"), "The prompt has no old step.");
    const memory = await waitFor("the site memory from browsing", () =>
      service.listMemories(learner.id).find((entry) => entry.site === "shop.example"),
    );
    assert.equal(memory.text, "Shop checkout: Proceed to checkout is on the cart page.");
    // The review deletes the steps it read before it applies the memory changes.
    const pendingAfter = await Effect.runPromise(userBrowsing.pending(learner.id));
    assert.equal(pendingAfter.length, 0, "The review deletes the steps it read.");
    assert.ok(!readFileSync(browsingFile, "utf8").includes("shop.example"), "The file has no read step.");
    await chat(learner.id, 3, "Learner again");
    await reviewed(count + 2);
    assert.ok(!(reviews().at(-1) ?? "").includes("<user_browsing>"), "The next review has no browsing steps.");
    await Effect.runPromise(userBrowsing.clear());
    control({ operations: [] });
    return { steps: pendingBefore.length };
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
