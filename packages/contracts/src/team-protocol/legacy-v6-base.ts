// Frozen provider-aware schema for protocol 6: the protocol 5 schema, with Cursor (`cursor`) and Cline
// (`cline`) added to the providers and auth kinds, and `=` and `,` added to the agent model charset for
// Cursor model ids. Versions 1-5 retain their own codec.
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";

export const TEAM_PROTOCOL_V6Base = 6;
export const TEAM_PROTOCOL_VERSION_HEADER = "OpenBot-Protocol-Version";
export const TEAM_APP_VERSION_HEADER = "OpenBot-App-Version";
export const TEAM_CAPABILITIES_HEADER = "OpenBot-Capabilities";
export const TEAM_PROTOCOL_V6Base_WEBSOCKET = "openbot-team-v6";

export const TEAM_PROTOCOL_V6Base_CAPABILITIES = [
  "agent-runtime-snapshots",
  "browser-control",
  "conversation-pagination",
  "direct-messages",
  "hosted-site-event-markers",
  "remote-desktop",
  "routine-event-markers",
  "routine-run-event-markers",
  "sidebar-layout",
] as const;

export type TeamProtocolV6BaseCapability = (typeof TEAM_PROTOCOL_V6Base_CAPABILITIES)[number];

const TEAM_PROTOCOL_V6Base_CAPABILITY_SET = new Set<string>(TEAM_PROTOCOL_V6Base_CAPABILITIES);

export type TeamProtocolV6BaseEventDecodeResult =
  | { kind: "known"; event: TeamProtocolV6BaseEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string | null };

export type TeamProtocolV6BaseJsonValue =
  | null
  | boolean
  | number
  | string
  | TeamProtocolV6BaseJsonValue[]
  | TeamProtocolV6BaseJsonObject;

export interface TeamProtocolV6BaseJsonObject {
  [key: string]: TeamProtocolV6BaseJsonValue;
}

interface TeamProtocolV6BasePresenceMember {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl?: string | null;
  role: "owner" | "admin" | "member";
  createdAt: string;
  disabled: boolean;
  online: boolean;
  typingBotId: string | null;
}

interface TeamProtocolV6BasePresenceSnapshot {
  serverId: string | null;
  members: TeamProtocolV6BasePresenceMember[];
  updatedAt: string;
}

interface TeamProtocolV6BaseDirectMessage {
  id: string;
  threadId: string;
  senderMemberId: string;
  recipientMemberId: string;
  text: string;
  createdAt: string;
  sequence: number;
}

export type TeamProtocolV6BaseEvent =
  | { type: "status"; status: TeamProtocolV6BaseJsonObject }
  | { type: "usage-changed"; usage: TeamProtocolV6BaseJsonObject }
  | { type: "bots-changed"; bots: TeamProtocolV6BaseJsonObject[] }
  | { type: "memories-changed"; botId: string }
  | { type: "routines-changed"; botId: string }
  | { type: "sidebar-layout-changed"; layout: TeamProtocolV6BaseJsonObject }
  | { type: "conversation"; snapshot: TeamProtocolV6BaseJsonObject }
  | { type: "conversation-invalidated"; botId: string; revision: number }
  | { type: "conversation-page"; page: TeamProtocolV6BaseJsonObject }
  | {
      type: "conversation-delta";
      botId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "queue-invalidated"; botId: string }
  | { type: "queue-changed"; snapshot: TeamProtocolV6BaseJsonObject }
  | { type: "turn-started"; botId: string; threadId: string; turnId: string; origin?: string }
  | { type: "turn-completed"; botId: string; threadId: string; turnId: string; status: string; origin?: string }
  | {
      type: "prompt";
      requestId: string | number;
      botId: string;
      threadId: string;
      turnId: string;
      questions: TeamProtocolV6BaseJsonObject[];
    }
  | { type: "agent-input-resolved"; kind: "prompt" | "approval"; requestId: string | number; botId: string }
  | { type: "browser-takeover-requested"; request: TeamProtocolV6BaseJsonObject }
  | { type: "browser-takeover-resolved"; requestId: string | number; botId: string }
  | { type: "approval"; approval: TeamProtocolV6BaseJsonObject }
  | { type: "runtime-snapshot"; snapshot: TeamProtocolV6BaseJsonObject }
  | { type: "browser-changed"; tabs: TeamProtocolV6BaseJsonObject[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: TeamProtocolV6BaseJsonObject }
  | { type: "error"; botId?: string; code: string; message: string }
  | { type: "team-identity"; serverId: string; serverName: string; logoVersion: string | null }
  | { type: "team-presence"; snapshot: TeamProtocolV6BasePresenceSnapshot }
  | { type: "team-direct-message"; message: TeamProtocolV6BaseDirectMessage; memberIds: [string, string] }
  | { type: "team-direct-typing"; senderMemberId: string; recipientMemberId: string; typing: boolean };

export type TeamProtocolV6BaseClientEvent =
  | { type: "runtime-snapshot-request" }
  | { type: "agent-event-scope"; includeConversations: boolean; capabilities?: readonly string[] }
  | { type: "team-typing"; botId: string | null; typing: boolean }
  | { type: "team-direct-typing"; recipientMemberId: string; typing: boolean };

const AGENT_EVENT_TYPES = [
  "status",
  "usage-changed",
  "bots-changed",
  "memories-changed",
  "routines-changed",
  "sidebar-layout-changed",
  "conversation",
  "conversation-invalidated",
  "conversation-page",
  "conversation-delta",
  "queue-invalidated",
  "queue-changed",
  "turn-started",
  "turn-completed",
  "prompt",
  "agent-input-resolved",
  "browser-takeover-requested",
  "browser-takeover-resolved",
  "approval",
  "runtime-snapshot",
  "browser-changed",
  "browser-control-changed",
  "error",
] as const;

const TEAM_EVENT_TYPES = ["team-identity", "team-presence", "team-direct-message", "team-direct-typing"] as const;
const TEAM_PROTOCOL_V6Base_EVENT_TYPES = [...AGENT_EVENT_TYPES, ...TEAM_EVENT_TYPES] as const;
const TEAM_PROTOCOL_V6Base_EVENT_TYPE_SET = new Set<string>(TEAM_PROTOCOL_V6Base_EVENT_TYPES);

export function decodeTeamProtocolV6BaseEvent(value: unknown): TeamProtocolV6BaseEventDecodeResult {
  if (!isDynamicRecord(value) || !isString(value.type)) return { kind: "invalid", type: null };
  if (!TEAM_PROTOCOL_V6Base_EVENT_TYPE_SET.has(value.type)) {
    return { kind: "unknown", type: value.type };
  }
  const projected = projectTeamProtocolV6BaseEvent(value);
  if (isTeamProtocolV6BaseKnownEvent(projected)) return { kind: "known", event: projected };
  return { kind: "invalid", type: value.type };
}

export function encodeTeamProtocolV6BaseEvent(event: TeamProtocolV6BaseEvent): string | null {
  const decoded = decodeTeamProtocolV6BaseEvent(event);
  return decoded.kind === "known" ? JSON.stringify(decoded.event) : null;
}

const TEAM_PROTOCOL_V6Base_EVENT_KEYS = {
  status: ["type", "status"],
  "usage-changed": ["type", "usage"],
  "bots-changed": ["type", "bots"],
  "memories-changed": ["type", "botId"],
  "routines-changed": ["type", "botId"],
  "sidebar-layout-changed": ["type", "layout"],
  conversation: ["type", "snapshot"],
  "conversation-invalidated": ["type", "botId", "revision"],
  "conversation-page": ["type", "page"],
  "conversation-delta": ["type", "botId", "threadId", "turnId", "messageId", "delta", "createdAt", "revision"],
  "queue-invalidated": ["type", "botId"],
  "queue-changed": ["type", "snapshot"],
  "turn-started": ["type", "botId", "threadId", "turnId", "origin"],
  "turn-completed": ["type", "botId", "threadId", "turnId", "status", "origin"],
  prompt: ["type", "requestId", "botId", "threadId", "turnId", "questions"],
  "agent-input-resolved": ["type", "kind", "requestId", "botId"],
  "browser-takeover-requested": ["type", "request"],
  "browser-takeover-resolved": ["type", "requestId", "botId"],
  approval: ["type", "approval"],
  "runtime-snapshot": ["type", "snapshot"],
  "browser-changed": ["type", "tabs", "activeTabId"],
  "browser-control-changed": ["type", "state"],
  error: ["type", "botId", "code", "message"],
  "team-identity": ["type", "serverId", "serverName", "logoVersion"],
  "team-presence": ["type", "snapshot"],
  "team-direct-message": ["type", "message", "memberIds"],
  "team-direct-typing": ["type", "senderMemberId", "recipientMemberId", "typing"],
} as const satisfies Record<(typeof TEAM_PROTOCOL_V6Base_EVENT_TYPES)[number], readonly string[]>;

function projectTeamProtocolV6BaseEvent(value: DynamicRecord): DynamicRecord {
  if (!isString(value.type) || !isTeamProtocolV6BaseEventType(value.type)) return value;
  const eventType = value.type;
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_EVENT_KEYS[eventType]);
  switch (eventType) {
    case "status":
      if (isDynamicRecord(projected.status)) {
        projected.status = projectTeamProtocolV6BaseHttpResponse("GET agent-status", projected.status);
      }
      break;
    case "usage-changed":
      if (isDynamicRecord(projected.usage)) {
        projected.usage = projectTeamProtocolV6BaseHttpResponse("GET agent-usage", projected.usage);
      }
      break;
    case "bots-changed":
      if (Array.isArray(projected.bots)) projected.bots = projected.bots.map(projectV6BaseBot);
      break;
    case "sidebar-layout-changed":
      if (isDynamicRecord(projected.layout)) {
        projected.layout = projectV6BaseSidebarLayout(projected.layout);
      }
      break;
    case "conversation":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV6BaseConversation(projected.snapshot, false, false);
      }
      break;
    case "conversation-page":
      if (isDynamicRecord(projected.page)) {
        projected.page = projectTeamProtocolV6BaseHttpResponse("GET conversation-page", projected.page);
      }
      break;
    case "queue-changed":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV6BaseQueueSnapshot(projected.snapshot);
      }
      break;
    case "prompt":
      if (Array.isArray(projected.questions))
        projected.questions = projected.questions.map(projectV6BasePromptQuestion);
      break;
    case "browser-takeover-requested":
      if (isDynamicRecord(projected.request)) projected.request = projectV6BaseBrowserTakeover(projected.request);
      break;
    case "approval":
      if (isDynamicRecord(projected.approval)) projected.approval = projectV6BaseApproval(projected.approval, false);
      break;
    case "runtime-snapshot":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV6BaseRuntimeSnapshot(projected.snapshot);
      }
      break;
    case "browser-changed":
      if (Array.isArray(projected.tabs)) {
        projected.tabs = projected.tabs.map((tab) => projectV6BaseObject(tab, V6Base_BROWSER_TAB_KEYS));
      }
      break;
    case "browser-control-changed":
      if (isDynamicRecord(projected.state)) {
        projected.state = projectV6BaseBrowserControl(projected.state);
      }
      break;
    case "team-presence":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectTeamProtocolV6BaseHttpResponse("GET team-presence", projected.snapshot);
      }
      break;
    case "team-direct-message":
      if (isDynamicRecord(projected.message)) {
        projected.message = projectV6BaseObject(projected.message, V6Base_DIRECT_MESSAGE_KEYS);
      }
      break;
  }
  return projected;
}

function isTeamProtocolV6BaseEventType(value: string): value is keyof typeof TEAM_PROTOCOL_V6Base_EVENT_KEYS {
  return TEAM_PROTOCOL_V6Base_EVENT_TYPE_SET.has(value);
}

