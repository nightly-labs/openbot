// Checks that a queue change writes no unchanged chat rows again. Runs the real SQLite, mailbox
// store, conversation runtime and mailbox sync on a temporary profile. The chat has more messages
// than the 100 the runtime keeps. Before them in the display order are a queued message from the
// user, a request whose delivery still shows running, and a completed message that the agent sent
// in that request's turn. Each round changes the chat, then a queue change syncs the mailbox.
// Before the fix, the runtime dropped the mailbox messages again after each sync, so each queue
// change wrote them again and sent the whole chat.
//
// The cases:
// - `message-limit`: a provider update adds an answer each round.
// - `byte-limit`: the answers are larger than the 8 MiB that the runtime keeps of one chat.
// - `provider-read`: each round, a provider read replaces the chat with one that has no mailbox
//   messages, so the cache has no record of them.
// - `request-turns`: each answer has the user's request before it, and the chat is over 8 MiB. The
//   trim must remove each old request with its answer, so that no request stays without its answer.
// - `mailbox-limit`: a request still shows running, and more than 100 requests come after it. The
//   chat must keep only the newest 100 completed requests, as many as mailbox sync reads.
// - `total-budget`: the least recently used chat has a turn that runs and only a mailbox message to
//   trim. Idle chats then go over the limit of all chats. The idle chats must still be removed.
// No app, provider, account or network is started.
//
// Run: bun scripts/conversation-mailbox-rewrite-e2e.ts
// Writes .openbot-build/conversation-mailbox-rewrite-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Scope } from "effect";
import {
  CONVERSATION_CACHE_BYTES_LIMIT,
  CONVERSATION_CACHE_TOTAL_BYTES_LIMIT,
  ConversationRuntime,
} from "../src/backend/agent/conversation-runtime";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MAILBOX_CONVERSATION_MESSAGE_LIMIT, MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

const OUT = resolve(import.meta.dirname, "../.openbot-build/conversation-mailbox-rewrite-e2e");
/** More than `CONVERSATION_SNAPSHOT_MESSAGE_LIMIT`, so the runtime keeps only part of the chat. */
const SEEDED_TURNS = 120;
const ROUNDS = 12;
const TIMED_QUEUE_CHANGES = 50;

type CaseName = "message-limit" | "byte-limit" | "provider-read" | "request-turns" | "mailbox-limit" | "total-budget";

interface Round {
  round: number;
  changeWrites: string[];
  queueChangeWrites: string[];
  queueChangeConversationEvents: number;
  cachedMessages: number;
  keepsMailboxMessages: boolean;
}

interface CaseReport {
  name: CaseName;
  checks: string[];
  rounds: Round[];
  passed: boolean;
  /** The time of one queue change that changes nothing, after the rounds. */
  unchangedQueueChangeMs?: number;
  /** Warnings that a chat was sent again with no stored change. */
  loopWarnings?: number;
  /** In `request-turns`, the turns that stay in memory. */
  turnsKept?: string;
  /** In `mailbox-limit`, the requests that stay in memory. */
  requestsKept?: string;
  /** In `total-budget`, the idle chats that stay in memory. */
  idleChatsKept?: string;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };

// The runtime writes its warnings to stderr. Count the one that shows the loop.
const LOOP_WARNING = "[conversation-runtime] A chat was sent again with no stored change";
let loopWarnings = 0;
const writeStderr = process.stderr.write;
Object.defineProperty(process.stderr, "write", {
  configurable: true,
  writable: true,
  value: (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
    callback?: (error?: Error | null) => void,
  ): boolean => {
    if (String(chunk).includes(LOOP_WARNING)) loopWarnings += 1;
    return writeStderr.call(process.stderr, chunk, encoding, callback);
  },
});

function assistantMessage(turn: string, createdAt: string, text: string): ConversationMessage {
  // Mailbox sync sets the reactions of each message. Seed them, so only a real change differs.
  return {
    id: `${turn}-answer`,
    turnId: turn,
    author: "assistant",
    text,
    createdAt,
    status: "completed",
    reactions: [],
    reaction: null,
  };
}

/** The ISO time 1 ms after `iso`. */
function after(iso: string): string {
  return new Date(Date.parse(iso) + 1).toISOString();
}

