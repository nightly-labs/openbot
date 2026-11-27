import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AgentSummary, ConversationMessage, ConversationSnapshot, QueueSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Scope } from "effect";
import { ConversationReader } from "../src/backend/agent/conversation-reader";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { conversationContentSignature } from "../src/backend/agent/delivery-content";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { withoutQueuePositions } from "../src/backend/database/conversation-writer";
import type { MailboxProjectionState } from "../src/backend/database/mailbox-projection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-page-read-e2e");
const AGENTS = Number(process.env.PAGE_READ_AGENTS ?? 85);
const MESSAGES = Number(process.env.PAGE_READ_MESSAGES ?? 70_000);
const ANSWERS_PER_AGENT = 150;
const BASE = Date.parse("2026-10-01T00:00:00.000Z");
const READS_PER_AGENT = 3;
const OPEN_SEED = 4_000;
const OPEN_EVERY = 40;

type SeedDelivery = MailboxProjectionState["deliveries"][number] & { queueOrder: number };

const time = (offset: number) => new Date(BASE + offset * 1_000).toISOString();

interface Timing {
  p50: number;
  p99: number;
  max: number;
  total: number;
}

function timing(samples: number[]): Timing {
  const sorted = samples.toSorted((left, right) => left - right);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
  return {
    p50: at(0.5),
    p99: at(0.99),
    max: sorted.at(-1) ?? 0,
    total: samples.reduce((sum, value) => sum + value, 0),
  };
}

function measure(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

function seedState(agents: readonly string[]): MailboxProjectionState {
  const messages: MailboxProjectionState["messages"] = [];
  const deliveries: SeedDelivery[] = [];
  const idempotency: Record<string, string> = {};
  let order = 0;
  for (let index = 0; index < MESSAGES; index++) {
    const recipient = agents[index % agents.length] ?? "";
    const id = `message-${index}`;
    const kind = index % 10;
    const senderAgent = agents[(index * 7 + 3) % agents.length] ?? "";
    const sender = kind < 6 || senderAgent === recipient ? { kind: "user" } : { kind: "agent", agentId: senderAgent };
    const open = index >= MESSAGES - OPEN_SEED ? index % OPEN_EVERY : -1;
    const message = {
      id,
      sender,
      text: `Message ${index}`,
      replyToMessageId: null,
      createdAt: time(index),
      attachments: [],
      ...(open === 3 ? { taskId: `task-${index}` } : {}),
    };
    messages.push(message);
    deliveries.push({
      id: `delivery-${deliveries.length}`,
      messageId: id,
      recipientAgentId: recipient,
      status: open === 0 || open === 3 ? "queued" : open === 1 ? "running" : open === 2 ? "failed" : "completed",
      turnId: open === 0 || open === 3 ? null : `turn-${index}`,
      error: null,
      createdAt: time(index),
      queueOrder: order++,
    });
    if (sender.kind === "agent") idempotency[`reply:${senderAgent}:turn-${index}:0`] = id;
  }
  return { messages, deliveries, drafts: [], generatedAttachments: [], pausedAgentIds: [], idempotency, reactions: [] };
}

function answers(agentIndex: number, agents: number): ConversationMessage[] {
  return Array.from({ length: ANSWERS_PER_AGENT }, (_, index) => {
    const delivered = MESSAGES - (ANSWERS_PER_AGENT - index) * agents + agentIndex;
    return {
      id: `answer-${agentIndex}-${index}`,
      turnId: `turn-${delivered}`,
      author: "assistant",
      text: `Answer ${index}`,
      createdAt: new Date(Date.parse(time(delivered)) + 500).toISOString(),
      status: "completed",
      reactions: [],
      reaction: null,
    };
  });
}

function reversedKeys(message: ConversationMessage): ConversationMessage {
  const reversed: ConversationMessage = JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(message).toReversed())),
  );
  return reversed;
}

function threadOf(agent: AgentSummary): string {
  if (!agent.threadId) throw new Error(`Agent ${agent.id} has no thread.`);
  return agent.threadId;
}

interface ReconcileChanges {
  changed: ConversationMessage[];
  removed: string[];
}