// This is the frozen v1 wire validator. Do not replace its nested checks with current IPC validators.
function isTeamProtocolV6BaseKnownEvent(value: DynamicRecord): value is TeamProtocolV6BaseEvent {
  switch (value.type) {
    case "status":
      return isV6BaseAgentStatus(value.status);
    case "usage-changed":
      return isV6BaseAccountUsage(value.usage);
    case "bots-changed":
      return Array.isArray(value.bots) && value.bots.length <= 100 && value.bots.every(isV6BaseBotSummary);
    case "memories-changed":
    case "routines-changed":
    case "queue-invalidated":
      return isString(value.botId);
    case "sidebar-layout-changed":
      return isV6BaseSidebarLayout(value.layout);
    case "conversation":
      return isV6BaseConversationSnapshot(value.snapshot);
    case "queue-changed":
      return isV6BaseQueueSnapshot(value.snapshot);
    case "conversation-invalidated":
      return isString(value.botId) && isNumber(value.revision);
    case "conversation-page":
      return isV6BaseConversationPage(value.page);
    case "conversation-delta":
      return (
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.messageId) &&
        isString(value.delta) &&
        isString(value.createdAt) &&
        isNumber(value.revision)
      );
    case "turn-started":
      return (
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        (value.origin === undefined || isV6BaseOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "turn-completed":
      return (
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.status) &&
        (value.origin === undefined || isV6BaseOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "prompt":
      return (
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        Array.isArray(value.questions) &&
        value.questions.length <= 32 &&
        value.questions.every(isV6BasePromptQuestion)
      );
    case "agent-input-resolved":
      return (
        (value.kind === "prompt" || value.kind === "approval") &&
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId)
      );
    case "browser-takeover-requested":
      return isV6BaseBrowserTakeover(value.request);
    case "browser-takeover-resolved":
      return (isString(value.requestId) || isNumber(value.requestId)) && isString(value.botId);
    case "approval":
      return isV6BaseApproval(value.approval, false);
    case "runtime-snapshot":
      return isV6BaseRuntimeSnapshot(value.snapshot);
    case "browser-changed":
      return (
        Array.isArray(value.tabs) &&
        value.tabs.every(isV6BaseBrowserTab) &&
        (value.activeTabId === null || isString(value.activeTabId))
      );
    case "browser-control-changed":
      return isV6BaseBrowserControl(value.state);
    case "error":
      return isString(value.code) && isString(value.message);
    case "team-identity":
      return (
        isString(value.serverId) &&
        isString(value.serverName) &&
        (value.logoVersion === null || isString(value.logoVersion))
      );
    case "team-presence":
      return isTeamProtocolV6BasePresenceSnapshot(value.snapshot);
    case "team-direct-message":
      return (
        isTeamProtocolV6BaseDirectMessage(value.message) &&
        Array.isArray(value.memberIds) &&
        value.memberIds.length === 2 &&
        value.memberIds[0] === value.message.senderMemberId &&
        value.memberIds[1] === value.message.recipientMemberId
      );
    case "team-direct-typing":
      return isString(value.senderMemberId) && isString(value.recipientMemberId) && isBoolean(value.typing);
    default:
      return false;
  }
}

function isTeamProtocolV6BaseJsonValue(value: unknown): value is TeamProtocolV6BaseJsonValue {
  return (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    (isNumber(value) && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isTeamProtocolV6BaseJsonValue)) ||
    isTeamProtocolV6BaseJsonObject(value)
  );
}

function isTeamProtocolV6BaseJsonObject(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return isDynamicRecord(value) && Object.values(value).every(isTeamProtocolV6BaseJsonValue);
}

function isV6BaseBotSummary(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.name, 80) &&
    isV6BaseBoundedString(value.title, 120) &&
    isV6BaseBoundedString(value.description, 2_000) &&
    isBoolean(value.notifications) &&
    (value.provider === "codex" ||
      value.provider === "claude" ||
      value.provider === "grok" ||
      value.provider === "opencode" ||
      value.provider === "antigravity" ||
      value.provider === "acp" ||
      value.provider === "cursor" ||
      value.provider === "cline") &&
    isString(value.model) &&
    // The charset of `isAgentModel`: the Claude CLI names a 1M-context model `claude-opus-5-5[1m]`, and
    // the Cursor CLI lists ids such as `gpt-5.6-sol[context=272k,reasoning=medium,fast=false]`.
    /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u.test(value.model) &&
    isV6BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort) &&
    (value.threadId === null || isV6BaseIdentifier(value.threadId)) &&
    isV6BaseBoundedString(value.workspacePath, 4_096) &&
    isV6BaseBoundedString(value.preview, 100_000) &&
    (value.updatedAt === null || isV6BaseBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null || isV6BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isV6BaseBoundedString(value.avatarUrl, 2_048)) &&
    (value.marketplaceSource === undefined || isV6BaseMarketplaceSource(value.marketplaceSource))
  );
}

function isV6BaseMarketplaceSource(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.agentId) &&
    isV6BaseIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    isV6BaseIdentifierList(value.skillIds, 100) &&
    isV6BaseIdentifierList(value.routineIds, 64)
  );
}

function isV6BaseSidebarLayout(value: unknown): value is TeamProtocolV6BaseJsonObject {
  if (
    !isTeamProtocolV6BaseJsonObject(value) ||
    !isNumber(value.revision) ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.sections) ||
    !Array.isArray(value.order) ||
    !isDynamicRecord(value.agentAssignments) ||
    !Array.isArray(value.agentOrder)
  ) {
    return false;
  }
  return (
    value.sections.length <= 100 &&
    value.sections.every(
      (section) =>
        isDynamicRecord(section) &&
        isV6BaseIdentifier(section.id) &&
        isV6BaseBoundedString(section.name, 40) &&
        section.name.length > 0,
    ) &&
    value.order.every(isV6BaseIdentifier) &&
    Object.values(value.agentAssignments).every(isV6BaseIdentifier) &&
    value.agentOrder.every(isV6BaseIdentifier) &&
    new Set(value.agentOrder).size === value.agentOrder.length
  );
}

function isV6BaseConversationSnapshot(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseIdentifier(value.botId) &&
    (value.threadId === null || isV6BaseIdentifier(value.threadId)) &&
    (value.activeTurnId === null || isV6BaseIdentifier(value.activeTurnId)) &&
    isV6BaseRevision(value.revision) &&
    Array.isArray(value.messages) &&
    value.messages.every(isV6BaseConversationMessage)
  );
}

function isV6BaseConversationPage(value: unknown): value is TeamProtocolV6BaseJsonObject {
  if (!isV6BaseConversationSnapshot(value) || !Array.isArray(value.messages) || value.messages.length > 100)
    return false;
  return (
    isDynamicRecord(value.references) &&
    Object.values(value.references).every(isV6BaseConversationMessage) &&
    isDynamicRecord(value.pageInfo) &&
    isBoolean(value.pageInfo.hasOlder) &&
    (value.pageInfo.olderCursor === null || isString(value.pageInfo.olderCursor)) &&
    (value.readState === undefined || isV6BaseConversationReadState(value.readState))
  );
}

function isV6BaseConversationMessage(value: unknown): boolean {
  if (!isTeamProtocolV6BaseJsonObject(value)) return false;
  return (
    isV6BaseIdentifier(value.id) &&
    isString(value.text) &&
    isV6BaseBoundedString(value.createdAt, 160) &&
    isV6BaseOneOf(["user", "assistant", "agent", "system"], value.author) &&
    isV6BaseOneOf(["streaming", "completed", "failed", "interrupted"], value.status) &&
    (value.turnId === undefined || isV6BaseIdentifier(value.turnId)) &&
    (value.itemType === undefined || isV6BaseBoundedString(value.itemType, 128)) &&
    (value.source === undefined || isV6BaseOneOf(["user", "assistant", "agent", "system", "routine"], value.source)) &&
    (value.senderBotId === undefined || isV6BaseIdentifier(value.senderBotId)) &&
    (value.replyToMessageId === undefined ||
      value.replyToMessageId === null ||
      isV6BaseIdentifier(value.replyToMessageId)) &&
    (value.attachments === undefined || isV6BaseAttachments(value.attachments)) &&
    (value.delivery === undefined || isV6BaseConversationDelivery(value.delivery)) &&
    (value.exchange === undefined || isV6BaseExchange(value.exchange)) &&
    (value.reaction === undefined || value.reaction === null || isV6BaseBoundedString(value.reaction, 32)) &&
    (value.reactions === undefined ||
      (Array.isArray(value.reactions) && value.reactions.length <= 100 && value.reactions.every(isV6BaseReaction))) &&
    (value.routine === undefined || isV6BaseRoutineReference(value.routine)) &&
    (value.imageGeneration === undefined || isV6BaseImageGeneration(value.imageGeneration)) &&
    (value.questionPrompt === undefined || isV6BaseConversationQuestionPrompt(value.questionPrompt))
  );
}

function isV6BaseConversationDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseQueueStatus(value.status) &&
    isV6BaseQueuePosition(value.position)
  );
}

function isV6BaseExchange(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseOneOf(["incoming", "outgoing"], value.direction) &&
    isV6BaseIdentifier(value.messageId) &&
    isV6BaseIdentifier(value.senderBotId) &&
    isV6BaseIdentifierList(value.recipientBotIds, 100) &&
    (value.replyToMessageId === null || isV6BaseIdentifier(value.replyToMessageId)) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.length <= 100 &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isV6BaseIdentifier(delivery.id) &&
        isV6BaseIdentifier(delivery.recipientBotId) &&
        isV6BaseQueueStatus(delivery.status) &&
        isV6BaseQueuePosition(delivery.position) &&
        (delivery.error === null || isV6BaseBoundedString(delivery.error, 100_000)),
    )
  );
}

function isV6BaseReaction(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseBoundedString(value.emoji, 32) &&
    isDynamicRecord(value.actor) &&
    (value.actor.kind === "user" || (value.actor.kind === "bot" && isV6BaseIdentifier(value.actor.botId)))
  );
}

function isV6BaseRoutineReference(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.routineId) &&
    isV6BaseIdentifier(value.runId) &&
    isV6BaseLimitedString(value.name, 160) &&
    isV6BaseTimestamp(value.scheduledFor)
  );
}

function isV6BaseImageGeneration(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    isString(value.resolution) &&
    isV6BaseOneOf(["square", "portrait", "landscape"], value.aspectRatio) &&
    (value.error === undefined || isString(value.error))
  );
}

function isV6BaseConversationQuestionPrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseRequestId(value.requestId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isV6BasePromptQuestion) &&
    (value.resolution === null || isV6BasePromptResolution(value.resolution))
  );
}

function isV6BasePromptResolution(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.status === "cancelled" || value.status === "expired") return true;
  return (
    value.status === "answered" &&
    isDynamicRecord(value.responses) &&
    Object.values(value.responses).every(
      (response) =>
        isDynamicRecord(response) &&
        (response.status === "skipped" ||
          (response.status === "answered" &&
            (response.answers === undefined || (Array.isArray(response.answers) && response.answers.every(isString))))),
    )
  );
}

function isV6BaseConversationReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    (value.firstUnreadMessageId === null || isV6BaseIdentifier(value.firstUnreadMessageId)) &&
    (value.throughMessageId === null || isV6BaseIdentifier(value.throughMessageId))
  );
}

function isV6BaseQueueSnapshot(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseIdentifier(value.botId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isV6BaseQueueDelivery)
  );
}

function isV6BaseQueueDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.messageId) &&
    isV6BaseIdentifier(value.recipientBotId) &&
    isV6BaseQueueSender(value.sender) &&
    isV6BaseBoundedString(value.text, 100_000) &&
    isV6BaseAttachments(value.attachments) &&
    (value.replyToMessageId === null || isV6BaseIdentifier(value.replyToMessageId)) &&
    isV6BaseQueueStatus(value.status) &&
    isV6BaseQueuePosition(value.position) &&
    (value.turnId === null || isV6BaseIdentifier(value.turnId)) &&
    (value.error === null || isV6BaseBoundedString(value.error, 100_000)) &&
    isV6BaseBoundedString(value.createdAt, 160)
  );
}

function isV6BaseQueueSender(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "user") return true;
  if (value.kind === "bot") return isV6BaseIdentifier(value.botId);
  return (
    value.kind === "routine" &&
    isV6BaseIdentifier(value.routineId) &&
    isV6BaseIdentifier(value.runId) &&
    isV6BaseBoundedString(value.routineName, 80) &&
    isV6BaseBoundedString(value.scheduledFor, 160)
  );
}

function isV6BaseAttachments(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 10 && value.every(isV6BaseAttachment);
}

function isV6BaseAttachment(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.name, 255) &&
    isNumber(value.size) &&
    value.size >= 0 &&
    isV6BaseOneOf(["image", "file"], value.kind) &&
    isV6BaseBoundedString(value.mimeType, 255) &&
    isV6BaseOneOf(["image", "pdf", "text", "none"], value.previewKind) &&
    (value.previewUrl === null || isV6BaseBoundedString(value.previewUrl, 2_048))
  );
}

function isV6BasePromptQuestion(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseBoundedString(value.id, 128) &&
    isV6BaseBoundedString(value.header, 120) &&
    isV6BaseBoundedString(value.question, 2_000) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isV6BaseBoundedString(option.label, 120) &&
            isV6BaseBoundedString(option.description, 2_000),
        )))
  );
}

function isV6BaseBrowserTakeover(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseRequestId(value.requestId) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.turnId) &&
    isV6BaseIdentifier(value.tabId)
  );
}

function isV6BaseApproval(value: unknown, runtime: boolean): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    isV6BaseRequestId(value.requestId) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.turnId) &&
    isV6BaseOneOf(["command", "file-change", "permissions"], value.kind) &&
    isV6BaseNullableString(value.command, runtime ? 240 : 100_000) &&
    isV6BaseNullableString(value.cwd, runtime ? 240 : 4_096) &&
    isV6BaseNullableString(value.reason, runtime ? 240 : 100_000) &&
    isV6BaseNullableString(value.grantRoot, runtime ? 240 : 4_096) &&
    (!runtime || isBoolean(value.truncated)) &&
    (value.permissions === null || isV6BaseApprovalPermissions(value.permissions, runtime))
  );
}

