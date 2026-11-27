import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withDatabaseTransaction } from "../src/backend/agent/conversation-runtime";
import { databaseRows } from "../src/backend/database/database-rows";
import type { MailboxProjectionChanges, MailboxProjectionState } from "../src/backend/database/mailbox-projection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-incremental-persist-e2e");
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";
const CHANNEL = "channel-1";
const SEEDED_MESSAGES = 2_000;
const TIMED_UPDATES = 50;
const KEYED_TEXT = "x".repeat(60);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const TABLES = [
  ["projection_mailbox_messages", "message_id"],
  ["projection_deliveries", "delivery_id"],
  ["projection_queue_state", "agent_id"],
  ["projection_reactions", "agent_id, message_id, actor_kind, actor_agent_id"],
  ["projection_attachments", "attachment_id"],
] as const;

interface StepResult {
  step: string;
  rows: number;
  matched: boolean;
}

interface Report {
  steps: StepResult[];
  incrementalWrites: number;
  fullWrites: number;
  idempotencyWritesSkipped: number;
  timing?: { seededMessages: number; updates: number; totalMs: number; perUpdateMs: number };
  passed: boolean;
}

const report: Report = {
  steps: [],
  incrementalWrites: 0,
  fullWrites: 0,
  idempotencyWritesSkipped: 0,
  passed: false,
};

class MirroredDatabase extends OpenBotDatabase {
  readonly #reference: OpenBotDatabase;

  constructor(path: string, reference: OpenBotDatabase) {
    super(path);
    this.#reference = reference;
  }

  override applyMailboxChanges(
    commandId: string,
    state: MailboxProjectionState,
    changes: MailboxProjectionChanges,
    eventType: string,
    fileDeletions: string[] = [],
    writeIdempotency = true,
  ): boolean {
    const wrote = super.applyMailboxChanges(commandId, state, changes, eventType, fileDeletions, writeIdempotency);
    report.incrementalWrites += 1;
    if (!writeIdempotency) report.idempotencyWritesSkipped += 1;
    this.#reference.replaceMailboxState(commandId, structuredClone(state), eventType);
    return wrote;
  }

  override replaceMailboxState(
    commandId: string,
    state: MailboxProjectionState,
    eventType: string,
    fileDeletions: string[] = [],
    rebaseHistory = false,
  ): boolean {
    const wrote = super.replaceMailboxState(commandId, state, eventType, fileDeletions, rebaseHistory);
    report.fullWrites += 1;
    this.#reference.replaceMailboxState(commandId, structuredClone(state), eventType);
    return wrote;
  }
}

function projectionRows(database: OpenBotDatabase): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  for (const [table, order] of TABLES) {
    rows[table] = databaseRows(database.connection.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()).map(
      (row) => {
        const { last_event_sequence: _sequence, created_at: createdAt, ...columns } = row;
        return row.owner_kind === "generated" ? columns : { ...columns, created_at: createdAt };
      },
    );
  }
  return rows;
}

function check(step: string, database: OpenBotDatabase, reference: OpenBotDatabase): void {
  const actual = projectionRows(database);
  const expected = projectionRows(reference);
  const rows = Object.values(actual).reduce((count, table) => count + table.length, 0);
  const matched = JSON.stringify(actual) === JSON.stringify(expected);
  report.steps.push({ step, rows, matched });
  assert.deepEqual(actual, expected, `The rows differ from the full replace after: ${step}`);
}

async function openProfile(root: string, name: string, reference?: OpenBotDatabase) {
  const path = join(root, name);
  const database = reference ? new MirroredDatabase(path, reference) : new OpenBotDatabase(path);
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  return { database, mailbox };
}

async function enqueue(
  mailbox: MailboxStore,
  text: string,
  options: { draftIds?: string[]; channelId?: string; idempotencyKey?: string } = {},
) {
  return runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [AGENT],
      text,
      ...(options.draftIds ? { draftIds: options.draftIds } : {}),
      ...(options.channelId ? { channelId: options.channelId } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    }),
  );
}

async function draft(mailbox: MailboxStore, name: string): Promise<string> {
  const [prepared] = await runCauseEffect(
    mailbox.prepareImportedAttachments([], [{ name, mimeType: "text/plain", bytes: Buffer.from(name) }]),
  );
  assert.ok(prepared);
  return prepared.id;
}

function deliveryOf(receipt: { deliveries: Array<{ id: string; recipientAgentId: string }> }): string {
  const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === AGENT);
  assert.ok(delivery);
  return delivery.id;
}

