import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, type AvatarHue, isAvatarColor, isAvatarHue } from "./ipc-agent-identity";
import { type AgentModelChoice, isAgentModelChoice } from "./ipc-agents";
import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  isAgentApproval,
  isBrowserTakeoverRequest,
} from "./ipc-approvals";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import {
  integerInRange,
  isBoundedString,
  isFiniteNumber,
  isIdentifier,
  isNullableBoundedString,
  isRequestId,
} from "./ipc-bounded-values";
import { isPromptAnswers } from "./ipc-browser-dock";
import { type ChannelIcon, isChannelIcon } from "./ipc-chat-channels";
import {
  type AgentPromptQuestion,
  type ConversationMessageSender,
  isAgentPromptQuestion,
  isConversationMessageSender,
} from "./ipc-conversation-messages";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const AGENT_DOCK_LIMITS = {
  seats: 24,
  messages: 60,
  count: 10_000,
  displays: 16,
  displayLabel: 200,
  results: 24,
  resultLabel: 200,
  channels: 100,
  channelImageUrl: 2048,
  inputRects: 8,
  inputExtent: 100_000,
  backupModels: 64,
  backupModelKey: 400,
  backupModelLabel: 200,
  pageTitle: 500,
  pageOrigin: 2048,
  threads: 50,
  threadTime: 64,
} as const;

export type AgentDockSeatRef = { kind: "agent"; id: string } | { kind: "channel"; id: string };

export interface AgentDockAgent {
  id: string;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor: AvatarColor | null;
  avatarUrl: string | null;
  chatColor?: AvatarColor;
}

export const AGENT_DOCK_MOODS = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"] as const;
export type AgentDockMood = (typeof AGENT_DOCK_MOODS)[number];

export const AGENT_DOCK_WAIT_REASONS = ["question", "approval", "takeover"] as const;
export type AgentDockWaitReason = (typeof AGENT_DOCK_WAIT_REASONS)[number];

export interface AgentDockChannel {
  id: string;
  name: string;
  title: string;
  members: string[];
  icon: ChannelIcon | null;
  imageUrl: string | null;
}

export type AgentDockSeatState =
  | { kind: "waiting"; reason: AgentDockWaitReason; detail: string | null }
  | { kind: "working" }
  | { kind: "responded" }
  | { kind: "unread"; count: number }
  | { kind: "routine"; phase: "running" | "queued" | "failed"; count: number }
  | { kind: "limited"; resetsAt: number | null };

export type AgentDockSeat =
  | { kind: "agent"; agent: AgentDockAgent; mood: AgentDockMood; state: AgentDockSeatState | null; temporary: boolean }
  | { kind: "channel"; channel: AgentDockChannel; state: AgentDockSeatState | null; temporary: boolean };

export interface AgentDockMessage {
  id: string;
  author: "you" | "agent";
  senderAgentId: string | null;
  senderMember: ConversationMessageSender | null;
  kind: "text" | "error";
  body: string;
  attachments: AttachmentSummary[];
}

export interface AgentDockApproval {
  approval: AgentApproval;
  attempt: number;
  cut: boolean;
}

export interface AgentDockPrompt {
  requestId: string | number;
  agentId: string;
  threadId: string | null;
  turnId: string;
  questions: AgentPromptQuestion[];
  attempt: number;
}

export interface AgentDockSecretVault {
  server: string | null;
  blocked?: "role" | "version" | undefined;
}

export interface AgentDockTakeoverPage {
  title: string;
  origin: string;
}

export interface AgentDockTakeover {
  request: BrowserTakeoverRequest;
  page: AgentDockTakeoverPage | null;
  agentName: string;
  vault: AgentDockSecretVault | null;
  attempt: number;
}

export interface AgentDockBackupModel {
  key: string;
  choice: AgentModelChoice;
  model: string;
  account: string | null;
  state: "ready" | "limit" | "unavailable";
}

export interface AgentDockUsageLimit {
  agentId: string;
  provider: AgentProviderId;
  model: string | null;
  agentName: string | null;
  resetsAt: number | null;
  options: AgentDockBackupModel[];
  rememberable: boolean;
  attempt: number;
}

export interface AgentDockThread {
  taskId: string;
  title: string;
}

export const AGENT_DOCK_THREAD_STATES = ["idle", "working", "queued", "awaiting", "failed"] as const;

export type AgentDockThreadStatus =
  | { kind: (typeof AGENT_DOCK_THREAD_STATES)[number] }
  | { kind: "waiting"; reason: AgentDockWaitReason };

