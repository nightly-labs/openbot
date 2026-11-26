import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Effect } from "effect";
import { withDatabaseTransaction } from "../src/backend/agent/conversation-runtime";
import type { MailboxProjectionState } from "../src/backend/database/mailbox-projection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-views-e2e");
const AGENTS = 85;
const MESSAGES = 70_000;
const QUEUED_PER_AGENT = 3;
const BASE = Date.parse("2026-10-01T00:00:00.000Z");
const ROUNDS = 20;
const MIN_SPEEDUP_AFTER_APPEND = 3;

const agentId = (index: number) => `agent-${String(index).padStart(3, "0")}`;
const time = (offset: number) => new Date(BASE + offset * 1_000).toISOString();

function seedState(): MailboxProjectionState {
  const messages: MailboxProjectionState["messages"] = [];
  const deliveries: MailboxProjectionState["deliveries"] = [];
  const idempotency: Record<string, string> = {};
  let order = 0;
  for (let index = 0; index < MESSAGES; index++) {
    const recipient = agentId(index % AGENTS);
    const id = `message-${index}`;
    const kind = index % 10;
    const sender =
      kind < 6
        ? { kind: "user" }
        : kind < 9
          ? { kind: "agent", agentId: agentId((index * 7 + 3) % AGENTS) }
          : {
              kind: "routine",
              routineId: `routine-${index % 52}`,
              runId: `run-${index}`,
              routineName: "Check",
              scheduledFor: time(index),
            };
    messages.push({
      id,
      sender,
      text: `Message ${index}`,
      replyToMessageId: null,
      createdAt: time(index),
      attachments: [],
    });
    const recipients = index % 25 === 0 ? [recipient, agentId((index + 1) % AGENTS)] : [recipient];
    for (const to of recipients)
      deliveries.push({
        id: `delivery-${deliveries.length}`,
        messageId: id,
        recipientAgentId: to,
        status: "completed",
        turnId: `turn-${index}`,
        error: null,
        createdAt: time(index),
        ...{ queueOrder: order++ },
      });
    if (sender.kind === "agent") idempotency[`reply:${sender.agentId}:turn-${index}:0`] = id;
  }
  for (let agent = 0; agent < AGENTS; agent++)
    for (let index = 0; index < QUEUED_PER_AGENT; index++) {
      const id = `queued-${agent}-${index}`;
      messages.push({
        id,
        sender: { kind: "user" },
        text: `Queued ${index}`,
        replyToMessageId: null,
        createdAt: time(MESSAGES + agent * 10 + index),
        attachments: [],
      });
      deliveries.push({
        id: `delivery-${deliveries.length}`,
        messageId: id,
        recipientAgentId: agentId(agent),
        status: "queued",
        turnId: null,
        error: null,
        createdAt: time(MESSAGES + agent * 10 + index),
        ...{ queueOrder: order++ },
      });
    }
  return { messages, deliveries, drafts: [], generatedAttachments: [], pausedAgentIds: [], idempotency, reactions: [] };
}

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

interface AgentViews {
  conversation: ReturnType<MailboxStore["conversationMessages"]>;
  recent: ReturnType<MailboxStore["conversationMessages"]>;
  queue: ReturnType<MailboxStore["listQueue"]>;
  routines: ReturnType<MailboxStore["taskRoutineDeliveries"]>;
  senders: string[];
}

interface Report {
  agents: number;
  messages: number;
  seedMs?: number;
  initializeMs?: number;
  timings: Record<string, Timing>;
  checks?: { sameAsFullRebuild: boolean; appendKeepsIndex: boolean };
  passed: boolean;
  error?: string;
}

function views(mailbox: MailboxStore): AgentViews[] {
  return Array.from({ length: AGENTS }, (_, index) => {
    const agent = agentId(index);
    return {
      conversation: mailbox.conversationMessages(agent),
      recent: mailbox.conversationMessages(agent, { fromCreatedAt: time(MESSAGES - 2_000) }),
      queue: mailbox.listQueue(agent),
      routines: mailbox.taskRoutineDeliveries(agent),
      senders: mailbox.senderAgentIdsForRecipient(agent),
    };
  });
}

function emitQueueReads(mailbox: MailboxStore, agent: string): void {
  mailbox.listQueue(agent);
  mailbox.taskRoutineDeliveries(agent);
  for (const affected of new Set([agent, ...mailbox.senderAgentIdsForRecipient(agent)]))
    mailbox.conversationMessages(affected);
}