function isV6BaseApprovalPermissions(value: unknown, runtime: boolean): boolean {
  const maximumItems = runtime ? 3 : 100;
  const maximumPath = runtime ? 240 : 4_096;
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.fileSystem) &&
    isV6BaseStringList(value.fileSystem.read, maximumItems, maximumPath) &&
    isV6BaseStringList(value.fileSystem.write, maximumItems, maximumPath) &&
    isBoolean(value.network)
  );
}

function isV6BaseRuntimeSnapshot(value: unknown): value is TeamProtocolV6BaseJsonObject {
  return (
    isTeamProtocolV6BaseJsonObject(value) &&
    Array.isArray(value.bots) &&
    value.bots.length <= 100 &&
    value.bots.every(isV6BaseRuntimeBot) &&
    Array.isArray(value.activeTurns) &&
    value.activeTurns.length <= 100 &&
    value.activeTurns.every(isV6BaseRuntimeTurn) &&
    Array.isArray(value.work) &&
    value.work.length <= 7 &&
    value.work.every(isV6BaseRuntimeWork) &&
    Array.isArray(value.latestMessages) &&
    value.latestMessages.length <= 100 &&
    value.latestMessages.every(isV6BaseRuntimeMessage) &&
    isBoolean(value.attentionComplete) &&
    Array.isArray(value.pendingPrompts) &&
    value.pendingPrompts.length <= 4 &&
    value.pendingPrompts.every(isV6BaseRuntimePrompt) &&
    Array.isArray(value.pendingApprovals) &&
    value.pendingApprovals.length <= 4 &&
    value.pendingApprovals.every((approval) => isV6BaseApproval(approval, true)) &&
    Array.isArray(value.pendingBrowserTakeovers) &&
    value.pendingBrowserTakeovers.length <= 4 &&
    value.pendingBrowserTakeovers.every(isV6BaseBrowserTakeover) &&
    value.pendingPrompts.length + value.pendingApprovals.length + value.pendingBrowserTakeovers.length <= 4 &&
    Array.isArray(value.failedTurns) &&
    value.failedTurns.length <= 100 &&
    value.failedTurns.every(isV6BaseFailedTurn)
  );
}

function isV6BaseRuntimeBot(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.name, 80) &&
    isBoolean(value.notifications) &&
    isV6BaseBoundedString(value.preview, 240) &&
    (value.updatedAt === null || isV6BaseBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null || isV6BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isV6BaseBoundedString(value.avatarUrl, 2_048))
  );
}

function isV6BaseRuntimeTurn(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.turnId)
  );
}

function isV6BaseFailedTurn(value: unknown): boolean {
  return isDynamicRecord(value) && isV6BaseIdentifier(value.botId) && isV6BaseIdentifier(value.turnId);
}

function isV6BaseRuntimeWork(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.botId) &&
    (value.turnId === null || isV6BaseIdentifier(value.turnId)) &&
    isV6BaseOneOf(["starting", "running", "failed"], value.status) &&
    isV6BaseBoundedString(value.text, 240) &&
    isV6BaseNullableString(value.error, 240)
  );
}

function isV6BaseRuntimeMessage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.text, 240) &&
    isV6BaseBoundedString(value.createdAt, 160)
  );
}

function isV6BaseRuntimePrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseRequestId(value.requestId) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.turnId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isV6BaseRuntimePromptQuestion)
  );
}

function isV6BaseRuntimePromptQuestion(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.header, 80) &&
    isV6BaseBoundedString(value.question, 240) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isV6BaseBoundedString(option.label, 120) &&
            isV6BaseBoundedString(option.description, 120),
        )))
  );
}

function isV6BaseQueueStatus(value: unknown): boolean {
  return isV6BaseOneOf(["queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"], value);
}

function isV6BaseQueuePosition(value: unknown): boolean {
  return value === null || (isNumber(value) && Number.isInteger(value) && value >= 1);
}

function isV6BaseRevision(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isV6BaseRequestId(value: unknown): value is string | number {
  return isNumber(value) || isV6BaseIdentifier(value);
}

function isV6BaseIdentifierList(value: unknown, limit: number): boolean {
  return Array.isArray(value) && value.length <= limit && value.every(isV6BaseIdentifier);
}

function isV6BaseStringList(value: unknown, count: number, length: number): boolean {
  return Array.isArray(value) && value.length <= count && value.every((item) => isV6BaseBoundedString(item, length));
}

function isV6BaseNullableString(value: unknown, limit: number): boolean {
  return value === null || isV6BaseBoundedString(value, limit);
}

function isV6BaseBoundedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length <= limit;
}

function isV6BaseOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

function isTeamProtocolV6BasePresenceSnapshot(value: unknown): value is TeamProtocolV6BasePresenceSnapshot {
  return (
    isDynamicRecord(value) &&
    (value.serverId === null || isV6BaseIdentifier(value.serverId)) &&
    Array.isArray(value.members) &&
    value.members.length <= 100 &&
    value.members.every(isTeamProtocolV6BasePresenceMember) &&
    isV6BaseTimestamp(value.updatedAt)
  );
}

function isTeamProtocolV6BasePresenceMember(value: unknown): value is TeamProtocolV6BasePresenceMember {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseLimitedString(value.username, 254) &&
    (value.email === null || isV6BaseLimitedString(value.email, 254)) &&
    (value.name === null || isV6BaseLimitedString(value.name, 120)) &&
    (value.avatarUrl === undefined || value.avatarUrl === null || isV6BaseHttpUrl(value.avatarUrl, 2_048)) &&
    (value.role === "owner" || value.role === "admin" || value.role === "member") &&
    isV6BaseTimestamp(value.createdAt) &&
    isBoolean(value.disabled) &&
    isBoolean(value.online) &&
    (value.typingBotId === null || isV6BaseIdentifier(value.typingBotId))
  );
}

function isTeamProtocolV6BaseDirectMessage(value: unknown): value is TeamProtocolV6BaseDirectMessage {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.senderMemberId) &&
    isV6BaseIdentifier(value.recipientMemberId) &&
    value.senderMemberId !== value.recipientMemberId &&
    isV6BaseLimitedString(value.text, 20_000) &&
    isV6BaseTimestamp(value.createdAt) &&
    isNumber(value.sequence) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0
  );
}

function isV6BaseIdentifier(value: unknown): value is string {
  return isV6BaseLimitedString(value, 128);
}

function isV6BaseTimestamp(value: unknown): value is string {
  return isV6BaseLimitedString(value, 64) && Number.isFinite(Date.parse(value));
}