/** The real runtime, mailbox and mailbox sync on a temporary profile. */
async function startRuntime() {
  const root = await mkdtemp(join(tmpdir(), "openbot-conversation-rewrite-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  const events: AgentEvent[] = [];
  const conversation = new ConversationRuntime(
    store,
    (event) => events.push(event),
    () => store.list(),
  );
  const timer = new RoutineTimer(
    () => [],
    () => false,
    () => {},
  );
  const waits = new AgentWaits({
    store: new AgentWaitStore({ database }),
    mailbox,
    hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
  });
  const routines = new RoutineScheduler({
    store,
    mailbox,
    conversation,
    timer,
    waits,
    timezone: () => "UTC",
    hooks: {
      emit: () => {},
      emitError: () => {},
      emitQueue: () => {},
      scheduleDrain: () => {},
      interrupt: () => Effect.void,
      awaitDrain: () => undefined,
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      isRunning: () => false,
      usageLimited: () => false,
    },
  });
  const scope = Scope.makeUnsafe();
  const sync = new MailboxSync({
    database,
    mailbox,
    conversation,
    routines,
    scope: () => scope,
    hooks: { emit: () => {}, emitError: () => {}, queueHold: () => null },
  });

  // Records the message ids of each conversation write.
  const writes: string[][] = [];
  const persistConversationChanges = database.persistConversationChanges.bind(database);
  database.persistConversationChanges = (input) => {
    writes.push(input.changedMessages.map((message) => message.id));
    return persistConversationChanges(input);
  };

  const close = async (): Promise<void> => {
    timer.dispose();
    conversation.dispose();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    database.close();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
  } catch (error) {
    await close();
    throw error;
  }
  return { store, mailbox, conversation, sync, events, writes, close };
}

async function runCase(name: CaseName, result: CaseReport): Promise<void> {
  const firstLoopWarning = loopWarnings;
  const { store, mailbox, conversation, sync, events, writes, close } = await startRuntime();
  try {
    const agent = await runCauseEffect(
      store.createAgent({ name: "Writer", description: "Gets queued work", avatarSeed: "rewrite-a", avatarHue: null }),
    );
    const teammate = await runCauseEffect(
      store.createAgent({ name: "Reviewer", description: "Gets sent work", avatarSeed: "rewrite-b", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);

    // The user's message stays queued, so mailbox sync always adds it back.
    const queued = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Queued request" }),
    );
    const queuedDeliveryId = queued.deliveries[0]?.id;
    assert.ok(queuedDeliveryId);
    // The provider finished this turn, but the delivery still shows running.
    const running = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Old request" }),
    );
    const runningDeliveryId = running.deliveries[0]?.id;
    assert.ok(runningDeliveryId);
    await runCauseEffect(mailbox.markStarting(runningDeliveryId));
    await runCauseEffect(mailbox.markRunning(runningDeliveryId, "turn-0"));
    const runningAt = mailbox
      .conversationMessages(agent.id)
      .find((message) => message.id === runningDeliveryId)?.createdAt;
    assert.ok(runningAt);
    // The seeded answers come after both requests, so the requests sort before the last 100.
    const answeredAt = after(runningAt);
    while (new Date().toISOString() <= answeredAt) await Promise.resolve();

    // Sent in the old turn: the turn sorts before the window, but this message's time is in it.
    const sent = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: agent.id },
        recipientAgentIds: [teammate.id],
        text: "Please review",
        idempotencyKey: `send:turn-0:${crypto.randomUUID()}`,
      }),
    );
    const sentDeliveryId = sent.deliveries[0]?.id;
    assert.ok(sentDeliveryId);
    await runCauseEffect(mailbox.markStarting(sentDeliveryId));
    await runCauseEffect(mailbox.markTerminal(sentDeliveryId, "completed"));
    const mailboxIds = [queuedDeliveryId, runningDeliveryId, `outbox-${sent.messageId}`];

    // In `byte-limit`, all answers together are 1.5 times the limit of one chat.
    const answerText =
      name === "byte-limit" ? "x".repeat(Math.ceil((CONVERSATION_CACHE_BYTES_LIMIT * 1.5) / SEEDED_TURNS)) : null;
    const seeded: ConversationSnapshot = {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: Array.from({ length: SEEDED_TURNS }, (_, index) =>
        assistantMessage(`turn-${index + 1}`, answeredAt, answerText ?? `Answer ${index + 1}`),
      ),
    };
    conversation.emitConversation(seeded, "e2e.seeded", {});
    result.checks.push(`seeded ${SEEDED_TURNS} answers, a queued and a running request, 1 sent message`);

    for (let round = 0; round < ROUNDS; round += 1) {
      const snapshot = conversation.snapshot(agent.id);
      assert.ok(snapshot);
      let first = writes.length;
      if (name === "provider-read") {
        // The provider's copy has the same answers, one with new text, and no mailbox messages.
        const read = structuredClone(snapshot);
        read.messages = read.messages.filter((message) => !mailboxIds.includes(message.id));
        const edited = read.messages.at(-1);
        assert.ok(edited);
        edited.text = `Edited ${round}`;
        conversation.setSnapshot(agent.id, read);
      } else {
        snapshot.messages.push(
          assistantMessage(`update-${round}`, new Date().toISOString(), answerText ?? `Update ${round}`),
        );
        conversation.emitConversation(snapshot, "e2e.provider-update", {});
      }
      const changeWrites = writes.slice(first).flat();

      first = writes.length;
      const firstEvent = events.length;
      sync.emitQueue(agent.id);
      const queueChangeWrites = writes.slice(first).flat();
      const cached = conversation.snapshot(agent.id);
      assert.ok(cached);
      const ids = new Set(cached.messages.map((message) => message.id));
      result.rounds.push({
        round,
        changeWrites,
        queueChangeWrites,
        queueChangeConversationEvents: events.slice(firstEvent).filter((event) => event.type === "conversation").length,
        cachedMessages: cached.messages.length,
        keepsMailboxMessages: mailboxIds.every((id) => ids.has(id)),
      });
    }

    for (const round of result.rounds) {
      assert.deepEqual(
        round.changeWrites,
        name === "provider-read" ? [] : [`update-${round.round}-answer`],
        `round ${round.round}: the change writes only its own message`,
      );
      assert.ok(round.keepsMailboxMessages, `round ${round.round}: the chat keeps the mailbox messages`);
    }
    result.checks.push("each change writes only its own message; the chat keeps the mailbox messages");

    const [firstRound, ...laterRounds] = result.rounds;
    assert.ok(firstRound);
    assert.deepEqual(
      [...firstRound.queueChangeWrites].sort(),
      [...mailboxIds].sort(),
      "The first queue change writes the mailbox messages once.",
    );
    for (const round of laterRounds) {
      assert.deepEqual(round.queueChangeWrites, [], `round ${round.round}: a queue change writes no unchanged rows`);
      // A provider read changes the chat, so the queue change that follows it sends the chat once.
      if (name !== "provider-read")
        assert.equal(round.queueChangeConversationEvents, 0, `round ${round.round}: a queue change sends no chat`);
    }
    result.checks.push(
      name === "provider-read"
        ? "later queue changes write no rows"
        : "later queue changes write no rows and send no chat",
    );
    const started = performance.now();
    for (let index = 0; index < TIMED_QUEUE_CHANGES; index += 1) sync.emitQueue(agent.id);
    result.unchangedQueueChangeMs = Number(((performance.now() - started) / TIMED_QUEUE_CHANGES).toFixed(3));
    result.loopWarnings = loopWarnings - firstLoopWarning;
    // Each round of the provider-read case reads the provider again, which sends the chat once.
    // A real provider read happens when a thread loads, not ten times a minute.
    if (name !== "provider-read") {
      assert.equal(result.loopWarnings, 0, "No warning that the chat is sent again with no stored change.");
      result.checks.push("no loop warning");
    }
    result.passed = true;
  } finally {
    await close();
  }
}