const report: Report = { agents: AGENTS, messages: MESSAGES, timings: {}, passed: false };
const root = await mkdtemp(join(tmpdir(), "openbot-mailbox-views-"));
try {
  const path = join(root, "profile");
  const database = new OpenBotDatabase(path);
  await runCauseEffect(database.initialize());
  const seeded = seedState();
  report.seedMs = measure(() => database.replaceMailboxState("seed", seeded, "mailbox.seeded"));
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  report.initializeMs = await (async () => {
    const started = performance.now();
    await runCauseEffect(mailbox.initialize());
    return performance.now() - started;
  })();

  const cold: number[] = [];
  const warm: number[] = [];
  for (let agent = 0; agent < AGENTS; agent++) cold.push(measure(() => mailbox.conversationMessages(agentId(agent))));
  for (let agent = 0; agent < AGENTS; agent++) warm.push(measure(() => mailbox.conversationMessages(agentId(agent))));
  report.timings.conversationMessagesCold = timing(cold);
  report.timings.conversationMessagesWarm = timing(warm);

  const afterStatus: number[] = [];
  const afterStatusEmit: number[] = [];
  const afterEnqueue: number[] = [];
  const afterEnqueueEmit: number[] = [];
  const inTransaction: number[] = [];
  const writeInTransaction: number[] = [];
  const write: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const agent = agentId(round % AGENTS);
    const queued = mailbox.listQueue(agent).deliveries.find((delivery) => delivery.status === "queued");
    if (!queued) throw new Error(`No queued delivery for ${agent}`);
    const delivery = queued.id;
    write.push(
      await (async () => {
        const started = performance.now();
        await runCauseEffect(mailbox.markStarting(delivery));
        return performance.now() - started;
      })(),
    );
    afterStatus.push(measure(() => mailbox.conversationMessages(agent)));
    await runCauseEffect(mailbox.markRunning(delivery, `live-turn-${round}`));
    afterStatusEmit.push(measure(() => emitQueueReads(mailbox, agent)));
    await runCauseEffect(mailbox.markTerminal(delivery, "completed"));
    await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent], text: `Live ${round}` }),
    );
    afterEnqueue.push(measure(() => mailbox.conversationMessages(agent)));
    await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent], text: `Live b ${round}` }),
    );
    afterEnqueueEmit.push(measure(() => emitQueueReads(mailbox, agent)));
    inTransaction.push(
      measure(() =>
        withDatabaseTransaction(database, () => {
          for (let read = 0; read < 5; read++) mailbox.conversationMessages(agent);
        }),
      ),
    );
    const next = mailbox.listQueue(agent).deliveries.find((delivery) => delivery.status === "queued");
    if (!next) throw new Error(`No queued delivery for ${agent}`);
    writeInTransaction.push(
      measure(() =>
        withDatabaseTransaction(database, () => {
          Effect.runSync(mailbox.markStarting(next.id));
          for (let read = 0; read < 5; read++) emitQueueReads(mailbox, agent);
        }),
      ),
    );
    await runCauseEffect(mailbox.markRunning(next.id, `live-next-turn-${round}`));
    await runCauseEffect(mailbox.markTerminal(next.id, "completed"));
  }
  report.timings.markStarting = timing(write);
  report.timings.conversationMessagesAfterStatus = timing(afterStatus);
  report.timings.emitQueueAfterStatus = timing(afterStatusEmit);
  report.timings.conversationMessagesAfterEnqueue = timing(afterEnqueue);
  report.timings.emitQueueAfterEnqueue = timing(afterEnqueueEmit);
  report.timings.fiveReadsInTransaction = timing(inTransaction);
  report.timings.writeAndFiveEmitsInTransaction = timing(writeInTransaction);
  const live = views(mailbox);
  const fresh = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(fresh.initialize());
  const rebuilt = views(fresh);
  const sameAsFullRebuild = isDeepStrictEqual(live, rebuilt);
  const appendKeepsIndex = timing(afterEnqueue).p50 * MIN_SPEEDUP_AFTER_APPEND < timing(cold).p50;
  report.checks = { sameAsFullRebuild, appendKeepsIndex };
  database.close();
  report.passed = sameAsFullRebuild && appendKeepsIndex;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
