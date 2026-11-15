import { isDynamicRecord, isString } from "./runtime-values";

export interface ActivityInboxSourceRef {
  agentId: string;
  taskId: string;
  threadId: string;
  turnId: string;
  eventType: "turn.completed";
  eventSequence: number;
  messageIds: string[];
  sourceOccurredAt: string;
}

export interface CanonicalExecutionRef {
  issue: string;
  hubTaskId: string | null;
  packetVersion: 1;
  observedAt: string;
  evidenceRef: string;
}

export interface ActivityInboxFollowupReceipt {
  actionId: string;
  actorId: string;
  clientMessageId: string;
  /** SHA-256 of the exact submitted text; the intake event does not duplicate the message body. */
  requestHash: string;
  targetAgentId: string;
  targetTaskId: string;
  targetThreadId: string;
  status: "pending" | "queued" | "running" | "result_linked" | "rejected" | "unknown";
  messageId: string | null;
  deliveryId: string | null;
  resultTurnId: string | null;
  resultEventSequence: number | null;
  resultMessageIds: string[];
  reasonCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityInboxFollowupInput {
  itemId: string;
  actionId: string;
  clientMessageId: string;
  text: string;
}

export interface ActivityInboxClassifyInput {
  itemId: string;
  classification: "reference" | "actionable";
}

export function isActivityInboxFollowupInput(value: unknown): value is ActivityInboxFollowupInput {
  return (
    isDynamicRecord(value) &&
    isString(value.itemId) &&
    isString(value.actionId) &&
    isString(value.clientMessageId) &&
    isString(value.text) &&
    value.text.length <= 32_000
  );
}

export function isActivityInboxClassifyInput(value: unknown): value is ActivityInboxClassifyInput {
  return (
    isDynamicRecord(value) &&
    isString(value.itemId) &&
    ["reference", "actionable"].includes(String(value.classification))
  );
}

export interface IntakeMachinePacketV2 {
  packetType: "openbot.inbox.intake";
  packet_version: 2;
  packet_id: string;
  revision: number;
  source_event_key: string;
  source_event_sequence: number;
  source_message_ids: string[];
  phase:
    | "intake_received_unrouted"
    | "triage"
    | "reference_only"
    | "followup_pending"
    | "followup_queued"
    | "followup_running"
    | "followup_result_linked"
    | "blocked"
    | "execution_linked";
  classification: "unknown" | "reference" | "actionable";
  assigned_owner_id: string | null;
  next_action: string;
  context: "unknown" | "observed";
  source_ref: ActivityInboxSourceRef;
  followup_receipt_ref: string | null;
  canonical_execution_ref: CanonicalExecutionRef | null;
  updated_at: string;
}

export interface ActivityInboxItem {
  schemaVersion: 1;
  itemId: string;
  sourceId: "openbot:agent-task";
  sourceEventKey: string;
  sourceEventSequence: number;
  sourceOccurredAt: string;
  eventType: "agent-task.turn.completed" | "agent-task.turn.failed";
  kind: "unclassified" | "reference" | "actionable";
  state:
    | "received_unrouted"
    | "triage"
    | "reference_only"
    | "followup_pending"
    | "followup_queued"
    | "followup_running"
    | "followup_result_linked"
    | "blocked"
    | "execution_linked";
  agentId: string;
  taskId: string;
  title: string;
  threadId: string;
  turnId: string;
  messageIds: string[];
  attachmentRefs: string[];
  sourceOutcome: "completed" | "failed";
  assignedOwnerId: string | null;
  receivedAt: string;
  observedAt: string;
  acceptedAt: string;
  nextAction: string;
  coverage: "current" | "stale" | "gap" | "unknown";
  sourceRef: ActivityInboxSourceRef;
  followupActionId: string | null;
  followupReceipt: ActivityInboxFollowupReceipt | null;
  canonicalExecutionRef: CanonicalExecutionRef | null;
  packet: IntakeMachinePacketV2;
}

export interface ActivityInboxSnapshot {
  items: ActivityInboxItem[];
  complete: boolean;
  coverage: "current" | "gap" | "unknown";
  nextCursor: string | null;
  gapCount: number;
}

export interface IntakeReceipt {
  itemId: string;
  packetId: string;
  sourceEventKey: string;
  sourceEventSequence: number;
  reportMessageIds: string[];
  result: "accepted" | "duplicate" | "rejected" | "unknown";
  committedAt?: string;
  existingRevision?: number;
  reasonCode?: string;
}

export function isActivityInboxSnapshot(value: unknown): value is ActivityInboxSnapshot {
  if (!isDynamicRecord(value)) return false;
  return (
    typeof value.complete === "boolean" &&
    Array.isArray(value.items) &&
    value.items.every(isActivityInboxItem) &&
    ["current", "gap", "unknown"].includes(String(value.coverage)) &&
    (value.nextCursor === null || isString(value.nextCursor)) &&
    typeof value.gapCount === "number" &&
    Number.isSafeInteger(value.gapCount) &&
    value.gapCount >= 0
  );
}

function isActivityInboxSourceRef(value: unknown): value is ActivityInboxSourceRef {
  if (!isDynamicRecord(value)) return false;
  return (
    isString(value.agentId) &&
    isString(value.taskId) &&
    isString(value.threadId) &&
    isString(value.turnId) &&
    value.eventType === "turn.completed" &&
    isSequence(value.eventSequence) &&
    Array.isArray(value.messageIds) &&
    value.messageIds.every(isString) &&
    isString(value.sourceOccurredAt)
  );
}

function isCanonicalExecutionRef(value: unknown): value is CanonicalExecutionRef | null {
  if (value === null) return true;
  if (!isDynamicRecord(value)) return false;
  return (
    isString(value.issue) &&
    (value.hubTaskId === null || isString(value.hubTaskId)) &&
    value.packetVersion === 1 &&
    isString(value.observedAt) &&
    isString(value.evidenceRef)
  );
}

export function isIntakeMachinePacketV2(value: unknown): value is IntakeMachinePacketV2 {
  if (!isDynamicRecord(value)) return false;
  return (
    value.packetType === "openbot.inbox.intake" &&
    value.packet_version === 2 &&
    isString(value.packet_id) &&
    isSequence(value.revision) &&
    isString(value.source_event_key) &&
    isSequence(value.source_event_sequence) &&
    Array.isArray(value.source_message_ids) &&
    value.source_message_ids.every(isString) &&
    packetPhase(value.phase) &&
    ["unknown", "reference", "actionable"].includes(String(value.classification)) &&
    (value.assigned_owner_id === null || isString(value.assigned_owner_id)) &&
    isString(value.next_action) &&
    ["unknown", "observed"].includes(String(value.context)) &&
    isActivityInboxSourceRef(value.source_ref) &&
    (value.followup_receipt_ref === null || isString(value.followup_receipt_ref)) &&
    isCanonicalExecutionRef(value.canonical_execution_ref) &&
    isString(value.updated_at)
  );
}

export function isActivityInboxItem(value: unknown): value is ActivityInboxItem {
  if (!isDynamicRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isString(value.itemId) &&
    value.sourceId === "openbot:agent-task" &&
    isString(value.sourceEventKey) &&
    isSequence(value.sourceEventSequence) &&
    isString(value.sourceOccurredAt) &&
    (value.eventType === "agent-task.turn.completed" || value.eventType === "agent-task.turn.failed") &&
    ["unclassified", "reference", "actionable"].includes(String(value.kind)) &&
    itemState(value.state) &&
    isString(value.agentId) &&
    isString(value.taskId) &&
    isString(value.title) &&
    isString(value.threadId) &&
    isString(value.turnId) &&
    Array.isArray(value.messageIds) &&
    value.messageIds.every(isString) &&
    Array.isArray(value.attachmentRefs) &&
    value.attachmentRefs.every(isString) &&
    value.sourceOutcome === (value.eventType === "agent-task.turn.failed" ? "failed" : "completed") &&
    (value.assignedOwnerId === null || isString(value.assignedOwnerId)) &&
    isString(value.receivedAt) &&
    isString(value.observedAt) &&
    isString(value.acceptedAt) &&
    isString(value.nextAction) &&
    ["current", "stale", "gap", "unknown"].includes(String(value.coverage)) &&
    isActivityInboxSourceRef(value.sourceRef) &&
    (value.followupActionId === null || isString(value.followupActionId)) &&
    (value.followupReceipt === null || isActivityInboxFollowupReceipt(value.followupReceipt)) &&
    isCanonicalExecutionRef(value.canonicalExecutionRef) &&
    isIntakeMachinePacketV2(value.packet)
  );
}

export function isActivityInboxFollowupReceipt(value: unknown): value is ActivityInboxFollowupReceipt {
  if (!isDynamicRecord(value)) return false;
  return (
    isString(value.actionId) &&
    isString(value.actorId) &&
    isString(value.clientMessageId) &&
    isString(value.requestHash) &&
    /^[a-f0-9]{64}$/iu.test(value.requestHash) &&
    isString(value.targetAgentId) &&
    isString(value.targetTaskId) &&
    isString(value.targetThreadId) &&
    ["pending", "queued", "running", "result_linked", "rejected", "unknown"].includes(String(value.status)) &&
    (value.messageId === null || isString(value.messageId)) &&
    (value.deliveryId === null || isString(value.deliveryId)) &&
    (value.resultTurnId === null || isString(value.resultTurnId)) &&
    (value.resultEventSequence === null || isSequence(value.resultEventSequence)) &&
    Array.isArray(value.resultMessageIds) &&
    value.resultMessageIds.every(isString) &&
    (value.reasonCode === null || isString(value.reasonCode)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function packetPhase(value: unknown): value is IntakeMachinePacketV2["phase"] {
  return [
    "intake_received_unrouted",
    "triage",
    "reference_only",
    "followup_pending",
    "followup_queued",
    "followup_running",
    "followup_result_linked",
    "blocked",
    "execution_linked",
  ].includes(String(value));
}

function itemState(value: unknown): value is ActivityInboxItem["state"] {
  return [
    "received_unrouted",
    "triage",
    "reference_only",
    "followup_pending",
    "followup_queued",
    "followup_running",
    "followup_result_linked",
    "blocked",
    "execution_linked",
  ].includes(String(value));
}
