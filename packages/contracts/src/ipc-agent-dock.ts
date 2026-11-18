// The agent dock: a column of agents and channels at the right edge of the screen, in a window of its own above the
// other apps. The main renderer owns the conversations: it publishes what the dock shows and does the
// actions that the dock window sends back. Main sends the messages typed in the dock.

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

/** The bounds of one presentation. A larger value is not valid, so main rejects the whole presentation. */
export const AGENT_DOCK_LIMITS = {
  seats: 24,
  /** The panel shows the newest text messages of each seat; the main window has the full history. */
  messages: 60,
  count: 10_000,
  displays: 16,
  displayLabel: 200,
  /** The finished-work shelf shows only the newest results; the seats keep the unread count. */
  results: 24,
  resultLabel: 200,
  /** The add menu offers at most this many channels; the renderer sends the first ones. */
  channels: 100,
  /** The bound of a channel image URL, the same as the channel contract. */
  channelImageUrl: 2048,
  /** The parts of a dock window that take the pointer on Linux: the dock, the panel, the shelf and the edge strip. */
  inputRects: 8,
  /** The largest window side, in px. */
  inputExtent: 100_000,
  /** The models that the usage-limit card of a chat offers. */
  backupModels: 64,
  backupModelKey: 400,
  backupModelLabel: 200,
  /** The page title and the origin that a browser takeover card shows. */
  pageTitle: 500,
  pageOrigin: 2048,
} as const;

/** A seat of the dock: an agent or a channel. The ids of the two kinds can be equal. */
export type AgentDockSeatRef = { kind: "agent"; id: string } | { kind: "channel"; id: string };

/** The agent fields that the dock, its chat and the mentions in the chat read. */
export interface AgentDockAgent {
  id: string;
  name: string;
  title: string;
  description: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor: AvatarColor | null;
  avatarUrl: string | null;
  /** The tint of the agent's chat bubbles, as in the main chat. Absent for no tint. */
  chatColor?: AvatarColor;
}

export const AGENT_DOCK_MOODS = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"] as const;
export type AgentDockMood = (typeof AGENT_DOCK_MOODS)[number];

export const AGENT_DOCK_WAIT_REASONS = ["question", "approval", "takeover"] as const;
export type AgentDockWaitReason = (typeof AGENT_DOCK_WAIT_REASONS)[number];

/** The channel fields that a channel seat and its chat read. `members` are agent ids, in channel order. */
export interface AgentDockChannel {
  id: string;
  name: string;
  title: string;
  members: string[];
  icon: ChannelIcon | null;
  imageUrl: string | null;
}

/** The badge on a seat: the same state as the agent's or channel's badge in the sidebar. */
export type AgentDockSeatState =
  | { kind: "waiting"; reason: AgentDockWaitReason; detail: string | null }
  | { kind: "working" }
  | { kind: "responded" }
  | { kind: "unread"; count: number }
  | { kind: "routine"; phase: "running" | "queued" | "failed"; count: number }
  | { kind: "limited"; resetsAt: number | null };

/**
 * `temporary`: the user did not put the seat on the dock. It shows while it has a new message or waits
 * for the user, when the user turned that on in Settings.
 */
export type AgentDockSeat =
  | { kind: "agent"; agent: AgentDockAgent; mood: AgentDockMood; state: AgentDockSeatState | null; temporary: boolean }
  | { kind: "channel"; channel: AgentDockChannel; state: AgentDockSeatState | null; temporary: boolean };

/**
 * A text message of the chat. `error` is a message that the app wrote because an action failed.
 * In a channel, `senderAgentId` names the agent of an agent message, and `senderMember` names another
 * person who wrote a `you` message. Both are null for the reader's own messages and in an agent chat.
 */
export interface AgentDockMessage {
  id: string;
  author: "you" | "agent";
  senderAgentId: string | null;
  senderMember: ConversationMessageSender | null;
  kind: "text" | "error";
  body: string;
  attachments: AttachmentSummary[];
}

/**
 * An approval that the user answers in the dock chat. `attempt` changes when an answer fails, so the
 * card shows its buttons again. `cut` is true when a runtime snapshot cut the request: the card then
 * offers only Deny, as in the main chat.
 */
export interface AgentDockApproval {
  approval: AgentApproval;
  attempt: number;
  cut: boolean;
}