function isV6BaseHttpUrl(value: unknown, limit: number): value is string {
  if (!isV6BaseLimitedString(value, limit)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isV6BaseLimitedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

export function encodeTeamProtocolV6BaseClientEvent(event: TeamProtocolV6BaseClientEvent): string {
  return JSON.stringify(event);
}

export function decodeTeamProtocolV6BaseClientEvent(value: unknown): TeamProtocolV6BaseClientEvent {
  if (!isDynamicRecord(value) || !isString(value.type)) throw new Error("Invalid Team protocol v1 client event.");
  if (value.type === "runtime-snapshot-request") return { type: value.type };
  if (value.type === "agent-event-scope") {
    if (!isBoolean(value.includeConversations)) throw new Error("Invalid Team protocol v1 client event.");
    if (
      value.capabilities !== undefined &&
      (!Array.isArray(value.capabilities) || !value.capabilities.every(isCapability))
    ) {
      throw new Error("Invalid Team protocol v1 client event.");
    }
    const event: Extract<TeamProtocolV6BaseClientEvent, { type: "agent-event-scope" }> = {
      type: value.type,
      includeConversations: value.includeConversations,
    };
    if (value.capabilities) event.capabilities = [...value.capabilities];
    return event;
  }
  if (value.type === "team-typing") {
    if (!isBoolean(value.typing) || (value.botId !== null && !isString(value.botId))) {
      throw new Error("Invalid Team protocol v1 client event.");
    }
    return { type: value.type, botId: value.botId, typing: value.typing };
  }
  if (value.type === "team-direct-typing" && isString(value.recipientMemberId) && isBoolean(value.typing)) {
    return { type: value.type, recipientMemberId: value.recipientMemberId, typing: value.typing };
  }
  throw new Error("Invalid Team protocol v1 client event.");
}

export function isTeamProtocolV6BaseCapability(value: string): value is TeamProtocolV6BaseCapability {
  return TEAM_PROTOCOL_V6Base_CAPABILITY_SET.has(value);
}

export interface TeamProtocolSupportV6Base {
  appVersion: string;
  protocol: {
    minimum: number;
    maximum: number;
  };
  capabilities: string[];
}

export function decodeTeamProtocolSupportV6Base(value: unknown): TeamProtocolSupportV6Base {
  if (!isDynamicRecord(value) || !isString(value.appVersion) || value.appVersion.length > 64) {
    throw new Error("Invalid Team API compatibility response.");
  }
  const protocol = value.protocol;
  if (
    !isDynamicRecord(protocol) ||
    !isProtocolVersion(protocol.minimum) ||
    !isProtocolVersion(protocol.maximum) ||
    protocol.minimum > protocol.maximum ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 64 ||
    !value.capabilities.every(isCapability)
  ) {
    throw new Error("Invalid Team API compatibility response.");
  }
  return {
    appVersion: value.appVersion,
    protocol: { minimum: protocol.minimum, maximum: protocol.maximum },
    capabilities: [...new Set(value.capabilities)],
  };
}

export function highestCommonTeamProtocol(
  local: TeamProtocolSupportV6Base["protocol"],
  remote: TeamProtocolSupportV6Base["protocol"],
): number | null {
  const minimum = Math.max(local.minimum, remote.minimum);
  const maximum = Math.min(local.maximum, remote.maximum);
  return minimum <= maximum ? maximum : null;
}

export function teamProtocolUpdateDirection(
  local: TeamProtocolSupportV6Base["protocol"],
  remote: TeamProtocolSupportV6Base["protocol"],
): "client_update_required" | "host_update_required" | null {
  if (highestCommonTeamProtocol(local, remote) !== null) return null;
  return local.maximum < remote.minimum ? "client_update_required" : "host_update_required";
}

function isProtocolVersion(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function isCapability(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
}

export type TeamProtocolV6BaseHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

type TeamProtocolV6BaseHttpPayloadKind = "array" | "nullable-object" | "object";

interface TeamProtocolV6BaseHttpContract {
  request: "none" | "object";
  response: TeamProtocolV6BaseHttpPayloadKind;
}

// This registry is the frozen v1 HTTP surface. A new route or a changed payload must use a new protocol.
const TEAM_PROTOCOL_V6Base_HTTP_CONTRACTS = {
  "GET compatibility": { request: "none", response: "object" },
  "GET identity": { request: "none", response: "nullable-object" },
  "POST invitation-preview": { request: "object", response: "object" },
  "POST join": { request: "object", response: "object" },
  "POST join-account": { request: "object", response: "object" },
  "POST auth-login": { request: "object", response: "object" },
  "POST auth-account": { request: "object", response: "object" },
  "POST auth-password": { request: "object", response: "object" },
  "GET me": { request: "none", response: "object" },
  "GET team-presence": { request: "none", response: "object" },
  "GET remote-capabilities": { request: "none", response: "object" },
  "POST remote-session": { request: "object", response: "object" },
  "PUT remote-display": { request: "object", response: "object" },
  "GET direct-threads": { request: "none", response: "array" },
  "GET message-search": { request: "none", response: "object" },
  "POST direct-message": { request: "object", response: "object" },
  "GET direct-conversation": { request: "none", response: "object" },
  "GET direct-conversation-page": { request: "none", response: "object" },
  "POST direct-conversation-read": { request: "object", response: "object" },
  "GET browser-tabs": { request: "none", response: "array" },
  "GET browser-control": { request: "none", response: "object" },
  "POST browser-open": { request: "object", response: "object" },
  "POST browser-activate": { request: "object", response: "object" },
  "POST browser-navigate": { request: "object", response: "object" },
  "POST browser-reload": { request: "object", response: "object" },
  "POST browser-close": { request: "object", response: "object" },
  "POST browser-preview": { request: "object", response: "object" },
  "POST browser-visible": { request: "object", response: "object" },
  "POST attachment-upload": { request: "none", response: "object" },
  "GET team-members": { request: "none", response: "array" },
  "PATCH team-member": { request: "object", response: "object" },
  "POST team-invites": { request: "object", response: "object" },
  "GET team-invites": { request: "none", response: "array" },
  "GET team-sessions": { request: "none", response: "array" },
  "GET agent-status": { request: "none", response: "object" },
  "GET sidebar-layout": { request: "none", response: "object" },
  "POST sidebar-action": { request: "object", response: "object" },
  "GET agent-usage": { request: "none", response: "object" },
  "GET agent-models": { request: "none", response: "array" },
  "GET agents": { request: "none", response: "array" },
  "POST agents": { request: "object", response: "object" },
  "GET conversation-reads": { request: "none", response: "object" },
  "PATCH agent": { request: "object", response: "object" },
  "GET memories": { request: "none", response: "array" },
  "POST memories": { request: "object", response: "object" },
  "PATCH memory": { request: "object", response: "object" },
  "GET routines": { request: "none", response: "array" },
  "POST routines": { request: "object", response: "object" },
  "PATCH routine": { request: "object", response: "object" },
  "POST routine-test": { request: "none", response: "object" },
  "GET routine-runs": { request: "none", response: "array" },
  "PUT agent-avatar": { request: "none", response: "object" },
  "DELETE agent-avatar": { request: "none", response: "object" },
  "GET conversation": { request: "none", response: "object" },
  "GET conversation-page": { request: "none", response: "object" },
  "POST conversation-read": { request: "object", response: "object" },
  "POST messages": { request: "object", response: "object" },
  "GET queue": { request: "none", response: "object" },
  "POST failure-acknowledge": { request: "object", response: "object" },
  "POST reaction": { request: "object", response: "object" },
  "POST queue-cancel": { request: "object", response: "object" },
  "POST queue-steer": { request: "object", response: "object" },
  "POST queue-update": { request: "object", response: "object" },
  "POST queue-reorder": { request: "object", response: "object" },
  "POST interrupt": { request: "object", response: "object" },
  "POST prompt-response": { request: "object", response: "object" },
  "POST approval-response": { request: "object", response: "object" },
  "POST browser-takeover-response": { request: "object", response: "object" },
} as const satisfies Record<string, TeamProtocolV6BaseHttpContract>;

type TeamProtocolV6BaseHttpRoute = keyof typeof TEAM_PROTOCOL_V6Base_HTTP_CONTRACTS;

const V6Base_MEMBER_KEYS = ["id", "username", "email", "name", "avatarUrl", "role", "createdAt", "disabled"] as const;
const V6Base_BOT_KEYS = [
  "id",
  "provider",
  "name",
  "title",
  "description",
  "notifications",
  "model",
  "reasoningEffort",
  "threadId",
  "workspacePath",
  "preview",
  "updatedAt",
  "avatarSeed",
  "avatarHue",
  "avatarUrl",
  "marketplaceSource",
] as const;
const V6Base_DIRECT_MESSAGE_KEYS = [
  "id",
  "threadId",
  "senderMemberId",
  "recipientMemberId",
  "text",
  "createdAt",
  "sequence",
] as const;
const V6Base_BROWSER_TAB_KEYS = ["id", "title", "url", "loading", "ownerThreadId", "ownerBotId"] as const;

const TEAM_PROTOCOL_V6Base_HTTP_REQUEST_KEYS = {
  "POST invitation-preview": ["inviteToken"],
  "POST join": ["inviteToken", "username", "password"],
  "POST join-account": ["inviteToken", "accountTicket"],
  "POST auth-login": ["username", "password"],
  "POST auth-account": ["accountTicket"],
  "POST auth-password": ["currentPassword", "newPassword"],
  "POST remote-session": [],
  "PUT remote-display": ["displayId"],
  "POST direct-message": ["memberId", "text", "clientMessageId"],
  "POST direct-conversation-read": ["throughSequence"],
  "POST browser-open": ["url", "ownerThreadId", "ownerBotId", "focus"],
  "POST browser-activate": ["tabId"],
  "POST browser-navigate": ["tabId", "direction"],
  "POST browser-reload": ["tabId"],
  "POST browser-close": ["tabId"],
  "POST browser-preview": ["tabId"],
  "POST browser-visible": ["visible", "bounds"],
  "PATCH team-member": ["role", "disabled"],
  "POST team-invites": ["role", "email"],
  "POST sidebar-action": ["type", "name", "agentId", "sectionId", "direction", "steps", "beforeAgentId"],
  "POST agents": ["name", "description", "avatarSeed", "avatarHue", "initialMessage"],
  "PATCH agent": [
    "name",
    "title",
    "description",
    "notifications",
    "provider",
    "model",
    "reasoningEffort",
    "avatarSeed",
    "avatarHue",
  ],
  "POST memories": ["text"],
  "PATCH memory": ["text"],
  "POST routines": ["botId", "name", "instruction", "active", "timezone", "schedule"],
  "PATCH routine": ["botId", "routineId", "name", "instruction", "active", "timezone", "schedule"],
  "POST conversation-read": ["throughMessageId"],
  "POST messages": ["text", "attachmentDraftIds", "replyToMessageId"],
  "POST failure-acknowledge": ["turnId"],
  "POST reaction": ["messageId", "emoji"],
  "POST queue-cancel": ["deliveryId"],
  "POST queue-steer": ["deliveryId", "expectedTurnId"],
  "POST queue-update": ["deliveryId", "text", "keepAttachmentIds", "attachmentDraftIds"],
  "POST queue-reorder": ["deliveryIds"],
  "POST interrupt": ["turnId"],
  "POST prompt-response": ["requestId", "answers"],
  "POST approval-response": ["requestId", "decision"],
  "POST browser-takeover-response": ["requestId", "decision"],
} as const satisfies Partial<Record<TeamProtocolV6BaseHttpRoute, readonly string[]>>;

const TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS = {
  "GET compatibility": ["appVersion", "protocol", "capabilities"],
  "GET identity": [
    "serverId",
    "serverName",
    "fingerprint",
    "publicKey",
    "enabledOnLaunch",
    "logoVersion",
    "challenge",
    "signature",
  ],
  "POST invitation-preview": ["role", "expiresAt", "emailBound"],
  "POST join": ["member", "sessionToken", "sessionExpiresAt"],
  "POST join-account": ["member", "sessionToken", "sessionExpiresAt"],
  "POST auth-login": ["member", "sessionToken", "sessionExpiresAt"],
  "POST auth-account": ["member", "sessionToken", "sessionExpiresAt"],
  "GET me": V6Base_MEMBER_KEYS,
  "GET team-presence": ["serverId", "members", "updatedAt"],
  "GET remote-capabilities": [
    "ready",
    "platform",
    "unattended",
    "runtime",
    "protocolVersion",
    "displays",
    "selectedDisplayId",
    "activeSessions",
    "maxSessions",
  ],
  "POST remote-session": [
    "id",
    "serverId",
    "viewerUrl",
    "viewerGrant",
    "displays",
    "selectedDisplayId",
    "phase",
    "transport",
    "errorCode",
    "message",
    "createdAt",
    "grantExpiresAt",
  ],
  "GET direct-threads": ["threadId", "otherMemberId", "lastMessage", "unreadCount", "updatedAt"],
  "POST direct-message": V6Base_DIRECT_MESSAGE_KEYS,
  "GET direct-conversation": ["threadId", "otherMemberId", "messages", "revision", "readState"],
  "GET direct-conversation-page": ["threadId", "otherMemberId", "messages", "revision", "pageInfo", "readState"],
  "POST direct-conversation-read": ["unreadCount", "firstUnreadMessageId", "throughSequence"],
  "GET browser-tabs": V6Base_BROWSER_TAB_KEYS,
  "GET browser-control": ["sessions"],
  "POST browser-open": V6Base_BROWSER_TAB_KEYS,
  "POST browser-preview": ["dataUrl", "width", "height"],
  "POST attachment-upload": ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"],
  "GET team-members": V6Base_MEMBER_KEYS,
  "PATCH team-member": V6Base_MEMBER_KEYS,
  "POST team-invites": ["id", "role", "expiresAt", "usedAt", "inviteUrl", "email"],
  "GET team-invites": ["id", "role", "expiresAt", "usedAt", "email"],
  "GET team-sessions": ["id", "memberId", "username", "createdAt", "expiresAt"],
  "GET agent-status": ["phase", "cliVersion", "auth", "providers", "capabilities", "message", "fullAccess"],
  "GET sidebar-layout": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "POST sidebar-action": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "GET agent-usage": ["limits"],
  "GET agent-models": ["provider", "id", "name", "description", "defaultReasoningEffort", "supportedReasoningEfforts"],
  "GET agents": V6Base_BOT_KEYS,
  "POST agents": V6Base_BOT_KEYS,
  "PATCH agent": V6Base_BOT_KEYS,
  "PUT agent-avatar": V6Base_BOT_KEYS,
  "DELETE agent-avatar": V6Base_BOT_KEYS,
  "GET conversation-reads": [],
  "GET memories": ["id", "botId", "text", "origin", "sourceTurnId", "createdAt", "updatedAt"],
  "POST memories": ["id", "botId", "text", "origin", "sourceTurnId", "createdAt", "updatedAt"],
  "PATCH memory": ["id", "botId", "text", "origin", "sourceTurnId", "createdAt", "updatedAt"],
  "GET routines": ["id", "botId", "name", "instruction", "active", "timezone", "trigger", "createdAt", "updatedAt"],
  "POST routines": ["id", "botId", "name", "instruction", "active", "timezone", "trigger", "createdAt", "updatedAt"],
  "PATCH routine": ["id", "botId", "name", "instruction", "active", "timezone", "trigger", "createdAt", "updatedAt"],
  "POST routine-test": [
    "id",
    "routineId",
    "botId",
    "triggerId",
    "kind",
    "scheduledFor",
    "routineName",
    "instruction",
    "deliveryId",
    "status",
    "error",
    "createdAt",
    "updatedAt",
  ],
  "GET routine-runs": [
    "id",
    "routineId",
    "botId",
    "triggerId",
    "kind",
    "scheduledFor",
    "routineName",
    "instruction",
    "deliveryId",
    "status",
    "error",
    "createdAt",
    "updatedAt",
  ],
  "GET conversation": ["botId", "threadId", "activeTurnId", "revision", "messages", "readState"],
  "GET conversation-page": [
    "botId",
    "threadId",
    "activeTurnId",
    "revision",
    "messages",
    "references",
    "pageInfo",
    "readState",
  ],
  "GET message-search": ["results", "total", "nextCursor"],
  "POST conversation-read": ["unreadCount", "firstUnreadMessageId", "throughMessageId"],
  "POST messages": ["messageId", "deliveries"],
  "GET queue": ["botId", "deliveries"],
} as const satisfies Partial<Record<TeamProtocolV6BaseHttpRoute, readonly string[]>>;

export function decodeTeamProtocolV6BaseHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV6BaseJsonObject {
  const route = teamProtocolV6BaseHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP request.");
  const contract = TEAM_PROTOCOL_V6Base_HTTP_CONTRACTS[route];
  if (contract.request !== "object" || !isTeamProtocolV6BaseJsonObject(value)) {
    throw new Error("Invalid Team protocol v1 HTTP request.");
  }
  const projected = projectTeamProtocolV6BaseHttpRequest(route, value);
  validateTeamProtocolV6BaseHttpRequest(route, projected);
  return projected;
}

export function decodeTeamProtocolV6BaseHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV6BaseJsonValue {
  if (status >= 400) {
    if (!isTeamProtocolV6BaseJsonObject(value) || !isString(value.error)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    return projectTeamProtocolV6BaseError(value);
  }
  const route = teamProtocolV6BaseHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP response.");
  const contract = TEAM_PROTOCOL_V6Base_HTTP_CONTRACTS[route];
  if (!matchesTeamProtocolV6BaseHttpShape(contract.response, value)) {
    throw new Error("Invalid Team protocol v1 HTTP response.");
  }
  const projected = projectTeamProtocolV6BaseHttpResponse(route, value);
  validateTeamProtocolV6BaseHttpResponse(route, projected);
  return projected;
}

function projectTeamProtocolV6BaseHttpRequest(
  route: TeamProtocolV6BaseHttpRoute,
  value: TeamProtocolV6BaseJsonObject,
): TeamProtocolV6BaseJsonObject {
  if (!hasTeamProtocolV6BaseHttpRequestProjection(route)) {
    throw new Error("Team protocol v1 HTTP request projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_V6Base_HTTP_REQUEST_KEYS[route];
  const projected = projectV6BaseObject(value, wireKeys);
  if (route === "POST browser-visible" && isDynamicRecord(projected.bounds)) {
    projected.bounds = projectV6BaseObject(projected.bounds, ["x", "y", "width", "height"]);
  }
  if ((route === "POST routines" || route === "PATCH routine") && isDynamicRecord(projected.schedule)) {
    projected.schedule = projectV6BaseRoutineSchedule(projected.schedule);
  }
  return projected;
}

function projectTeamProtocolV6BaseHttpResponse(
  route: TeamProtocolV6BaseHttpRoute,
  value: TeamProtocolV6BaseJsonValue,
): TeamProtocolV6BaseJsonValue {
  if (route === "GET conversation-reads" && isDynamicRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([botId, state]) => [
        botId,
        isDynamicRecord(state)
          ? projectV6BaseObject(state, ["unreadCount", "firstUnreadMessageId", "throughMessageId"])
          : null,
      ]),
    );
  }
  if (!hasTeamProtocolV6BaseHttpResponseProjection(route)) {
    throw new Error("Team protocol v1 HTTP response projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS[route];
  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected = route === "GET agents" ? projectV6BaseBot(item) : projectV6BaseObject(item, wireKeys);
      if (route === "GET direct-threads" && isDynamicRecord(projected.lastMessage)) {
        projected.lastMessage = projectV6BaseObject(projected.lastMessage, V6Base_DIRECT_MESSAGE_KEYS);
      } else if (route === "GET agent-usage") {
        return projectV6BaseUsageLimit(item);
      } else if (route === "GET routines" || route === "GET routine-runs") {
        return projectV6BaseRoutineValue(projected);
      }
      return projected;
    });
  }
  if (value === null) return null;
  const projected =
    route === "POST agents" || route === "PATCH agent" || route.endsWith("agent-avatar")
      ? projectV6BaseBot(value)
      : projectV6BaseObject(value, wireKeys);
  if (["POST join", "POST join-account", "POST auth-login", "POST auth-account"].includes(route)) {
    if (isDynamicRecord(projected.member)) projected.member = projectV6BaseObject(projected.member, V6Base_MEMBER_KEYS);
  } else if (route === "GET team-presence" && Array.isArray(projected.members)) {
    projected.members = projected.members.map((member) =>
      projectV6BaseObject(member, [...V6Base_MEMBER_KEYS, "online", "typingBotId"]),
    );
  } else if (
    (route === "GET direct-conversation" || route === "GET direct-conversation-page") &&
    Array.isArray(projected.messages)
  ) {
    projected.messages = projected.messages.map((message) => projectV6BaseObject(message, V6Base_DIRECT_MESSAGE_KEYS));
    if (isDynamicRecord(projected.readState)) projected.readState = projectV6BaseDirectReadState(projected.readState);
    if (isDynamicRecord(projected.pageInfo)) projected.pageInfo = projectV6BasePageInfo(projected.pageInfo);
  } else if (route === "GET compatibility" && isDynamicRecord(projected.protocol)) {
    projected.protocol = projectV6BaseObject(projected.protocol, ["minimum", "maximum"]);
  } else if (route === "GET agent-status") {
    if (isDynamicRecord(projected.auth)) {
      projected.auth = projectV6BaseObject(projected.auth, ["kind", "accountType", "email"]);
    }
    if (Array.isArray(projected.providers)) {
      projected.providers = projected.providers.map(projectV6BaseProviderStatus);
    }
    if (isDynamicRecord(projected.capabilities)) {
      projected.capabilities = projectV6BaseObject(projected.capabilities, ["chat", "browser", "computerUse"]);
    }
  } else if (route === "GET agent-usage" && Array.isArray(projected.limits)) {
    projected.limits = projected.limits.map(projectV6BaseUsageLimit);
  } else if (route === "GET sidebar-layout" || route === "POST sidebar-action") {
    return projectV6BaseSidebarLayout(projected);
  } else if (route === "GET remote-capabilities" && Array.isArray(projected.displays)) {
    projected.displays = projected.displays.map(projectV6BaseRemoteDisplay);
  } else if (route === "POST remote-session") {
    if (Array.isArray(projected.displays)) projected.displays = projected.displays.map(projectV6BaseRemoteDisplay);
  } else if (route === "GET browser-control") {
    return projectV6BaseBrowserControl(projected);
  } else if (route === "POST routines" || route === "PATCH routine" || route === "POST routine-test") {
    return projectV6BaseRoutineValue(projected);
  } else if (route === "GET conversation") {
    return projectV6BaseConversation(projected, false, true);
  } else if (route === "GET conversation-page") {
    return projectV6BaseConversation(projected, true);
  } else if (route === "GET message-search") {
    return projectV6BaseConversationSearch(projected);
  } else if (route === "GET queue") {
    return projectV6BaseQueueSnapshot(projected);
  } else if (route === "POST messages") {
    return projectV6BaseQueuedMessageReceipt(projected);
  }
  return projected;
}

function hasTeamProtocolV6BaseHttpRequestProjection(
  route: TeamProtocolV6BaseHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_V6Base_HTTP_REQUEST_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_V6Base_HTTP_REQUEST_KEYS, route);
}

function hasTeamProtocolV6BaseHttpResponseProjection(
  route: TeamProtocolV6BaseHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS, route);
}

const V6Base_HTTP_ERROR_CODES = new Set([
  "client_update_required",
  "host_update_required",
  "protocol_error",
  "host_unavailable",
  "host_permissions_required",
  "session_capacity_reached",
  "session_expired",
  "session_revoked",
  "protocol_mismatch",
  "connection_failed",
]);

function projectTeamProtocolV6BaseError(value: TeamProtocolV6BaseJsonObject): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, ["error", "code", "host", "client"]);
  if (!isV6BaseBoundedString(projected.error, 100_000))
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  if (projected.code !== undefined && (!isString(projected.code) || !V6Base_HTTP_ERROR_CODES.has(projected.code))) {
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  }
  if (projected.host !== undefined) {
    if (!isDynamicRecord(projected.host)) throw new Error("Invalid Team protocol v1 HTTP error response.");
    const host = projectV6BaseObject(projected.host, ["appVersion", "protocol", "capabilities"]);
    if (isDynamicRecord(host.protocol)) host.protocol = projectV6BaseObject(host.protocol, ["minimum", "maximum"]);
    try {
      const decoded = decodeTeamProtocolSupportV6Base(host);
      projected.host = {
        appVersion: decoded.appVersion,
        protocol: { minimum: decoded.protocol.minimum, maximum: decoded.protocol.maximum },
        capabilities: decoded.capabilities,
      };
    } catch {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
  }
  if (projected.client !== undefined) {
    if (!isDynamicRecord(projected.client)) throw new Error("Invalid Team protocol v1 HTTP error response.");
    const client = projectV6BaseObject(projected.client, ["appVersion", "protocol"]);
    if (!isV6BaseBoundedString(client.appVersion, 64) || !isProtocolVersion(client.protocol)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    projected.client = client;
  }
  return projected;
}

function projectV6BaseBot(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, V6Base_BOT_KEYS);
  if (isDynamicRecord(projected.marketplaceSource)) {
    projected.marketplaceSource = projectV6BaseObject(projected.marketplaceSource, [
      "agentId",
      "versionId",
      "version",
      "skillIds",
      "routineIds",
    ]);
  }
  return projected;
}

