import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-queue-scale-e2e");
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";
const SENDERS = ["sender-0", "sender-1", "sender-2", "sender-3"];
const SEEDED_MESSAGES = 10_000;
const AGENT_EVERY = 5;
const COMPLETED = 1_000;
const TIMED_READS = 20;
const TIMED_DELIVERY_READS = 200;
const TIMED_PAGE_READS = 200;
const TURN_ID = "turn-scale";

interface Report {
  seededMessages: number;
  agentDeliveries: number;
  completedDeliveries: number;
  checks: string[];
  timing?: {
    reads: number;
    totalMs: number;
    perQueueChangeMs: number;
    deliveryReads?: number;
    getDeliveryMs?: number;
    nextQueuedMs?: number;
    findDeliveriesByTurnMs?: number;
    pageReads?: number;
    conversationMessagesMs?: number;
    conversationMessagesAfterChangeMs?: number;
  };
  passed: boolean;
}

const report: Report = {
  seededMessages: SEEDED_MESSAGES,
  agentDeliveries: 0,
  completedDeliveries: COMPLETED,
  checks: [],
  passed: false,
};

interface Seeded {
  deliveryId: string;
  messageId: string;
  sender: string;
  text: string;
}

async function seed(mailbox: MailboxStore): Promise<Seeded[]> {
  const seeded: Seeded[] = [];
  for (let index = 0; index < SEEDED_MESSAGES; index += 1) {
    const toAgent = index % AGENT_EVERY === 0;
    const sender = SENDERS[index % SENDERS.length] ?? "sender-0";
    const text = `message ${index}`;
    const receipt = await runCauseEffect(
      mailbox.enqueue(
        toAgent
          ? { sender: { kind: "agent", agentId: sender }, recipientAgentIds: [AGENT], text }
          : { sender: { kind: "user" }, recipientAgentIds: [OTHER_AGENT], text },
      ),
    );
    if (!toAgent) continue;
    const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === AGENT);
    assert.ok(delivery);
    seeded.push({ deliveryId: delivery.id, messageId: receipt.messageId, sender, text });
  }
  for (const item of seeded.slice(0, COMPLETED)) {
    await runCauseEffect(mailbox.markStarting(item.deliveryId));
    await runCauseEffect(mailbox.markTerminal(item.deliveryId, "completed"));
  }
  return seeded;
}

function checkQueue(mailbox: MailboxStore, seeded: Seeded[]): void {
  const queue = mailbox.listQueue(AGENT);
  assert.equal(queue.agentId, AGENT);
  assert.deepEqual(
    queue.deliveries.map((delivery) => delivery.id),
    seeded.map((item) => item.deliveryId),
    "The queue lists every delivery of the agent, the completed ones too, in queue order.",
  );
  queue.deliveries.forEach((delivery, index) => {
    const item = seeded[index];
    assert.ok(item);
    assert.deepEqual(delivery.sender, { kind: "agent", agentId: item.sender });
    assert.equal(delivery.text, item.text);
    const completed = index < COMPLETED;
    assert.equal(delivery.status, completed ? "completed" : "queued");
    assert.equal(delivery.position, completed ? null : index - COMPLETED + 1);
  });
  report.checks.push(`listQueue: ${queue.deliveries.length} deliveries with their message sender, text and position`);

  assert.deepEqual(mailbox.senderAgentIdsForRecipient(AGENT).sort(), [...SENDERS].sort());
  assert.deepEqual(mailbox.senderAgentIdsForRecipient(OTHER_AGENT), []);
  report.checks.push("senderAgentIdsForRecipient: the agent senders of each recipient");

  const byDelivery = new Map(seeded.map((item) => [item.deliveryId, item]));
  const rows = mailbox.conversationMessages(AGENT).filter((row) => row.delivery);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const item = byDelivery.get(row.id);
    assert.ok(item, `The conversation row ${row.id} is a delivery to the agent.`);
    assert.equal(row.text, item.text);
    assert.equal(row.senderAgentId, item.sender);
    assert.equal(row.exchange?.messageId, item.messageId);
    assert.deepEqual(
      row.exchange?.deliveries.map((delivery) => delivery.id),
      [item.deliveryId],
    );
  }
  report.checks.push(`conversationMessages: ${rows.length} rows with their message text and sender`);
}

