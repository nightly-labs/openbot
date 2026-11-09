// The agent dock: a column of agents and channels at the right edge of the screen, in a window of its own above the
// other apps. The main renderer owns the conversations: it publishes what the dock shows and does the
// actions that the dock window sends back. Main sends the messages typed in the dock.

import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, type AvatarHue, isAvatarColor, isAvatarHue } from "./ipc-agent-identity";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import {
  integerInRange,
  isBoundedString,
  isFiniteNumber,
  isIdentifier,
  isNullableBoundedString,
} from "./ipc-bounded-values";
import { type ChannelIcon, isChannelIcon } from "./ipc-chat-channels";
import { type ConversationMessageSender, isConversationMessageSender } from "./ipc-conversation-messages";
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

export type AgentDockSeat =
  | { kind: "agent"; agent: AgentDockAgent; mood: AgentDockMood; state: AgentDockSeatState | null }
  | { kind: "channel"; channel: AgentDockChannel; state: AgentDockSeatState | null };

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

export interface AgentDockChat {
  seat: AgentDockSeatRef;
  /** The newest text messages, oldest first. */
  messages: AgentDockMessage[];
  working: boolean;
  /** Set while the agent waits for the user. The user answers in the main window. */
  wait: AgentDockWaitReason | null;
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

/** A drag of the dock body. Main reads the pointer position and moves the window. */
export type AgentDockDragPhase = "start" | "move" | "end";

export interface AgentDockPresentation {
  serverId: string;
  display: AgentDockDisplay;
  edge: AgentDockEdge;
  /** The dock slides into the screen edge when the pointer is not on it and no chat is open. */
  autoHide: boolean;
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
  /** Main sends it. A retry of the same draft keeps its `clientMessageId`, so the seat gets the message once. */
  | { type: "send"; serverId: string; seat: AgentDockSeatRef; text: string; clientMessageId: string }
  /** Shows the agent in the main window. */
  | { type: "open-agent"; serverId: string; agentId: string }
  /** Shows the channel in the main window. */
  | { type: "open-channel"; serverId: string; channelId: string }
  /** Opens the agent in its own chat window. */
  | { type: "open-window"; serverId: string; agentId: string }
  | { type: "open-link"; url: string }
  /** Shows the agent dock settings in the main window. */
  | { type: "open-settings" };

export interface SetAgentDockInteractiveInput {
  /** Whether the window takes the pointer. Outside the dock shapes, clicks go to the apps under it. */
  interactive: boolean;
  /** The chat composer needs key input. Main makes the panel key without activating the app. */
  keyboard?: boolean;
}

export function isAgentDockPresentation(value: unknown): value is AgentDockPresentation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    isAgentDockDisplay(value.display) &&
    (value.edge === "left" || value.edge === "right") &&
    isBoolean(value.autoHide) &&
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
  if (value.type === "open-settings") return true;
  if (!isIdentifier(value.serverId)) return false;
  switch (value.type) {
    case "open-chat":
      return value.seat === null || isSeatRef(value.seat);
    case "add":
    case "remove":
      return isSeatRef(value.seat);
    case "open-agent":
    case "open-window":
      return isIdentifier(value.agentId);
    case "open-channel":
      return isIdentifier(value.channelId);
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
    isNullableBoundedString(value.avatarUrl, INPUT_LIMITS.avatarUrl)
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
  if (!isDynamicRecord(value) || !(value.state === null || isSeatState(value.state))) return false;
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
    (value.wait === null || isOneOf(AGENT_DOCK_WAIT_REASONS, value.wait))
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
