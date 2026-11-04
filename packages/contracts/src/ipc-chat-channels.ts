import { INPUT_LIMITS } from "./input-limits";
import type { AvatarImageInput } from "./ipc-agents";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
import { optionalHistoryExtent } from "./ipc-decoding";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const CHANNEL_CHATS_CAPABILITY = "channel-chats-v1";
export const CHANNEL_DELETE_CAPABILITY = "channel-delete-v1";
/**
 * The host takes the channel command `cancel`, which ends a stopped or failed task and the open tasks
 * below it. A host without it rejects the command, so a client shows Cancel only with it.
 */
export const CHANNEL_TASK_CANCEL_CAPABILITY = "channel-task-cancel-v1";
/**
 * The id a channel row carries for the reader, and for its own author, while no account is signed
 * in. The person behind it does not change when they sign in, so their read cursors follow them and
 * their own messages stay their own in the transcript.
 */
export const SIGNED_OUT_CHANNEL_MEMBER_ID = "local";
export const CHANNEL_PARALLEL_LIMIT = 2;
export const CHANNEL_ASSIGNMENT_LIMIT = 8;

export interface ChannelMember {
  agentId: string;
}

/**
 * The icon a reader chose for a channel, in place of its member faces. `name` is a key of the icon
 * set in the app. A name this version does not know shows the faces, so a later version can add
 * icons without making a channel unreadable after a downgrade.
 */
export interface ChannelIcon {
  name: string;
  hue: number;
}

/**
 * The icons that this version draws, in the order of the editor grid. The names are saved in the
 * channel, so a name never changes its meaning; add new names at the end.
 */
export const CHANNEL_ICON_NAMES = [
  "megaphone",
  "chart",
  "lifebuoy",
  "search",
  "briefcase",
  "code",
  "globe",
  "mail",
  "calendar",
  "gift",
  "palette",
  "brain",
  "book",
  "sparkles",
  "star",
  "zap",
  "shield",
  "store",
  "workflow",
  "card",
] as const;

export type ChannelIconName = (typeof CHANNEL_ICON_NAMES)[number];

export interface ChannelDraft {
  name: string;
  title: string;
  instructions: string;
  members: ChannelMember[];
  leadAgentId: string | null;
  /**
   * An isolated channel keeps what its members learn in it: `openbot.remember` saves a channel
   * memory there, not a memory of the agent (#4332). Absent is off. A save without it keeps the
   * stored value, so a client from before it does not turn it off.
   */
  isolated?: boolean;
  /**
   * Absent keeps the stored icon, and null removes it. Only this computer keeps it: the Team API
   * channel codecs do not carry it, so a joined server and a phone show the member faces.
   */
  icon?: ChannelIcon | null;
}

export interface Channel extends ChannelDraft {
  id: string;
  archived: boolean;
  revision: number;
  createdAt: string;
  /** An `openbot-avatar://channel/` URL of the uploaded image. Only `setChannelImage` changes it. */
  imageUrl?: string | null;
}

export interface SetChannelImageInput {
  channelId: string;
  image: AvatarImageInput | null;
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

/** Deletes one message of a channel from its history and view. Agents can still remember it. */
export interface DeleteChannelMessageInput {
  channelId: string;
  messageId: string;
}

/** One ellipsised sidebar line: enough to preview a channel, never a whole message body. */
export interface ChannelPreview {
  authorName: string;
  /** Who wrote it. Absent from a host without channel-attention-v1. */
  author?: { kind: ChannelMessage["author"]["kind"]; id: string };
  /** Whether it is still streaming. Absent from a host without channel-attention-v1. */
  status?: ConversationMessage["status"];
  text: string;
  at: string;
}

/** The execution thread of one member agent in a channel. A prompt on it belongs to the channel. */
export interface ChannelThread {
  agentId: string;
  threadId: string;
}

export const CHANNEL_PREVIEW_LIMIT = 160;

export interface ChannelSummary extends Channel {
  unreadCount: number;
  activeTasks: number;
  /** Its queued, waiting and running tasks; `activeTasks` counts only running ones. Absent from a host without channel-attention-v1. */
  openTasks?: number;
  lastMessage: ChannelPreview | null;
  /** One for each member agent that has worked here. Absent from a host without channel-attention-v1. */
  threads?: ChannelThread[];
}

export interface ChannelPage {
  channel: Channel;
  messages: ChannelMessage[];
  tasks: ChannelTask[];
  olderCursor: number | null;
  throughSequence: number;
  /** As in `ConversationPageInfo`: the unloaded length, for the scroll rail. Absent from a remote host. */
  olderCount?: number;
  oldestAt?: string;
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
      type: "stop" | "resume" | "reassign" | "cancel";
      operationId: string;
      channelId: string;
      taskId: string;
      recipientAgentId: string | null;
    }
  | { type: "read"; operationId: string; channelId: string; throughSequence: number };

export interface ChannelReadInput {
  channelId: string;
  beforeSequence?: number | undefined;
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

/**
 * A saved channel, read back. An icon this version cannot read is left out, so a channel that a later
 * version saved shows its member faces after a downgrade and does not become unreadable. A command
 * with such an icon is still refused.
 */
function normalizeSavedChannel(value: unknown): DynamicRecord | undefined {
  const channel = normalizeChannelDraft(value);
  if (!channel || channel.icon === undefined || channel.icon === null || isChannelIcon(channel.icon)) return channel;
  const { icon: _unreadable, ...rest } = channel;
  return rest;
}

export function isChannelDraft(value: unknown): value is ChannelDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.instructions, INPUT_LIMITS.agentDescription) &&
    (value.isolated === undefined || typeof value.isolated === "boolean") &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.agents &&
    value.members.every(isChannelMember) &&
    new Set(value.members.map((member) => member.agentId)).size === value.members.length &&
    (value.leadAgentId === null ||
      (isIdentifier(value.leadAgentId) && value.members.some((member) => member.agentId === value.leadAgentId))) &&
    (value.icon === undefined || value.icon === null || isChannelIcon(value.icon))
  );
}

