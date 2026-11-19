import { INPUT_LIMITS } from "./input-limits";
import type { AvatarImageInput } from "./ipc-agents";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
import { optionalHistoryExtent } from "./ipc-decoding";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const CHANNEL_CHATS_CAPABILITY = "channel-chats-v1";
export const CHANNEL_DELETE_CAPABILITY = "channel-delete-v1";
export const CHANNEL_TASK_CANCEL_CAPABILITY = "channel-task-cancel-v1";
export const SIGNED_OUT_CHANNEL_MEMBER_ID = "local";
export const CHANNEL_PARALLEL_LIMIT = 2;
export const CHANNEL_ASSIGNMENT_LIMIT = 8;
export const CHANNEL_ASSIGNMENT_LIMIT_ERROR =
  "The automatic assignment limit was reached. Continue or reassign this task.";

export interface ChannelMember {
  agentId: string;
}

export interface ChannelIcon {
  name: string;
  hue: number;
}

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
  isolated?: boolean;
  browser?: ChannelBrowser;
  icon?: ChannelIcon | null;
}

export type ChannelBrowser = { kind: "members" } | { kind: "none" } | { kind: "member"; agentId: string };

export const CHANNEL_BROWSER_MEMBERS: ChannelBrowser = { kind: "members" };

export function isChannelBrowser(value: unknown): value is ChannelBrowser {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "members" || value.kind === "none") return Object.keys(value).length === 1;
  return value.kind === "member" && isIdentifier(value.agentId) && Object.keys(value).length === 2;
}

export function channelBrowserAgent(channel: Pick<ChannelDraft, "browser">): string | boolean {
  const browser = channel.browser ?? CHANNEL_BROWSER_MEMBERS;
  if (browser.kind === "member") return browser.agentId;
  return browser.kind === "members";
}

export function channelAllowsBrowser(channel: Pick<ChannelDraft, "browser">, agentId: string): boolean {
  const agent = channelBrowserAgent(channel);
  return typeof agent === "string" ? agent === agentId : agent;
}

export function withBrowserMember<T extends ChannelDraft>(channel: T): T {
  const browser = channel.browser;
  if (browser?.kind !== "member" || channel.members.some((member) => member.agentId === browser.agentId))
    return channel;
  return { ...channel, browser: { kind: "none" } };
}