async function checkDeliveryReads(mailbox: MailboxStore, seeded: Seeded[]): Promise<string[]> {
  const positionOf = () =>
    new Map(mailbox.listQueue(AGENT).deliveries.map((delivery) => [delivery.id, delivery.position]));
  const queuedIndexes = [COMPLETED, COMPLETED + 1, COMPLETED + 500, seeded.length - 2, seeded.length - 1];
  const before = positionOf();
  for (const index of queuedIndexes) {
    const id = seeded[index]?.deliveryId;
    assert.ok(id);
    assert.equal(mailbox.getDelivery(id)?.delivery.position, before.get(id), `getDelivery position of ${id}`);
  }
  const completedId = seeded[0]?.deliveryId;
  assert.ok(completedId);
  assert.equal(mailbox.getDelivery(completedId)?.delivery.position, null);
  report.checks.push("getDelivery: the listQueue position of a queued delivery, and null for a completed one");

  assert.equal(mailbox.nextQueued(AGENT)?.delivery.id, seeded[COMPLETED]?.deliveryId);
  assert.equal(mailbox.nextQueued(AGENT)?.delivery.position, 1);
  report.checks.push("nextQueued: the first queued delivery, at position 1");

  const started = seeded.slice(COMPLETED, COMPLETED + 3).map((item) => item.deliveryId);
  for (const id of started) {
    await runCauseEffect(mailbox.markStarting(id));
    await runCauseEffect(mailbox.markRunning(id, TURN_ID));
  }
  assert.deepEqual(
    mailbox
      .findDeliveriesByTurn(AGENT, TURN_ID)
      .map((context) => context.delivery.id)
      .sort(),
    [...started].sort(),
  );
  const unresolved = new Set(mailbox.unresolvedDeliveries().map((context) => context.delivery.id));
  for (const id of started) assert.ok(unresolved.has(id), `unresolvedDeliveries has ${id}`);
  const after = mailbox.listQueue(AGENT).deliveries.filter((delivery) => delivery.status === "queued");
  assert.deepEqual(
    after.map((delivery) => delivery.position),
    after.map((_, index) => index + 1),
  );
  const firstQueued = after[0]?.id;
  assert.ok(firstQueued);
  assert.equal(mailbox.getDelivery(firstQueued)?.delivery.position, 1);
  report.checks.push("findDeliveriesByTurn and unresolvedDeliveries: the 3 running deliveries; the queue starts at 1");
  return started;
}

function pageWindows(mailbox: MailboxStore): (string | undefined)[] {
  const rows = mailbox.conversationMessages(AGENT);
  return [undefined, rows[0]?.createdAt, rows[Math.floor(rows.length / 2)]?.createdAt, rows.at(-1)?.createdAt];
}

async function checkPageReadsMatchStored(mailbox: MailboxStore, path: string, shared: string, label: string) {
  const fresh = new MailboxStore(path, shared, database);
  await runCauseEffect(fresh.initialize());
  for (const fromCreatedAt of pageWindows(fresh)) {
    const options = fromCreatedAt === undefined ? {} : { fromCreatedAt };
    const expected = fresh.conversationMessages(AGENT, options);
    assert.deepEqual(mailbox.conversationMessages(AGENT, options), expected, `${label}: page from ${fromCreatedAt}`);
    assert.deepEqual(mailbox.conversationMessages(AGENT, options), expected, `${label}: repeated page read`);
  }
}

