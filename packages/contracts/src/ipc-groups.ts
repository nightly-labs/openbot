import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const GROUP_CHATS_CAPABILITY = "group-chats-v1";
export const GROUP_PARALLEL_LIMIT = 2;
export const GROUP_ASSIGNMENT_LIMIT = 8;

export interface GroupMember {
  agentId: string;
  responsibility: string;
}

export interface GroupDraft {
  name: string;
  purpose: string;
  members: GroupMember[];
  leadAgentId: string | null;
  linkedThreadIds: string[];
}

export interface Group extends GroupDraft {
  id: string;
  archived: boolean;
  revision: number;
  createdAt: string;
}

export type GroupTaskState = "queued" | "running" | "waiting" | "paused" | "completed" | "failed" | "cancelled";

export interface GroupTask {
  id: string;
  groupId: string;
  parentTaskId: string | null;
  rootTaskId: string;
  ownerAgentId: string | null;
  requestMessageId: string;
  instruction: string;
  attachmentDraftIds: string[];
  expectedResult: string;
  sourceMessageIds: string[];
  dependencies: string[];
  resources: string[];
  state: GroupTaskState;
  revision: number;
  assignmentCount: number;
  error: string | null;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  sequence: number;
  author: { kind: "member" | "agent" | "coordinator"; id: string; name: string };
  taskId: string | null;
  superseded: boolean;
  message: ConversationMessage;
}

export interface GroupSummary extends Group {
  unreadCount: number;
  activeTasks: number;
}

export interface GroupPage {
  group: Group;
  messages: GroupMessage[];
  tasks: GroupTask[];
  olderCursor: number | null;
  throughSequence: number;
}

export type GroupCommand =
  | { type: "save"; operationId: string; groupId: string; draft: GroupDraft }
  | { type: "restore"; operationId: string; groupId: string }
  | { type: "archive"; operationId: string; groupId: string }
  | {
      type: "send";
      operationId: string;
      groupId: string;
      text: string;
      recipientAgentId: string | null;
      replyToMessageId: string | null;
      attachmentDraftIds: string[];
    }
  | {
      type: "stop" | "resume" | "reassign";
      operationId: string;
      groupId: string;
      taskId: string;
      recipientAgentId: string | null;
    }
  | { type: "read"; operationId: string; groupId: string; throughSequence: number };

export interface GroupReadInput {
  groupId: string;
  beforeSequence?: number;
}

export function isGroupDraft(value: unknown): value is GroupDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.purpose, INPUT_LIMITS.agentDescription) &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.agents &&
    value.members.every(isGroupMember) &&
    new Set(value.members.map((member) => member.agentId)).size === value.members.length &&
    (value.leadAgentId === null ||
      (isIdentifier(value.leadAgentId) && value.members.some((member) => member.agentId === value.leadAgentId))) &&
    identifiers(value.linkedThreadIds)
  );
}

function isGroupMember(value: unknown): value is GroupMember {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.responsibility, INPUT_LIMITS.agentDescription)
  );
}

function identifiers(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= INPUT_LIMITS.agents &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

function sequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isGroup(value: unknown): value is Group {
  return (
    isDynamicRecord(value) &&
    isGroupDraft(value) &&
    isIdentifier(value.id) &&
    typeof value.archived === "boolean" &&
    sequence(value.revision) &&
    isBoundedString(value.createdAt, 80)
  );
}

export function isGroupTask(value: unknown): value is GroupTask {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.groupId) &&
    isIdentifier(value.rootTaskId) &&
    (value.parentTaskId === null || isIdentifier(value.parentTaskId)) &&
    (value.ownerAgentId === null || isIdentifier(value.ownerAgentId)) &&
    isIdentifier(value.requestMessageId) &&
    identifiers(value.attachmentDraftIds) &&
    isBoundedString(value.instruction, INPUT_LIMITS.messageText) &&
    isBoundedString(value.expectedResult, INPUT_LIMITS.messageText) &&
    identifiers(value.sourceMessageIds) &&
    identifiers(value.dependencies) &&
    Array.isArray(value.resources) &&
    value.resources.length <= 64 &&
    value.resources.every((resource) => isBoundedString(resource, INPUT_LIMITS.path)) &&
    isOneOf(["queued", "running", "waiting", "paused", "completed", "failed", "cancelled"] as const, value.state) &&
    sequence(value.revision) &&
    sequence(value.assignmentCount) &&
    (value.error === null || isBoundedString(value.error, INPUT_LIMITS.messageText))
  );
}