export interface Channel extends ChannelDraft {
  id: string;
  archived: boolean;
  revision: number;
  createdAt: string;
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
  seenDependencies?: string[];
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

export interface DeleteChannelMessageInput {
  channelId: string;
  messageId: string;
}

export interface ChannelPreview {
  authorName: string;
  author?: { kind: ChannelMessage["author"]["kind"]; id: string };
  status?: ConversationMessage["status"];
  text: string;
  at: string;
}

export interface ChannelThread {
  agentId: string;
  threadId: string;
}

export const CHANNEL_PREVIEW_LIMIT = 160;

export interface ChannelSummary extends Channel {
  unreadCount: number;
  activeTasks: number;
  openTasks?: number;
  lastMessage: ChannelPreview | null;
  threads?: ChannelThread[];
}

export type ChannelTaskWait =
  | { taskId: string; agentId: string; reason: "agent-busy"; channelId: string; channelName: string }
  | { taskId: string; agentId: string; reason: "channel-full" };

export interface ChannelPage {
  channel: Channel;
  messages: ChannelMessage[];
  tasks: ChannelTask[];
  olderCursor: number | null;
  throughSequence: number;
  olderCount?: number;
  oldestAt?: string;
  waits?: ChannelTaskWait[];
}

export type ChannelCommand =
  | {
      type: "save";
      operationId: string;
      channelId: string;
      draft: ChannelDraft;
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

export function normalizeChannelDraft(value: unknown): DynamicRecord | undefined {
  if (!isDynamicRecord(value)) return undefined;
  if (!("purpose" in value)) return value;
  const { purpose, ...rest } = value;
  return { title: "", instructions: isString(purpose) ? purpose : "", ...rest };
}

function normalizeSavedChannel(value: unknown): DynamicRecord | undefined {
  const channel = readableLead(readableBrowser(normalizeChannelDraft(value)));
  if (!channel || channel.icon === undefined || channel.icon === null || isChannelIcon(channel.icon)) return channel;
  const { icon: _unreadable, ...rest } = channel;
  return rest;
}

function readableLead(channel: DynamicRecord | undefined): DynamicRecord | undefined {
  if (!channel || !isIdentifier(channel.leadAgentId) || !Array.isArray(channel.members)) return channel;
  const members = channel.members.filter(isChannelMember);
  if (members.some((member) => member.agentId === channel.leadAgentId)) return channel;
  return { ...channel, leadAgentId: members[0]?.agentId ?? null };
}

function readableBrowser(channel: DynamicRecord | undefined): DynamicRecord | undefined {
  if (!channel || channel.browser === undefined) return channel;
  const members = Array.isArray(channel.members) ? channel.members.filter(isChannelMember) : [];
  if (isChannelBrowser(channel.browser) && browserIsMember(channel.browser, members)) return channel;
  return { ...channel, browser: { kind: "none" } };
}

export function isChannelDraft(
  value: unknown,
  instructionsLimit: number = INPUT_LIMITS.agentDescription,
): value is ChannelDraft {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.instructions, instructionsLimit) &&
    (value.isolated === undefined || typeof value.isolated === "boolean") &&
    (value.browser === undefined || isChannelBrowser(value.browser)) &&
    Array.isArray(value.members) &&
    value.members.length <= INPUT_LIMITS.agents &&
    value.members.every(isChannelMember) &&
    new Set(value.members.map((member) => member.agentId)).size === value.members.length &&
    (value.leadAgentId === null ||
      (isIdentifier(value.leadAgentId) && value.members.some((member) => member.agentId === value.leadAgentId))) &&
    (value.icon === undefined || value.icon === null || isChannelIcon(value.icon)) &&
    browserIsMember(value.browser, value.members)
  );
}

function browserIsMember(browser: unknown, members: readonly ChannelMember[]): boolean {
  return (
    !isChannelBrowser(browser) ||
    browser.kind !== "member" ||
    members.some((member) => member.agentId === browser.agentId)
  );
}

const CHANNEL_ICON_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function isChannelIcon(value: unknown): value is ChannelIcon {
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

function draftFields(draft: ChannelDraft): ChannelDraft {
  const { name, title, instructions, members, leadAgentId, isolated, browser, icon } = draft;
  return {
    name,
    title,
    instructions,
    members,
    leadAgentId,
    ...(isolated === undefined ? {} : { isolated }),
    ...(browser === undefined ? {} : { browser }),
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
    isChannelDraft(value, INPUT_LIMITS.storedChannelInstructions) &&
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
    (value.error === null || isBoundedString(value.error, INPUT_LIMITS.messageText)) &&
    (value.seenDependencies === undefined || identifiers(value.seenDependencies))
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
    !sequence(value.throughSequence) ||
    !(
      value.waits === undefined ||
      (Array.isArray(value.waits) && value.waits.length <= value.tasks.length && value.waits.every(isChannelTaskWait))
    )
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
    ...(value.waits === undefined ? {} : { waits: value.waits }),
  };
}

function isChannelTaskWait(value: unknown): value is ChannelTaskWait {
  if (!isDynamicRecord(value) || !isIdentifier(value.taskId) || !isIdentifier(value.agentId)) return false;
  if (value.reason === "channel-full") return true;
  return (
    value.reason === "agent-busy" &&
    isIdentifier(value.channelId) &&
    isBoundedString(value.channelName, INPUT_LIMITS.agentName)
  );
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
  if (value.type === "save" && isChannelDraft(draft, INPUT_LIMITS.storedChannelInstructions))
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