export interface AgentDockThreadChoice {
  id: string;
  title: string;
  updatedAt: string;
  status: AgentDockThreadStatus;
  unread: number;
}

export interface AgentDockThreadChoices {
  activeId: string;
  threads: AgentDockThreadChoice[];
}

export interface AgentDockChat {
  seat: AgentDockSeatRef;
  thread?: AgentDockThread | null;
  threads?: AgentDockThreadChoices | null;
  messages: AgentDockMessage[];
  working: boolean;
  wait: AgentDockWaitReason | null;
  approval: AgentDockApproval | null;
  prompt: AgentDockPrompt | null;
  takeover: AgentDockTakeover | null;
  usageLimit: AgentDockUsageLimit | null;
}

export interface AgentDockResult {
  id: string;
  agentId: string;
  kind: "file" | "message";
  label: string;
  at: number;
}

export type AgentDockDisplay =
  | { kind: "window" }
  | { kind: "primary" }
  | { kind: "all" }
  | { kind: "display"; id: number };

export interface AgentDockDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  internal: boolean;
}

export type AgentDockEdge = "left" | "right";

export interface AgentDockDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentDockOffset {
  displayId: number;
  offset: number;
  bounds?: AgentDockDisplayBounds | undefined;
}

export function sameAgentDockDisplayBounds(
  a: AgentDockDisplayBounds | undefined,
  b: AgentDockDisplayBounds | undefined,
): boolean {
  return (
    a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

export const AGENT_DOCK_SIZE_LIMITS = { min: 70, max: 140, step: 1, default: 100 } as const;

export type AgentDockDragPhase = "start" | "move" | "end";

export interface AgentDockPresentation {
  serverId: string;
  display: AgentDockDisplay;
  edge: AgentDockEdge;
  autoHide: boolean;
  edgeStrip: boolean;
  sizePercent: number;
  offsets: AgentDockOffset[];
  seats: AgentDockSeat[];
  available: AgentDockAgent[];
  availableChannels: AgentDockChannel[];
  agents: AgentDockAgent[];
  chats: AgentDockChat[];
  results: AgentDockResult[];
}

export type AgentDockAction =
  | { type: "open-chat"; serverId: string; seat: AgentDockSeatRef | null }
  | { type: "add"; serverId: string; seat: AgentDockSeatRef }
  | { type: "remove"; serverId: string; seat: AgentDockSeatRef }
  | { type: "move"; serverId: string; seat: AgentDockSeatRef; before: AgentDockSeatRef | null }
  | {
      type: "send";
      serverId: string;
      seat: AgentDockSeatRef;
      taskId?: string;
      text: string;
      clientMessageId: string;
    }
  | { type: "open-thread"; serverId: string; agentId: string; threadId: string }
  | { type: "new-thread"; serverId: string; agentId: string }
  | { type: "start-thread"; serverId: string; agentId: string; text: string; clientMessageId: string }
  | { type: "open-agent"; serverId: string; agentId: string }
  | { type: "open-channel"; serverId: string; channelId: string }
  | { type: "open-window"; serverId: string; agentId: string }
  | {
      type: "respond-approval";
      serverId: string;
      agentId: string;
      requestId: string | number;
      decision: "accept" | "decline";
    }
  | {
      type: "answer-prompt";
      serverId: string;
      agentId: string;
      threadId: string | null;
      requestId: string | number;
      answers: Record<string, string[]>;
    }
  | {
      type: "respond-takeover";
      serverId: string;
      agentId: string;
      threadId: string | null;
      requestId: string | number;
      decision: "complete" | "cancel";
    }
  | { type: "usage-limit-send"; serverId: string; agentId: string; optionKey: string; remember: boolean }
  | { type: "usage-limit-wait"; serverId: string; agentId: string }
  | { type: "open-link"; url: string }
  | { type: "open-settings" }
  | { type: "hide" };

export type AboveAppsSupport = "restart" | "unsupported";

export interface SetAgentDockXWaylandInput {
  enabled: boolean;
}

export interface SetAgentDockInteractiveInput {
  interactive: boolean;
  keyboard?: boolean;
}

export interface AgentDockInputRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isAgentDockPresentation(value: unknown): value is AgentDockPresentation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    isAgentDockDisplay(value.display) &&
    (value.edge === "left" || value.edge === "right") &&
    isBoolean(value.autoHide) &&
    isBoolean(value.edgeStrip) &&
    integerInRange(value.sizePercent, AGENT_DOCK_SIZE_LIMITS.min, AGENT_DOCK_SIZE_LIMITS.max) &&
    isList(value.offsets, AGENT_DOCK_LIMITS.displays, isAgentDockOffset) &&
    isList(value.seats, AGENT_DOCK_LIMITS.seats, isSeat) &&
    isList(value.available, INPUT_LIMITS.agents, isAgent) &&
    isList(value.availableChannels, AGENT_DOCK_LIMITS.channels, isChannel) &&
    isList(value.agents, INPUT_LIMITS.agents, isAgent) &&
    isList(value.chats, AGENT_DOCK_LIMITS.seats, isChat) &&
    isList(value.results, AGENT_DOCK_LIMITS.results, isResult)
  );
}