/**
 * A question that the user answers in the dock chat: options, a typed or a secret answer, or the
 * consent of a plugin. A card that the agent drew shows its questions. `threadId` is null for the
 * agent's own chat when it has no thread yet.
 */
export interface AgentDockPrompt {
  requestId: string | number;
  agentId: string;
  threadId: string | null;
  turnId: string;
  questions: AgentPromptQuestion[];
  attempt: number;
}

/**
 * Where the code or the password of a takeover can also be saved: this computer (`server` null) or the
 * Vault of the joined server. `blocked` shows the box off, with the reason.
 */
export interface AgentDockSecretVault {
  server: string | null;
  blocked?: "role" | "version" | undefined;
}

/**
 * The page of a browser takeover, as the card names it. `origin` is the scheme and the host only:
 * the full address can hold a sign-in token, so it does not go to the dock.
 */
export interface AgentDockTakeoverPage {
  title: string;
  origin: string;
}

/**
 * A browser takeover: the user does a step in the page, or types a code or a password. The page
 * opens in the main window. `agentName` names the agent in a channel. `page` is null when the
 * renderer does not have the tab.
 */
export interface AgentDockTakeover {
  request: BrowserTakeoverRequest;
  page: AgentDockTakeoverPage | null;
  agentName: string;
  vault: AgentDockSecretVault | null;
  attempt: number;
}

/** A model that the usage-limit card offers, as the backup model controls show it. */
export interface AgentDockBackupModel {
  key: string;
  choice: AgentModelChoice;
  model: string;
  account: string | null;
  state: "ready" | "limit" | "unavailable";
}

/**
 * A usage limit holds the next message of an agent. The user sends it on another model, or waits.
 * `resetsAt` is in epoch seconds. `agentName` names the agent in a channel.
 */
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

/**
 * The chat of one seat. While a card shows, the user answers in the dock. A wait with no card, such as
 * one of another agent, shows the wait bar, which opens the main window.
 */
export interface AgentDockChat {
  seat: AgentDockSeatRef;
  /** The newest text messages, oldest first. */
  messages: AgentDockMessage[];
  working: boolean;
  /** Set while an agent of the seat waits for the user. */
  wait: AgentDockWaitReason | null;
  /** The approval of the chat, when the agent waits for one. */
  approval: AgentDockApproval | null;
  prompt: AgentDockPrompt | null;
  takeover: AgentDockTakeover | null;
  usageLimit: AgentDockUsageLimit | null;
}

/**
 * Work that an agent finished and that the user did not read yet. The shelf beside the dock shows it
 * for a short time. `label` is a file name or the first line of the answer. `at` is when the answer
 * came, in milliseconds since the epoch.
 */
export interface AgentDockResult {
  id: string;
  agentId: string;
  kind: "file" | "message";
  label: string;
  at: number;
}

/**
 * The display that holds the dock window. `window` follows the display of the main window. A display
 * that is not connected also follows the main window. `all` puts a dock on each display.
 */
export type AgentDockDisplay =
  | { kind: "window" }
  | { kind: "primary" }
  | { kind: "all" }
  | { kind: "display"; id: number };

/** A connected display that the dock can use. `label` is the name that macOS gives it. */
export interface AgentDockDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  internal: boolean;
}

/** The screen edge that holds the dock. */
export type AgentDockEdge = "left" | "right";

/**
 * Where the user dragged the dock on one display: 0 is the top of the work area, 1 the bottom, and 0.5
 * the centre.
 */
export interface AgentDockOffset {
  displayId: number;
  offset: number;
}

/**
 * The size of the dock above the other apps, in percent of its normal size. In the main window, the
 * dock follows the interface size.
 */
export const AGENT_DOCK_SIZE_LIMITS = { min: 70, max: 140, step: 1, default: 100 } as const;

/** A drag of the dock body. Main reads the pointer position and moves the window. */
export type AgentDockDragPhase = "start" | "move" | "end";

export interface AgentDockPresentation {
  serverId: string;
  display: AgentDockDisplay;
  edge: AgentDockEdge;
  /** The dock slides into the screen edge when the pointer is not on it and no chat is open. */
  autoHide: boolean;
  /** While hidden, a thin strip stays at the edge. It grows as the pointer comes near and shows the dock when the pointer is close. */
  edgeStrip: boolean;
  /** See `AGENT_DOCK_SIZE_LIMITS`. */
  sizePercent: number;
  /** The saved positions. A display without one has the dock in the centre. */
  offsets: AgentDockOffset[];
  seats: AgentDockSeat[];
  /** The agents that the add menu offers. */
  available: AgentDockAgent[];
  /** The channels that the add menu offers. */
  availableChannels: AgentDockChannel[];
  /** All agents of the server, so that mentions in a chat show as chips. */
  agents: AgentDockAgent[];
  /** One chat for each seat. */
  chats: AgentDockChat[];
  /** The unread results of the seated agents, oldest first. Channels have none. Empty when the user turned the shelf off. */
  results: AgentDockResult[];
}

