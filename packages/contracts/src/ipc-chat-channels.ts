import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const CHANNEL_CHATS_CAPABILITY = "channel-chats-v1";
export const CHANNEL_PARALLEL_LIMIT = 2;
export const CHANNEL_ASSIGNMENT_LIMIT = 8;

export interface ChannelMember {
  agentId: string;
  responsibility: string;
}

export interface ChannelDraft {
  name: string;
  purpose: string;
  members: ChannelMember[];
  leadAgentId: string | null;
  linkedThreadIds: string[];
}

export interface Channel extends ChannelDraft {
  id: string;
  archived: boolean;
  revision: number;
  createdAt: string;
}

export type ChannelTaskState = "queued" | "running" | "waiting" | "paused" | "completed" | "failed" | "cancelled";

export interface ChannelTask {
  id: string;
  channelId: string;
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
  state: ChannelTaskState;
  revision: number;
  assignmentCount: number;
  error: string | null;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  sequence: number;
  author: { kind: "member" | "agent" | "coordinator"; id: string; name: string };
  taskId: string | null;
  superseded: boolean;
  message: ConversationMessage;
}

/** One ellipsised sidebar line: enough to preview a channel, never a whole message body. */
export interface ChannelPreview {
  authorName: string;
  text: string;
  at: string;
}

export const CHANNEL_PREVIEW_LIMIT = 160;

export interface ChannelSummary extends Channel {
  unreadCount: number;
  activeTasks: number;
  lastMessage: ChannelPreview | null;
}

export interface ChannelPage {
  channel: Channel;
  messages: ChannelMessage[];
  tasks: ChannelTask[];
  olderCursor: number | null;
  throughSequence: number;
}

export type ChannelCommand =
  | { type: "save"; operationId: string; channelId: string; draft: ChannelDraft }
  | { type: "restore"; operationId: string; channelId: string }
  | { type: "archive"; operationId: string; channelId: string }
  | {
      type: "send";
      operationId: string;
      channelId: string;
      text: string;
      recipientAgentId: string | null;
      replyToMessageId: string | null;
      attachmentDraftIds: string[];
    }
  | {
      type: "stop" | "resume" | "reassign";
      operationId: string;
      channelId: string;
      taskId: string;
      recipientAgentId: string | null;
    }
  | { type: "read"; operationId: string; channelId: string; throughSequence: number };

export interface ChannelReadInput {
  channelId: string;
  beforeSequence?: number;
}

export function isChannelDraft(value: unknown): value is ChannelDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.purpose, INPUT_LIMITS.agentDescription) &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.agents &&
    value.members.every(isChannelMember) &&
    new Set(value.members.map((member) => member.agentId)).size === value.members.length &&
    (value.leadAgentId === null ||
      (isIdentifier(value.leadAgentId) && value.members.some((member) => member.agentId === value.leadAgentId))) &&
    identifiers(value.linkedThreadIds)
  );
}

function isChannelMember(value: unknown): value is ChannelMember {
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

export function isChannel(value: unknown): value is Channel {
  return (
    isDynamicRecord(value) &&
    isChannelDraft(value) &&
    isIdentifier(value.id) &&
    typeof value.archived === "boolean" &&
    sequence(value.revision) &&
    isBoundedString(value.createdAt, 80)
  );
}

export function isChannelTask(value: unknown): value is ChannelTask {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.channelId) &&
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

export function isChannelMessage(value: unknown): value is ChannelMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.channelId) &&
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

export function decodeChannel(value: unknown): Channel {
  if (!isChannel(value)) throw new Error("Invalid channel response.");
  return value;
}

export function decodeChannelPage(value: unknown): ChannelPage {
  if (
    !isDynamicRecord(value) ||
    !isChannel(value.channel) ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isChannelMessage) ||
    !Array.isArray(value.tasks) ||
    !value.tasks.every(isChannelTask) ||
    !(value.olderCursor === null || sequence(value.olderCursor)) ||
    !sequence(value.throughSequence)
  ) {
    throw new Error("Invalid channel conversation response.");
  }
  return {
    channel: value.channel,
    messages: value.messages,
    tasks: value.tasks,
    olderCursor: value.olderCursor,
    throughSequence: value.throughSequence,
  };
}

export function decodeChannelSummaries(value: unknown): ChannelSummary[] {
  if (!Array.isArray(value) || !value.every(isChannelSummary)) throw new Error("Invalid channel list response.");
  return value;
}

function isChannelSummary(value: unknown): value is ChannelSummary {
  return (
    isDynamicRecord(value) &&
    isChannel(value) &&
    sequence(value.unreadCount) &&
    sequence(value.activeTasks) &&
    (value.lastMessage === null || isChannelPreview(value.lastMessage))
  );
}

function isChannelPreview(value: unknown): value is ChannelPreview {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.authorName, INPUT_LIMITS.agentName) &&
    isBoundedString(value.text, CHANNEL_PREVIEW_LIMIT) &&
    isBoundedString(value.at, 80)
  );
}

export function parseChannelRead(value: unknown): ChannelReadInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.channelId) ||
    !(value.beforeSequence === undefined || sequence(value.beforeSequence))
  ) {
    throw new Error("Provide a valid channel and message cursor.");
  }
  return { channelId: value.channelId, beforeSequence: value.beforeSequence };
}

export function parseChannelCommand(value: unknown): ChannelCommand {
  if (!isDynamicRecord(value) || !isIdentifier(value.operationId) || !isIdentifier(value.channelId))
    throw new Error("Provide a valid channel command.");
  const common = { operationId: value.operationId, channelId: value.channelId };
  if (value.type === "save" && isChannelDraft(value.draft)) return { ...common, type: value.type, draft: value.draft };
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
  throw new Error("Provide a valid channel command.");
}
