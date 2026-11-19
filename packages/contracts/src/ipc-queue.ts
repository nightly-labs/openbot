import { INPUT_LIMITS } from "./input-limits";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";
import type { QueueEditRequest } from "./team-protocol/queue-edit-v1";

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

export const BUSY_MESSAGE_MODES = ["queue", "steer"] as const;
export type BusyMessageMode = (typeof BUSY_MESSAGE_MODES)[number];
export const DEFAULT_BUSY_MESSAGE_MODE: BusyMessageMode = "steer";

export function isBusyMessageMode(value: unknown): value is BusyMessageMode {
  return isOneOf(BUSY_MESSAGE_MODES, value);
}

export interface BusyMessageModePreference {
  mode: BusyMessageMode;
}

export const QUEUE_STEER_FALLBACKS = ["provider-unsupported", "steer-failed"] as const;
export type QueueSteerFallback = (typeof QUEUE_STEER_FALLBACKS)[number];

export interface QueueDelivery {
  id: string;
  messageId: string;
  recipientAgentId: string;
  sender:
    | { kind: "user" }
    | { kind: "agent"; agentId: string }
    | { kind: "routine"; routineId: string; runId: string; routineName: string; scheduledFor: string }
    | { kind: "remote-agent"; agentId: string; agentName: string; linkId: string; serverName: string };
  text: string;
  attachments: AttachmentSummary[];
  replyToMessageId: string | null;
  status: QueueDeliveryStatus;
  position: number | null;
  turnId: string | null;
  error: string | null;
  createdAt: string;
  editing?: boolean;
  expectsReply?: boolean;
  steerFallback?: QueueSteerFallback;
}

export function isQueuedAgentReply(delivery: QueueDelivery): boolean {
  return (
    delivery.status === "queued" &&
    delivery.sender.kind === "agent" &&
    delivery.replyToMessageId !== null &&
    delivery.expectsReply === false
  );
}

export function routineRunsTurn(
  deliveries: readonly QueueDelivery[] | undefined,
  turnId: string | null | undefined,
): boolean {
  if (!turnId) return false;
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.sender.kind === "routine" &&
      (delivery.status === "starting" || delivery.status === "running") &&
      delivery.turnId === turnId,
  );
}

export function isQueueDelivery(value: unknown): value is QueueDelivery {
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
    (value.expectsReply === undefined || isBoolean(value.expectsReply)) &&
    (value.steerFallback === undefined || isOneOf(QUEUE_STEER_FALLBACKS, value.steerFallback))
  );
}

function isQueueSender(value: unknown): value is QueueDelivery["sender"] {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "user") return true;
  if (value.kind === "agent") return isIdentifier(value.agentId);
  if (value.kind === "remote-agent") {
    return (
      isIdentifier(value.agentId) &&
      isIdentifier(value.linkId) &&
      isBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
      isBoundedString(value.serverName, INPUT_LIMITS.agentName)
    );
  }
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

export interface QueueHold {
  reason: QueueHoldReason;
  channelId: string;
  channelName: string;
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
  hold?: QueueHold | null;
  welcome?: true;
}

export function isQueueSnapshot(value: unknown): value is QueueSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isQueueDelivery) &&
    (value.hold === undefined || value.hold === null || isQueueHold(value.hold)) &&
    (value.welcome === undefined || value.welcome === true)
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
  taskId?: string;
}

export interface InterruptTurnInput {
  agentId: string;
  turnId: string;
}

export type EditQueuedMessageInput = QueueEditRequest & { agentId: string };