function projectV6BaseSidebarLayout(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET sidebar-layout"]);
  if (Array.isArray(projected.sections)) {
    projected.sections = projected.sections.map((section) => projectV6BaseObject(section, ["id", "name"]));
  }
  return projected;
}

function projectV6BaseConversation(
  value: unknown,
  page: boolean,
  includeReadState = true,
): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(
    value,
    page
      ? TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET conversation-page"]
      : TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET conversation"],
  );
  if (Array.isArray(projected.messages)) projected.messages = projected.messages.map(projectV6BaseConversationMessage);
  if (!includeReadState) delete projected.readState;
  else if (isDynamicRecord(projected.readState))
    projected.readState = projectV6BaseConversationReadState(projected.readState);
  if (page && isDynamicRecord(projected.references)) {
    projected.references = Object.fromEntries(
      Object.entries(projected.references).map(([id, message]) => [id, projectV6BaseConversationMessage(message)]),
    );
  }
  if (page && isDynamicRecord(projected.pageInfo)) projected.pageInfo = projectV6BasePageInfo(projected.pageInfo);
  return projected;
}

function projectV6BaseConversationMessage(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, [
    "id",
    "turnId",
    "author",
    "text",
    "createdAt",
    "status",
    "itemType",
    "source",
    "senderBotId",
    "replyToMessageId",
    "attachments",
    "imageGeneration",
    "delivery",
    "exchange",
    "reaction",
    "reactions",
    "routine",
    "questionPrompt",
  ]);
  if (Array.isArray(projected.attachments)) projected.attachments = projected.attachments.map(projectV6BaseAttachment);
  if (isDynamicRecord(projected.delivery)) {
    projected.delivery = projectV6BaseObject(projected.delivery, ["id", "status", "position"]);
  }
  if (isDynamicRecord(projected.exchange)) projected.exchange = projectV6BaseExchange(projected.exchange);
  if (Array.isArray(projected.reactions)) projected.reactions = projected.reactions.map(projectV6BaseReaction);
  if (isDynamicRecord(projected.routine)) {
    projected.routine = projectV6BaseObject(projected.routine, ["routineId", "runId", "name", "scheduledFor"]);
  }
  if (isDynamicRecord(projected.imageGeneration)) {
    projected.imageGeneration = projectV6BaseObject(projected.imageGeneration, [
      "prompt",
      "resolution",
      "aspectRatio",
      "error",
    ]);
  }
  if (isDynamicRecord(projected.questionPrompt)) {
    projected.questionPrompt = projectV6BaseConversationQuestionPrompt(projected.questionPrompt);
  }
  return projected;
}

function projectV6BaseExchange(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, [
    "direction",
    "messageId",
    "senderBotId",
    "recipientBotIds",
    "replyToMessageId",
    "deliveries",
  ]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectV6BaseObject(delivery, ["id", "recipientBotId", "status", "position", "error"]),
    );
  }
  return projected;
}

function projectV6BaseReaction(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, ["emoji", "actor"]);
  if (isDynamicRecord(projected.actor)) projected.actor = projectV6BaseObject(projected.actor, ["kind", "botId"]);
  return projected;
}

function projectV6BaseConversationQuestionPrompt(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, ["requestId", "questions", "resolution"]);
  if (Array.isArray(projected.questions)) projected.questions = projected.questions.map(projectV6BasePromptQuestion);
  if (isDynamicRecord(projected.resolution)) {
    const resolution = projectV6BaseObject(projected.resolution, ["status", "responses"]);
    if (isDynamicRecord(resolution.responses)) {
      resolution.responses = Object.fromEntries(
        Object.entries(resolution.responses).map(([id, response]) => [
          id,
          projectV6BaseObject(response, ["status", "answers"]),
        ]),
      );
    }
    projected.resolution = resolution;
  }
  return projected;
}

function projectV6BasePromptQuestion(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, ["id", "header", "question", "isSecret", "options"]);
  if (Array.isArray(projected.options)) {
    projected.options = projected.options.map((option) => projectV6BaseObject(option, ["label", "description"]));
  }
  return projected;
}

function projectV6BaseConversationReadState(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["unreadCount", "firstUnreadMessageId", "throughMessageId"]);
}

function projectV6BaseDirectReadState(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["unreadCount", "firstUnreadMessageId", "throughSequence"]);
}

function projectV6BasePageInfo(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["hasOlder", "olderCursor"]);
}

function projectV6BaseQueueSnapshot(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET queue"]);
  if (Array.isArray(projected.deliveries)) projected.deliveries = projected.deliveries.map(projectV6BaseQueueDelivery);
  return projected;
}

function projectV6BaseQueueDelivery(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, [
    "id",
    "messageId",
    "recipientBotId",
    "sender",
    "text",
    "attachments",
    "replyToMessageId",
    "status",
    "position",
    "turnId",
    "error",
    "createdAt",
  ]);
  if (isDynamicRecord(projected.sender)) {
    projected.sender = projectV6BaseObject(projected.sender, [
      "kind",
      "botId",
      "routineId",
      "runId",
      "routineName",
      "scheduledFor",
    ]);
  }
  if (Array.isArray(projected.attachments)) projected.attachments = projected.attachments.map(projectV6BaseAttachment);
  return projected;
}

function projectV6BaseAttachment(value: unknown): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"]);
}

function projectV6BaseBrowserTakeover(value: unknown): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["requestId", "botId", "threadId", "turnId", "tabId"]);
}

function projectV6BaseApproval(value: unknown, runtime: boolean): TeamProtocolV6BaseJsonObject {
  const keys = [
    "requestId",
    "botId",
    "threadId",
    "turnId",
    "kind",
    "command",
    "cwd",
    "reason",
    "grantRoot",
    "permissions",
  ];
  const projected = projectV6BaseObject(value, runtime ? [...keys, "truncated"] : keys);
  if (isDynamicRecord(projected.permissions)) {
    const permissions = projectV6BaseObject(projected.permissions, ["fileSystem", "network"]);
    if (isDynamicRecord(permissions.fileSystem)) {
      permissions.fileSystem = projectV6BaseObject(permissions.fileSystem, ["read", "write"]);
    }
    projected.permissions = permissions;
  }
  return projected;
}