export function isGroupMessage(value: unknown): value is GroupMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.groupId) &&
    sequence(value.sequence) &&
    isDynamicRecord(value.author) &&
    isOneOf(["member", "agent", "coordinator"] as const, value.author.kind) &&
    isIdentifier(value.author.id) &&
    isBoundedString(value.author.name, INPUT_LIMITS.agentName) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    typeof value.superseded === "boolean" &&
    isConversationMessage(value.message)
  );
}

export function decodeGroup(value: unknown): Group {
  if (!isGroup(value)) throw new Error("Invalid group response.");
  return value;
}

export function decodeGroupPage(value: unknown): GroupPage {
  if (
    !isDynamicRecord(value) ||
    !isGroup(value.group) ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isGroupMessage) ||
    !Array.isArray(value.tasks) ||
    !value.tasks.every(isGroupTask) ||
    !(value.olderCursor === null || sequence(value.olderCursor)) ||
    !sequence(value.throughSequence)
  ) {
    throw new Error("Invalid group conversation response.");
  }
  return {
    group: value.group,
    messages: value.messages,
    tasks: value.tasks,
    olderCursor: value.olderCursor,
    throughSequence: value.throughSequence,
  };
}

export function decodeGroupSummaries(value: unknown): GroupSummary[] {
  if (!Array.isArray(value) || !value.every(isGroupSummary)) throw new Error("Invalid group list response.");
  return value;
}

function isGroupSummary(value: unknown): value is GroupSummary {
  return isDynamicRecord(value) && isGroup(value) && sequence(value.unreadCount) && sequence(value.activeTasks);
}

export function parseGroupRead(value: unknown): GroupReadInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.groupId) ||
    !(value.beforeSequence === undefined || sequence(value.beforeSequence))
  ) {
    throw new Error("Provide a valid group and message cursor.");
  }
  return { groupId: value.groupId, beforeSequence: value.beforeSequence };
}

export function parseGroupCommand(value: unknown): GroupCommand {
  if (!isDynamicRecord(value) || !isIdentifier(value.operationId) || !isIdentifier(value.groupId))
    throw new Error("Provide a valid group command.");
  const common = { operationId: value.operationId, groupId: value.groupId };
  if (value.type === "save" && isGroupDraft(value.draft)) return { ...common, type: value.type, draft: value.draft };
  if (value.type === "archive" || value.type === "restore") return { ...common, type: value.type };
  if (value.type === "read" && sequence(value.throughSequence))
    return { ...common, type: value.type, throughSequence: value.throughSequence };
  if (
    (value.type === "stop" || value.type === "resume" || value.type === "reassign") &&
    isIdentifier(value.taskId) &&
    (value.recipientAgentId === null || isIdentifier(value.recipientAgentId))
  ) {
    return { ...common, type: value.type, taskId: value.taskId, recipientAgentId: value.recipientAgentId };
  }
  if (
    value.type === "send" &&
    isBoundedString(value.text, INPUT_LIMITS.messageText) &&
    (value.recipientAgentId === null || isIdentifier(value.recipientAgentId)) &&
    (value.replyToMessageId === null || isIdentifier(value.replyToMessageId)) &&
    identifiers(value.attachmentDraftIds) &&
    (value.text.trim().length > 0 || value.attachmentDraftIds.length > 0)
  ) {
    return {
      ...common,
      type: value.type,
      text: value.text,
      recipientAgentId: value.recipientAgentId,
      replyToMessageId: value.replyToMessageId,
      attachmentDraftIds: value.attachmentDraftIds,
    };
  }
  throw new Error("Provide a valid group command.");
}