export function isAgentDockAction(value: unknown): value is AgentDockAction {
  if (!isDynamicRecord(value) || !isString(value.type)) return false;
  if (value.type === "open-link") return isBoundedString(value.url, INPUT_LIMITS.browserUrl) && value.url.length > 0;
  if (value.type === "open-settings" || value.type === "hide") return true;
  if (!isIdentifier(value.serverId)) return false;
  switch (value.type) {
    case "open-chat":
      return value.seat === null || isSeatRef(value.seat);
    case "add":
    case "remove":
      return isSeatRef(value.seat);
    case "move":
      return isSeatRef(value.seat) && (value.before === null || isSeatRef(value.before));
    case "open-agent":
    case "open-window":
    case "new-thread":
      return isIdentifier(value.agentId);
    case "open-thread":
      return isIdentifier(value.agentId) && isIdentifier(value.threadId);
    case "start-thread":
      return (
        isIdentifier(value.agentId) &&
        isBoundedString(value.text, INPUT_LIMITS.messageText) &&
        value.text.trim().length > 0 &&
        isIdentifier(value.clientMessageId)
      );
    case "open-channel":
      return isIdentifier(value.channelId);
    case "respond-approval":
      return (
        isIdentifier(value.agentId) &&
        isRequestId(value.requestId) &&
        isOneOf(["accept", "decline"] as const, value.decision)
      );
    case "answer-prompt":
      return (
        isIdentifier(value.agentId) &&
        (value.threadId === null || isIdentifier(value.threadId)) &&
        isRequestId(value.requestId) &&
        isPromptAnswers(value.answers)
      );
    case "respond-takeover":
      return (
        isIdentifier(value.agentId) &&
        (value.threadId === null || isIdentifier(value.threadId)) &&
        isRequestId(value.requestId) &&
        isOneOf(["complete", "cancel"] as const, value.decision)
      );
    case "usage-limit-send":
      return (
        isIdentifier(value.agentId) &&
        isBoundedString(value.optionKey, AGENT_DOCK_LIMITS.backupModelKey) &&
        value.optionKey.length > 0 &&
        isBoolean(value.remember)
      );
    case "usage-limit-wait":
      return isIdentifier(value.agentId);
    case "send":
      return (
        isSeatRef(value.seat) &&
        (value.taskId === undefined || (value.seat.kind === "agent" && isIdentifier(value.taskId))) &&
        isBoundedString(value.text, INPUT_LIMITS.messageText) &&
        value.text.trim().length > 0 &&
        isIdentifier(value.clientMessageId)
      );
    default:
      return false;
  }
}

export function isAgentDockInteractive(value: unknown): value is SetAgentDockInteractiveInput {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.interactive) &&
    (value.keyboard === undefined || isBoolean(value.keyboard))
  );
}

export function isAgentDockXWayland(value: unknown): value is SetAgentDockXWaylandInput {
  return isDynamicRecord(value) && isBoolean(value.enabled);
}

export function isAgentDockInputRegion(value: unknown): value is AgentDockInputRect[] {
  return isList(
    value,
    AGENT_DOCK_LIMITS.inputRects,
    (rect): rect is AgentDockInputRect =>
      isDynamicRecord(rect) &&
      integerInRange(rect.x, 0, AGENT_DOCK_LIMITS.inputExtent) &&
      integerInRange(rect.y, 0, AGENT_DOCK_LIMITS.inputExtent) &&
      integerInRange(rect.width, 1, AGENT_DOCK_LIMITS.inputExtent) &&
      integerInRange(rect.height, 1, AGENT_DOCK_LIMITS.inputExtent),
  );
}