async function parity(root: string): Promise<void> {
  const reference = new OpenBotDatabase(join(root, "reference"));
  await runCauseEffect(reference.initialize());
  let { database, mailbox } = await openProfile(root, "profile", reference);
  check("legacy import", database, reference);

  const discarded = await draft(mailbox, "discarded.txt");
  check("draft prepared", database, reference);
  await runCauseEffect(mailbox.discardDraft(discarded));
  check("draft discarded", database, reference);

  const firstDraft = await draft(mailbox, "first.txt");
  const first = await enqueue(mailbox, "first", { draftIds: [firstDraft] });
  const firstDelivery = deliveryOf(first);
  check("message with a draft sent", database, reference);

  await runCauseEffect(mailbox.markStarting(firstDelivery));
  check("delivery starting", database, reference);
  await runCauseEffect(mailbox.markRunning(firstDelivery, "turn-1"));
  check("delivery running", database, reference);
  await runCauseEffect(mailbox.markTerminal(firstDelivery, "completed"));
  check("delivery completed", database, reference);

  const failing = deliveryOf(await enqueue(mailbox, "failing"));
  await runCauseEffect(mailbox.markStarting(failing));
  await runCauseEffect(mailbox.markTerminal(failing, "failed", "provider refused"));
  check("delivery failed", database, reference);

  const steered = deliveryOf(await enqueue(mailbox, "steered"));
  await runCauseEffect(mailbox.markSteerFallback(steered, "steer-failed"));
  check("steer fallback", database, reference);
  await runCauseEffect(mailbox.markSteering(steered, "turn-2"));
  check("steering", database, reference);
  await runCauseEffect(mailbox.restoreUnsteered(steered, "turn-2"));
  check("steer restored", database, reference);

  await runCauseEffect(mailbox.setReaction(AGENT, first.messageId, { kind: "user" }, "👍"));
  await runCauseEffect(mailbox.setReaction(AGENT, first.messageId, { kind: "agent", agentId: OTHER_AGENT }, "🎉"));
  check("reactions added", database, reference);
  await runCauseEffect(mailbox.setReaction(AGENT, first.messageId, { kind: "user" }, "❤️"));
  check("reaction changed", database, reference);
  await runCauseEffect(mailbox.setReaction(AGENT, first.messageId, { kind: "agent", agentId: OTHER_AGENT }, null));
  check("reaction removed", database, reference);

  const editedDraft = await draft(mailbox, "edited.txt");
  const edited = deliveryOf(await enqueue(mailbox, "edited", { draftIds: [editedDraft] }));
  mailbox.beginQueueEdit(AGENT, edited, "edit-1");
  check("queue edit started", database, reference);
  const replacement = await draft(mailbox, "replacement.txt");
  const backup = await draft(mailbox, "backup.txt");
  mailbox.retainQueueEditAttachments(AGENT, edited, "edit-1", [backup]);
  check("edit attachments retained", database, reference);
  await runCauseEffect(mailbox.updateQueuedMessage(AGENT, edited, "edited again", [], [replacement], "edit-1"));
  check("queued message saved", database, reference);
  mailbox.beginQueueEdit(AGENT, edited, "edit-2");
  mailbox.finishQueueEdit(AGENT, edited, "edit-2");
  check("queue edit finished", database, reference);

  const third = deliveryOf(await enqueue(mailbox, "third"));
  await runCauseEffect(mailbox.reorderQueue(AGENT, [third, edited, steered]));
  check("queue reordered", database, reference);
  await runCauseEffect(mailbox.moveToTask(AGENT, third, "task-1"));
  check("message moved to a task", database, reference);
  await runCauseEffect(mailbox.cancel(AGENT, steered));
  check("delivery cancelled", database, reference);

  const channelDraft = await draft(mailbox, "channel.txt");
  const committed = await runCauseEffect(
    mailbox.commitChannelAttachments({
      channelId: CHANNEL,
      messageId: crypto.randomUUID(),
      text: "for the channel",
      draftIds: [channelDraft],
    }),
  );
  check("channel attachments committed", database, reference);
  await runCauseEffect(committed.revert);
  check("channel attachments reverted", database, reference);
  assert.throws(() =>
    withDatabaseTransaction(database, () => {
      mailbox.cancelNow(AGENT, edited);
      throw new Error("The caller's work failed.");
    }),
  );
  await runCauseEffect(committed.revert);
  await enqueue(mailbox, "channel message", { channelId: CHANNEL });
  check("channel message sent after a replayed command", database, reference);

  await runCauseEffect(
    mailbox.storeGeneratedAttachment({ bytes: PNG, name: "made.png", mimeType: "image/png", ownerAgentId: AGENT }),
  );
  check("generated attachment stored", database, reference);
  const staged = await runCauseEffect(
    mailbox.stageGeneratedBytes({ bytes: PNG, name: "staged.png", mimeType: "image/png", ownerAgentId: AGENT }),
  );
  mailbox.persistGeneratedAttachmentsWithConversation(
    { agentId: AGENT, threadId: null, activeTurnId: null, revision: 0, messages: [] },
    "message.updated",
    null,
    [staged.id],
  );
  check("staged attachment kept with the conversation", database, reference);

  const sentFile = mailbox.listStoredFiles().find((file) => file.source === "attachment");
  const generatedFile = mailbox.listStoredFiles().find((file) => file.source === "generated");
  assert.ok(sentFile && generatedFile);
  await runCauseEffect(mailbox.deleteStoredFile(sentFile.attachment.id));
  await runCauseEffect(mailbox.deleteStoredFile(generatedFile.attachment.id));
  check("stored files deleted", database, reference);

  const rolledBack = deliveryOf(await enqueue(mailbox, "rolled back"));
  assert.throws(() =>
    withDatabaseTransaction(database, () => {
      mailbox.cancelNow(AGENT, rolledBack);
      throw new Error("The caller's work failed.");
    }),
  );
  const after = deliveryOf(await enqueue(mailbox, "after the rollback"));
  check("own write after a rolled-back write", database, reference);
  await runCauseEffect(mailbox.markStarting(after));

  const nested = deliveryOf(await enqueue(mailbox, "nested rollback"));
  assert.throws(() =>
    withDatabaseTransaction(database, () =>
      withDatabaseTransaction(
        database,
        () => {
          mailbox.cancelNow(AGENT, nested);
          throw new Error("The nested work failed.");
        },
        () => mailbox.restorePersistedState(),
      ),
    ),
  );
  await enqueue(mailbox, "after the nested rollback");
  check("own write after a nested rollback with a restore", database, reference);

  const keyed = deliveryOf(await enqueue(mailbox, "keyed", { idempotencyKey: "routine:keyed:turn-k:1" }));
  check("message with an idempotency key sent", database, reference);
  await runCauseEffect(mailbox.markStarting(keyed));
  check("keyed delivery started without a key change", database, reference);
  assert.throws(() =>
    withDatabaseTransaction(database, () => {
      mailbox.forgetIdempotencyKey("routine:keyed:turn-k:1");
      mailbox.cancelNow(AGENT, nested);
      throw new Error("The caller's work failed after a key was forgotten.");
    }),
  );
  await runCauseEffect(mailbox.markTerminal(keyed, "completed"));
  check("own write after a rolled-back key change", database, reference);
  mailbox.forgetIdempotencyKeys("routine:", new Date(Date.now() + 60_000));
  await runCauseEffect(mailbox.setReaction(AGENT, first.messageId, { kind: "user" }, "👍"));
  check("expired keys forgotten before an unrelated write", database, reference);

  await runCauseEffect(mailbox.deleteChannelData(CHANNEL));
  check("channel data deleted", database, reference);
  await draft(mailbox, "left on restart.txt");
  check("draft left for the restart", database, reference);

  database.connection
    .prepare(
      "UPDATE projection_deliveries SET delivery_json = json_remove(delivery_json, '$.queueOrder') WHERE delivery_id = ?",
    )
    .run(after);
  database.close();
  ({ database, mailbox } = await openProfile(root, "profile", reference));
  check("restart", database, reference);
  await runCauseEffect(mailbox.markTerminal(after, "interrupted"));
  check("delivery interrupted after the restart", database, reference);

  await runCauseEffect(mailbox.deleteAgentData(AGENT));
  check("agent data deleted", database, reference);
  database.close();
  reference.close();
}