function projectV6BaseRuntimeSnapshot(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, [
    "bots",
    "activeTurns",
    "work",
    "latestMessages",
    "attentionComplete",
    "pendingPrompts",
    "pendingApprovals",
    "pendingBrowserTakeovers",
    "failedTurns",
  ]);
  if (Array.isArray(projected.bots)) {
    projected.bots = projected.bots.map((bot) =>
      projectV6BaseObject(bot, [
        "id",
        "name",
        "notifications",
        "preview",
        "updatedAt",
        "avatarSeed",
        "avatarHue",
        "avatarUrl",
      ]),
    );
  }
  if (Array.isArray(projected.activeTurns)) {
    projected.activeTurns = projected.activeTurns.map((turn) =>
      projectV6BaseObject(turn, ["botId", "threadId", "turnId"]),
    );
  }
  if (Array.isArray(projected.work)) {
    projected.work = projected.work.map((work) =>
      projectV6BaseObject(work, ["id", "botId", "turnId", "status", "text", "error"]),
    );
  }
  if (Array.isArray(projected.latestMessages)) {
    projected.latestMessages = projected.latestMessages.map((message) =>
      projectV6BaseObject(message, ["botId", "id", "text", "createdAt"]),
    );
  }
  if (Array.isArray(projected.pendingPrompts)) {
    projected.pendingPrompts = projected.pendingPrompts.map((prompt) => {
      const item = projectV6BaseObject(prompt, ["requestId", "botId", "threadId", "turnId", "questions"]);
      if (Array.isArray(item.questions)) item.questions = item.questions.map(projectV6BasePromptQuestion);
      return item;
    });
  }
  if (Array.isArray(projected.pendingApprovals)) {
    projected.pendingApprovals = projected.pendingApprovals.map((approval) => projectV6BaseApproval(approval, true));
  }
  if (Array.isArray(projected.pendingBrowserTakeovers)) {
    projected.pendingBrowserTakeovers = projected.pendingBrowserTakeovers.map(projectV6BaseBrowserTakeover);
  }
  if (Array.isArray(projected.failedTurns)) {
    projected.failedTurns = projected.failedTurns.map((turn) => projectV6BaseObject(turn, ["botId", "turnId"]));
  }
  return projected;
}

function projectV6BaseBrowserControl(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET browser-control"]);
  if (Array.isArray(projected.sessions)) {
    projected.sessions = projected.sessions.map((session) =>
      projectV6BaseObject(session, ["id", "threadId", "turnId", "callId", "tabId", "action", "phase", "startedAt"]),
    );
  }
  return projected;
}

function projectV6BaseRemoteDisplay(value: unknown): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["id", "label", "width", "height", "primary"]);
}

function projectV6BaseConversationSearch(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["GET message-search"]);
  if (Array.isArray(projected.results)) {
    projected.results = projected.results.map((result) => {
      const item = projectV6BaseObject(result, ["botId", "message"]);
      if (isDynamicRecord(item.message)) item.message = projectV6BaseConversationMessage(item.message);
      return item;
    });
  }
  return projected;
}

function projectV6BaseQueuedMessageReceipt(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, TEAM_PROTOCOL_V6Base_HTTP_RESPONSE_KEYS["POST messages"]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectV6BaseObject(delivery, ["id", "recipientBotId", "status", "position"]),
    );
  }
  return projected;
}

function projectV6BaseProviderStatus(value: unknown): TeamProtocolV6BaseJsonObject {
  return projectV6BaseObject(value, ["id", "state", "version", "message", "email", "connectionState", "checkError"]);
}

function projectV6BaseUsageLimit(value: unknown): TeamProtocolV6BaseJsonObject {
  const projected = projectV6BaseObject(value, ["id", "primary", "secondary"]);
  for (const key of ["primary", "secondary"] as const) {
    if (isDynamicRecord(projected[key])) {
      projected[key] = projectV6BaseObject(projected[key], ["usedPercent", "windowDurationMins", "resetsAt"]);
    }
  }
  return projected;
}

function projectV6BaseRoutineValue(value: TeamProtocolV6BaseJsonObject): TeamProtocolV6BaseJsonObject {
  const projected = { ...value };
  const trigger = projected.trigger;
  if (isDynamicRecord(trigger)) {
    const projectedTrigger = projectV6BaseObject(trigger, [
      "id",
      "routineId",
      "schedule",
      "nextRunAt",
      "createdAt",
      "updatedAt",
    ]);
    if (isDynamicRecord(projectedTrigger.schedule)) {
      projectedTrigger.schedule = projectV6BaseRoutineSchedule(projectedTrigger.schedule);
    }
    projected.trigger = projectedTrigger;
  }
  return projected;
}

function projectV6BaseObject(value: unknown, wireKeys: readonly string[]): TeamProtocolV6BaseJsonObject {
  if (!isDynamicRecord(value)) return {};
  const projected: TeamProtocolV6BaseJsonObject = {};
  for (const key of wireKeys) {
    const item = value[key];
    if (item !== undefined && isTeamProtocolV6BaseJsonValue(item)) projected[key] = item;
  }
  return projected;
}

function projectV6BaseRoutineSchedule(value: DynamicRecord): TeamProtocolV6BaseJsonObject {
  const common = ["kind"];
  switch (value.kind) {
    case "hourly":
      return projectV6BaseObject(value, [...common, "minute"]);
    case "daily":
    case "weekdays":
      return projectV6BaseObject(value, [...common, "time"]);
    case "weekly":
      return projectV6BaseObject(value, [...common, "weekday", "time"]);
    case "monthly":
      return projectV6BaseObject(value, [...common, "day", "time"]);
    case "interval":
      return projectV6BaseObject(value, [...common, "amount", "unit", "anchorAt"]);
    case "advanced":
      return projectV6BaseObject(value, [...common, "months", "days", "time"]);
    case "custom":
      return projectV6BaseObject(value, [...common, "expression"]);
    default:
      return projectV6BaseObject(value, common);
  }
}

// Exported for the shared route table's coverage case in `src/main/team-api-server.test.ts`. The host
// encodes every JSON response through this adapter, so a path `TEAM_API_ROUTES` builds that this
// frozen list cannot name is a route no client can be answered on. Classification only: it reads the
// list below and decides nothing, so exporting it leaves every released response meaning what it did.
export function teamProtocolV6BaseHttpRoute(method: string, path: string): TeamProtocolV6BaseHttpRoute | null {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  const exact: Record<string, TeamProtocolV6BaseHttpRoute> = {
    "GET /v1/compatibility": "GET compatibility",
    "GET /v1/identity": "GET identity",
    "POST /v1/invitations/preview": "POST invitation-preview",
    "POST /v1/join": "POST join",
    "POST /v1/join/account": "POST join-account",
    "POST /v1/auth/login": "POST auth-login",
    "POST /v1/auth/account": "POST auth-account",
    "POST /v1/auth/password": "POST auth-password",
    "GET /v1/me": "GET me",
    "GET /v1/team/presence": "GET team-presence",
    "GET /v1/remote-screen/capabilities": "GET remote-capabilities",
    "POST /v1/remote-screen/sessions": "POST remote-session",
    "PUT /v1/remote-screen/display": "PUT remote-display",
    "GET /v1/direct/threads": "GET direct-threads",
    "GET /v1/messages/search": "GET message-search",
    "POST /v1/direct/messages": "POST direct-message",
    "GET /v1/browser/tabs": "GET browser-tabs",
    "GET /v1/browser/control": "GET browser-control",
    "POST /v1/browser/open": "POST browser-open",
    "POST /v1/browser/activate": "POST browser-activate",
    "POST /v1/browser/navigate": "POST browser-navigate",
    "POST /v1/browser/reload": "POST browser-reload",
    "POST /v1/browser/close": "POST browser-close",
    "POST /v1/browser/preview": "POST browser-preview",
    "POST /v1/browser/visible": "POST browser-visible",
    "POST /v1/attachments": "POST attachment-upload",
    "GET /v1/team/members": "GET team-members",
    "POST /v1/team/invites": "POST team-invites",
    "GET /v1/team/invites": "GET team-invites",
    "GET /v1/team/sessions": "GET team-sessions",
    "GET /v1/agents/status": "GET agent-status",
    "GET /v1/sidebar-layout": "GET sidebar-layout",
    "POST /v1/sidebar-layout/actions": "POST sidebar-action",
    "GET /v1/agents/usage": "GET agent-usage",
    "GET /v1/agents/models": "GET agent-models",
    "GET /v1/agents": "GET agents",
    "POST /v1/agents": "POST agents",
    "GET /v1/agents/conversation-reads": "GET conversation-reads",
    "POST /v1/prompts/respond": "POST prompt-response",
    "POST /v1/approvals/respond": "POST approval-response",
    "POST /v1/browser-takeovers/respond": "POST browser-takeover-response",
  };
  const direct = exact[`${method} ${pathname}`];
  if (direct) return direct;
  if (/^\/v1\/team\/members\/[^/]+$/u.test(pathname) && method === "PATCH") return "PATCH team-member";
  const directConversation = pathname.match(/^\/v1\/direct\/conversations\/[^/]+(?:\/(read|page))?$/u);
  if (directConversation && method === "GET") {
    return directConversation[1] === "page" ? "GET direct-conversation-page" : "GET direct-conversation";
  }
  if (directConversation?.[1] === "read" && method === "POST") return "POST direct-conversation-read";
  const agent = pathname.match(/^\/v1\/agents\/[^/]+(?:\/(.*))?$/u);
  if (!agent) return null;
  const action = agent[1] ?? "";
  if (!action && method === "PATCH") return "PATCH agent";
  if (action === "memories") return method === "GET" ? "GET memories" : method === "POST" ? "POST memories" : null;
  if (/^memories\/[^/]+$/u.test(action) && method === "PATCH") return "PATCH memory";
  if (action === "routines") return method === "GET" ? "GET routines" : method === "POST" ? "POST routines" : null;
  if (/^routines\/[^/]+$/u.test(action) && method === "PATCH") return "PATCH routine";
  if (/^routines\/[^/]+\/test$/u.test(action) && method === "POST") return "POST routine-test";
  if (/^routines\/[^/]+\/runs$/u.test(action) && method === "GET") return "GET routine-runs";
  if (action === "avatar" && (method === "PUT" || method === "DELETE")) return `${method} agent-avatar`;
  if (action === "conversation" && method === "GET") return "GET conversation";
  if (action === "conversation-page" && method === "GET") return "GET conversation-page";
  if (action === "conversation/read" && method === "POST") return "POST conversation-read";
  if (action === "messages" && method === "POST") return "POST messages";
  if (action === "queue" && method === "GET") return "GET queue";
  if (method === "POST" && action === "failures/acknowledge") return "POST failure-acknowledge";
  if (method === "POST" && action === "reactions") return "POST reaction";
  if (method === "POST" && action === "queue/cancel") return "POST queue-cancel";
  if (method === "POST" && action === "queue/steer") return "POST queue-steer";
  if (method === "POST" && action === "queue/update") return "POST queue-update";
  if (method === "POST" && action === "queue/reorder") return "POST queue-reorder";
  if (method === "POST" && action === "interrupt") return "POST interrupt";
  return null;
}

function matchesTeamProtocolV6BaseHttpShape(
  payloadKind: TeamProtocolV6BaseHttpPayloadKind,
  value: unknown,
): value is TeamProtocolV6BaseJsonValue {
  if (payloadKind === "array") return Array.isArray(value) && value.every(isTeamProtocolV6BaseJsonValue);
  if (payloadKind === "nullable-object" && value === null) return true;
  return isTeamProtocolV6BaseJsonObject(value);
}