/** Requests and answers, together 1.5 times the limit of one chat. */
const REQUEST_TURNS = 40;

/** The ISO time after `iso`, read from the clock. */
async function nextTime(iso: string): Promise<string> {
  while (new Date().toISOString() <= iso) await Promise.resolve();
  return new Date().toISOString();
}

async function runRequestTurnsCase(result: CaseReport): Promise<void> {
  const { store, mailbox, conversation, sync, close } = await startRuntime();
  try {
    const agent = await runCauseEffect(
      store.createAgent({ name: "Answers", description: "Gets requests", avatarSeed: "turns", avatarHue: null }),
    );
    const text = "x".repeat(Math.ceil((CONVERSATION_CACHE_BYTES_LIMIT * 1.5) / REQUEST_TURNS));
    const answers: ConversationMessage[] = [];
    let last = new Date().toISOString();
    for (let index = 0; index < REQUEST_TURNS; index += 1) {
      const turn = `turn-${index}`;
      const request = await runCauseEffect(
        mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: `Request ${index}` }),
      );
      const deliveryId = request.deliveries[0]?.id;
      assert.ok(deliveryId);
      await runCauseEffect(mailbox.markStarting(deliveryId));
      await runCauseEffect(mailbox.markRunning(deliveryId, turn));
      await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
      const requestAt = mailbox.conversationMessages(agent.id).find((message) => message.id === deliveryId)?.createdAt;
      assert.ok(requestAt);
      last = await nextTime(requestAt > last ? requestAt : last);
      answers.push(assistantMessage(turn, last, text));
      last = await nextTime(last);
    }
    // A full read of the chat, as when it loads: each request, then its answer.
    const requests = mailbox.conversationMessages(agent.id);
    assert.equal(requests.length, REQUEST_TURNS, "Each request is in the mailbox.");
    conversation.emitConversation(
      {
        agentId: agent.id,
        threadId: store.ensureThreadIdNow(agent.id),
        activeTurnId: null,
        revision: 0,
        messages: [...requests, ...answers].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      },
      "e2e.chat-read",
      {},
    );
    sync.emitQueue(agent.id);
    const kept = conversation.loadedSnapshot(agent.id)?.messages ?? [];
    const keptTurns = (author: ConversationMessage["author"]): number[] =>
      kept.flatMap((message) =>
        message.author === author && message.turnId ? [Number(message.turnId.slice("turn-".length))] : [],
      );
    const keptRequests = keptTurns("user");
    const keptAnswers = keptTurns("assistant");
    result.turnsKept = `${keptAnswers.length} answers and ${keptRequests.length} requests of ${REQUEST_TURNS}`;
    assert.ok(keptAnswers.length < REQUEST_TURNS, "The 8 MiB limit removes old answers.");
    assert.deepEqual(
      keptRequests.filter((turn) => !keptAnswers.includes(turn)),
      [],
      "No request stays without its answer.",
    );
    const firstKept = REQUEST_TURNS - keptAnswers.length;
    assert.deepEqual(
      [...keptAnswers].sort((a, b) => a - b),
      Array.from({ length: keptAnswers.length }, (_, index) => firstKept + index),
      "The kept answers are the newest ones, with no gap.",
    );
    result.checks.push("the trim removes old requests with their answers; the kept turns have no gap");
    result.passed = true;
  } finally {
    await close();
  }
}