interface EquivalenceCase {
  change: string;
  expectedChanged: string[];
  expectedRemoved: string[];
  actualChanged: string[];
  actualRemoved: string[];
  sameContent: boolean;
  writesOnNextRead: number;
  passed: boolean;
}

interface QueueViews {
  activeDeliveries: number;
  executionDeliveries: number;
  mismatches: string[];
  digest: string;
}

interface Report {
  agents: number;
  messages: number;
  timings: Record<string, Timing>;
  persistedWritesInSteadyReads?: number;
  storedChecksInSteadyReads?: number;
  sameContentPages?: number;
  pagesRead?: number;
  equivalence: EquivalenceCase[];
  queueViews?: QueueViews;
  passed: boolean;
  error?: string;
}

const report: Report = { agents: AGENTS, messages: MESSAGES, timings: {}, equivalence: [], passed: false };
const root = await mkdtemp(join(tmpdir(), "openbot-page-read-"));
const scope = Scope.makeUnsafe();
let cleanup = async () => {};
try {
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  await runCauseEffect(store.initialize());
  const created: AgentSummary[] = [];
  for (let index = 0; index < AGENTS; index++)
    created.push(
      await runCauseEffect(
        store.createAgent({
          name: `Agent ${index}`,
          description: "Bench",
          avatarSeed: `bench-${index}`,
          avatarHue: null,
        }),
      ),
    );
  const agentIds = created.map((agent) => agent.id);
  database.replaceMailboxState("seed", seedState(agentIds), "mailbox.seeded");
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(mailbox.initialize());
  const conversation = new ConversationRuntime(
    store,
    () => {},
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
    hooks: {
      emit: () => {},
      ownsRoutine: () => true,
      hasRoutine: () => true,
      requireKnownAgent: () => {},
      isSideThread: () => false,
    },
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
      routineThread: () => null,
      waitThread: () => null,
      queueHold: () => null,
      routineDeleted: () => Effect.void,
    },
  });
  const sync = new MailboxSync({
    database,
    mailbox,
    conversation,
    routines,
    scope: () => scope,
    hooks: { emit: () => {}, emitError: () => {}, queueHold: () => null, threadRequestsChanged: () => {} },
  });
  const reader = new ConversationReader({
    store,
    conversation,
    mailboxSync: sync,
    hooks: { emit: () => {}, listAgents: () => store.list() },
  });
  cleanup = async () => {
    timer.dispose();
    conversation.dispose();
    database.close();
  };

  for (const [index, id] of agentIds.entries()) {
    const threadId = store.ensureThreadIdNow(id);
    const seeded: ConversationSnapshot = {
      agentId: id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: answers(index, AGENTS),
    };
    const oldest = seeded.messages[0]?.createdAt;
    const copies = mailbox.conversationMessages(id, oldest === undefined ? {} : { fromCreatedAt: oldest });
    seeded.messages.push(...copies.map((message) => reversedKeys({ ...message, reactions: [], reaction: null })));
    conversation.emitConversation(seeded, "e2e.seeded", {});
  }
  const agents = () =>
    agentIds.map((id) => {
      const agent = store.list().find((candidate) => candidate.id === id);
      if (!agent) throw new Error(`Agent ${id} is missing.`);
      return agent;
    });
  for (const agent of agents()) sync.reconcilePersistedMailboxMessages(agent);

  let writes = 0;
  let lastWrite: ReconcileChanges | null = null;
  const persist = database.persistConversationChanges.bind(database);
  database.persistConversationChanges = (input) => {
    writes += 1;
    lastWrite = { changed: [...input.changedMessages], removed: [...(input.removedMessageIds ?? [])] };
    return persist(input);
  };
  let storedChecks = 0;
  const changedMessages = database.changedConversationMessages.bind(database);
  database.changedConversationMessages = (threadId, messages, known) => {
    storedChecks += 1;
    return changedMessages(threadId, messages, known);
  };

  const syncedPage = (agent: AgentSummary) => {
    const page = database.readConversationPage(agent.id, threadOf(agent), { type: "latest" }, 100);
    const before: ConversationSnapshot = { ...page, messages: structuredClone(page.messages) };
    const synced: ConversationSnapshot = { ...page, messages: structuredClone(page.messages) };
    const oldest = synced.messages[0]?.createdAt;
    sync.syncMailboxMessages(
      synced,
      mailbox.conversationMessages(agent.id, oldest === undefined ? {} : { fromCreatedAt: oldest }),
    );
    return { before, synced };
  };
  const previousReconcileChanges = (agent: AgentSummary): ReconcileChanges => {
    const { before, synced } = syncedPage(agent);
    if (conversationContentSignature(before) === conversationContentSignature(synced))
      return { changed: [], removed: [] };
    const kept = new Set(synced.messages.map((message) => message.id));
    return {
      changed: changedMessages(threadOf(agent), synced.messages),
      removed: before.messages.map((message) => message.id).filter((id) => !kept.has(id)),
    };
  };
  let sameContentPages = 0;
  let pagesRead = 0;

  const reconcile: number[] = [];
  const pageRead: number[] = [];
  const persistedPage: number[] = [];
  const mailboxCopies: number[] = [];
  const signature: number[] = [];
  const changed: number[] = [];
  for (let read = 0; read < READS_PER_AGENT; read++)
    for (const agent of agents()) {
      const threadId = threadOf(agent);
      const { before, synced } = syncedPage(agent);
      pagesRead += 1;
      if (
        conversationContentSignature(before) !== conversationContentSignature(synced) &&
        isDeepStrictEqual(
          JSON.parse(JSON.stringify(synced.messages.map(withoutQueuePositions))),
          before.messages.map(withoutQueuePositions),
        )
      )
        sameContentPages += 1;
      reconcile.push(measure(() => sync.reconcilePersistedMailboxMessages(agent)));
      let page = database.readConversationPage(agent.id, threadId, { type: "latest" }, 100);
      persistedPage.push(
        measure(() => {
          page = database.readConversationPage(agent.id, threadId, { type: "latest" }, 100);
        }),
      );
      const oldest = page.messages[0]?.createdAt;
      mailboxCopies.push(
        measure(() => mailbox.conversationMessages(agent.id, oldest === undefined ? {} : { fromCreatedAt: oldest })),
      );
      const snapshot: ConversationSnapshot = {
        agentId: page.agentId,
        threadId: page.threadId,
        activeTurnId: page.activeTurnId,
        revision: page.revision,
        messages: page.messages,
      };
      signature.push(measure(() => conversationContentSignature(snapshot)));
      changed.push(measure(() => changedMessages(threadId, page.messages)));
      const started = performance.now();
      await runCauseEffect(reader.readPageFor(agent.id, "member-1", { type: "latest" }, 50));
      pageRead.push(performance.now() - started);
    }
  report.persistedWritesInSteadyReads = writes;
  report.storedChecksInSteadyReads = storedChecks;
  report.sameContentPages = sameContentPages;
  report.pagesRead = pagesRead;
  report.timings.reconcileSteady = timing(reconcile);
  report.timings.readPageForSteady = timing(pageRead);
  report.timings.persistedPage100 = timing(persistedPage);
  report.timings.mailboxCopies = timing(mailboxCopies);
  report.timings.signature100 = timing(signature);
  report.timings.changedConversationMessages = timing(changed);

  const failedTurns = new Map<string, string>();
  for (let index = MESSAGES - OPEN_SEED + 2; index < MESSAGES; index += OPEN_EVERY)
    failedTurns.set(agentIds[index % agentIds.length] ?? "", `turn-${index}`);
  let active: QueueSnapshot[] = [];
  const activeTimes = Array.from({ length: 20 }, () =>
    measure(() => {
      active = mailbox.listActiveQueues(agentIds, failedTurns);
    }),
  );
  let executionIds: string[][] = [];
  const executionTimes = Array.from({ length: 20 }, () =>
    measure(() => {
      executionIds = agentIds.map((id) => mailbox.queuedExecutionDeliveryIds(id));
    }),
  );
  report.timings.listActiveQueues = timing(activeTimes);
  report.timings.queuedExecutionDeliveryIdsAllAgents = timing(executionTimes);
  const mismatches: string[] = [];
  for (const queue of active) {
    const full = mailbox.listQueue(queue.agentId);
    if (full.welcome !== queue.welcome) mismatches.push(`${queue.agentId}:welcome`);
    for (const delivery of queue.deliveries)
      if (!isDeepStrictEqual(full.deliveries.find((item) => item.id === delivery.id) ?? null, delivery))
        mismatches.push(`${queue.agentId}:${delivery.id}`);
  }
  const agentIndex = new Map(agentIds.map((id, index) => [id, `agent-${index}`]));
  report.queueViews = {
    activeDeliveries: active.reduce((sum, queue) => sum + queue.deliveries.length, 0),
    executionDeliveries: executionIds.reduce((sum, ids) => sum + ids.length, 0),
    mismatches,
    digest: createHash("sha256")
      .update(
        JSON.stringify({ active, executionIds }, (_key, value) =>
          typeof value === "string" ? (agentIndex.get(value) ?? value) : value,
        ),
      )
      .digest("hex"),
  };

  const [target] = agents();
  if (!target) throw new Error("No agent to change.");
  const user = { kind: "user" } as const;
  const shownCopy = () => {
    const page = database.readConversationPage(target.id, threadOf(target), { type: "latest" }, 100);
    const copy = page.messages.toReversed().find((message) => message.id.startsWith("delivery-"));
    if (!copy) throw new Error("No mailbox copy on the page.");
    return copy.id;
  };
  let queuedId = "";
  const changes: Array<[string, () => Promise<unknown>]> = [
    ["reaction added", () => runCauseEffect(mailbox.setReaction(target.id, shownCopy(), user, "👍"))],
    ["reaction removed", () => runCauseEffect(mailbox.setReaction(target.id, shownCopy(), user, null))],
    [
      "new message",
      async () => {
        const receipt = await runCauseEffect(
          mailbox.enqueue({ sender: user, recipientAgentIds: [target.id], text: "Fresh request" }),
        );
        queuedId = receipt.deliveries[0]?.id ?? "";
      },
    ],
    ["delivery starting", () => runCauseEffect(mailbox.markStarting(queuedId))],
    ["delivery running", () => runCauseEffect(mailbox.markRunning(queuedId, "turn-fresh"))],
    ["delivery completed", () => runCauseEffect(mailbox.markTerminal(queuedId, "completed"))],
    ["message deleted", () => runCauseEffect(mailbox.deleteShownMessage(target.id, shownCopy()))],
  ];
  const ids = (messages: readonly ConversationMessage[]) => messages.map((message) => message.id).toSorted();
  for (const [change, apply] of changes) {
    await apply();
    const expected = previousReconcileChanges(target);
    lastWrite = null;
    sync.reconcilePersistedMailboxMessages(target);
    const actual: ReconcileChanges = lastWrite ?? { changed: [], removed: [] };
    const writesBefore = writes;
    sync.reconcilePersistedMailboxMessages(target);
    const byId = (messages: readonly ConversationMessage[]) =>
      new Map(messages.map((message) => [message.id, JSON.parse(JSON.stringify(message))]));
    const sameContent = isDeepStrictEqual(byId(expected.changed), byId(actual.changed));
    const result: EquivalenceCase = {
      change,
      expectedChanged: ids(expected.changed),
      expectedRemoved: expected.removed.toSorted(),
      actualChanged: ids(actual.changed),
      actualRemoved: actual.removed.toSorted(),
      sameContent,
      writesOnNextRead: writes - writesBefore,
      passed: false,
    };
    result.passed =
      sameContent &&
      isDeepStrictEqual(result.expectedChanged, result.actualChanged) &&
      isDeepStrictEqual(result.expectedRemoved, result.actualRemoved) &&
      result.writesOnNextRead === 0;
    report.equivalence.push(result);
  }
  report.passed =
    report.equivalence.every((result) => result.passed) &&
    sameContentPages > 0 &&
    report.storedChecksInSteadyReads <= 2 * (pagesRead - sameContentPages) &&
    report.queueViews.mismatches.length === 0 &&
    report.queueViews.activeDeliveries > 0 &&
    report.queueViews.executionDeliveries > 0;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await cleanup();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