function validateTeamProtocolV6BaseHttpRequest(
  route: TeamProtocolV6BaseHttpRoute,
  value: TeamProtocolV6BaseJsonObject,
): void {
  let valid = false;
  switch (route) {
    case "POST invitation-preview":
      valid = isV6BaseIdentifier(value.inviteToken);
      break;
    case "POST join":
      valid =
        isV6BaseIdentifier(value.inviteToken) &&
        isV6BaseLimitedString(value.username, 64) &&
        isV6BaseLimitedString(value.password, 256);
      break;
    case "POST join-account":
      valid = isV6BaseIdentifier(value.inviteToken) && isV6BaseIdentifier(value.accountTicket);
      break;
    case "POST auth-login":
      valid = isV6BaseLimitedString(value.username, 64) && isV6BaseLimitedString(value.password, 256);
      break;
    case "POST auth-account":
      valid = isV6BaseIdentifier(value.accountTicket);
      break;
    case "POST auth-password":
      valid = isV6BaseLimitedString(value.currentPassword, 256) && isV6BaseLimitedString(value.newPassword, 256);
      break;
    case "POST remote-session":
      valid = Object.keys(value).length === 0;
      break;
    case "PUT remote-display":
      valid = isV6BaseIdentifier(value.displayId);
      break;
    case "POST direct-message":
      valid =
        isV6BaseIdentifier(value.memberId) &&
        isV6BaseLimitedString(value.text, 20_000) &&
        isV6BaseIdentifier(value.clientMessageId);
      break;
    case "POST direct-conversation-read":
      valid = isV6BaseNonNegativeInteger(value.throughSequence);
      break;
    case "POST browser-open":
      valid =
        isV6BaseHttpUrl(value.url, 8_192) &&
        isV6BaseOptionalNullableIdentifier(value.ownerThreadId) &&
        isV6BaseOptionalNullableIdentifier(value.ownerBotId) &&
        (value.focus === undefined || isBoolean(value.focus));
      break;
    case "POST browser-activate":
    case "POST browser-reload":
    case "POST browser-close":
    case "POST browser-preview":
      valid = isV6BaseIdentifier(value.tabId);
      break;
    case "POST browser-navigate":
      valid = isV6BaseIdentifier(value.tabId) && isV6BaseOneOf(["back", "forward"], value.direction);
      break;
    case "POST browser-visible":
      valid = isBoolean(value.visible) && (value.bounds === undefined || isV6BaseBrowserBounds(value.bounds));
      break;
    case "PATCH team-member":
      valid =
        (value.role === undefined || value.role === "admin" || value.role === "member") &&
        (value.disabled === undefined || isBoolean(value.disabled)) &&
        (value.role !== undefined || value.disabled !== undefined);
      break;
    case "POST team-invites":
      valid =
        (value.role === "admin" || value.role === "member") &&
        (value.email === undefined || isV6BaseLimitedString(value.email, 254));
      break;
    case "POST sidebar-action":
      valid = isV6BaseSidebarAction(value);
      break;
    case "POST agents":
      valid =
        isV6BaseLimitedString(value.name, 80) &&
        isV6BaseBoundedString(value.description, 2_000) &&
        isString(value.avatarSeed) &&
        (value.avatarHue === null || isV6BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
        isV6BaseBoundedString(value.initialMessage, 100_000);
      break;
    case "PATCH agent":
      valid = isV6BaseBotUpdate(value);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isV6BaseBoundedString(value.text, 20_000);
      break;
    case "POST routines":
      valid = isV6BaseRoutineMutation(value, true);
      break;
    case "PATCH routine":
      valid = isV6BaseRoutineMutation(value, false);
      break;
    case "POST conversation-read":
      valid = value.throughMessageId === null || isV6BaseIdentifier(value.throughMessageId);
      break;
    case "POST messages":
      valid =
        isV6BaseBoundedString(value.text, 100_000) &&
        (value.attachmentDraftIds === undefined || isV6BaseIdentifierList(value.attachmentDraftIds, 10)) &&
        isV6BaseOptionalNullableIdentifier(value.replyToMessageId);
      break;
    case "POST failure-acknowledge":
    case "POST interrupt":
      valid = isV6BaseIdentifier(value.turnId);
      break;
    case "POST reaction":
      valid = isV6BaseIdentifier(value.messageId) && (value.emoji === null || isV6BaseBoundedString(value.emoji, 32));
      break;
    case "POST queue-cancel":
      valid = isV6BaseIdentifier(value.deliveryId);
      break;
    case "POST queue-steer":
      valid = isV6BaseIdentifier(value.deliveryId) && isV6BaseIdentifier(value.expectedTurnId);
      break;
    case "POST queue-update":
      valid =
        isV6BaseIdentifier(value.deliveryId) &&
        isV6BaseBoundedString(value.text, 100_000) &&
        isV6BaseIdentifierList(value.keepAttachmentIds, 10) &&
        isV6BaseIdentifierList(value.attachmentDraftIds, 10);
      break;
    case "POST queue-reorder":
      valid = isV6BaseIdentifierList(value.deliveryIds, 100);
      break;
    case "POST prompt-response":
      valid = isV6BaseRequestId(value.requestId) && isV6BasePromptAnswers(value.answers);
      break;
    case "POST approval-response":
      valid = isV6BaseRequestId(value.requestId) && isV6BaseOneOf(["accept", "decline"], value.decision);
      break;
    case "POST browser-takeover-response":
      valid = isV6BaseRequestId(value.requestId) && isV6BaseOneOf(["complete", "cancel"], value.decision);
      break;
    default:
      valid = TEAM_PROTOCOL_V6Base_HTTP_CONTRACTS[route].request === "none";
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP request.");
}

function validateTeamProtocolV6BaseHttpResponse(
  route: TeamProtocolV6BaseHttpRoute,
  value: TeamProtocolV6BaseJsonValue,
): void {
  let valid = false;
  switch (route) {
    case "GET compatibility":
      try {
        decodeTeamProtocolSupportV6Base(value);
        valid = true;
      } catch {
        valid = false;
      }
      break;
    case "GET identity":
      valid = value === null || isV6BaseIdentity(value);
      break;
    case "POST invitation-preview":
      valid = isV6BaseInvitePreview(value);
      break;
    case "POST join":
    case "POST join-account":
    case "POST auth-login":
    case "POST auth-account":
      valid = isV6BaseJoinResult(value);
      break;
    case "GET me":
    case "PATCH team-member":
      valid = isV6BaseTeamMember(value);
      break;
    case "GET team-presence":
      valid = isTeamProtocolV6BasePresenceSnapshot(value);
      break;
    case "GET remote-capabilities":
      valid = isV6BaseRemoteCapabilities(value);
      break;
    case "POST remote-session":
      valid = isV6BaseRemoteSession(value);
      break;
    case "GET direct-threads":
      valid = Array.isArray(value) && value.every(isV6BaseDirectThread);
      break;
    case "POST direct-message":
      valid = isTeamProtocolV6BaseDirectMessage(value);
      break;
    case "GET direct-conversation":
      valid = isV6BaseDirectConversation(value, false);
      break;
    case "GET direct-conversation-page":
      valid = isV6BaseDirectConversation(value, true);
      break;
    case "POST direct-conversation-read":
      valid = isV6BaseDirectReadState(value);
      break;
    case "GET browser-tabs":
      valid = Array.isArray(value) && value.every(isV6BaseBrowserTab);
      break;
    case "GET browser-control":
      valid = isV6BaseBrowserControl(value);
      break;
    case "POST browser-open":
      valid = isV6BaseBrowserTab(value);
      break;
    case "POST browser-preview":
      valid = isV6BaseBrowserPreview(value);
      break;
    case "POST attachment-upload":
      valid = isV6BaseAttachment(value);
      break;
    case "GET team-members":
      valid = Array.isArray(value) && value.every(isV6BaseTeamMember);
      break;
    case "POST team-invites":
      valid = isV6BaseTeamInvite(value, true);
      break;
    case "GET team-invites":
      valid = Array.isArray(value) && value.every((invite) => isV6BaseTeamInvite(invite, false));
      break;
    case "GET team-sessions":
      valid = Array.isArray(value) && value.every(isV6BaseTeamSession);
      break;
    case "GET agent-status":
      valid = isV6BaseAgentStatus(value);
      break;
    case "GET sidebar-layout":
    case "POST sidebar-action":
      valid = isV6BaseSidebarLayout(value);
      break;
    case "GET agent-usage":
      valid = isV6BaseAccountUsage(value);
      break;
    case "GET agent-models":
      valid = Array.isArray(value) && value.every(isV6BaseAgentModelOption);
      break;
    case "GET agents":
      valid = Array.isArray(value) && value.every(isV6BaseBotSummary);
      break;
    case "POST agents":
    case "PATCH agent":
    case "PUT agent-avatar":
    case "DELETE agent-avatar":
      valid = isV6BaseBotSummary(value);
      break;
    case "GET conversation-reads":
      valid = isV6BaseConversationReadStates(value);
      break;
    case "GET memories":
      valid = Array.isArray(value) && value.every(isV6BaseMemory);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isV6BaseMemory(value);
      break;
    case "GET routines":
      valid = Array.isArray(value) && value.every(isV6BaseRoutine);
      break;
    case "POST routines":
    case "PATCH routine":
      valid = isV6BaseRoutine(value);
      break;
    case "POST routine-test":
      valid = isV6BaseRoutineRun(value);
      break;
    case "GET routine-runs":
      valid = Array.isArray(value) && value.every(isV6BaseRoutineRun);
      break;
    case "GET conversation":
      valid = isV6BaseConversationSnapshot(value) && isV6BaseConversationReadState(value.readState);
      break;
    case "GET conversation-page":
      valid = isV6BaseConversationPage(value);
      break;
    case "GET message-search":
      valid = isV6BaseConversationSearch(value);
      break;
    case "POST conversation-read":
      valid = isV6BaseConversationReadState(value);
      break;
    case "POST messages":
      valid = isV6BaseQueuedMessageReceipt(value);
      break;
    case "GET queue":
      valid = isV6BaseQueueSnapshot(value);
      break;
    default:
      valid = false;
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP response.");
}

function isV6BaseIdentity(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.serverId) &&
    isV6BaseLimitedString(value.serverName, 120) &&
    isV6BaseLimitedString(value.fingerprint, 256) &&
    isV6BaseBoundedString(value.publicKey, 8_192) &&
    isBoolean(value.enabledOnLaunch) &&
    (value.logoVersion === null || isV6BaseIdentifier(value.logoVersion)) &&
    (value.challenge === undefined || isV6BaseBoundedString(value.challenge, 256)) &&
    (value.signature === undefined || isV6BaseBoundedString(value.signature, 512))
  );
}

function isV6BaseInvitePreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseOneOf(["admin", "member"], value.role) &&
    isV6BaseTimestamp(value.expiresAt) &&
    isBoolean(value.emailBound)
  );
}

function isV6BaseJoinResult(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseTeamMember(value.member) &&
    isV6BaseLimitedString(value.sessionToken, 512) &&
    isV6BaseTimestamp(value.sessionExpiresAt)
  );
}

function isV6BaseTeamMember(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseLimitedString(value.username, 254) &&
    (value.email === null || isV6BaseLimitedString(value.email, 254)) &&
    (value.name === null || isV6BaseLimitedString(value.name, 120)) &&
    (value.avatarUrl === null || isV6BaseHttpUrl(value.avatarUrl, 2_048)) &&
    isV6BaseOneOf(["owner", "admin", "member"], value.role) &&
    isV6BaseTimestamp(value.createdAt) &&
    isBoolean(value.disabled)
  );
}

function isV6BaseRemoteDisplay(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseLimitedString(value.label, 160) &&
    isV6BasePositiveInteger(value.width) &&
    isV6BasePositiveInteger(value.height) &&
    isBoolean(value.primary)
  );
}

function isV6BaseRemoteCapabilities(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.ready) &&
    isV6BaseOneOf(["darwin", "win32", "linux"], value.platform) &&
    isBoolean(value.unattended) &&
    value.runtime === "sunshine-moonlight" &&
    value.protocolVersion === 2 &&
    Array.isArray(value.displays) &&
    value.displays.every(isV6BaseRemoteDisplay) &&
    (value.selectedDisplayId === null || isV6BaseIdentifier(value.selectedDisplayId)) &&
    isV6BaseNonNegativeInteger(value.activeSessions) &&
    isV6BasePositiveInteger(value.maxSessions)
  );
}

function isV6BaseRemoteSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.serverId) &&
    isV6BaseHttpUrl(value.viewerUrl, 8_192) &&
    isV6BaseLimitedString(value.viewerGrant, 512) &&
    Array.isArray(value.displays) &&
    value.displays.every(isV6BaseRemoteDisplay) &&
    (value.selectedDisplayId === null || isV6BaseIdentifier(value.selectedDisplayId)) &&
    isV6BaseOneOf(["starting_host", "connecting", "connected", "disconnecting", "error"], value.phase) &&
    isV6BaseOneOf(["unknown", "p2p", "relay"], value.transport) &&
    (value.errorCode === null ||
      isV6BaseOneOf(
        [
          "host_unavailable",
          "host_permissions_required",
          "session_capacity_reached",
          "session_expired",
          "session_revoked",
          "protocol_mismatch",
          "connection_failed",
        ],
        value.errorCode,
      )) &&
    (value.message === null || isV6BaseBoundedString(value.message, 2_000)) &&
    isV6BaseTimestamp(value.createdAt) &&
    isV6BaseTimestamp(value.grantExpiresAt)
  );
}

function isV6BaseDirectThread(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.otherMemberId) &&
    isTeamProtocolV6BaseDirectMessage(value.lastMessage) &&
    isV6BaseNonNegativeInteger(value.unreadCount) &&
    isV6BaseTimestamp(value.updatedAt)
  );
}

function isV6BaseDirectConversation(value: unknown, paged: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.threadId) &&
    isV6BaseIdentifier(value.otherMemberId) &&
    Array.isArray(value.messages) &&
    value.messages.every(isTeamProtocolV6BaseDirectMessage) &&
    isV6BaseRevision(value.revision) &&
    (value.readState === undefined || isV6BaseDirectReadState(value.readState)) &&
    (!paged || isV6BasePageInfo(value.pageInfo))
  );
}

function isV6BaseDirectReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseNonNegativeInteger(value.unreadCount) &&
    (value.firstUnreadMessageId === null || isV6BaseIdentifier(value.firstUnreadMessageId)) &&
    isV6BaseNonNegativeInteger(value.throughSequence)
  );
}

function isV6BaseBrowserTab(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseBoundedString(value.title, 2_000) &&
    isV6BaseBoundedString(value.url, 8_192) &&
    isBoolean(value.loading) &&
    (value.ownerThreadId === null || isV6BaseIdentifier(value.ownerThreadId)) &&
    (value.ownerBotId === null || isV6BaseIdentifier(value.ownerBotId))
  );
}

function isV6BaseBrowserControl(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(
      (session) =>
        isDynamicRecord(session) &&
        isV6BaseIdentifier(session.id) &&
        isV6BaseIdentifier(session.threadId) &&
        isV6BaseIdentifier(session.turnId) &&
        isV6BaseIdentifier(session.callId) &&
        (session.tabId === null || isV6BaseIdentifier(session.tabId)) &&
        isV6BaseOneOf(
          [
            "open",
            "list-tabs",
            "snapshot",
            "click",
            "type",
            "key",
            "scroll",
            "back",
            "forward",
            "reload",
            "screenshot",
            "close-tab",
          ],
          session.action,
        ) &&
        isV6BaseOneOf(["acting", "waiting"], session.phase) &&
        isV6BaseTimestamp(session.startedAt),
    )
  );
}

