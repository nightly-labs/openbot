import { createHash } from "node:crypto";
import {
  type ActivityInboxFollowupInput,
  type ActivityInboxFollowupReceipt,
  type ActivityInboxItem,
  type ActivityInboxSnapshot,
  type ActivityInboxSourceRef,
  type IntakeMachinePacketV2,
  type IntakeReceipt,
  isActivityInboxItem,
  isIntakeMachinePacketV2,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { DatabaseCore, OrchestrationEventInput } from "./database-core";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database-rows";

const SOURCE_ID = "openbot:agent-task" as const;
const INBOX_AGGREGATE = "activity-inbox";
const CONFIG_AGGREGATE = "activity-inbox-config";
const CONFIG_ID = "v1";
const ACTIVATION_COMMAND = "inbox-activation:v1";
const MAX_ITEMS = 100;
const MAX_RECONCILE_EVENTS = 1_000;

interface CapturedTurn {
  agentId: string;
  threadId: string;
  turnId: string;
}

interface DurableSourceTurn {
  outcome: "completed" | "failed";
  sequence: number;
  messageIds: string[];
  sourceRef: ActivityInboxSourceRef;
  title: string;
  attachmentRefs: string[];
  occurredAt: string;
}

interface Reconciliation {
  complete: boolean;
  coverage: "current" | "gap" | "unknown";
  nextCursor: string | null;
  gapCount: number;
}

/** The durable native report event index and local-only intake packet; no table migration is needed. */
export class ActivityInboxStore {
  readonly #core: DatabaseCore;

  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  /** Writes the activation watermark once, before task execution can start on this host. */
  activate(): void {
    if (this.#readActivationSequence() !== null) return;
    const captureStartSequence = this.#sourceSequence();
    const commandId = ACTIVATION_COMMAND;
    try {
      this.#core.dispatch(
        commandId,
        [
          {
            aggregateType: CONFIG_AGGREGATE,
            aggregateId: CONFIG_ID,
            eventType: "inbox.capture-activated",
            payload: { captureStartSequence, sourceId: SOURCE_ID },
          },
        ],
        () => ({ captureStartSequence }),
      );
    } catch (error) {
      if (this.#readActivationSequence() !== null) return;
      throw error;
    }
  }

  /** Captures one committed task turn with two item/packet events and one dispatch receipt. */
  captureFinalTaskTurn(turn: CapturedTurn): IntakeReceipt {
    this.activate();
    const source = this.#readSourceTurn(turn);
    if (!source) return this.#receipt(turn, "unknown", "source-event-unavailable");
    if (source.sequence <= (this.#readActivationSequence() ?? 0))
      return this.#receipt(turn, "rejected", "before-inbox-activation", source);
    if (source.outcome === "completed" && !source.messageIds.length)
      return this.#receipt(turn, "unknown", "report-message-unavailable", source);

    const sourceEventKey = JSON.stringify([turn.agentId, turn.threadId, turn.turnId]);
    const sourceKey = `openbot.agent-task-turn\0${turn.agentId}\0${turn.threadId}\0${turn.turnId}`;
    const hash = createHash("sha256").update(sourceKey).digest("hex");
    const itemId = `inbox-${hash}`;
    const commandId = `inbox-intake:${hash}`;
    const existing = this.#core.commandResult(commandId);
    if (this.#hasExactPair(itemId, sourceEventKey, source.sequence, source.messageIds)) {
      const receipt = isIntakeReceipt(existing) ? existing : this.#receipt(turn, "accepted", undefined, source);
      return { ...receipt, result: "duplicate" };
    }

    const acceptedAt = new Date().toISOString();
    const failed = source.outcome === "failed";
    const classification = failed ? "actionable" : "reference";
    const phase = failed ? "triage" : "received_unrouted";
    const nextAction = failed ? "Inspect the failure and decide whether to retry" : "Review the completed task";
    const packet: IntakeMachinePacketV2 = {
      packetType: "openbot.inbox.intake",
      packet_version: 2,
      packet_id: itemId,
      revision: 0,
      source_event_key: sourceEventKey,
      source_event_sequence: source.sequence,
      source_message_ids: source.messageIds,
      phase: failed ? "triage" : "intake_received_unrouted",
      classification,
      assigned_owner_id: failed ? turn.agentId : null,
      next_action: nextAction,
      context: "unknown",
      source_ref: source.sourceRef,
      followup_receipt_ref: null,
      canonical_execution_ref: null,
      updated_at: acceptedAt,
    };
    const item: ActivityInboxItem = {
      schemaVersion: 1,
      itemId,
      sourceId: SOURCE_ID,
      sourceEventKey,
      sourceEventSequence: source.sequence,
      sourceOccurredAt: source.occurredAt,
      eventType: failed ? "agent-task.turn.failed" : "agent-task.turn.completed",
      kind: classification,
      state: phase,
      agentId: turn.agentId,
      taskId: source.sourceRef.taskId,
      title: source.title,
      threadId: turn.threadId,
      turnId: turn.turnId,
      messageIds: source.messageIds,
      attachmentRefs: source.attachmentRefs,
      sourceOutcome: source.outcome,
      assignedOwnerId: failed ? turn.agentId : null,
      receivedAt: acceptedAt,
      observedAt: source.occurredAt,
      acceptedAt,
      nextAction,
      coverage: "current",
      sourceRef: source.sourceRef,
      followupActionId: null,
      followupReceipt: null,
      canonicalExecutionRef: null,
      packet,
    };
    const receipt: IntakeReceipt = {
      itemId,
      packetId: itemId,
      sourceEventKey,
      sourceEventSequence: source.sequence,
      reportMessageIds: source.messageIds,
      result: "accepted",
      committedAt: acceptedAt,
      existingRevision: 0,
    };
    const events: OrchestrationEventInput[] = [
      {
        aggregateType: INBOX_AGGREGATE,
        aggregateId: itemId,
        eventType: "inbox.item.received",
        payload: item,
        occurredAt: acceptedAt,
      },
      {
        aggregateType: INBOX_AGGREGATE,
        aggregateId: itemId,
        eventType: "inbox.intake-packet.received",
        payload: packet,
        occurredAt: acceptedAt,
      },
    ];
    try {
      this.#core.dispatch(commandId, events, (_db, sequences) => ({
        ...receipt,
        committedAt: acceptedAt,
        existingRevision: sequences.length ? 0 : 0,
      }));
    } catch (error) {
      const previous = this.#core.commandResult(commandId);
      if (isIntakeReceipt(previous) && this.#hasExactPair(itemId, sourceEventKey, source.sequence, source.messageIds))
        return { ...previous, result: "duplicate" };
      throw error;
    }
    if (!this.#hasExactPair(itemId, sourceEventKey, source.sequence, source.messageIds))
      return { ...receipt, result: "unknown", reasonCode: "intake-readback-unavailable" };
    return receipt;
  }

  readItem(itemId: string, visibleAgentIds?: readonly string[]): ActivityInboxItem | null {
    const item = this.#latestItem(itemId);
    if (!item || (visibleAgentIds && !visibleAgentIds.includes(item.agentId))) return null;
    const packet = this.#latestPacket(itemId);
    if (!packet) return null;
    return this.#projectItem(item, packet);
  }

  classify(input: {
    itemId: string;
    classification: "reference" | "actionable";
    actorId: string;
  }): ActivityInboxItem | null {
    const existing = this.#latestItem(input.itemId);
    const current = existing && this.#latestPacket(input.itemId);
    if (!existing || !current || existing.followupReceipt) return existing ? this.readItem(existing.itemId) : null;
    const now = new Date().toISOString();
    const kind = input.classification === "reference" ? "reference" : "actionable";
    const item: ActivityInboxItem = {
      ...existing,
      kind,
      state: input.classification === "reference" ? "reference_only" : "triage",
      nextAction: input.classification === "reference" ? "reference only" : "request follow-up or keep as reference",
      packet: current,
    };
    const packet: IntakeMachinePacketV2 = {
      ...current,
      revision: current.revision + 1,
      phase: input.classification === "reference" ? "reference_only" : "triage",
      classification: input.classification,
      next_action: item.nextAction,
      updated_at: now,
    };
    this.#dispatchItemUpdate(item, packet, `inbox-classify:${hashKey([input.itemId, input.actorId, kind])}`, {
      aggregateType: INBOX_AGGREGATE,
      aggregateId: input.itemId,
      eventType: "inbox.item.classified",
      payload: { itemId: input.itemId, actorId: input.actorId, classification: input.classification, at: now },
      occurredAt: now,
    });
    return this.readItem(input.itemId);
  }

  beginFollowup(input: ActivityInboxFollowupInput & { actorId: string }): {
    item: ActivityInboxItem | null;
    receipt: ActivityInboxFollowupReceipt | null;
    shouldSend: boolean;
    payloadMismatch: boolean;
  } {
    const current = this.#latestItem(input.itemId);
    const currentPacket = current && this.#latestPacket(input.itemId);
    if (!current || !currentPacket) return { item: null, receipt: null, shouldSend: false, payloadMismatch: false };
    const previous = current.followupReceipt;
    const requestHash = createHash("sha256").update(input.text).digest("hex");
    if (previous) {
      const sameAction =
        previous.actionId === input.actionId &&
        previous.actorId === input.actorId &&
        previous.clientMessageId === input.clientMessageId;
      if (!sameAction && !(previous.status === "rejected" && previous.deliveryId === null))
        return { item: this.readItem(input.itemId), receipt: previous, shouldSend: false, payloadMismatch: false };
      if (sameAction && previous.requestHash !== requestHash) {
        const mismatch: ActivityInboxFollowupReceipt = {
          ...previous,
          reasonCode: "action-payload-mismatch",
          updatedAt: new Date().toISOString(),
        };
        this.recordFollowupReceipt({ itemId: input.itemId, receipt: mismatch });
        return {
          item: this.readItem(input.itemId),
          receipt: mismatch,
          shouldSend: false,
          payloadMismatch: true,
        };
      }
      if (sameAction && ["queued", "running", "result_linked"].includes(previous.status))
        return { item: this.readItem(input.itemId), receipt: previous, shouldSend: false, payloadMismatch: false };
      if (sameAction && previous.status === "rejected" && previous.deliveryId !== null)
        return { item: this.readItem(input.itemId), receipt: previous, shouldSend: false, payloadMismatch: false };
    }
    const now = new Date().toISOString();
    const task = databaseRow(
      this.#core.connection
        .prepare("SELECT agent_id, legacy_task_id, archived_at FROM projection_agent_threads WHERE thread_id = ?")
        .get(current.threadId),
    );
    const targetTaskId = task && isString(task.legacy_task_id) ? task.legacy_task_id : current.threadId;
    const sourceCurrent = this.#sourceRefExists(current);
    const routeAvailable = Boolean(
      task &&
        task.agent_id === current.agentId &&
        targetTaskId === current.taskId &&
        task.archived_at === null &&
        sourceCurrent,
    );
    const receipt: ActivityInboxFollowupReceipt = {
      actionId: input.actionId,
      actorId: input.actorId,
      clientMessageId: input.clientMessageId,
      requestHash,
      targetAgentId: current.agentId,
      targetTaskId: current.taskId,
      targetThreadId: current.threadId,
      status: routeAvailable ? "pending" : "rejected",
      messageId: null,
      deliveryId: null,
      resultTurnId: null,
      resultEventSequence: null,
      resultMessageIds: [],
      reasonCode: routeAvailable ? null : sourceCurrent ? "task-unavailable" : "source-unavailable",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const item: ActivityInboxItem = {
      ...current,
      kind: "actionable",
      state: routeAvailable ? "followup_pending" : "blocked",
      assignedOwnerId: routeAvailable ? current.agentId : null,
      followupActionId: input.actionId,
      followupReceipt: receipt,
      nextAction: routeAvailable ? "await owner send receipt" : "repair source or task before retry",
      packet: currentPacket,
    };
    const packet: IntakeMachinePacketV2 = {
      ...currentPacket,
      revision: currentPacket.revision + 1,
      phase: routeAvailable ? "followup_pending" : "blocked",
      classification: "actionable",
      assigned_owner_id: routeAvailable ? current.agentId : null,
      followup_receipt_ref: input.actionId,
      next_action: item.nextAction,
      updated_at: now,
    };
    this.#dispatchItemUpdate(item, packet, `inbox-followup:${hashKey([input.itemId, input.actorId, input.actionId])}`, {
      aggregateType: INBOX_AGGREGATE,
      aggregateId: input.itemId,
      eventType: routeAvailable ? "inbox.followup.pending" : "inbox.followup.rejected",
      payload: receipt,
      occurredAt: now,
    });
    return {
      item: this.readItem(input.itemId),
      receipt,
      shouldSend: routeAvailable,
      payloadMismatch: false,
    };
  }

  recordFollowupReceipt(input: { itemId: string; receipt: ActivityInboxFollowupReceipt }): ActivityInboxItem | null {
    const current = this.#latestItem(input.itemId);
    const packetCurrent = current && this.#latestPacket(input.itemId);
    if (!current || !packetCurrent || current.followupReceipt?.actionId !== input.receipt.actionId) return null;
    if (
      current.followupReceipt.actorId !== input.receipt.actorId ||
      current.followupReceipt.clientMessageId !== input.receipt.clientMessageId
    )
      return null;
    const now = new Date().toISOString();
    const itemState = followupItemState(input.receipt.status);
    const item: ActivityInboxItem = {
      ...current,
      state: itemState,
      assignedOwnerId:
        input.receipt.status === "queued" ||
        input.receipt.status === "running" ||
        input.receipt.status === "result_linked" ||
        input.receipt.deliveryId !== null
          ? current.agentId
          : null,
      followupActionId: input.receipt.actionId,
      followupReceipt: { ...input.receipt, updatedAt: now },
      coverage: input.receipt.status === "unknown" ? "unknown" : current.coverage,
      nextAction: followupNextAction(input.receipt.status),
      packet: packetCurrent,
    };
    const packet: IntakeMachinePacketV2 = {
      ...packetCurrent,
      revision: packetCurrent.revision + 1,
      phase: followupPacketPhase(input.receipt.status),
      classification: "actionable",
      assigned_owner_id: item.assignedOwnerId,
      followup_receipt_ref: input.receipt.actionId,
      next_action: item.nextAction,
      updated_at: now,
    };
    this.#dispatchItemUpdate(
      item,
      packet,
      `inbox-followup-receipt:${hashKey([
        input.itemId,
        input.receipt.actionId,
        input.receipt.status,
        input.receipt.deliveryId ?? "none",
        input.receipt.reasonCode ?? "none",
      ])}`,
      {
        aggregateType: INBOX_AGGREGATE,
        aggregateId: input.itemId,
        eventType: "inbox.followup.receipt",
        payload: input.receipt,
        occurredAt: now,
      },
    );
    return this.readItem(input.itemId);
  }

  linkFollowupResult(input: { itemId: string; deliveryId: string; turnId: string }): ActivityInboxItem | null {
    const current = this.#latestItem(input.itemId);
    const packetCurrent = current && this.#latestPacket(input.itemId);
    const followup = current?.followupReceipt;
    if (!current || !packetCurrent || !followup || followup.deliveryId !== input.deliveryId) return null;
    const source = this.#readSourceTurn({ agentId: current.agentId, threadId: current.threadId, turnId: input.turnId });
    if (
      source?.outcome !== "completed" ||
      source.sequence <= current.sourceEventSequence ||
      source.sourceRef.taskId !== current.taskId ||
      source.sourceRef.threadId !== followup.targetThreadId
    )
      return null;
    const receipt: ActivityInboxFollowupReceipt = {
      ...followup,
      status: "result_linked",
      resultTurnId: input.turnId,
      resultEventSequence: source.sequence,
      resultMessageIds: source.messageIds,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
    };
    return this.recordFollowupReceipt({ itemId: input.itemId, receipt });
  }

  linkFollowupResultForDelivery(input: {
    agentId: string;
    taskId: string;
    threadId: string;
    deliveryId: string;
    turnId: string;
  }): number {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT DISTINCT aggregate_id FROM orchestration_events
           WHERE aggregate_type = ? AND event_type = 'inbox.followup.receipt'
             AND json_extract(payload_json, '$.deliveryId') = ?
           ORDER BY sequence DESC`,
        )
        .all(INBOX_AGGREGATE, input.deliveryId),
    );
    let linked = 0;
    for (const row of rows) {
      const itemId = row.aggregate_id;
      if (!isString(itemId)) continue;
      const item = this.#latestItem(itemId);
      if (
        item?.agentId !== input.agentId ||
        item.taskId !== input.taskId ||
        item.threadId !== input.threadId ||
        item.followupReceipt?.deliveryId !== input.deliveryId
      )
        continue;
      if (this.linkFollowupResult({ itemId, deliveryId: input.deliveryId, turnId: input.turnId })) linked += 1;
    }
    return linked;
  }

  /** Replays only source turns after activation; the cursor advances after each complete bounded batch. */
  reconcile(): Reconciliation {
    this.activate();
    const startSequence = this.#readActivationSequence() ?? 0;
    const cursor = this.#readCursor(startSequence);
    const sourceMax = this.#sourceSequence();
    if (sourceMax <= cursor) return { complete: true, coverage: "current", nextCursor: null, gapCount: 0 };
    const endSequence = Math.min(sourceMax, cursor + MAX_RECONCILE_EVENTS);
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT sequence, aggregate_id, payload_json
           FROM orchestration_events
           WHERE sequence > ? AND sequence <= ? AND aggregate_type = 'thread' AND event_type = 'turn.completed'
           ORDER BY sequence`,
        )
        .all(cursor, endSequence),
    );
    let gapCount = 0;
    for (const row of rows) {
      const source = this.#sourceTurnFromEvent(row);
      if (source.kind === "not-a-task") continue;
      if (source.kind === "gap") {
        gapCount += 1;
        continue;
      }
      try {
        const receipt = this.captureFinalTaskTurn(source.turn);
        if (receipt.result === "unknown" || receipt.result === "rejected") gapCount += 1;
      } catch {
        gapCount += 1;
      }
    }
    if (gapCount > 0) return { complete: false, coverage: "gap", nextCursor: String(cursor), gapCount };
    if (endSequence > cursor) this.#writeCursor(endSequence);
    const truncated = endSequence < sourceMax;
    return {
      complete: !truncated,
      coverage: truncated ? "unknown" : "current",
      nextCursor: truncated ? String(endSequence) : null,
      gapCount: 0,
    };
  }

  list(visibleAgentIds?: readonly string[]): ActivityInboxSnapshot {
    const reconciliation = this.reconcile();
    if (visibleAgentIds && visibleAgentIds.length === 0) return { items: [], ...reconciliation };
    const received = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT aggregate_id, payload_json, sequence
           FROM orchestration_events
           WHERE aggregate_type = ? AND event_type = 'inbox.item.received'
           ORDER BY sequence DESC LIMIT ?`,
        )
        .all(INBOX_AGGREGATE, MAX_ITEMS + 1),
    );
    const tooMany = received.length > MAX_ITEMS;
    const items = received.slice(0, MAX_ITEMS).flatMap((row): ActivityInboxItem[] => {
      const item = isString(row.aggregate_id) ? this.#latestItem(row.aggregate_id) : null;
      if (!item || (visibleAgentIds && !visibleAgentIds.includes(item.agentId))) return [];
      const packet = this.#latestPacket(item.itemId);
      if (!packet) return [];
      return [this.#projectItem(item, packet)];
    });
    const complete = reconciliation.complete && !tooMany;
    return {
      items,
      complete,
      coverage:
        reconciliation.coverage === "gap" || items.some((item) => item.coverage === "gap")
          ? "gap"
          : complete
            ? "current"
            : "unknown",
      nextCursor: reconciliation.nextCursor,
      gapCount: reconciliation.gapCount + items.filter((item) => item.coverage === "gap").length,
    };
  }

  #latestPacket(itemId: string): IntakeMachinePacketV2 | null {
    const events = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND aggregate_id = ?
             AND event_type IN ('inbox.intake-packet.received', 'inbox.intake-packet.updated')
           ORDER BY sequence DESC LIMIT 1`,
        )
        .all(INBOX_AGGREGATE, itemId),
    );
    return events.length ? parsePacket(events[0]?.payload_json) : null;
  }

  #latestItem(itemId: string): ActivityInboxItem | null {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND aggregate_id = ?
             AND event_type IN ('inbox.item.received', 'inbox.item.updated')
           ORDER BY sequence DESC LIMIT 1`,
        )
        .all(INBOX_AGGREGATE, itemId),
    );
    return rows.length ? parseItem(rows[0]?.payload_json) : null;
  }

  #projectItem(item: ActivityInboxItem, packet: IntakeMachinePacketV2): ActivityInboxItem {
    return { ...item, coverage: this.#sourceRefExists(item) ? item.coverage : "gap", packet };
  }

  #sourceRefExists(item: ActivityInboxItem): boolean {
    const thread = databaseRow(
      this.#core.connection.prepare("SELECT 1 AS found FROM projection_threads WHERE thread_id = ?").get(item.threadId),
    );
    if (!thread) return false;
    const messagesExist = item.messageIds.every((messageId) =>
      Boolean(
        databaseRow(
          this.#core.connection
            .prepare("SELECT 1 AS found FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?")
            .get(item.threadId, messageId),
        ),
      ),
    );
    if (!messagesExist) return false;
    return item.attachmentRefs.every((attachmentId) =>
      Boolean(
        databaseRow(
          this.#core.connection
            .prepare("SELECT 1 AS found FROM projection_attachments WHERE attachment_id = ?")
            .get(attachmentId),
        ),
      ),
    );
  }

  #dispatchItemUpdate(
    item: ActivityInboxItem,
    packet: IntakeMachinePacketV2,
    commandId: string,
    auditEvent?: OrchestrationEventInput,
  ): void {
    const occurredAt = packet.updated_at;
    this.#core.dispatch(
      commandId,
      [
        ...(auditEvent ? [auditEvent] : []),
        {
          aggregateType: INBOX_AGGREGATE,
          aggregateId: item.itemId,
          eventType: "inbox.item.updated",
          payload: { ...item, packet },
          occurredAt,
        },
        {
          aggregateType: INBOX_AGGREGATE,
          aggregateId: item.itemId,
          eventType: "inbox.intake-packet.updated",
          payload: packet,
          occurredAt,
        },
      ],
      () => ({ itemId: item.itemId, packetId: packet.packet_id, revision: packet.revision }),
    );
  }

  #hasExactPair(itemId: string, sourceEventKey: string, sequence: number, messageIds: string[]): boolean {
    const itemRow = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND aggregate_id = ? AND event_type = 'inbox.item.received' LIMIT 1`,
        )
        .get(INBOX_AGGREGATE, itemId),
    );
    const packet = this.#latestPacket(itemId);
    const item = itemRow ? parseItem(itemRow.payload_json) : null;
    return Boolean(
      item &&
        packet &&
        item.sourceEventKey === sourceEventKey &&
        item.sourceEventSequence === sequence &&
        arraysEqual(item.messageIds, messageIds) &&
        packet.source_event_key === sourceEventKey &&
        packet.source_event_sequence === sequence &&
        arraysEqual(packet.source_message_ids, messageIds),
    );
  }

  #readSourceTurn(turn: CapturedTurn): DurableSourceTurn | null {
    const event = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT sequence, occurred_at, json_extract(payload_json, '$.detail.status') AS outcome FROM orchestration_events
           WHERE aggregate_type = 'thread' AND aggregate_id = ? AND event_type = 'turn.completed'
             AND json_extract(payload_json, '$.detail.turnId') = ?
             AND json_extract(payload_json, '$.detail.status') IN ('completed', 'failed')
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(turn.threadId, turn.turnId),
    );
    const owner = databaseRow(
      this.#core.connection
        .prepare("SELECT agent_id, routine_id, legacy_task_id, title FROM projection_agent_threads WHERE thread_id = ?")
        .get(turn.threadId),
    );
    if (!event || !owner || requiredStringColumn(owner, "agent_id") !== turn.agentId || owner.routine_id !== null)
      return null;
    const messageIds = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT message_id FROM projection_thread_messages
           WHERE thread_id = ? AND turn_id = ? AND author IN ('assistant', 'agent') AND status != 'streaming'
           ORDER BY created_at, ordinal, message_id`,
        )
        .all(turn.threadId, turn.turnId),
    ).map((row) => requiredStringColumn(row, "message_id"));
    const outcome = event.outcome === "failed" ? "failed" : "completed";
    if (outcome === "completed" && !messageIds.length) return null;
    const sequence = requiredNumberColumn(event, "sequence");
    const occurredAt = requiredStringColumn(event, "occurred_at");
    const taskId = isString(owner.legacy_task_id) ? owner.legacy_task_id : turn.threadId;
    const attachmentRefs = messageIds.length
      ? databaseRows(
          this.#core.connection
            .prepare(
              `SELECT attachment_id FROM projection_attachments
           WHERE owner_kind = 'thread-message' AND owner_id IN (${messageIds.map(() => "?").join(",")})
           ORDER BY attachment_id`,
            )
            .all(...messageIds.map((messageId) => `${turn.threadId}:${messageId}`)),
        ).map((row) => requiredStringColumn(row, "attachment_id"))
      : [];
    return {
      outcome,
      sourceRef: {
        agentId: turn.agentId,
        taskId,
        threadId: turn.threadId,
        turnId: turn.turnId,
        eventType: "turn.completed",
        eventSequence: sequence,
        messageIds,
        sourceOccurredAt: occurredAt,
      },
      sequence,
      messageIds,
      title: isString(owner.title) ? owner.title : "",
      attachmentRefs,
      occurredAt,
    };
  }

  #sourceTurnFromEvent(
    row: DynamicRecord,
  ): { kind: "not-a-task" } | { kind: "gap" } | { kind: "turn"; turn: CapturedTurn } {
    const threadId = row.aggregate_id;
    if (!isString(threadId) || !isString(row.payload_json)) return { kind: "gap" };
    const event = parseSourceEvent(row.payload_json);
    if (!event) return { kind: "gap" };
    if (event.status !== "completed" && event.status !== "failed") return { kind: "not-a-task" };
    const side = databaseRow(
      this.#core.connection
        .prepare("SELECT agent_id, routine_id FROM projection_agent_threads WHERE thread_id = ?")
        .get(threadId),
    );
    if (!side) {
      const mainThread = databaseRow(
        this.#core.connection.prepare("SELECT 1 AS found FROM projection_agents WHERE thread_id = ?").get(threadId),
      );
      return mainThread ? { kind: "not-a-task" } : { kind: "gap" };
    }
    if (side.routine_id !== null) return { kind: "not-a-task" };
    const agentId = side.agent_id;
    if (!isString(agentId) || !event.turnId) return { kind: "gap" };
    const messages = databaseRows(
      this.#core.connection
        .prepare(
          `SELECT 1 AS found FROM projection_thread_messages
           WHERE thread_id = ? AND turn_id = ? AND author IN ('assistant', 'agent') AND status != 'streaming' LIMIT 1`,
        )
        .all(threadId, event.turnId),
    );
    if (event.status === "completed" && !messages.length) return { kind: "gap" };
    return { kind: "turn", turn: { agentId, threadId, turnId: event.turnId } };
  }

  #sourceSequence(): number {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT sequence FROM orchestration_events
           WHERE aggregate_type NOT IN (?, ?) ORDER BY sequence DESC LIMIT 1`,
        )
        .get(INBOX_AGGREGATE, CONFIG_AGGREGATE),
    );
    return row ? requiredNumberColumn(row, "sequence") : 0;
  }

  #readActivationSequence(): number | null {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND aggregate_id = ? AND event_type = 'inbox.capture-activated'
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(CONFIG_AGGREGATE, CONFIG_ID),
    );
    if (!row || !isString(row.payload_json)) return null;
    const payload = parseObject(row.payload_json);
    return payload && isSafeInteger(payload.captureStartSequence) ? payload.captureStartSequence : null;
  }

  #readCursor(defaultSequence: number): number {
    const row = databaseRow(
      this.#core.connection
        .prepare(
          `SELECT payload_json FROM orchestration_events
           WHERE aggregate_type = ? AND aggregate_id = ? AND event_type = 'inbox.reconcile.cursor'
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(CONFIG_AGGREGATE, CONFIG_ID),
    );
    if (!row || !isString(row.payload_json)) return defaultSequence;
    const payload = parseObject(row.payload_json);
    return payload && isSafeInteger(payload.sourceSequence) ? payload.sourceSequence : defaultSequence;
  }

  #writeCursor(sourceSequence: number): void {
    const commandId = `inbox-reconcile:${sourceSequence}`;
    if (this.#core.commandResult(commandId) !== undefined) return;
    try {
      this.#core.dispatch(
        commandId,
        [
          {
            aggregateType: CONFIG_AGGREGATE,
            aggregateId: CONFIG_ID,
            eventType: "inbox.reconcile.cursor",
            payload: { sourceSequence },
          },
        ],
        () => ({ sourceSequence }),
      );
    } catch (error) {
      if (this.#readCursor(0) >= sourceSequence) return;
      throw error;
    }
  }

  #receipt(
    turn: CapturedTurn,
    result: IntakeReceipt["result"],
    reasonCode?: string,
    source?: DurableSourceTurn | null,
  ): IntakeReceipt {
    const sourceEventKey = JSON.stringify([turn.agentId, turn.threadId, turn.turnId]);
    const hash = createHash("sha256")
      .update(`openbot.agent-task-turn\0${turn.agentId}\0${turn.threadId}\0${turn.turnId}`)
      .digest("hex");
    return {
      itemId: `inbox-${hash}`,
      packetId: `inbox-${hash}`,
      sourceEventKey,
      sourceEventSequence: source?.sequence ?? 0,
      reportMessageIds: source?.messageIds ?? [],
      result,
      ...(reasonCode ? { reasonCode } : {}),
    };
  }
}

function parseSourceEvent(value: unknown): { turnId: string; status: string } | null {
  if (!isString(value)) return null;
  const payload = parseObject(value);
  if (!payload || !isDynamicRecord(payload.detail)) return null;
  const turnId = payload.detail.turnId;
  const status = payload.detail.status;
  return isString(turnId) && isString(status) ? { turnId, status } : null;
}

function parseObject(value: string): DynamicRecord | null {
  try {
    const parsed = JSON.parse(value);
    return isDynamicRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseItem(value: unknown): ActivityInboxItem | null {
  if (!isString(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return isActivityInboxItem(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parsePacket(value: unknown): IntakeMachinePacketV2 | null {
  if (!isString(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return isIntakeMachinePacketV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hashKey(values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function followupItemState(status: ActivityInboxFollowupReceipt["status"]): ActivityInboxItem["state"] {
  switch (status) {
    case "pending":
      return "followup_pending";
    case "queued":
      return "followup_queued";
    case "running":
      return "followup_running";
    case "result_linked":
      return "followup_result_linked";
    case "rejected":
    case "unknown":
      return "blocked";
  }
}

function followupPacketPhase(status: ActivityInboxFollowupReceipt["status"]): IntakeMachinePacketV2["phase"] {
  switch (status) {
    case "pending":
      return "followup_pending";
    case "queued":
      return "followup_queued";
    case "running":
      return "followup_running";
    case "result_linked":
      return "followup_result_linked";
    case "rejected":
    case "unknown":
      return "blocked";
  }
}

function followupNextAction(
  status: ActivityInboxFollowupReceipt["status"],
):
  | "await owner send receipt"
  | "await owner delivery"
  | "await correlated result"
  | "review linked result"
  | "fix the route and retry"
  | "reconcile using the same action and message ids" {
  switch (status) {
    case "pending":
      return "await owner send receipt";
    case "queued":
      return "await owner delivery";
    case "running":
      return "await correlated result";
    case "result_linked":
      return "review linked result";
    case "rejected":
      return "fix the route and retry";
    case "unknown":
      return "reconcile using the same action and message ids";
  }
}

function isIntakeReceipt(value: unknown): value is IntakeReceipt {
  if (!isDynamicRecord(value)) return false;
  return (
    isString(value.itemId) &&
    isString(value.packetId) &&
    isString(value.sourceEventKey) &&
    isSafeInteger(value.sourceEventSequence) &&
    Array.isArray(value.reportMessageIds) &&
    value.reportMessageIds.every(isString) &&
    ["accepted", "duplicate", "rejected", "unknown"].includes(String(value.result))
  );
}