/** More completed requests than one mailbox read returns. */
const LATER_REQUESTS = 130;

async function runMailboxLimitCase(result: CaseReport): Promise<void> {
  const { store, mailbox, conversation, sync, events, writes, close } = await startRuntime();
  try {
    const agent = await runCauseEffect(
      store.createAgent({ name: "Requests", description: "Gets requests", avatarSeed: "limit", avatarHue: null }),
    );
    conversation.emitConversation(
      { agentId: agent.id, threadId: store.ensureThreadIdNow(agent.id), activeTurnId: null, revision: 0, messages: [] },
      "e2e.chat-start",
      {},
    );
    // The provider finished this turn, but the delivery still shows running.
    const running = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Old request" }),
    );
    const runningId = running.deliveries[0]?.id;
    assert.ok(runningId);
    await runCauseEffect(mailbox.markStarting(runningId));
    await runCauseEffect(mailbox.markRunning(runningId, "turn-old"));
    sync.emitQueue(agent.id);
    const requestIds: string[] = [];
    for (let index = 0; index < LATER_REQUESTS; index += 1) {
      const request = await runCauseEffect(
        mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: `Request ${index}` }),
      );
      const deliveryId = request.deliveries[0]?.id;
      assert.ok(deliveryId);
      requestIds.push(deliveryId);
      await runCauseEffect(mailbox.markStarting(deliveryId));
      await runCauseEffect(mailbox.markRunning(deliveryId, `turn-${index}`));
      await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
      sync.emitQueue(agent.id);
    }
    const keptIds = new Set(conversation.loadedSnapshot(agent.id)?.messages.map((message) => message.id));
    const keptRequests = requestIds.filter((id) => keptIds.has(id));
    result.requestsKept = `${keptRequests.length} of ${LATER_REQUESTS}`;
    assert.ok(keptIds.has(runningId), "The chat keeps the request that still shows running.");
    assert.deepEqual(
      keptRequests,
      requestIds.slice(-MAILBOX_CONVERSATION_MESSAGE_LIMIT),
      "The chat keeps only the newest completed requests that mailbox sync reads.",
    );
    result.checks.push("the chat keeps the running request and the newest 100 completed requests");
    const firstWrite = writes.length;
    const firstEvent = events.length;
    sync.emitQueue(agent.id);
    assert.deepEqual(writes.slice(firstWrite).flat(), [], "A queue change writes no unchanged rows.");
    assert.equal(
      events.slice(firstEvent).filter((event) => event.type === "conversation").length,
      0,
      "A queue change sends no chat.",
    );
    result.checks.push("a queue change writes no rows and sends no chat");
    result.passed = true;
  } finally {
    await close();
  }
}

