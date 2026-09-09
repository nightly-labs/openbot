import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const CHANNEL_CHATS_CAPABILITY = "channel-chats-v1";
export const CHANNEL_DELETE_CAPABILITY = "channel-delete-v1";
export const CHANNEL_PARALLEL_LIMIT = 2;
export const CHANNEL_ASSIGNMENT_LIMIT = 8;

export interface ChannelMember {
  agentId: string;
}

export interface ChannelDraft {
  name: string;
  title: string;
  instructions: string;
  members: ChannelMember[];
  leadAgentId: string | null;
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
  | {
      type: "save";
      operationId: string;
      channelId: string;
      draft: ChannelDraft;
      /**
       * The save edits a channel that the sender has open. A save without it creates the channel
       * when its id is unknown, which is how a channel is made, and how every released client
       * still saves. Settings save on every field and a save can arrive after a deletion, so the
       * settings panel sets this and the service refuses to bring the channel back.
       */
      update?: boolean;
    }
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
      /**
       * A routine firing into the channel. It is a `send` without the continuation heuristic: a
       * schedule must start its own task rather than fold itself into whatever a member is doing.
       * The `requestMessageId` is minted by the caller and persisted on its run row before the
       * command is issued, so a replay after a crash lands on the same message.
       */
      type: "request";
      operationId: string;
      channelId: string;
      text: string;
      recipientAgentId: string | null;
      requestMessageId: string;
      origin: { kind: "routine"; routineId: string; routineName: string; runId: string };
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

/**
 * A channel used to hold one `purpose`. It now holds a `title` and `instructions`, the way an agent
 * does, and the guards below are strict about both - so every row written before the rename has to
 * pass through here on the way in. This is the only place that knows the old key: the store reads
 * `channel_json` through `decodeChannel` (`channel-store.ts`), and a strict guard at the call sites
 * would make every one of those rows unreadable instead.
 */
export function normalizeChannelDraft(value: unknown): DynamicRecord | undefined {
  if (!isDynamicRecord(value)) return undefined;
  if (!("purpose" in value)) return value;
  const { purpose, ...rest } = value;
  return { title: "", instructions: isString(purpose) ? purpose : "", ...rest };
}

export function isChannelDraft(value: unknown): value is ChannelDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.instructions, INPUT_LIMITS.agentDescription) &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.agents &&
    value.members.every(isChannelMember) &&
    new Set(value.members.map((member) => member.agentId)).size === value.members.length &&
    (value.leadAgentId === null ||
      (isIdentifier(value.leadAgentId) && value.members.some((member) => member.agentId === value.leadAgentId)))
  );
}

function isChannelMember(value: unknown): value is ChannelMember {
  return isDynamicRecord(value) && isIdentifier(value.agentId);
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
  const channel = normalizeChannelDraft(value);
  if (!isChannel(channel)) throw new Error("Invalid channel response.");
  return channel;
}

export function decodeChannelPage(value: unknown): ChannelPage {
  const channel = isDynamicRecord(value) ? normalizeChannelDraft(value.channel) : undefined;
  if (
    !isDynamicRecord(value) ||
    !isChannel(channel) ||
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
    channel,
    messages: value.messages,
    tasks: value.tasks,
    olderCursor: value.olderCursor,
    throughSequence: value.throughSequence,
  };
}

export function decodeChannelSummaries(value: unknown): ChannelSummary[] {
  if (!Array.isArray(value)) throw new Error("Invalid channel list response.");
  const summaries: unknown[] = value.map(normalizeChannelDraft);
  if (!summaries.every(isChannelSummary)) throw new Error("Invalid channel list response.");
  return summaries;
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
  const draft = normalizeChannelDraft(value.draft);
  if (value.type === "save" && isChannelDraft(draft))
    return { ...common, type: value.type, draft, ...(value.update === true ? { update: true } : {}) };
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
  if (
    value.type === "request" &&
    isBoundedString(value.text, INPUT_LIMITS.messageText) &&
    value.text.trim().length > 0 &&
    (value.recipientAgentId === null || isIdentifier(value.recipientAgentId)) &&
    isIdentifier(value.requestMessageId) &&
    isDynamicRecord(value.origin) &&
    value.origin.kind === "routine" &&
    isIdentifier(value.origin.routineId) &&
    isBoundedString(value.origin.routineName, INPUT_LIMITS.routineName) &&
    isIdentifier(value.origin.runId)
  ) {
    return {
      ...common,
      type: value.type,
      text: value.text,
      recipientAgentId: value.recipientAgentId,
      requestMessageId: value.requestMessageId,
      origin: {
        kind: "routine",
        routineId: value.origin.routineId,
        routineName: value.origin.routineName,
        runId: value.origin.runId,
      },
    };
  }
  throw new Error("Provide a valid channel command.");
}