const CHANNEL_ICON_NAME = /^[a-z][a-z0-9-]{0,39}$/;

function isChannelIcon(value: unknown): value is ChannelIcon {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    CHANNEL_ICON_NAME.test(value.name) &&
    typeof value.hue === "number" &&
    Number.isInteger(value.hue) &&
    value.hue >= 0 &&
    value.hue < 360
  );
}

/** Only the fields of a draft, so a save cannot carry a host-owned field such as `imageUrl`. */
function draftFields(draft: ChannelDraft): ChannelDraft {
  const { name, title, instructions, members, leadAgentId, isolated, icon } = draft;
  return {
    name,
    title,
    instructions,
    members,
    leadAgentId,
    ...(isolated === undefined ? {} : { isolated }),
    ...(icon === undefined ? {} : { icon }),
  };
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
    isBoundedString(value.createdAt, 80) &&
    (value.imageUrl === undefined || value.imageUrl === null || isBoundedString(value.imageUrl, 2048))
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
    // The author of a channel message can be a person, and an account name is bounded there, not
    // by the agent name. A name this validator refuses is a stored message no read can decode.
    isBoundedString(value.author.name, INPUT_LIMITS.accountName) &&
    (value.taskId === null || isIdentifier(value.taskId)) &&
    typeof value.superseded === "boolean" &&
    isConversationMessage(value.message)
  );
}

export function decodeChannel(value: unknown): Channel {
  const channel = normalizeSavedChannel(value);
  if (!isChannel(channel)) throw new Error("Invalid channel response.");
  return channel;
}

export function decodeChannelPage(value: unknown): ChannelPage {
  const channel = isDynamicRecord(value) ? normalizeSavedChannel(value.channel) : undefined;
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
    ...optionalHistoryExtent(value),
  };
}

export function decodeChannelSummaries(value: unknown): ChannelSummary[] {
  if (!Array.isArray(value)) throw new Error("Invalid channel list response.");
  const summaries: unknown[] = value.map(normalizeSavedChannel);
  if (!summaries.every(isChannelSummary)) throw new Error("Invalid channel list response.");
  return summaries;
}

function isChannelSummary(value: unknown): value is ChannelSummary {
  return (
    isDynamicRecord(value) &&
    isChannel(value) &&
    sequence(value.unreadCount) &&
    sequence(value.activeTasks) &&
    (value.openTasks === undefined || sequence(value.openTasks)) &&
    (value.lastMessage === null || isChannelPreview(value.lastMessage)) &&
    (value.threads === undefined ||
      (Array.isArray(value.threads) &&
        value.threads.length <= INPUT_LIMITS.agents &&
        value.threads.every(isChannelThread)))
  );
}

function isChannelThread(value: unknown): value is ChannelThread {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isIdentifier(value.threadId);
}

function isChannelPreview(value: unknown): value is ChannelPreview {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.authorName, INPUT_LIMITS.accountName) &&
    (value.author === undefined ||
      (isDynamicRecord(value.author) &&
        (value.author.kind === "member" || value.author.kind === "agent" || value.author.kind === "coordinator") &&
        isIdentifier(value.author.id))) &&
    (value.status === undefined ||
      value.status === "streaming" ||
      value.status === "completed" ||
      value.status === "failed" ||
      value.status === "interrupted") &&
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
    return {
      ...common,
      type: value.type,
      draft: draftFields(draft),
      ...(value.update === true ? { update: true } : {}),
    };
  if (value.type === "archive" || value.type === "restore") return { ...common, type: value.type };
  if (value.type === "read" && sequence(value.throughSequence))
    return { ...common, type: value.type, throughSequence: value.throughSequence };
  if (
    (value.type === "stop" || value.type === "resume" || value.type === "reassign" || value.type === "cancel") &&
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