async function checkPageReads(mailbox: MailboxStore, path: string, shared: string, started: string[]) {
  await checkPageReadsMatchStored(mailbox, path, shared, "before a change");
  const rows = mailbox.conversationMessages(AGENT);
  const changed = rows.find((row) => row.delivery);
  assert.ok(changed?.delivery);
  changed.text = "changed by the caller";
  changed.delivery.status = "failed";
  const again = mailbox.conversationMessages(AGENT).find((row) => row.id === changed.id);
  assert.notEqual(again?.text, "changed by the caller", "A caller's change to its rows does not reach the next read.");
  assert.notEqual(again?.delivery?.status, "failed");
  report.checks.push("conversationMessages: a repeated page read gives the stored rows, not a caller's changes");

  const ended = started[0];
  assert.ok(ended);
  await runCauseEffect(mailbox.markTerminal(ended, "completed"));
  assert.equal(mailbox.conversationMessages(AGENT).find((row) => row.id === ended)?.delivery?.status, "completed");
  await checkPageReadsMatchStored(mailbox, path, shared, "after a delivery ended");
  report.checks.push("conversationMessages: a page read after a delivery ends gives its new status");
}

function timePageReads(mailbox: MailboxStore) {
  const windows = pageWindows(mailbox);
  const perRead = (change: () => void) => {
    let total = 0;
    for (let index = 0; index < TIMED_PAGE_READS; index += 1) {
      change();
      const fromCreatedAt = windows[index % windows.length];
      const started = performance.now();
      mailbox.conversationMessages(AGENT, fromCreatedAt === undefined ? {} : { fromCreatedAt });
      total += performance.now() - started;
    }
    return Number((total / TIMED_PAGE_READS).toFixed(3));
  };
  return {
    pageReads: TIMED_PAGE_READS,
    conversationMessagesMs: perRead(() => {}),
    conversationMessagesAfterChangeMs: perRead(() => mailbox.forgetIdempotencyKey("no-such-key")),
  };
}

function timeDeliveryReads(mailbox: MailboxStore, seeded: Seeded[]) {
  const queuedId = seeded[COMPLETED + 500]?.deliveryId;
  assert.ok(queuedId);
  const perCall = (read: () => unknown) => {
    const started = performance.now();
    for (let index = 0; index < TIMED_DELIVERY_READS; index += 1) read();
    return Number(((performance.now() - started) / TIMED_DELIVERY_READS).toFixed(3));
  };
  return {
    deliveryReads: TIMED_DELIVERY_READS,
    getDeliveryMs: perCall(() => mailbox.getDelivery(queuedId)),
    nextQueuedMs: perCall(() => mailbox.nextQueued(AGENT, "task-none")),
    findDeliveriesByTurnMs: perCall(() => mailbox.findDeliveriesByTurn(AGENT, TURN_ID)),
  };
}

function timeQueueChanges(mailbox: MailboxStore): NonNullable<Report["timing"]> {
  const started = performance.now();
  for (let index = 0; index < TIMED_READS; index += 1) {
    mailbox.listQueue(AGENT);
    mailbox.senderAgentIdsForRecipient(AGENT);
  }
  const totalMs = performance.now() - started;
  return {
    reads: TIMED_READS,
    totalMs: Math.round(totalMs),
    perQueueChangeMs: Number((totalMs / TIMED_READS).toFixed(2)),
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-mailbox-queue-scale-"));
const path = join(root, "profile");
const database = new OpenBotDatabase(path);
try {
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  const seeded = await seed(mailbox);
  report.agentDeliveries = seeded.length;
  checkQueue(mailbox, seeded);
  const started = await checkDeliveryReads(mailbox, seeded);
  const pageTiming = timePageReads(mailbox);
  await checkPageReads(mailbox, path, join(root, "shared"), started);
  report.timing = { ...timeQueueChanges(mailbox), ...timeDeliveryReads(mailbox, seeded), ...pageTiming };
  report.passed = true;
} finally {
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.checks.length} checks, ${report.timing?.perQueueChangeMs} ms per queue change, ` +
    `${report.timing?.getDeliveryMs} ms per getDelivery, ${report.timing?.findDeliveriesByTurnMs} ms per findDeliveriesByTurn, ` +
    `${report.timing?.conversationMessagesMs} ms per chat page read, ` +
    `${report.timing?.conversationMessagesAfterChangeMs} ms for the first one after a change. ` +
    `Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
