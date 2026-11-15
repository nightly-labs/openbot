// Checks durable-event reconciliation, atomic item/packet capture, replay, restart and visibility filtering.
// Run: `bun run test:activity-inbox`.
// Writes `.openbot-build/activity-inbox-e2e/report.json`; it does not start providers or use the network.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  herdrTerminalReferenceIdentity,
  orcaWorkerDispatchIdentity,
  telegramActivityInboxIdentity,
  unavailableActivityInboxEventCapture,
} from "../src/backend/database/activity-inbox-source-adapters";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { TelegramChatState } from "../src/backend/messaging/telegram/telegram-chats";
import { telegramUpdateEvent } from "../src/backend/messaging/telegram/telegram-updates";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "activity-inbox-e2e");
const report: { passed: boolean; steps: { name: string; passed: boolean }[]; error?: string } = {
  passed: false,
  steps: [],
};

function record(name: string, check: () => void): void {
  check();
  report.steps.push({ name, passed: true });
  process.stdout.write(`- ${name}\n`);
}

function captureInChild(userDataPath: string, agentId: string, threadId: string, turnId: string): Promise<number> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        join(ROOT, "scripts/activity-inbox-capture-worker.ts"),
        userDataPath,
        agentId,
        threadId,
        turnId,
      ],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectChild);
    child.once("close", (code) => {
      if (code === 0) resolveChild(0);
      else rejectChild(new Error(`Activity inbox capture child exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function beginFollowupInChild(
  userDataPath: string,
  input: { itemId: string; actionId: string; clientMessageId: string; text: string; actorId: string },
): Promise<{ shouldSend: boolean; receipt: unknown }> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", join(ROOT, "scripts/activity-inbox-followup-worker.ts"), userDataPath, JSON.stringify(input)],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectChild);
    child.once("close", (code) => {
      if (code !== 0) return rejectChild(new Error(`Follow-up worker exited ${code}: ${stderr.slice(-2000)}`));
      try {
        const parsed = JSON.parse(stdout);
        if (!isDynamicRecord(parsed) || typeof parsed.shouldSend !== "boolean" || !("receipt" in parsed))
          return rejectChild(new Error("Follow-up worker returned an invalid receipt."));
        resolveChild({ shouldSend: parsed.shouldSend, receipt: parsed.receipt });
      } catch (error) {
        rejectChild(error);
      }
    });
  });
}

function testAgent(): AgentSummary {
  return {
    id: "activity-agent",
    provider: "codex",
    name: "Activity Fixture",
    title: "Test owner",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "activity-main-thread",
    workspacePath: "/tmp/openbot-activity-fixture",
    preview: "",
    updatedAt: "2026-11-12T08:00:00.000Z",
    avatarSeed: "activity-fixture",
    avatarHue: null,
    avatarUrl: null,
  };
}

function message(id: string, turnId: string, text: string): ConversationMessage {
  return {
    id,
    author: "assistant",
    text,
    createdAt: "2026-11-12T08:01:00.000Z",
    status: "completed",
    turnId,
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-activity-inbox-"));
const userDataPath = join(root, "state");
let database = new OpenBotDatabase(userDataPath);
let stage = "database initialization";

try {
  const telegramState = new TelegramChatState("Fixture chat", "openbot_fixture");
  const telegramUpdate = {
    update_id: 901,
    message: {
      message_id: 44,
      date: 1_794_456_000,
      chat: { id: -100700, type: "private" },
      from: { id: 902, is_bot: false, first_name: "Fixture" },
      text: "A synthetic inbound report.",
    },
  };
  const normalizedTelegram = telegramUpdateEvent(telegramUpdate, "999", "-100700", telegramState);
  assert.equal(normalizedTelegram?.type, "message");
  if (normalizedTelegram?.type !== "message") throw new Error("Telegram fixture did not normalize to a message.");
  const telegramIdentity = telegramActivityInboxIdentity(normalizedTelegram.message);
  record("Telegram identity uses the verified chat and platform message ids", () => {
    assert.equal(telegramIdentity.sourceId, "telegram");
    assert.equal(telegramIdentity.sourceKey, JSON.stringify(["telegram.message", "-100700", "44"]));
    assert.equal(telegramIdentity.originalRef, "-100700:44");
    assert.equal(telegramIdentity.identityKind, "event");
    assert.equal(telegramActivityInboxIdentity(normalizedTelegram.message).sourceKey, telegramIdentity.sourceKey);
  });
  const herdrIdentity = herdrTerminalReferenceIdentity({
    terminalId: "terminal-17",
    spaceId: "space-4",
    tabId: "tab-8",
    machineLabel: "orch-hel1",
  });
  const orcaIdentity = orcaWorkerDispatchIdentity({
    runId: "run_81",
    taskId: "task_19",
    dispatchId: "dispatch_22",
  });
  record("Herdr and Orca resource identities are exact, while event capture stays unavailable without cursors", () => {
    assert.equal(
      herdrIdentity.sourceKey,
      JSON.stringify(["herdr.terminal.v1", "orch-hel1", "space-4", "tab-8", "terminal-17"]),
    );
    assert.equal(herdrIdentity.identityKind, "resource");
    assert.equal(
      orcaIdentity.sourceKey,
      JSON.stringify(["orca.worker-dispatch.v1", "run_81", "task_19", "dispatch_22"]),
    );
    assert.equal(orcaIdentity.identityKind, "resource");
    assert.deepEqual(unavailableActivityInboxEventCapture("herdr"), {
      sourceId: "herdr",
      state: "unconnected",
      coverage: "unknown",
      reasonCode: "durable-source-event-cursor-unverified",
    });
    assert.deepEqual(unavailableActivityInboxEventCapture("orca"), {
      sourceId: "orca",
      state: "unconnected",
      coverage: "unknown",
      reasonCode: "durable-source-event-cursor-unverified",
    });
  });
  await runCauseEffect(database.initialize());
  const agent = testAgent();
  stage = "agent seed";
  database.replaceAgents("activity-agent-seed", [agent], "agents.updated");

  const threadId = "activity-side-thread";
  const turnId = "activity-turn-1";
  const reportMessage = message("activity-report-message", turnId, "The local report is ready.");
  stage = "side-thread seed";
  database.connection
    .prepare(
      `INSERT INTO projection_threads
       (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(threadId, agent.id, "Completed fixture report", turnId, reportMessage.createdAt, reportMessage.createdAt);
  database.persistConversation(
    { agentId: agent.id, threadId, activeTurnId: turnId, revision: 0, messages: [reportMessage] },
    "conversation.saved",
  );
  const sequence = database.readConversationRevision(agent.id, threadId);
  stage = "task-thread ownership seed";
  database.connection
    .prepare(
      `INSERT INTO projection_agent_threads
       (thread_id, agent_id, legacy_task_id, origin, title, title_source, outcome, error,
        created_at, updated_at, archived_at, last_event_sequence, branch_source_thread_id,
        branch_source_message_id, branch_through_message_id, routine_id)
       VALUES (?, ?, ?, 'user', ?, 'user', NULL, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, NULL)`,
    )
    .run(
      threadId,
      agent.id,
      "activity-task-1",
      "Completed fixture report",
      reportMessage.createdAt,
      reportMessage.createdAt,
      sequence,
    );

  const completeTurn = (completedTurnId: string, completedMessage: ConversationMessage) =>
    database.persistConversationChanges({
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      changedMessages: [completedMessage],
      eventType: "turn.completed",
      detail: { turnId: completedTurnId, status: "completed" },
    });

  const legacyTurnId = "activity-turn-before-inbox";
  completeTurn(legacyTurnId, message("activity-old-report", legacyTurnId, "An older report."));
  const activationSequence = database.connection
    .prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events
       WHERE aggregate_type NOT IN ('activity-inbox', 'activity-inbox-config')`,
    )
    .get()?.sequence;
  assert.equal(typeof activationSequence, "number");
  const activation = database.connection
    .prepare(
      `SELECT event_id, payload_json FROM orchestration_events
       WHERE aggregate_type = 'activity-inbox-config' AND event_type = 'inbox.capture-activated' LIMIT 1`,
    )
    .get();
  assert.ok(activation);
  const parsedActivationPayload = JSON.parse(String(activation.payload_json));
  if (!isDynamicRecord(parsedActivationPayload)) throw new Error("Invalid activation event fixture.");
  const activationPayload = { ...parsedActivationPayload, captureStartSequence: activationSequence };
  database.connection
    .prepare("UPDATE orchestration_events SET payload_json = ? WHERE event_id = ?")
    .run(JSON.stringify(activationPayload), String(activation.event_id));
  record("events before inbox activation are not backfilled", () => {
    assert.equal(database.listActivityInbox([agent.id]).items.length, 0);
  });

  stage = "durable event and intake gap recovery";
  completeTurn(turnId, reportMessage);
  database.connection.exec(`
    CREATE TRIGGER fail_activity_packet BEFORE INSERT ON orchestration_events
    WHEN NEW.aggregate_type = 'activity-inbox' AND NEW.event_type = 'inbox.intake-packet.received'
    BEGIN SELECT RAISE(ABORT, 'injected packet failure'); END;
  `);
  assert.throws(
    () => database.captureActivityInboxFinalTaskTurn({ agentId: agent.id, threadId, turnId }),
    /injected packet failure/,
  );
  assert.equal(
    database.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type='activity-inbox' AND event_type='inbox.item.received'",
      )
      .get()?.count,
    0,
  );
  assert.equal(
    database.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM projection_thread_activities WHERE turn_id = ? AND activity_type = 'turn.completed'",
      )
      .get(turnId)?.count,
    1,
  );
  database.connection.exec("DROP TRIGGER fail_activity_packet");
  record("packet failure leaves the durable source event and no partial item", () => {
    assert.equal(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM projection_thread_activities WHERE turn_id = ? AND activity_type = 'turn.completed'",
        )
        .get(turnId)?.count,
      1,
    );
    assert.equal(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type='activity-inbox' AND event_type='inbox.intake-packet.received'",
        )
        .get()?.count,
      0,
    );
  });

  stage = "crash-gap reconciliation";
  let snapshot = database.listActivityInbox([agent.id]);
  record("completed native task turn creates one item and one provisional packet", () => {
    assert.equal(snapshot.items.length, 1);
    const item = snapshot.items[0];
    assert.ok(item);
    const stableKey = `openbot.agent-task-turn\0${agent.id}\0${threadId}\0${turnId}`;
    const sourceEventSequence = database.connection
      .prepare(
        `SELECT sequence FROM orchestration_events
         WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = 'turn.completed'
           AND json_extract(payload_json, '$.detail.turnId') = ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(threadId, turnId)?.sequence;
    assert.equal(item.kind, "reference");
    assert.equal(item.state, "received_unrouted");
    assert.equal(item.itemId, `inbox-${createHash("sha256").update(stableKey).digest("hex")}`);
    assert.equal(item.taskId, "activity-task-1");
    assert.deepEqual(item.messageIds, [reportMessage.id]);
    assert.equal(item.sourceEventSequence, sourceEventSequence);
    assert.equal(item.packet.source_event_sequence, sourceEventSequence);
    assert.equal(item.packet.source_ref.eventSequence, sourceEventSequence);
    assert.equal(item.packet.packet_id, item.itemId);
    assert.equal(item.packet.phase, "intake_received_unrouted");
    assert.equal(item.packet.assigned_owner_id, null);
    assert.equal(item.packet.classification, "reference");
    assert.equal(item.packet.context, "unknown");
    assert.equal(item.packet.next_action, "Review the completed task");
    assert.equal(item.packet.source_event_key, JSON.stringify([agent.id, threadId, turnId]));
  });

  const itemId = snapshot.items[0]?.itemId;
  assert.ok(itemId);
  record("reference capture does not create a mailbox delivery or execution claim", () => {
    assert.equal(database.connection.prepare("SELECT COUNT(*) AS count FROM projection_deliveries").get()?.count, 0);
    assert.equal(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type='activity-inbox' AND event_type='inbox.intake-packet.received'",
        )
        .get()?.count,
      1,
    );
  });

  stage = "reference classification and item-scoped follow-up receipt";
  const referenceItem = database.classifyActivityInboxItem({
    itemId,
    actorId: "fixture-operator",
    classification: "reference",
  });
  assert.equal(referenceItem?.state, "reference_only");
  const actionableItem = database.classifyActivityInboxItem({
    itemId,
    actorId: "fixture-operator",
    classification: "actionable",
  });
  assert.equal(actionableItem?.state, "triage");
  const followupInput = {
    itemId,
    actionId: "activity-followup-1",
    clientMessageId: "activity-client-message-1",
    text: "Verify the source records and report the result.",
    actorId: "fixture-operator",
  };
  const [childFollowupA, childFollowupB] = await Promise.all([
    beginFollowupInChild(userDataPath, followupInput),
    beginFollowupInChild(userDataPath, followupInput),
  ]);
  const pendingFollowup = database.beginActivityInboxFollowup(followupInput);
  const concurrentFollowup = database.beginActivityInboxFollowup(followupInput);
  const pendingReceipt = pendingFollowup.receipt;
  assert.ok(pendingReceipt);
  record("explicit follow-up is durably bound to the existing item, owner, actor and idempotency keys", () => {
    assert.equal(pendingFollowup.shouldSend, true);
    assert.equal(pendingFollowup.receipt?.status, "pending");
    assert.equal(pendingFollowup.receipt?.targetAgentId, agent.id);
    assert.equal(pendingFollowup.receipt?.targetTaskId, "activity-task-1");
    assert.equal(concurrentFollowup.receipt?.actionId, pendingFollowup.receipt?.actionId);
    assert.equal(concurrentFollowup.receipt?.clientMessageId, followupInput.clientMessageId);
    assert.equal(childFollowupA.shouldSend, true);
    assert.equal(childFollowupB.shouldSend, true);
    assert.ok(isDynamicRecord(childFollowupA.receipt));
    assert.ok(isDynamicRecord(childFollowupB.receipt));
    assert.equal(childFollowupA.receipt.actionId, followupInput.actionId);
    assert.equal(childFollowupB.receipt.clientMessageId, followupInput.clientMessageId);
    assert.equal(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'inbox.followup.pending'")
        .get()?.count,
      1,
    );
  });
  const queuedReceipt = {
    ...pendingReceipt,
    status: "queued" as const,
    messageId: "activity-followup-message",
    deliveryId: "activity-followup-delivery",
    updatedAt: new Date().toISOString(),
  };
  database.recordActivityInboxFollowup({ itemId, receipt: queuedReceipt });
  record("queued receipt updates the same packet without claiming a result", () => {
    const item = database.readActivityInboxItem(itemId);
    assert.equal(item?.state, "followup_queued");
    assert.equal(item?.packet.packet_id, itemId);
    assert.equal(item?.packet.followup_receipt_ref, followupInput.actionId);
    assert.equal(item?.followupReceipt?.resultTurnId, null);
    assert.equal(item?.followupReceipt?.status, "queued");
  });
  database.recordActivityInboxFollowup({
    itemId,
    receipt: { ...queuedReceipt, status: "running", updatedAt: new Date().toISOString() },
  });
  record("authoritative running receipt advances the same item without linking a result", () => {
    const item = database.readActivityInboxItem(itemId);
    assert.equal(item?.state, "followup_running");
    assert.equal(item?.followupReceipt?.status, "running");
    assert.equal(item?.followupReceipt?.resultTurnId, null);
  });
  const changedPayloadRetry = database.beginActivityInboxFollowup({
    ...followupInput,
    text: "A different message must not reuse this action id.",
  });
  record("a retry with changed text cannot reuse the same action or message id", () => {
    assert.equal(changedPayloadRetry.shouldSend, false);
    assert.equal(changedPayloadRetry.payloadMismatch, true);
    assert.equal(changedPayloadRetry.receipt?.requestHash, pendingReceipt.requestHash);
    assert.equal(changedPayloadRetry.receipt?.reasonCode, "action-payload-mismatch");
  });

  completeTurn(turnId, reportMessage);
  database.captureActivityInboxFinalTaskTurn({ agentId: agent.id, threadId, turnId });
  snapshot = database.listActivityInbox([agent.id]);
  record("replaying the same thread and turn creates no duplicate item or packet", () => {
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0]?.itemId, itemId);
    assert.equal(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type='activity-inbox' AND event_type='inbox.intake-packet.received'",
        )
        .get()?.count,
      1,
    );
  });

  record("server visibility filters keep reports scoped to visible agents", () => {
    assert.equal(database.listActivityInbox(["another-agent"]).items.length, 0);
    assert.equal(database.listActivityInbox([agent.id]).items.length, 1);
  });

  const secondTurnId = "activity-turn-2";
  const secondMessage = message("activity-report-message-2", secondTurnId, "A separate local report.");
  completeTurn(secondTurnId, secondMessage);
  await Promise.all([
    captureInChild(userDataPath, agent.id, threadId, secondTurnId),
    captureInChild(userDataPath, agent.id, threadId, secondTurnId),
  ]);
  snapshot = database.listActivityInbox([agent.id]);
  record("two SQLite connections capturing the same turn create one distinct item and packet", () => {
    assert.equal(snapshot.items.length, 2);
    assert.notEqual(snapshot.items[0]?.itemId, snapshot.items[1]?.itemId);
    assert.equal(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_type='activity-inbox' AND event_type='inbox.intake-packet.received'",
        )
        .get()?.count,
      2,
    );
  });

  const wrongDeliveryLinkCount = database.linkActivityInboxFollowupResultForDelivery({
    agentId: agent.id,
    taskId: "activity-task-1",
    threadId,
    deliveryId: "wrong-delivery-id",
    turnId: secondTurnId,
  });
  const wrongTaskLinkCount = database.linkActivityInboxFollowupResultForDelivery({
    agentId: agent.id,
    taskId: "other-task",
    threadId,
    deliveryId: "activity-followup-delivery",
    turnId: secondTurnId,
  });
  const linkedResultCount = database.linkActivityInboxFollowupResultForDelivery({
    agentId: agent.id,
    taskId: "activity-task-1",
    threadId,
    deliveryId: "activity-followup-delivery",
    turnId: secondTurnId,
  });
  const secondSourceSequence = database.connection
    .prepare(
      `SELECT sequence FROM orchestration_events
       WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = 'turn.completed'
         AND json_extract(payload_json, '$.detail.turnId') = ?
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(threadId, secondTurnId)?.sequence;
  snapshot = database.listActivityInbox([agent.id]);
  record("only the matching delivery, owner, task, thread and terminal turn link back to the same item", () => {
    assert.equal(wrongDeliveryLinkCount, 0);
    assert.equal(wrongTaskLinkCount, 0);
    assert.equal(linkedResultCount, 1);
    const linkedItem = snapshot.items.find((item) => item.itemId === itemId);
    assert.equal(linkedItem?.state, "followup_result_linked");
    assert.equal(linkedItem?.followupReceipt?.resultTurnId, secondTurnId);
    assert.equal(linkedItem?.followupReceipt?.resultEventSequence, secondSourceSequence);
    assert.deepEqual(linkedItem?.followupReceipt?.resultMessageIds, [secondMessage.id]);
  });

  stage = "rejected route and retry recovery";
  database.connection
    .prepare("UPDATE projection_agent_threads SET archived_at = ? WHERE thread_id = ?")
    .run(new Date().toISOString(), threadId);
  const rejectedFollowup = database.beginActivityInboxFollowup({
    itemId: snapshot.items.find((item) => item.itemId !== itemId)?.itemId ?? "missing-item",
    actionId: "activity-followup-rejected",
    clientMessageId: "activity-client-message-rejected",
    text: "Check the report.",
    actorId: "fixture-operator",
  });
  database.connection
    .prepare("UPDATE projection_agent_threads SET archived_at = NULL WHERE thread_id = ?")
    .run(threadId);
  const retryItemId = snapshot.items.find((item) => item.itemId !== itemId)?.itemId;
  assert.ok(retryItemId);
  const rejectedOnRetryItem = database.readActivityInboxItem(retryItemId)?.followupReceipt;
  record("an archived task returns a durable rejected receipt and does not send", () => {
    assert.equal(rejectedFollowup.shouldSend, false);
    assert.equal(rejectedFollowup.receipt?.status, "rejected");
    assert.equal(rejectedFollowup.receipt?.reasonCode, "task-unavailable");
    assert.equal(rejectedOnRetryItem?.status, "rejected");
  });
  const routeRetry = database.beginActivityInboxFollowup({
    itemId: retryItemId,
    actionId: "activity-followup-retry",
    clientMessageId: "activity-client-message-retry",
    text: "Check the report after the task is reopened.",
    actorId: "fixture-operator",
  });
  const routeRetryReceipt = routeRetry.receipt;
  assert.ok(routeRetryReceipt);
  database.recordActivityInboxFollowup({
    itemId: retryItemId,
    receipt: {
      ...routeRetryReceipt,
      status: "unknown",
      reasonCode: "delivery-receipt-unavailable",
      updatedAt: new Date().toISOString(),
    },
  });
  const unknownRetry = database.beginActivityInboxFollowup({
    itemId: retryItemId,
    actionId: routeRetryReceipt.actionId,
    clientMessageId: routeRetryReceipt.clientMessageId,
    text: "Check the report after the task is reopened.",
    actorId: "fixture-operator",
  });
  record("uncertain send recovery reuses the same action and client message ids", () => {
    assert.equal(routeRetry.shouldSend, true);
    assert.equal(unknownRetry.shouldSend, true);
    assert.equal(unknownRetry.receipt?.actionId, routeRetryReceipt.actionId);
    assert.equal(unknownRetry.receipt?.clientMessageId, routeRetryReceipt.clientMessageId);
  });

  database.close();
  database = new OpenBotDatabase(userDataPath);
  await runCauseEffect(database.initialize());
  snapshot = database.listActivityInbox([agent.id]);
  record("the inbox item and packet survive database restart", () => {
    assert.equal(snapshot.items.length, 2);
    assert.ok(snapshot.items.some((item) => item.itemId === itemId));
    assert.ok(
      snapshot.items.some((item) => item.packet.source_event_key === JSON.stringify([agent.id, threadId, turnId])),
    );
  });

  stage = "bounded inbox coverage";
  const template = snapshot.items[0];
  assert.ok(template);
  const appendSynthetic = database.connection.prepare(`
    INSERT INTO orchestration_events
      (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json)
    VALUES (?, ?, 'activity-inbox', ?, ?, ?, ?)
  `);
  for (let index = 0; index < 101; index += 1) {
    const syntheticTurnId = `activity-cap-turn-${index}`;
    const syntheticItemId = `inbox-cap-${index}`;
    const sourceEventKey = JSON.stringify([agent.id, threadId, syntheticTurnId]);
    const syntheticItem = {
      ...template,
      itemId: syntheticItemId,
      turnId: syntheticTurnId,
      sourceEventKey,
      sourceRef: { ...template.sourceRef, turnId: syntheticTurnId },
      packet: {
        ...template.packet,
        packet_id: syntheticItemId,
        source_event_key: sourceEventKey,
        source_ref: { ...template.packet.source_ref, turnId: syntheticTurnId },
      },
    };
    appendSynthetic.run(
      `cap-item-${index}`,
      `cap-command-${index}`,
      syntheticItemId,
      "inbox.item.received",
      new Date().toISOString(),
      JSON.stringify(syntheticItem),
    );
    appendSynthetic.run(
      `cap-packet-${index}`,
      `cap-command-${index}`,
      syntheticItemId,
      "inbox.intake-packet.received",
      new Date().toISOString(),
      JSON.stringify(syntheticItem.packet),
    );
  }
  snapshot = database.listActivityInbox([agent.id]);
  record("the 100-item list cap reports incomplete coverage", () => {
    assert.equal(snapshot.items.length, 100);
    assert.equal(snapshot.complete, false);
    assert.notEqual(snapshot.coverage, "current");
  });

  database.connection
    .prepare(
      "DELETE FROM orchestration_events WHERE aggregate_type = 'activity-inbox' AND aggregate_id LIKE 'inbox-cap-%'",
    )
    .run();
  stage = "source-thread deletion coverage";
  database.connection.prepare("DELETE FROM projection_agent_threads WHERE thread_id = ?").run(threadId);
  database.connection.prepare("DELETE FROM projection_thread_messages WHERE thread_id = ?").run(threadId);
  database.connection.prepare("DELETE FROM projection_threads WHERE thread_id = ?").run(threadId);
  snapshot = database.listActivityInbox([agent.id]);
  record("source-thread deletion keeps inbox history and marks its references as a gap", () => {
    const deletedSourceItem = snapshot.items.find((item) => item.itemId === itemId);
    assert.ok(deletedSourceItem);
    assert.equal(deletedSourceItem.coverage, "gap");
    assert.equal(snapshot.coverage, "gap");
    assert.equal(snapshot.complete, false);
    assert.ok(deletedSourceItem.packet.source_ref.messageIds.includes(reportMessage.id));
  });
  stage = "failed turn intake";
  const failedThread = "pilot-failed-thread";
  const failedTurn = "pilot-failed-turn";
  const failedAt = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO projection_threads
     (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(failedThread, agent.id, "Pilot failed task", failedTurn, failedAt, failedAt);
  database.connection
    .prepare(
      `INSERT INTO projection_agent_threads
     (thread_id, agent_id, origin, title, title_source, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, 'user', ?, 'user', ?, ?, 0)`,
    )
    .run(failedThread, agent.id, "Pilot failed task", failedAt, failedAt);
  database.persistConversationChanges({
    agentId: agent.id,
    threadId: failedThread,
    activeTurnId: null,
    changedMessages: [],
    eventType: "turn.completed",
    detail: { turnId: failedTurn, status: "failed" },
  });
  const failedInput = { agentId: agent.id, threadId: failedThread, turnId: failedTurn };
  const failedRows = () => database.listActivityInbox([agent.id]).items.filter((item) => item.turnId === failedTurn);
  assert.equal(failedRows().length, 1);
  database.captureActivityInboxFinalTaskTurn(failedInput);
  record("a failed turn with no assistant message reconciles and replays to one actionable item", () => {
    const rows = failedRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceOutcome, "failed");
    assert.equal(rows[0]?.kind, "actionable");
    assert.equal(rows[0]?.assignedOwnerId, agent.id);
    assert.equal(rows[0]?.nextAction, "Inspect the failure and decide whether to retry");
  });
  report.passed = true;
} catch (error) {
  report.error = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
} finally {
  database.close();
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exitCode = 1;