function isV6BaseBrowserPreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseBoundedString(value.dataUrl, 2_000_000) &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.dataUrl) &&
    isV6BasePositiveInteger(value.width) &&
    value.width <= 960 &&
    isV6BasePositiveInteger(value.height) &&
    value.height <= 600
  );
}

function isV6BaseTeamInvite(value: unknown, includeUrl: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseOneOf(["admin", "member"], value.role) &&
    isV6BaseTimestamp(value.expiresAt) &&
    (value.usedAt === null || isV6BaseTimestamp(value.usedAt)) &&
    (value.email === null || isV6BaseLimitedString(value.email, 254)) &&
    (!includeUrl || isV6BaseBoundedString(value.inviteUrl, 8_192))
  );
}

function isV6BaseTeamSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.memberId) &&
    isV6BaseLimitedString(value.username, 254) &&
    isV6BaseTimestamp(value.createdAt) &&
    isV6BaseTimestamp(value.expiresAt)
  );
}

function isV6BaseAgentStatus(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseOneOf(["idle", "starting", "ready", "restarting", "blocked", "stopped"], value.phase) &&
    (value.cliVersion === null || isV6BaseBoundedString(value.cliVersion, 160)) &&
    isV6BaseAgentAuth(value.auth) &&
    (value.providers === undefined ||
      (Array.isArray(value.providers) && value.providers.every(isV6BaseProviderStatus))) &&
    isDynamicRecord(value.capabilities) &&
    isV6BaseCapabilityState(value.capabilities.chat) &&
    isV6BaseCapabilityState(value.capabilities.browser) &&
    isV6BaseCapabilityState(value.capabilities.computerUse) &&
    (value.message === null || isV6BaseBoundedString(value.message, 2_000)) &&
    value.fullAccess === true
  );
}

function isV6BaseAgentAuth(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "unknown" || value.kind === "signed-out") return true;
  if (value.kind === "unsupported") return isV6BaseBoundedString(value.accountType, 160);
  return (
    isV6BaseOneOf(["chatgpt", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"], value.kind) &&
    (value.email === null || isV6BaseBoundedString(value.email, 254))
  );
}

function isV6BaseProviderStatus(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseOneOf(["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"], value.id) &&
    isV6BaseOneOf(
      ["not-started", "checking", "available", "sign-in-required", "not-installed", "outdated", "error"],
      value.state,
    ) &&
    (value.version === null || isV6BaseBoundedString(value.version, 160)) &&
    (value.message === null || isV6BaseBoundedString(value.message, 2_000)) &&
    (value.email === undefined || value.email === null || isV6BaseBoundedString(value.email, 254)) &&
    (value.connectionState === undefined || value.connectionState === "connecting") &&
    (value.checkError === undefined || value.checkError === null || isV6BaseBoundedString(value.checkError, 2_000))
  );
}

function isV6BaseCapabilityState(value: unknown): boolean {
  return isV6BaseOneOf(["ready", "setup-required", "unavailable"], value);
}

function isV6BaseAccountUsage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.limits) &&
    value.limits.every(
      (limit) =>
        isDynamicRecord(limit) &&
        isV6BaseIdentifier(limit.id) &&
        (limit.primary === null || isV6BaseUsageWindow(limit.primary)) &&
        (limit.secondary === null || isV6BaseUsageWindow(limit.secondary)),
    )
  );
}

function isV6BaseUsageWindow(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.usedPercent) &&
    Number.isFinite(value.usedPercent) &&
    (value.windowDurationMins === null || isV6BaseNonNegativeInteger(value.windowDurationMins)) &&
    (value.resetsAt === null || (isNumber(value.resetsAt) && Number.isFinite(value.resetsAt)))
  );
}

function isV6BaseAgentModelOption(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseOneOf(["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"], value.provider) &&
    isV6BaseBoundedString(value.id, 160) &&
    isV6BaseLimitedString(value.name, 160) &&
    isV6BaseBoundedString(value.description, 2_000) &&
    isV6BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.defaultReasoningEffort) &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.every((effort) => isV6BaseOneOf(["low", "medium", "high", "xhigh", "max"], effort))
  );
}

function isV6BaseConversationReadStates(value: unknown): boolean {
  return isDynamicRecord(value) && Object.values(value).every(isV6BaseConversationReadState);
}

function isV6BaseMemory(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseBoundedString(value.text, 20_000) &&
    isV6BaseOneOf(["automatic", "manual"], value.origin) &&
    (value.sourceTurnId === null || isV6BaseIdentifier(value.sourceTurnId)) &&
    isV6BaseTimestamp(value.createdAt) &&
    isV6BaseTimestamp(value.updatedAt)
  );
}

function isV6BaseRoutine(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.botId) &&
    isV6BaseLimitedString(value.name, 160) &&
    isV6BaseBoundedString(value.instruction, 100_000) &&
    isBoolean(value.active) &&
    isV6BaseLimitedString(value.timezone, 128) &&
    isDynamicRecord(value.trigger) &&
    isV6BaseIdentifier(value.trigger.id) &&
    isV6BaseIdentifier(value.trigger.routineId) &&
    isV6BaseRoutineSchedule(value.trigger.schedule) &&
    isV6BaseTimestamp(value.trigger.nextRunAt) &&
    isV6BaseTimestamp(value.trigger.createdAt) &&
    isV6BaseTimestamp(value.trigger.updatedAt) &&
    isV6BaseTimestamp(value.createdAt) &&
    isV6BaseTimestamp(value.updatedAt)
  );
}

function isV6BaseRoutineRun(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.id) &&
    isV6BaseIdentifier(value.routineId) &&
    isV6BaseIdentifier(value.botId) &&
    (value.triggerId === null || isV6BaseIdentifier(value.triggerId)) &&
    isV6BaseOneOf(["scheduled", "manual"], value.kind) &&
    isV6BaseTimestamp(value.scheduledFor) &&
    isV6BaseLimitedString(value.routineName, 160) &&
    isV6BaseBoundedString(value.instruction, 100_000) &&
    (value.deliveryId === null || isV6BaseIdentifier(value.deliveryId)) &&
    isV6BaseOneOf(
      ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"],
      value.status,
    ) &&
    (value.error === null || isV6BaseBoundedString(value.error, 100_000)) &&
    isV6BaseTimestamp(value.createdAt) &&
    isV6BaseTimestamp(value.updatedAt)
  );
}

function isV6BaseConversationSearch(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        isDynamicRecord(result) && isV6BaseIdentifier(result.botId) && isV6BaseConversationMessage(result.message),
    ) &&
    isV6BaseNonNegativeInteger(value.total) &&
    (value.nextCursor === null || isV6BaseBoundedString(value.nextCursor, 512))
  );
}

function isV6BaseQueuedMessageReceipt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV6BaseIdentifier(value.messageId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isV6BaseIdentifier(delivery.id) &&
        isV6BaseIdentifier(delivery.recipientBotId) &&
        isV6BaseQueueStatus(delivery.status) &&
        isV6BaseQueuePosition(delivery.position),
    )
  );
}

function isV6BaseSidebarAction(value: TeamProtocolV6BaseJsonObject): boolean {
  if (!isString(value.type)) return false;
  if (value.type === "create")
    return isV6BaseLimitedString(value.name, 40) && (value.agentId === undefined || isV6BaseIdentifier(value.agentId));
  if (value.type === "rename") return isV6BaseIdentifier(value.sectionId) && isV6BaseLimitedString(value.name, 40);
  if (value.type === "delete") return isV6BaseIdentifier(value.sectionId);
  if (value.type === "move") {
    return (
      isV6BaseIdentifier(value.sectionId) &&
      isV6BaseOneOf(["up", "down"], value.direction) &&
      (value.steps === undefined || isV6BasePositiveInteger(value.steps))
    );
  }
  if (value.type === "assign")
    return isV6BaseIdentifier(value.agentId) && (value.sectionId === null || isV6BaseIdentifier(value.sectionId));
  return (
    value.type === "move-agent" &&
    isV6BaseIdentifier(value.agentId) &&
    (value.sectionId === null || isV6BaseIdentifier(value.sectionId)) &&
    (value.beforeAgentId === null || isV6BaseIdentifier(value.beforeAgentId))
  );
}

function isV6BaseBotUpdate(value: TeamProtocolV6BaseJsonObject): boolean {
  const fields = [
    "name",
    "title",
    "description",
    "notifications",
    "provider",
    "model",
    "reasoningEffort",
    "avatarSeed",
    "avatarHue",
  ];
  if (!fields.some((field) => value[field] !== undefined)) return false;
  return (
    (value.name === undefined || isV6BaseBoundedString(value.name, 80)) &&
    (value.title === undefined || isV6BaseBoundedString(value.title, 120)) &&
    (value.description === undefined || isV6BaseBoundedString(value.description, 2_000)) &&
    (value.notifications === undefined || isBoolean(value.notifications)) &&
    (value.provider === undefined ||
      isV6BaseOneOf(
        ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"],
        value.provider,
      )) &&
    (value.model === undefined || isV6BaseBoundedString(value.model, 160)) &&
    (value.reasoningEffort === undefined ||
      isV6BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort)) &&
    (value.avatarSeed === undefined || isV6BaseBoundedString(value.avatarSeed, 128)) &&
    (value.avatarHue === undefined ||
      value.avatarHue === null ||
      isV6BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue))
  );
}

function isV6BaseRoutineMutation(value: TeamProtocolV6BaseJsonObject, create: boolean): boolean {
  return (
    (!create ||
      (isV6BaseLimitedString(value.name, 160) &&
        isV6BaseBoundedString(value.instruction, 100_000) &&
        isBoolean(value.active) &&
        isV6BaseLimitedString(value.timezone, 128) &&
        isV6BaseRoutineSchedule(value.schedule))) &&
    (value.name === undefined || isV6BaseLimitedString(value.name, 160)) &&
    (value.instruction === undefined || isV6BaseBoundedString(value.instruction, 100_000)) &&
    (value.active === undefined || isBoolean(value.active)) &&
    (value.timezone === undefined || isV6BaseLimitedString(value.timezone, 128)) &&
    (value.schedule === undefined || isV6BaseRoutineSchedule(value.schedule))
  );
}

function isV6BaseRoutineSchedule(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case "hourly":
      return isV6BaseIntegerInRange(value.minute, 0, 59);
    case "daily":
    case "weekdays":
      return isV6BaseRoutineTime(value.time);
    case "weekly":
      return isV6BaseIntegerInRange(value.weekday, 0, 6) && isV6BaseRoutineTime(value.time);
    case "monthly":
      return isV6BaseIntegerInRange(value.day, 1, 31) && isV6BaseRoutineTime(value.time);
    case "interval":
      return (
        isV6BaseIntegerInRange(value.amount, 1, 100_000) &&
        isV6BaseOneOf(["minutes", "hours", "days"], value.unit) &&
        isV6BaseTimestamp(value.anchorAt)
      );
    case "advanced":
      return (
        Array.isArray(value.months) &&
        value.months.length > 0 &&
        value.months.every((month) => isV6BaseIntegerInRange(month, 1, 12)) &&
        isV6BaseRoutineDays(value.days) &&
        isV6BaseRoutineTimeSelection(value.time)
      );
    case "custom":
      return isV6BaseLimitedString(value.expression, 512);
    default:
      return false;
  }
}

function isV6BaseRoutineDays(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "every-day") return true;
  if (!Array.isArray(value.days) || value.days.length === 0) return false;
  if (value.kind === "days-of-week") return value.days.every((day) => isV6BaseIntegerInRange(day, 0, 6));
  return value.kind === "days-of-month" && value.days.every((day) => isV6BaseIntegerInRange(day, 1, 31));
}

function isV6BaseRoutineTimeSelection(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    ((value.kind === "at-time" && isV6BaseRoutineTime(value.time)) ||
      (value.kind === "every" &&
        isV6BaseIntegerInRange(value.amount, 1, 100_000) &&
        isV6BaseOneOf(["minutes", "hours"], value.unit)))
  );
}

function isV6BaseRoutineTime(value: unknown): boolean {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function isV6BasePromptAnswers(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length <= 32 &&
    Object.values(value).every(
      (answers) => Array.isArray(answers) && answers.every((answer) => isV6BaseBoundedString(answer, 20_000)),
    )
  );
}

function isV6BaseBrowserBounds(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    [value.x, value.y, value.width, value.height].every((item) => isNumber(item) && Number.isFinite(item))
  );
}

function isV6BasePageInfo(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.hasOlder) &&
    (value.olderCursor === null || isV6BaseBoundedString(value.olderCursor, 512))
  );
}

function isV6BaseOptionalNullableIdentifier(value: unknown): boolean {
  return value === undefined || value === null || isV6BaseIdentifier(value);
}

function isV6BaseNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isV6BasePositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

function isV6BaseIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