export function isAgentDockOffset(value: unknown): value is AgentDockOffset {
  return (
    isDynamicRecord(value) &&
    isDisplayId(value.displayId) &&
    isFiniteNumber(value.offset) &&
    value.offset >= 0 &&
    value.offset <= 1 &&
    (value.bounds === undefined || isAgentDockDisplayBounds(value.bounds))
  );
}

function isAgentDockDisplayBounds(value: unknown): value is AgentDockDisplayBounds {
  const extent = AGENT_DOCK_LIMITS.inputExtent;
  return (
    isDynamicRecord(value) &&
    integerInRange(value.x, -extent, extent) &&
    integerInRange(value.y, -extent, extent) &&
    integerInRange(value.width, 1, extent) &&
    integerInRange(value.height, 1, extent)
  );
}

export function isAgentDockDragPhase(value: unknown): value is AgentDockDragPhase {
  return value === "start" || value === "move" || value === "end";
}

function isDisplayId(value: unknown): value is number {
  return integerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

export function isAgentDockDisplay(value: unknown): value is AgentDockDisplay {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "window" || value.kind === "primary" || value.kind === "all") return true;
  return value.kind === "display" && isDisplayId(value.id);
}

export function isAgentDockDisplayInfoList(value: unknown): value is AgentDockDisplayInfo[] {
  return isList(
    value,
    AGENT_DOCK_LIMITS.displays,
    (display): display is AgentDockDisplayInfo =>
      isDynamicRecord(display) &&
      isDisplayId(display.id) &&
      isBoundedString(display.label, AGENT_DOCK_LIMITS.displayLabel) &&
      isBoolean(display.primary) &&
      isBoolean(display.internal),
  );
}

function isAgent(value: unknown): value is AgentDockAgent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isBoundedString(value.avatarSeed, INPUT_LIMITS.identifier) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarColor === null || isAvatarColor(value.avatarColor)) &&
    isNullableBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl) &&
    (value.chatColor === undefined || isAvatarColor(value.chatColor))
  );
}

function isChannel(value: unknown): value is AgentDockChannel {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isList(value.members, INPUT_LIMITS.agents, isIdentifier) &&
    (value.icon === null || isChannelIcon(value.icon)) &&
    isNullableBoundedString(value.imageUrl, AGENT_DOCK_LIMITS.channelImageUrl)
  );
}

function isSeatRef(value: unknown): value is AgentDockSeatRef {
  return isDynamicRecord(value) && (value.kind === "agent" || value.kind === "channel") && isIdentifier(value.id);
}

function isSeat(value: unknown): value is AgentDockSeat {
  if (!isDynamicRecord(value) || !(value.state === null || isSeatState(value.state)) || !isBoolean(value.temporary))
    return false;
  if (value.kind === "agent") return isAgent(value.agent) && isOneOf(AGENT_DOCK_MOODS, value.mood);
  return value.kind === "channel" && isChannel(value.channel);
}

function isSeatState(value: unknown): value is AgentDockSeatState {
  if (!isDynamicRecord(value)) return false;
  switch (value.kind) {
    case "waiting":
      return (
        isOneOf(AGENT_DOCK_WAIT_REASONS, value.reason) &&
        isNullableBoundedString(value.detail, INPUT_LIMITS.directMessageText)
      );
    case "working":
    case "responded":
      return true;
    case "unread":
      return isCount(value.count);
    case "routine":
      return isOneOf(["running", "queued", "failed"] as const, value.phase) && isCount(value.count);
    case "limited":
      return value.resetsAt === null || integerInRange(value.resetsAt, 0, Number.MAX_SAFE_INTEGER);
    default:
      return false;
  }
}

function isChat(value: unknown): value is AgentDockChat {
  return (
    isDynamicRecord(value) &&
    isSeatRef(value.seat) &&
    (value.thread === undefined || value.thread === null || isThread(value.thread)) &&
    (value.threads === undefined || value.threads === null || isThreadChoices(value.threads)) &&
    isList(value.messages, AGENT_DOCK_LIMITS.messages, isMessage) &&
    isBoolean(value.working) &&
    (value.wait === null || isOneOf(AGENT_DOCK_WAIT_REASONS, value.wait)) &&
    (value.approval === null || isApproval(value.approval)) &&
    (value.prompt === null || isPrompt(value.prompt)) &&
    (value.takeover === null || isTakeover(value.takeover)) &&
    (value.usageLimit === null || isUsageLimit(value.usageLimit))
  );
}

function isThread(value: unknown): value is AgentDockThread {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.taskId) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTaskTitle) &&
    value.title.length > 0
  );
}

