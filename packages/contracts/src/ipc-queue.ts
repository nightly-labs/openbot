import { INPUT_LIMITS } from "./input-limits";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const QUEUE_DELIVERY_STATUSES = [
  "queued",
  "starting",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
] as const;
export type QueueDeliveryStatus = (typeof QUEUE_DELIVERY_STATUSES)[number];

export interface QueueDelivery {
  id: string;
  messageId: string;
  recipientAgentId: string;
  sender:
    | { kind: "user" }
    | { kind: "agent"; agentId: string }
    | { kind: "routine"; routineId: string; runId: string; routineName: string; scheduledFor: string };
  text: string;
  attachments: AttachmentSummary[];
  replyToMessageId: string | null;
  status: QueueDeliveryStatus;
  position: number | null;
  turnId: string | null;
  error: string | null;
  createdAt: string;
  /**
   * Another editor holds this queued message. It keeps its place in the queue and the agent does
   * not start it until the edit is saved or cancelled.
   *
   * Absent rather than false on a released Team API response: the shipped adapters project a fixed
   * key list, so a remote server drops this field instead of reporting it.
   */
  editing?: boolean;
  /**
   * Whether the sender waits for an answer. Only an agent sender sets it, and only to `false`:
   * a message the sender marked as information the recipient may act on, but must not answer.
   *
   * Absent means an answer is expected: what every message stored before this field existed meant,
   * and what a remote server too old to send it reports.
   */
  expectsReply?: boolean;
}

function isQueueDelivery(value: unknown): value is QueueDelivery {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.messageId) &&
    isIdentifier(value.recipientAgentId) &&
    isQueueSender(value.sender) &&
    isBoundedString(value.text, INPUT_LIMITS.messageText) &&
    Array.isArray(value.attachments) &&
    value.attachments.length <= INPUT_LIMITS.attachments &&
    value.attachments.every(isAttachmentSummary) &&
    (value.replyToMessageId === null || isIdentifier(value.replyToMessageId)) &&
    isOneOf(QUEUE_DELIVERY_STATUSES, value.status) &&
    (value.position === null ||
      (isNumber(value.position) && Number.isInteger(value.position) && value.position >= 1)) &&
    (value.turnId === null || isIdentifier(value.turnId)) &&
    (value.error === null || isBoundedString(value.error, INPUT_LIMITS.messageText)) &&
    isBoundedString(value.createdAt, 160) &&
    (value.editing === undefined || isBoolean(value.editing)) &&
    (value.expectsReply === undefined || isBoolean(value.expectsReply))
  );
}

function isQueueSender(value: unknown): value is QueueDelivery["sender"] {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "user") return true;
  if (value.kind === "agent") return isIdentifier(value.agentId);
  return (
    value.kind === "routine" &&
    isIdentifier(value.routineId) &&
    isIdentifier(value.runId) &&
    isBoundedString(value.routineName, INPUT_LIMITS.routineName) &&
    isBoundedString(value.scheduledFor, 160)
  );
}

export const QUEUE_HOLD_REASONS = ["channel-task"] as const;
export type QueueHoldReason = (typeof QUEUE_HOLD_REASONS)[number];

/**
 * Why a queue is waiting for something other than its own running turn.
 *
 * A channel assignment reserves the whole host, so an agent with nothing running of its own can
 * still be unable to start the message the user just sent it. Without this the wait has no visible
 * cause: the channel turn's events are not the agent's own, so the agent reads as idle.
 */
export interface QueueHold {
  reason: QueueHoldReason;
  channelId: string;
  channelName: string;
  /** The agent the channel work belongs to. Equal to the snapshot's agent when it is its own work. */
  agentId: string;
}

export function isQueueHold(value: unknown): value is QueueHold {
  return (
    isDynamicRecord(value) &&
    isOneOf(QUEUE_HOLD_REASONS, value.reason) &&
    isIdentifier(value.channelId) &&
    isBoundedString(value.channelName, INPUT_LIMITS.agentTitle) &&
    isIdentifier(value.agentId)
  );
}

export interface QueueSnapshot {
  agentId: string;
  deliveries: QueueDelivery[];
  /**
   * Absent rather than null on a released Team API response: the shipped adapters project a fixed
   * key list, so a remote server drops this field instead of reporting it.
   */
  hold?: QueueHold | null;
}

export function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isQueueDelivery) &&
    (value.hold === undefined || value.hold === null || isQueueHold(value.hold))
  );
}

export interface QueuedMessageReceipt {
  messageId: string;
  deliveries: Array<{
    id: string;
    recipientAgentId: string;
    status: QueueDeliveryStatus;
    position: number | null;
  }>;
}

export function isQueuedMessageReceipt(value: unknown): value is QueuedMessageReceipt {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.messageId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isIdentifier(delivery.id) &&
        isIdentifier(delivery.recipientAgentId) &&
        isOneOf(QUEUE_DELIVERY_STATUSES, delivery.status) &&
        (delivery.position === null ||
          (isNumber(delivery.position) && Number.isInteger(delivery.position) && delivery.position >= 1)),
    )
  );
}

export interface CancelQueuedMessageInput {
  agentId: string;
  deliveryId: string;
}

export interface AcknowledgeFailedTurnInput {
  agentId: string;
  turnId: string;
}

export interface SteerQueuedMessageInput {
  agentId: string;
  deliveryId: string;
  expectedTurnId: string;
}

export interface UpdateQueuedMessageInput {
  agentId: string;
  deliveryId: string;
  text: string;
  keepAttachmentIds: string[];
  attachmentDraftIds: string[];
}

export interface ReorderQueueInput {
  agentId: string;
  deliveryIds: string[];
}

export interface InterruptTurnInput {
  agentId: string;
  turnId: string;
}