/** Idle chats of about 7.5 MiB each, together more than the limit of all chats. */
const IDLE_CHATS = Math.ceil(CONVERSATION_CACHE_TOTAL_BYTES_LIMIT / (CONVERSATION_CACHE_BYTES_LIMIT * 0.9375)) + 1;

async function runBudgetCase(result: CaseReport): Promise<void> {
  const { store, mailbox, conversation, sync, close } = await startRuntime();
  try {
    const busy = await runCauseEffect(
      store.createAgent({ name: "Busy", description: "Runs a turn", avatarSeed: "budget-busy", avatarHue: null }),
    );
    await runCauseEffect(mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [busy.id], text: "Next" }));
    conversation.emitConversation(
      {
        agentId: busy.id,
        threadId: store.ensureThreadIdNow(busy.id),
        activeTurnId: "turn-busy",
        revision: 0,
        messages: [
          {
            id: "turn-busy-answer",
            turnId: "turn-busy",
            author: "assistant",
            text: "Working",
            createdAt: new Date().toISOString(),
            status: "streaming",
            reactions: [],
            reaction: null,
          },
        ],
      },
      "e2e.turn-started",
      {},
    );
    // Adds the queued message. It is the only message that a trim of this chat could remove.
    sync.emitQueue(busy.id);
    const busyIds = conversation.loadedSnapshot(busy.id)?.messages.map((message) => message.id) ?? [];
    assert.equal(busyIds.length, 2, "The busy chat has its turn and the queued message.");
    result.checks.push("the least recently used chat runs a turn and has only a mailbox message to trim");

    // Each idle chat is used later than the busy chat.
    const usedAt = Date.now();
    while (Date.now() === usedAt) await Promise.resolve();
    const answersPerChat = 30;
    const text = "x".repeat(Math.floor((CONVERSATION_CACHE_BYTES_LIMIT * 0.9375) / answersPerChat));
    const idle: string[] = [];
    for (let index = 0; index < IDLE_CHATS; index += 1) {
      const agent = await runCauseEffect(
        store.createAgent({
          name: `Idle ${index}`,
          description: "Idle",
          avatarSeed: `budget-${index}`,
          avatarHue: null,
        }),
      );
      idle.push(agent.id);
      const createdAt = new Date().toISOString();
      conversation.emitConversation(
        {
          agentId: agent.id,
          threadId: store.ensureThreadIdNow(agent.id),
          activeTurnId: null,
          revision: 0,
          messages: Array.from({ length: answersPerChat }, (_, turn) =>
            assistantMessage(`idle-${index}-${turn}`, createdAt, text),
          ),
        },
        "e2e.idle-chat",
        {},
      );
    }
    const kept = idle.filter((id) => conversation.loadedSnapshot(id));
    result.idleChatsKept = `${kept.length} of ${IDLE_CHATS}`;
    assert.ok(kept.length < IDLE_CHATS, "The limit of all chats removes idle chats past the busy chat.");
    assert.equal(conversation.loadedSnapshot(idle[0] ?? "")?.messages.length, undefined, "The oldest idle chat goes.");
    assert.deepEqual(
      conversation.loadedSnapshot(busy.id)?.messages.map((message) => message.id),
      busyIds,
      "The busy chat keeps its turn and the queued message.",
    );
    result.checks.push("idle chats are removed; the busy chat keeps its messages");
    result.passed = true;
  } finally {
    await close();
  }
}

try {
  for (const name of [
    "message-limit",
    "byte-limit",
    "provider-read",
    "request-turns",
    "mailbox-limit",
    "total-budget",
  ] as const) {
    const result: CaseReport = { name, checks: [], rounds: [], passed: false };
    report.cases.push(result);
    const run =
      name === "request-turns"
        ? runRequestTurnsCase(result)
        : name === "mailbox-limit"
          ? runMailboxLimitCase(result)
          : name === "total-budget"
            ? runBudgetCase(result)
            : runCase(name, result);
    await run.catch((error: unknown) => {
      result.error = error instanceof Error ? error.message : String(error);
    });
    process.stdout.write(`${name}: ${result.passed ? "passed" : `FAILED: ${result.error}`}\n`);
  }
  report.passed = report.cases.every((result) => result.passed);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`passed: ${report.passed}, report: ${join(OUT, "report.json")}\n`);
if (!report.passed) process.exitCode = 1;