function isThreadChoices(value: unknown): value is AgentDockThreadChoices {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.activeId) &&
    isList(value.threads, AGENT_DOCK_LIMITS.threads, isThreadChoice)
  );
}

function isThreadChoice(value: unknown): value is AgentDockThreadChoice {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTaskTitle) &&
    isBoundedString(value.updatedAt, AGENT_DOCK_LIMITS.threadTime) &&
    isThreadStatus(value.status) &&
    isCount(value.unread)
  );
}

function isThreadStatus(value: unknown): value is AgentDockThreadStatus {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "waiting") return isOneOf(AGENT_DOCK_WAIT_REASONS, value.reason);
  return isOneOf(AGENT_DOCK_THREAD_STATES, value.kind);
}

function isApproval(value: unknown): value is AgentDockApproval {
  return isDynamicRecord(value) && isAgentApproval(value.approval) && isCount(value.attempt) && isBoolean(value.cut);
}

function isPrompt(value: unknown): value is AgentDockPrompt {
  return (
    isDynamicRecord(value) &&
    isRequestId(value.requestId) &&
    isIdentifier(value.agentId) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    isIdentifier(value.turnId) &&
    Array.isArray(value.questions) &&
    value.questions.length > 0 &&
    isList(value.questions, INPUT_LIMITS.promptQuestions, isAgentPromptQuestion) &&
    isCount(value.attempt)
  );
}

function isTakeover(value: unknown): value is AgentDockTakeover {
  return (
    isDynamicRecord(value) &&
    isBrowserTakeoverRequest(value.request) &&
    (value.page === null || isTakeoverPage(value.page)) &&
    isBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
    (value.vault === null || isSecretVault(value.vault)) &&
    isCount(value.attempt)
  );
}

function isTakeoverPage(value: unknown): value is AgentDockTakeoverPage {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.title, AGENT_DOCK_LIMITS.pageTitle) &&
    isBoundedString(value.origin, AGENT_DOCK_LIMITS.pageOrigin)
  );
}

function isSecretVault(value: unknown): value is AgentDockSecretVault {
  return (
    isDynamicRecord(value) &&
    isNullableBoundedString(value.server, INPUT_LIMITS.agentName) &&
    (value.blocked === undefined || isOneOf(["role", "version"] as const, value.blocked))
  );
}

function isUsageLimit(value: unknown): value is AgentDockUsageLimit {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isAgentProvider(value.provider) &&
    isNullableBoundedString(value.model, AGENT_DOCK_LIMITS.backupModelLabel) &&
    isNullableBoundedString(value.agentName, INPUT_LIMITS.agentName) &&
    (value.resetsAt === null || integerInRange(value.resetsAt, 0, Number.MAX_SAFE_INTEGER)) &&
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    isList(value.options, AGENT_DOCK_LIMITS.backupModels, isBackupModel) &&
    isBoolean(value.rememberable) &&
    isCount(value.attempt)
  );
}

function isBackupModel(value: unknown): value is AgentDockBackupModel {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.key, AGENT_DOCK_LIMITS.backupModelKey) &&
    value.key.length > 0 &&
    isAgentModelChoice(value.choice) &&
    isBoundedString(value.model, AGENT_DOCK_LIMITS.backupModelLabel) &&
    isNullableBoundedString(value.account, AGENT_DOCK_LIMITS.backupModelLabel) &&
    isOneOf(["ready", "limit", "unavailable"] as const, value.state)
  );
}

function isMessage(value: unknown): value is AgentDockMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(["you", "agent"] as const, value.author) &&
    (value.senderAgentId === null || isIdentifier(value.senderAgentId)) &&
    (value.senderMember === null || isConversationMessageSender(value.senderMember)) &&
    isOneOf(["text", "error"] as const, value.kind) &&
    isBoundedString(value.body, INPUT_LIMITS.messageText) &&
    isList(value.attachments, INPUT_LIMITS.attachments, isAttachmentSummary)
  );
}

function isResult(value: unknown): value is AgentDockResult {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isOneOf(["file", "message"] as const, value.kind) &&
    isBoundedString(value.label, AGENT_DOCK_LIMITS.resultLabel) &&
    value.label.length > 0 &&
    integerInRange(value.at, 0, Number.MAX_SAFE_INTEGER)
  );
}

function isCount(value: unknown): value is number {
  return integerInRange(value, 0, AGENT_DOCK_LIMITS.count);
}

function isList<T>(value: unknown, maximum: number, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(isItem);
}