export type AgentDockAction =
  /** The chat that the panel shows, or null when the panel closes. */
  | { type: "open-chat"; serverId: string; seat: AgentDockSeatRef | null }
  | { type: "add"; serverId: string; seat: AgentDockSeatRef }
  | { type: "remove"; serverId: string; seat: AgentDockSeatRef }
  /** Puts a seat before another seat, or at the end when `before` is null. */
  | { type: "move"; serverId: string; seat: AgentDockSeatRef; before: AgentDockSeatRef | null }
  /** Main sends it. A retry of the same draft keeps its `clientMessageId`, so the seat gets the message once. */
  | { type: "send"; serverId: string; seat: AgentDockSeatRef; text: string; clientMessageId: string }
  /** Shows the agent in the main window. */
  | { type: "open-agent"; serverId: string; agentId: string }
  /** Shows the channel in the main window. */
  | { type: "open-channel"; serverId: string; channelId: string }
  /** Opens the agent in its own chat window. */
  | { type: "open-window"; serverId: string; agentId: string }
  /** Answers the approval of an agent, in its chat or in a channel thread. */
  | {
      type: "respond-approval";
      serverId: string;
      agentId: string;
      requestId: string | number;
      decision: "accept" | "decline";
    }
  /**
   * Answers the question of an agent thread. An empty `answers` cancels it. A secret answer goes to the
   * main renderer, as the answers of the browser dock do; nothing writes it to a log.
   */
  | {
      type: "answer-prompt";
      serverId: string;
      agentId: string;
      threadId: string | null;
      requestId: string | number;
      answers: Record<string, string[]>;
    }
  /** Done or Cancel of a browser takeover. The code or the password goes to main from the dock window. */
  | {
      type: "respond-takeover";
      serverId: string;
      agentId: string;
      threadId: string | null;
      requestId: string | number;
      decision: "complete" | "cancel";
    }
  /** Sends the held message on the model `optionKey` of the usage-limit card. */
  | { type: "usage-limit-send"; serverId: string; agentId: string; optionKey: string; remember: boolean }
  /** Waits for the reset of the usage limit. */
  | { type: "usage-limit-wait"; serverId: string; agentId: string }
  | { type: "open-link"; url: string }
  /** Shows the agent dock settings in the main window. */
  | { type: "open-settings" }
  /** Turns the dock off, as the switch in Settings does. */
  | { type: "hide" };

/**
 * Why the agent dock and the Dynamic Island cannot show above other apps now. "restart": OpenBot runs on Wayland, and it can start
 * again on XWayland. "unsupported": it cannot, with no X11 display or in a development build.
 */
export type AboveAppsSupport = "restart" | "unsupported";

/** On: on Wayland, OpenBot starts again on XWayland, so the dock can show above other apps. */
export interface SetAgentDockXWaylandInput {
  enabled: boolean;
}

export interface SetAgentDockInteractiveInput {
  /** Whether the window takes the pointer. Outside the dock shapes, clicks go to the apps under it. */
  interactive: boolean;
  /** The chat composer needs key input. Main makes the panel key without activating the app. */
  keyboard?: boolean;
}

/** A part of the dock window, in window px. */
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
      return isIdentifier(value.agentId);
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

/**
 * The parts of the dock window that take the pointer and show. Linux gives no pointer events to a
 * window that lets them through, so there the window shape follows the dock instead.
 */
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
    value.offset <= 1
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
    isList(value.messages, AGENT_DOCK_LIMITS.messages, isMessage) &&
    isBoolean(value.working) &&
    (value.wait === null || isOneOf(AGENT_DOCK_WAIT_REASONS, value.wait)) &&
    (value.approval === null || isApproval(value.approval)) &&
    (value.prompt === null || isPrompt(value.prompt)) &&
    (value.takeover === null || isTakeover(value.takeover)) &&
    (value.usageLimit === null || isUsageLimit(value.usageLimit))
  );
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