async function timing(root: string): Promise<NonNullable<Report["timing"]>> {
  const { database, mailbox } = await openProfile(root, "timing");
  for (let index = 0; index < SEEDED_MESSAGES; index += 1) {
    const deliveryId = deliveryOf(
      await enqueue(mailbox, `message ${index}`, { idempotencyKey: `routine:${index}:turn-${index}:${KEYED_TEXT}` }),
    );
    await runCauseEffect(mailbox.markStarting(deliveryId));
    await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
  }
  const queued: string[] = [];
  for (let index = 0; index < TIMED_UPDATES; index += 1)
    queued.push(deliveryOf(await enqueue(mailbox, `timed ${index}`)));
  const started = performance.now();
  for (const deliveryId of queued) await runCauseEffect(mailbox.markStarting(deliveryId));
  const totalMs = performance.now() - started;
  database.close();
  return {
    seededMessages: SEEDED_MESSAGES,
    updates: TIMED_UPDATES,
    totalMs: Math.round(totalMs),
    perUpdateMs: Number((totalMs / TIMED_UPDATES).toFixed(2)),
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-mailbox-persist-"));
try {
  await parity(root);
  report.timing = await timing(root);
  report.passed = report.steps.every((step) => step.matched) && report.idempotencyWritesSkipped > 0;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.steps.length} steps, ${report.timing?.perUpdateMs} ms per status update. ` +
    `Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
