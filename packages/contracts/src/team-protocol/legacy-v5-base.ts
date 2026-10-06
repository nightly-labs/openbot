// Frozen provider-aware schema for protocol 5: the protocol 4 schema, with Gemini (`antigravity`) and
// custom ACP agents (`acp`) added to the providers and auth kinds. Versions 1-4 retain their own codec.
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";

export const TEAM_PROTOCOL_V5Base = 5;
export const TEAM_PROTOCOL_VERSION_HEADER = "OpenBot-Protocol-Version";
export const TEAM_APP_VERSION_HEADER = "OpenBot-App-Version";
export const TEAM_CAPABILITIES_HEADER = "OpenBot-Capabilities";
export const TEAM_PROTOCOL_V5Base_WEBSOCKET = "openbot-team-v5";

export const TEAM_PROTOCOL_V5Base_CAPABILITIES = [
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

export type TeamProtocolV5BaseCapability = (typeof TEAM_PROTOCOL_V5Base_CAPABILITIES)[number];

const TEAM_PROTOCOL_V5Base_CAPABILITY_SET = new Set<string>(TEAM_PROTOCOL_V5Base_CAPABILITIES);

export type TeamProtocolV5BaseEventDecodeResult =
  | { kind: "known"; event: TeamProtocolV5BaseEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string | null };

export type TeamProtocolV5BaseJsonValue =
  | null
  | boolean
  | number
  | string
  | TeamProtocolV5BaseJsonValue[]
  | TeamProtocolV5BaseJsonObject;

export interface TeamProtocolV5BaseJsonObject {
  [key: string]: TeamProtocolV5BaseJsonValue;
}

interface TeamProtocolV5BasePresenceMember {
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

interface TeamProtocolV5BasePresenceSnapshot {
  serverId: string | null;
  members: TeamProtocolV5BasePresenceMember[];
  updatedAt: string;
}

interface TeamProtocolV5BaseDirectMessage {
  id: string;
  threadId: string;
  senderMemberId: string;
  recipientMemberId: string;
  text: string;
  createdAt: string;
  sequence: number;
}

export type TeamProtocolV5BaseEvent =
  | { type: "status"; status: TeamProtocolV5BaseJsonObject }
  | { type: "usage-changed"; usage: TeamProtocolV5BaseJsonObject }
  | { type: "bots-changed"; bots: TeamProtocolV5BaseJsonObject[] }
  | { type: "memories-changed"; botId: string }
  | { type: "routines-changed"; botId: string }
  | { type: "sidebar-layout-changed"; layout: TeamProtocolV5BaseJsonObject }
  | { type: "conversation"; snapshot: TeamProtocolV5BaseJsonObject }
  | { type: "conversation-invalidated"; botId: string; revision: number }
  | { type: "conversation-page"; page: TeamProtocolV5BaseJsonObject }
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
  | { type: "queue-changed"; snapshot: TeamProtocolV5BaseJsonObject }
  | { type: "turn-started"; botId: string; threadId: string; turnId: string; origin?: string }
  | { type: "turn-completed"; botId: string; threadId: string; turnId: string; status: string; origin?: string }
  | {
      type: "prompt";
      requestId: string | number;
      botId: string;
      threadId: string;
      turnId: string;
      questions: TeamProtocolV5BaseJsonObject[];
    }
  | { type: "agent-input-resolved"; kind: "prompt" | "approval"; requestId: string | number; botId: string }
  | { type: "browser-takeover-requested"; request: TeamProtocolV5BaseJsonObject }
  | { type: "browser-takeover-resolved"; requestId: string | number; botId: string }
  | { type: "approval"; approval: TeamProtocolV5BaseJsonObject }
  | { type: "runtime-snapshot"; snapshot: TeamProtocolV5BaseJsonObject }
  | { type: "browser-changed"; tabs: TeamProtocolV5BaseJsonObject[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: TeamProtocolV5BaseJsonObject }
  | { type: "error"; botId?: string; code: string; message: string }
  | { type: "team-identity"; serverId: string; serverName: string; logoVersion: string | null }
  | { type: "team-presence"; snapshot: TeamProtocolV5BasePresenceSnapshot }
  | { type: "team-direct-message"; message: TeamProtocolV5BaseDirectMessage; memberIds: [string, string] }
  | { type: "team-direct-typing"; senderMemberId: string; recipientMemberId: string; typing: boolean };

export type TeamProtocolV5BaseClientEvent =
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
const TEAM_PROTOCOL_V5Base_EVENT_TYPES = [...AGENT_EVENT_TYPES, ...TEAM_EVENT_TYPES] as const;
const TEAM_PROTOCOL_V5Base_EVENT_TYPE_SET = new Set<string>(TEAM_PROTOCOL_V5Base_EVENT_TYPES);

export function decodeTeamProtocolV5BaseEvent(value: unknown): TeamProtocolV5BaseEventDecodeResult {
  if (!isDynamicRecord(value) || !isString(value.type)) return { kind: "invalid", type: null };
  if (!TEAM_PROTOCOL_V5Base_EVENT_TYPE_SET.has(value.type)) {
    return { kind: "unknown", type: value.type };
  }
  const projected = projectTeamProtocolV5BaseEvent(value);
  if (isTeamProtocolV5BaseKnownEvent(projected)) return { kind: "known", event: projected };
  return { kind: "invalid", type: value.type };
}

export function encodeTeamProtocolV5BaseEvent(event: TeamProtocolV5BaseEvent): string | null {
  const decoded = decodeTeamProtocolV5BaseEvent(event);
  return decoded.kind === "known" ? JSON.stringify(decoded.event) : null;
}

const TEAM_PROTOCOL_V5Base_EVENT_KEYS = {
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
} as const satisfies Record<(typeof TEAM_PROTOCOL_V5Base_EVENT_TYPES)[number], readonly string[]>;

function projectTeamProtocolV5BaseEvent(value: DynamicRecord): DynamicRecord {
  if (!isString(value.type) || !isTeamProtocolV5BaseEventType(value.type)) return value;
  const eventType = value.type;
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_EVENT_KEYS[eventType]);
  switch (eventType) {
    case "status":
      if (isDynamicRecord(projected.status)) {
        projected.status = projectTeamProtocolV5BaseHttpResponse("GET agent-status", projected.status);
      }
      break;
    case "usage-changed":
      if (isDynamicRecord(projected.usage)) {
        projected.usage = projectTeamProtocolV5BaseHttpResponse("GET agent-usage", projected.usage);
      }
      break;
    case "bots-changed":
      if (Array.isArray(projected.bots)) projected.bots = projected.bots.map(projectV5BaseBot);
      break;
    case "sidebar-layout-changed":
      if (isDynamicRecord(projected.layout)) {
        projected.layout = projectV5BaseSidebarLayout(projected.layout);
      }
      break;
    case "conversation":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV5BaseConversation(projected.snapshot, false, false);
      }
      break;
    case "conversation-page":
      if (isDynamicRecord(projected.page)) {
        projected.page = projectTeamProtocolV5BaseHttpResponse("GET conversation-page", projected.page);
      }
      break;
    case "queue-changed":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV5BaseQueueSnapshot(projected.snapshot);
      }
      break;
    case "prompt":
      if (Array.isArray(projected.questions))
        projected.questions = projected.questions.map(projectV5BasePromptQuestion);
      break;
    case "browser-takeover-requested":
      if (isDynamicRecord(projected.request)) projected.request = projectV5BaseBrowserTakeover(projected.request);
      break;
    case "approval":
      if (isDynamicRecord(projected.approval)) projected.approval = projectV5BaseApproval(projected.approval, false);
      break;
    case "runtime-snapshot":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectV5BaseRuntimeSnapshot(projected.snapshot);
      }
      break;
    case "browser-changed":
      if (Array.isArray(projected.tabs)) {
        projected.tabs = projected.tabs.map((tab) => projectV5BaseObject(tab, V5Base_BROWSER_TAB_KEYS));
      }
      break;
    case "browser-control-changed":
      if (isDynamicRecord(projected.state)) {
        projected.state = projectV5BaseBrowserControl(projected.state);
      }
      break;
    case "team-presence":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectTeamProtocolV5BaseHttpResponse("GET team-presence", projected.snapshot);
      }
      break;
    case "team-direct-message":
      if (isDynamicRecord(projected.message)) {
        projected.message = projectV5BaseObject(projected.message, V5Base_DIRECT_MESSAGE_KEYS);
      }
      break;
  }
  return projected;
}

function isTeamProtocolV5BaseEventType(value: string): value is keyof typeof TEAM_PROTOCOL_V5Base_EVENT_KEYS {
  return TEAM_PROTOCOL_V5Base_EVENT_TYPE_SET.has(value);
}

// This is the frozen v1 wire validator. Do not replace its nested checks with current IPC validators.
function isTeamProtocolV5BaseKnownEvent(value: DynamicRecord): value is TeamProtocolV5BaseEvent {
  switch (value.type) {
    case "status":
      return isV5BaseAgentStatus(value.status);
    case "usage-changed":
      return isV5BaseAccountUsage(value.usage);
    case "bots-changed":
      return Array.isArray(value.bots) && value.bots.length <= 100 && value.bots.every(isV5BaseBotSummary);
    case "memories-changed":
    case "routines-changed":
    case "queue-invalidated":
      return isString(value.botId);
    case "sidebar-layout-changed":
      return isV5BaseSidebarLayout(value.layout);
    case "conversation":
      return isV5BaseConversationSnapshot(value.snapshot);
    case "queue-changed":
      return isV5BaseQueueSnapshot(value.snapshot);
    case "conversation-invalidated":
      return isString(value.botId) && isNumber(value.revision);
    case "conversation-page":
      return isV5BaseConversationPage(value.page);
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
        (value.origin === undefined || isV5BaseOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "turn-completed":
      return (
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.status) &&
        (value.origin === undefined || isV5BaseOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "prompt":
      return (
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        Array.isArray(value.questions) &&
        value.questions.length <= 32 &&
        value.questions.every(isV5BasePromptQuestion)
      );
    case "agent-input-resolved":
      return (
        (value.kind === "prompt" || value.kind === "approval") &&
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId)
      );
    case "browser-takeover-requested":
      return isV5BaseBrowserTakeover(value.request);
    case "browser-takeover-resolved":
      return (isString(value.requestId) || isNumber(value.requestId)) && isString(value.botId);
    case "approval":
      return isV5BaseApproval(value.approval, false);
    case "runtime-snapshot":
      return isV5BaseRuntimeSnapshot(value.snapshot);
    case "browser-changed":
      return (
        Array.isArray(value.tabs) &&
        value.tabs.every(isV5BaseBrowserTab) &&
        (value.activeTabId === null || isString(value.activeTabId))
      );
    case "browser-control-changed":
      return isV5BaseBrowserControl(value.state);
    case "error":
      return isString(value.code) && isString(value.message);
    case "team-identity":
      return (
        isString(value.serverId) &&
        isString(value.serverName) &&
        (value.logoVersion === null || isString(value.logoVersion))
      );
    case "team-presence":
      return isTeamProtocolV5BasePresenceSnapshot(value.snapshot);
    case "team-direct-message":
      return (
        isTeamProtocolV5BaseDirectMessage(value.message) &&
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

function isTeamProtocolV5BaseJsonValue(value: unknown): value is TeamProtocolV5BaseJsonValue {
  return (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    (isNumber(value) && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isTeamProtocolV5BaseJsonValue)) ||
    isTeamProtocolV5BaseJsonObject(value)
  );
}

function isTeamProtocolV5BaseJsonObject(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return isDynamicRecord(value) && Object.values(value).every(isTeamProtocolV5BaseJsonValue);
}

function isV5BaseBotSummary(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.name, 80) &&
    isV5BaseBoundedString(value.title, 120) &&
    isV5BaseBoundedString(value.description, 2_000) &&
    isBoolean(value.notifications) &&
    (value.provider === "codex" ||
      value.provider === "claude" ||
      value.provider === "grok" ||
      value.provider === "opencode" ||
      value.provider === "antigravity" ||
      value.provider === "acp") &&
    isString(value.model) &&
    // Brackets as in `isAgentModel`: the Claude CLI names a 1M-context model `claude-opus-5-5[1m]`.
    /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,159}$/u.test(value.model) &&
    isV5BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort) &&
    (value.threadId === null || isV5BaseIdentifier(value.threadId)) &&
    isV5BaseBoundedString(value.workspacePath, 4_096) &&
    isV5BaseBoundedString(value.preview, 100_000) &&
    (value.updatedAt === null || isV5BaseBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null || isV5BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isV5BaseBoundedString(value.avatarUrl, 2_048)) &&
    (value.marketplaceSource === undefined || isV5BaseMarketplaceSource(value.marketplaceSource))
  );
}

function isV5BaseMarketplaceSource(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.agentId) &&
    isV5BaseIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    isV5BaseIdentifierList(value.skillIds, 100) &&
    isV5BaseIdentifierList(value.routineIds, 64)
  );
}

function isV5BaseSidebarLayout(value: unknown): value is TeamProtocolV5BaseJsonObject {
  if (
    !isTeamProtocolV5BaseJsonObject(value) ||
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
        isV5BaseIdentifier(section.id) &&
        isV5BaseBoundedString(section.name, 40) &&
        section.name.length > 0,
    ) &&
    value.order.every(isV5BaseIdentifier) &&
    Object.values(value.agentAssignments).every(isV5BaseIdentifier) &&
    value.agentOrder.every(isV5BaseIdentifier) &&
    new Set(value.agentOrder).size === value.agentOrder.length
  );
}

function isV5BaseConversationSnapshot(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseIdentifier(value.botId) &&
    (value.threadId === null || isV5BaseIdentifier(value.threadId)) &&
    (value.activeTurnId === null || isV5BaseIdentifier(value.activeTurnId)) &&
    isV5BaseRevision(value.revision) &&
    Array.isArray(value.messages) &&
    value.messages.every(isV5BaseConversationMessage)
  );
}

function isV5BaseConversationPage(value: unknown): value is TeamProtocolV5BaseJsonObject {
  if (!isV5BaseConversationSnapshot(value) || !Array.isArray(value.messages) || value.messages.length > 100)
    return false;
  return (
    isDynamicRecord(value.references) &&
    Object.values(value.references).every(isV5BaseConversationMessage) &&
    isDynamicRecord(value.pageInfo) &&
    isBoolean(value.pageInfo.hasOlder) &&
    (value.pageInfo.olderCursor === null || isString(value.pageInfo.olderCursor)) &&
    (value.readState === undefined || isV5BaseConversationReadState(value.readState))
  );
}

function isV5BaseConversationMessage(value: unknown): boolean {
  if (!isTeamProtocolV5BaseJsonObject(value)) return false;
  return (
    isV5BaseIdentifier(value.id) &&
    isString(value.text) &&
    isV5BaseBoundedString(value.createdAt, 160) &&
    isV5BaseOneOf(["user", "assistant", "agent", "system"], value.author) &&
    isV5BaseOneOf(["streaming", "completed", "failed", "interrupted"], value.status) &&
    (value.turnId === undefined || isV5BaseIdentifier(value.turnId)) &&
    (value.itemType === undefined || isV5BaseBoundedString(value.itemType, 128)) &&
    (value.source === undefined || isV5BaseOneOf(["user", "assistant", "agent", "system", "routine"], value.source)) &&
    (value.senderBotId === undefined || isV5BaseIdentifier(value.senderBotId)) &&
    (value.replyToMessageId === undefined ||
      value.replyToMessageId === null ||
      isV5BaseIdentifier(value.replyToMessageId)) &&
    (value.attachments === undefined || isV5BaseAttachments(value.attachments)) &&
    (value.delivery === undefined || isV5BaseConversationDelivery(value.delivery)) &&
    (value.exchange === undefined || isV5BaseExchange(value.exchange)) &&
    (value.reaction === undefined || value.reaction === null || isV5BaseBoundedString(value.reaction, 32)) &&
    (value.reactions === undefined ||
      (Array.isArray(value.reactions) && value.reactions.length <= 100 && value.reactions.every(isV5BaseReaction))) &&
    (value.routine === undefined || isV5BaseRoutineReference(value.routine)) &&
    (value.imageGeneration === undefined || isV5BaseImageGeneration(value.imageGeneration)) &&
    (value.questionPrompt === undefined || isV5BaseConversationQuestionPrompt(value.questionPrompt))
  );
}

function isV5BaseConversationDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseQueueStatus(value.status) &&
    isV5BaseQueuePosition(value.position)
  );
}

function isV5BaseExchange(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseOneOf(["incoming", "outgoing"], value.direction) &&
    isV5BaseIdentifier(value.messageId) &&
    isV5BaseIdentifier(value.senderBotId) &&
    isV5BaseIdentifierList(value.recipientBotIds, 100) &&
    (value.replyToMessageId === null || isV5BaseIdentifier(value.replyToMessageId)) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.length <= 100 &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isV5BaseIdentifier(delivery.id) &&
        isV5BaseIdentifier(delivery.recipientBotId) &&
        isV5BaseQueueStatus(delivery.status) &&
        isV5BaseQueuePosition(delivery.position) &&
        (delivery.error === null || isV5BaseBoundedString(delivery.error, 100_000)),
    )
  );
}

function isV5BaseReaction(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseBoundedString(value.emoji, 32) &&
    isDynamicRecord(value.actor) &&
    (value.actor.kind === "user" || (value.actor.kind === "bot" && isV5BaseIdentifier(value.actor.botId)))
  );
}

function isV5BaseRoutineReference(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.routineId) &&
    isV5BaseIdentifier(value.runId) &&
    isV5BaseLimitedString(value.name, 160) &&
    isV5BaseTimestamp(value.scheduledFor)
  );
}

function isV5BaseImageGeneration(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    isString(value.resolution) &&
    isV5BaseOneOf(["square", "portrait", "landscape"], value.aspectRatio) &&
    (value.error === undefined || isString(value.error))
  );
}

function isV5BaseConversationQuestionPrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseRequestId(value.requestId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isV5BasePromptQuestion) &&
    (value.resolution === null || isV5BasePromptResolution(value.resolution))
  );
}

function isV5BasePromptResolution(value: unknown): boolean {
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

function isV5BaseConversationReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    (value.firstUnreadMessageId === null || isV5BaseIdentifier(value.firstUnreadMessageId)) &&
    (value.throughMessageId === null || isV5BaseIdentifier(value.throughMessageId))
  );
}

function isV5BaseQueueSnapshot(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseIdentifier(value.botId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isV5BaseQueueDelivery)
  );
}

function isV5BaseQueueDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.messageId) &&
    isV5BaseIdentifier(value.recipientBotId) &&
    isV5BaseQueueSender(value.sender) &&
    isV5BaseBoundedString(value.text, 100_000) &&
    isV5BaseAttachments(value.attachments) &&
    (value.replyToMessageId === null || isV5BaseIdentifier(value.replyToMessageId)) &&
    isV5BaseQueueStatus(value.status) &&
    isV5BaseQueuePosition(value.position) &&
    (value.turnId === null || isV5BaseIdentifier(value.turnId)) &&
    (value.error === null || isV5BaseBoundedString(value.error, 100_000)) &&
    isV5BaseBoundedString(value.createdAt, 160)
  );
}

function isV5BaseQueueSender(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "user") return true;
  if (value.kind === "bot") return isV5BaseIdentifier(value.botId);
  return (
    value.kind === "routine" &&
    isV5BaseIdentifier(value.routineId) &&
    isV5BaseIdentifier(value.runId) &&
    isV5BaseBoundedString(value.routineName, 80) &&
    isV5BaseBoundedString(value.scheduledFor, 160)
  );
}

function isV5BaseAttachments(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 10 && value.every(isV5BaseAttachment);
}

function isV5BaseAttachment(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.name, 255) &&
    isNumber(value.size) &&
    value.size >= 0 &&
    isV5BaseOneOf(["image", "file"], value.kind) &&
    isV5BaseBoundedString(value.mimeType, 255) &&
    isV5BaseOneOf(["image", "pdf", "text", "none"], value.previewKind) &&
    (value.previewUrl === null || isV5BaseBoundedString(value.previewUrl, 2_048))
  );
}

function isV5BasePromptQuestion(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseBoundedString(value.id, 128) &&
    isV5BaseBoundedString(value.header, 120) &&
    isV5BaseBoundedString(value.question, 2_000) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isV5BaseBoundedString(option.label, 120) &&
            isV5BaseBoundedString(option.description, 2_000),
        )))
  );
}

function isV5BaseBrowserTakeover(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseRequestId(value.requestId) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.turnId) &&
    isV5BaseIdentifier(value.tabId)
  );
}

function isV5BaseApproval(value: unknown, runtime: boolean): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    isV5BaseRequestId(value.requestId) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.turnId) &&
    isV5BaseOneOf(["command", "file-change", "permissions"], value.kind) &&
    isV5BaseNullableString(value.command, runtime ? 240 : 100_000) &&
    isV5BaseNullableString(value.cwd, runtime ? 240 : 4_096) &&
    isV5BaseNullableString(value.reason, runtime ? 240 : 100_000) &&
    isV5BaseNullableString(value.grantRoot, runtime ? 240 : 4_096) &&
    (!runtime || isBoolean(value.truncated)) &&
    (value.permissions === null || isV5BaseApprovalPermissions(value.permissions, runtime))
  );
}

function isV5BaseApprovalPermissions(value: unknown, runtime: boolean): boolean {
  const maximumItems = runtime ? 3 : 100;
  const maximumPath = runtime ? 240 : 4_096;
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.fileSystem) &&
    isV5BaseStringList(value.fileSystem.read, maximumItems, maximumPath) &&
    isV5BaseStringList(value.fileSystem.write, maximumItems, maximumPath) &&
    isBoolean(value.network)
  );
}

function isV5BaseRuntimeSnapshot(value: unknown): value is TeamProtocolV5BaseJsonObject {
  return (
    isTeamProtocolV5BaseJsonObject(value) &&
    Array.isArray(value.bots) &&
    value.bots.length <= 100 &&
    value.bots.every(isV5BaseRuntimeBot) &&
    Array.isArray(value.activeTurns) &&
    value.activeTurns.length <= 100 &&
    value.activeTurns.every(isV5BaseRuntimeTurn) &&
    Array.isArray(value.work) &&
    value.work.length <= 7 &&
    value.work.every(isV5BaseRuntimeWork) &&
    Array.isArray(value.latestMessages) &&
    value.latestMessages.length <= 100 &&
    value.latestMessages.every(isV5BaseRuntimeMessage) &&
    isBoolean(value.attentionComplete) &&
    Array.isArray(value.pendingPrompts) &&
    value.pendingPrompts.length <= 4 &&
    value.pendingPrompts.every(isV5BaseRuntimePrompt) &&
    Array.isArray(value.pendingApprovals) &&
    value.pendingApprovals.length <= 4 &&
    value.pendingApprovals.every((approval) => isV5BaseApproval(approval, true)) &&
    Array.isArray(value.pendingBrowserTakeovers) &&
    value.pendingBrowserTakeovers.length <= 4 &&
    value.pendingBrowserTakeovers.every(isV5BaseBrowserTakeover) &&
    value.pendingPrompts.length + value.pendingApprovals.length + value.pendingBrowserTakeovers.length <= 4 &&
    Array.isArray(value.failedTurns) &&
    value.failedTurns.length <= 100 &&
    value.failedTurns.every(isV5BaseFailedTurn)
  );
}

function isV5BaseRuntimeBot(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.name, 80) &&
    isBoolean(value.notifications) &&
    isV5BaseBoundedString(value.preview, 240) &&
    (value.updatedAt === null || isV5BaseBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null || isV5BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isV5BaseBoundedString(value.avatarUrl, 2_048))
  );
}

function isV5BaseRuntimeTurn(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.turnId)
  );
}

function isV5BaseFailedTurn(value: unknown): boolean {
  return isDynamicRecord(value) && isV5BaseIdentifier(value.botId) && isV5BaseIdentifier(value.turnId);
}

function isV5BaseRuntimeWork(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.botId) &&
    (value.turnId === null || isV5BaseIdentifier(value.turnId)) &&
    isV5BaseOneOf(["starting", "running", "failed"], value.status) &&
    isV5BaseBoundedString(value.text, 240) &&
    isV5BaseNullableString(value.error, 240)
  );
}

function isV5BaseRuntimeMessage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.text, 240) &&
    isV5BaseBoundedString(value.createdAt, 160)
  );
}

function isV5BaseRuntimePrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseRequestId(value.requestId) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.turnId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isV5BaseRuntimePromptQuestion)
  );
}

function isV5BaseRuntimePromptQuestion(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.header, 80) &&
    isV5BaseBoundedString(value.question, 240) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isV5BaseBoundedString(option.label, 120) &&
            isV5BaseBoundedString(option.description, 120),
        )))
  );
}

function isV5BaseQueueStatus(value: unknown): boolean {
  return isV5BaseOneOf(["queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"], value);
}

function isV5BaseQueuePosition(value: unknown): boolean {
  return value === null || (isNumber(value) && Number.isInteger(value) && value >= 1);
}

function isV5BaseRevision(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isV5BaseRequestId(value: unknown): value is string | number {
  return isNumber(value) || isV5BaseIdentifier(value);
}

function isV5BaseIdentifierList(value: unknown, limit: number): boolean {
  return Array.isArray(value) && value.length <= limit && value.every(isV5BaseIdentifier);
}

function isV5BaseStringList(value: unknown, count: number, length: number): boolean {
  return Array.isArray(value) && value.length <= count && value.every((item) => isV5BaseBoundedString(item, length));
}

function isV5BaseNullableString(value: unknown, limit: number): boolean {
  return value === null || isV5BaseBoundedString(value, limit);
}

function isV5BaseBoundedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length <= limit;
}

function isV5BaseOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

function isTeamProtocolV5BasePresenceSnapshot(value: unknown): value is TeamProtocolV5BasePresenceSnapshot {
  return (
    isDynamicRecord(value) &&
    (value.serverId === null || isV5BaseIdentifier(value.serverId)) &&
    Array.isArray(value.members) &&
    value.members.length <= 100 &&
    value.members.every(isTeamProtocolV5BasePresenceMember) &&
    isV5BaseTimestamp(value.updatedAt)
  );
}

function isTeamProtocolV5BasePresenceMember(value: unknown): value is TeamProtocolV5BasePresenceMember {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseLimitedString(value.username, 254) &&
    (value.email === null || isV5BaseLimitedString(value.email, 254)) &&
    (value.name === null || isV5BaseLimitedString(value.name, 120)) &&
    (value.avatarUrl === undefined || value.avatarUrl === null || isV5BaseHttpUrl(value.avatarUrl, 2_048)) &&
    (value.role === "owner" || value.role === "admin" || value.role === "member") &&
    isV5BaseTimestamp(value.createdAt) &&
    isBoolean(value.disabled) &&
    isBoolean(value.online) &&
    (value.typingBotId === null || isV5BaseIdentifier(value.typingBotId))
  );
}

function isTeamProtocolV5BaseDirectMessage(value: unknown): value is TeamProtocolV5BaseDirectMessage {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.senderMemberId) &&
    isV5BaseIdentifier(value.recipientMemberId) &&
    value.senderMemberId !== value.recipientMemberId &&
    isV5BaseLimitedString(value.text, 20_000) &&
    isV5BaseTimestamp(value.createdAt) &&
    isNumber(value.sequence) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0
  );
}

function isV5BaseIdentifier(value: unknown): value is string {
  return isV5BaseLimitedString(value, 128);
}

function isV5BaseTimestamp(value: unknown): value is string {
  return isV5BaseLimitedString(value, 64) && Number.isFinite(Date.parse(value));
}

function isV5BaseHttpUrl(value: unknown, limit: number): value is string {
  if (!isV5BaseLimitedString(value, limit)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isV5BaseLimitedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

export function encodeTeamProtocolV5BaseClientEvent(event: TeamProtocolV5BaseClientEvent): string {
  return JSON.stringify(event);
}

export function decodeTeamProtocolV5BaseClientEvent(value: unknown): TeamProtocolV5BaseClientEvent {
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
    const event: Extract<TeamProtocolV5BaseClientEvent, { type: "agent-event-scope" }> = {
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

export function isTeamProtocolV5BaseCapability(value: string): value is TeamProtocolV5BaseCapability {
  return TEAM_PROTOCOL_V5Base_CAPABILITY_SET.has(value);
}

export interface TeamProtocolSupportV5Base {
  appVersion: string;
  protocol: {
    minimum: number;
    maximum: number;
  };
  capabilities: string[];
}

export function decodeTeamProtocolSupportV5Base(value: unknown): TeamProtocolSupportV5Base {
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
  local: TeamProtocolSupportV5Base["protocol"],
  remote: TeamProtocolSupportV5Base["protocol"],
): number | null {
  const minimum = Math.max(local.minimum, remote.minimum);
  const maximum = Math.min(local.maximum, remote.maximum);
  return minimum <= maximum ? maximum : null;
}

export function teamProtocolUpdateDirection(
  local: TeamProtocolSupportV5Base["protocol"],
  remote: TeamProtocolSupportV5Base["protocol"],
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

export type TeamProtocolV5BaseHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

type TeamProtocolV5BaseHttpPayloadKind = "array" | "nullable-object" | "object";

interface TeamProtocolV5BaseHttpContract {
  request: "none" | "object";
  response: TeamProtocolV5BaseHttpPayloadKind;
}

// This registry is the frozen v1 HTTP surface. A new route or a changed payload must use a new protocol.
const TEAM_PROTOCOL_V5Base_HTTP_CONTRACTS = {
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
} as const satisfies Record<string, TeamProtocolV5BaseHttpContract>;

type TeamProtocolV5BaseHttpRoute = keyof typeof TEAM_PROTOCOL_V5Base_HTTP_CONTRACTS;

const V5Base_MEMBER_KEYS = ["id", "username", "email", "name", "avatarUrl", "role", "createdAt", "disabled"] as const;
const V5Base_BOT_KEYS = [
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
const V5Base_DIRECT_MESSAGE_KEYS = [
  "id",
  "threadId",
  "senderMemberId",
  "recipientMemberId",
  "text",
  "createdAt",
  "sequence",
] as const;
const V5Base_BROWSER_TAB_KEYS = ["id", "title", "url", "loading", "ownerThreadId", "ownerBotId"] as const;

const TEAM_PROTOCOL_V5Base_HTTP_REQUEST_KEYS = {
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
} as const satisfies Partial<Record<TeamProtocolV5BaseHttpRoute, readonly string[]>>;

const TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS = {
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
  "GET me": V5Base_MEMBER_KEYS,
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
  "POST direct-message": V5Base_DIRECT_MESSAGE_KEYS,
  "GET direct-conversation": ["threadId", "otherMemberId", "messages", "revision", "readState"],
  "GET direct-conversation-page": ["threadId", "otherMemberId", "messages", "revision", "pageInfo", "readState"],
  "POST direct-conversation-read": ["unreadCount", "firstUnreadMessageId", "throughSequence"],
  "GET browser-tabs": V5Base_BROWSER_TAB_KEYS,
  "GET browser-control": ["sessions"],
  "POST browser-open": V5Base_BROWSER_TAB_KEYS,
  "POST browser-preview": ["dataUrl", "width", "height"],
  "POST attachment-upload": ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"],
  "GET team-members": V5Base_MEMBER_KEYS,
  "PATCH team-member": V5Base_MEMBER_KEYS,
  "POST team-invites": ["id", "role", "expiresAt", "usedAt", "inviteUrl", "email"],
  "GET team-invites": ["id", "role", "expiresAt", "usedAt", "email"],
  "GET team-sessions": ["id", "memberId", "username", "createdAt", "expiresAt"],
  "GET agent-status": ["phase", "cliVersion", "auth", "providers", "capabilities", "message", "fullAccess"],
  "GET sidebar-layout": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "POST sidebar-action": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "GET agent-usage": ["limits"],
  "GET agent-models": ["provider", "id", "name", "description", "defaultReasoningEffort", "supportedReasoningEfforts"],
  "GET agents": V5Base_BOT_KEYS,
  "POST agents": V5Base_BOT_KEYS,
  "PATCH agent": V5Base_BOT_KEYS,
  "PUT agent-avatar": V5Base_BOT_KEYS,
  "DELETE agent-avatar": V5Base_BOT_KEYS,
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
} as const satisfies Partial<Record<TeamProtocolV5BaseHttpRoute, readonly string[]>>;

export function decodeTeamProtocolV5BaseHttpRequest(
  method: string,
  path: string,
  value: unknown,
): TeamProtocolV5BaseJsonObject {
  const route = teamProtocolV5BaseHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP request.");
  const contract = TEAM_PROTOCOL_V5Base_HTTP_CONTRACTS[route];
  if (contract.request !== "object" || !isTeamProtocolV5BaseJsonObject(value)) {
    throw new Error("Invalid Team protocol v1 HTTP request.");
  }
  const projected = projectTeamProtocolV5BaseHttpRequest(route, value);
  validateTeamProtocolV5BaseHttpRequest(route, projected);
  return projected;
}

export function decodeTeamProtocolV5BaseHttpResponse(
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolV5BaseJsonValue {
  if (status >= 400) {
    if (!isTeamProtocolV5BaseJsonObject(value) || !isString(value.error)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    return projectTeamProtocolV5BaseError(value);
  }
  const route = teamProtocolV5BaseHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP response.");
  const contract = TEAM_PROTOCOL_V5Base_HTTP_CONTRACTS[route];
  if (!matchesTeamProtocolV5BaseHttpShape(contract.response, value)) {
    throw new Error("Invalid Team protocol v1 HTTP response.");
  }
  const projected = projectTeamProtocolV5BaseHttpResponse(route, value);
  validateTeamProtocolV5BaseHttpResponse(route, projected);
  return projected;
}

function projectTeamProtocolV5BaseHttpRequest(
  route: TeamProtocolV5BaseHttpRoute,
  value: TeamProtocolV5BaseJsonObject,
): TeamProtocolV5BaseJsonObject {
  if (!hasTeamProtocolV5BaseHttpRequestProjection(route)) {
    throw new Error("Team protocol v1 HTTP request projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_V5Base_HTTP_REQUEST_KEYS[route];
  const projected = projectV5BaseObject(value, wireKeys);
  if (route === "POST browser-visible" && isDynamicRecord(projected.bounds)) {
    projected.bounds = projectV5BaseObject(projected.bounds, ["x", "y", "width", "height"]);
  }
  if ((route === "POST routines" || route === "PATCH routine") && isDynamicRecord(projected.schedule)) {
    projected.schedule = projectV5BaseRoutineSchedule(projected.schedule);
  }
  return projected;
}

function projectTeamProtocolV5BaseHttpResponse(
  route: TeamProtocolV5BaseHttpRoute,
  value: TeamProtocolV5BaseJsonValue,
): TeamProtocolV5BaseJsonValue {
  if (route === "GET conversation-reads" && isDynamicRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([botId, state]) => [
        botId,
        isDynamicRecord(state)
          ? projectV5BaseObject(state, ["unreadCount", "firstUnreadMessageId", "throughMessageId"])
          : null,
      ]),
    );
  }
  if (!hasTeamProtocolV5BaseHttpResponseProjection(route)) {
    throw new Error("Team protocol v1 HTTP response projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS[route];
  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected = route === "GET agents" ? projectV5BaseBot(item) : projectV5BaseObject(item, wireKeys);
      if (route === "GET direct-threads" && isDynamicRecord(projected.lastMessage)) {
        projected.lastMessage = projectV5BaseObject(projected.lastMessage, V5Base_DIRECT_MESSAGE_KEYS);
      } else if (route === "GET agent-usage") {
        return projectV5BaseUsageLimit(item);
      } else if (route === "GET routines" || route === "GET routine-runs") {
        return projectV5BaseRoutineValue(projected);
      }
      return projected;
    });
  }
  if (value === null) return null;
  const projected =
    route === "POST agents" || route === "PATCH agent" || route.endsWith("agent-avatar")
      ? projectV5BaseBot(value)
      : projectV5BaseObject(value, wireKeys);
  if (["POST join", "POST join-account", "POST auth-login", "POST auth-account"].includes(route)) {
    if (isDynamicRecord(projected.member)) projected.member = projectV5BaseObject(projected.member, V5Base_MEMBER_KEYS);
  } else if (route === "GET team-presence" && Array.isArray(projected.members)) {
    projected.members = projected.members.map((member) =>
      projectV5BaseObject(member, [...V5Base_MEMBER_KEYS, "online", "typingBotId"]),
    );
  } else if (
    (route === "GET direct-conversation" || route === "GET direct-conversation-page") &&
    Array.isArray(projected.messages)
  ) {
    projected.messages = projected.messages.map((message) => projectV5BaseObject(message, V5Base_DIRECT_MESSAGE_KEYS));
    if (isDynamicRecord(projected.readState)) projected.readState = projectV5BaseDirectReadState(projected.readState);
    if (isDynamicRecord(projected.pageInfo)) projected.pageInfo = projectV5BasePageInfo(projected.pageInfo);
  } else if (route === "GET compatibility" && isDynamicRecord(projected.protocol)) {
    projected.protocol = projectV5BaseObject(projected.protocol, ["minimum", "maximum"]);
  } else if (route === "GET agent-status") {
    if (isDynamicRecord(projected.auth)) {
      projected.auth = projectV5BaseObject(projected.auth, ["kind", "accountType", "email"]);
    }
    if (Array.isArray(projected.providers)) {
      projected.providers = projected.providers.map(projectV5BaseProviderStatus);
    }
    if (isDynamicRecord(projected.capabilities)) {
      projected.capabilities = projectV5BaseObject(projected.capabilities, ["chat", "browser", "computerUse"]);
    }
  } else if (route === "GET agent-usage" && Array.isArray(projected.limits)) {
    projected.limits = projected.limits.map(projectV5BaseUsageLimit);
  } else if (route === "GET sidebar-layout" || route === "POST sidebar-action") {
    return projectV5BaseSidebarLayout(projected);
  } else if (route === "GET remote-capabilities" && Array.isArray(projected.displays)) {
    projected.displays = projected.displays.map(projectV5BaseRemoteDisplay);
  } else if (route === "POST remote-session") {
    if (Array.isArray(projected.displays)) projected.displays = projected.displays.map(projectV5BaseRemoteDisplay);
  } else if (route === "GET browser-control") {
    return projectV5BaseBrowserControl(projected);
  } else if (route === "POST routines" || route === "PATCH routine" || route === "POST routine-test") {
    return projectV5BaseRoutineValue(projected);
  } else if (route === "GET conversation") {
    return projectV5BaseConversation(projected, false, true);
  } else if (route === "GET conversation-page") {
    return projectV5BaseConversation(projected, true);
  } else if (route === "GET message-search") {
    return projectV5BaseConversationSearch(projected);
  } else if (route === "GET queue") {
    return projectV5BaseQueueSnapshot(projected);
  } else if (route === "POST messages") {
    return projectV5BaseQueuedMessageReceipt(projected);
  }
  return projected;
}

function hasTeamProtocolV5BaseHttpRequestProjection(
  route: TeamProtocolV5BaseHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_V5Base_HTTP_REQUEST_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_V5Base_HTTP_REQUEST_KEYS, route);
}

function hasTeamProtocolV5BaseHttpResponseProjection(
  route: TeamProtocolV5BaseHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS, route);
}

const V5Base_HTTP_ERROR_CODES = new Set([
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

function projectTeamProtocolV5BaseError(value: TeamProtocolV5BaseJsonObject): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, ["error", "code", "host", "client"]);
  if (!isV5BaseBoundedString(projected.error, 100_000))
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  if (projected.code !== undefined && (!isString(projected.code) || !V5Base_HTTP_ERROR_CODES.has(projected.code))) {
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  }
  if (projected.host !== undefined) {
    if (!isDynamicRecord(projected.host)) throw new Error("Invalid Team protocol v1 HTTP error response.");
    const host = projectV5BaseObject(projected.host, ["appVersion", "protocol", "capabilities"]);
    if (isDynamicRecord(host.protocol)) host.protocol = projectV5BaseObject(host.protocol, ["minimum", "maximum"]);
    try {
      const decoded = decodeTeamProtocolSupportV5Base(host);
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
    const client = projectV5BaseObject(projected.client, ["appVersion", "protocol"]);
    if (!isV5BaseBoundedString(client.appVersion, 64) || !isProtocolVersion(client.protocol)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    projected.client = client;
  }
  return projected;
}

function projectV5BaseBot(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, V5Base_BOT_KEYS);
  if (isDynamicRecord(projected.marketplaceSource)) {
    projected.marketplaceSource = projectV5BaseObject(projected.marketplaceSource, [
      "agentId",
      "versionId",
      "version",
      "skillIds",
      "routineIds",
    ]);
  }
  return projected;
}

function projectV5BaseSidebarLayout(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET sidebar-layout"]);
  if (Array.isArray(projected.sections)) {
    projected.sections = projected.sections.map((section) => projectV5BaseObject(section, ["id", "name"]));
  }
  return projected;
}

function projectV5BaseConversation(
  value: unknown,
  page: boolean,
  includeReadState = true,
): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(
    value,
    page
      ? TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET conversation-page"]
      : TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET conversation"],
  );
  if (Array.isArray(projected.messages)) projected.messages = projected.messages.map(projectV5BaseConversationMessage);
  if (!includeReadState) delete projected.readState;
  else if (isDynamicRecord(projected.readState))
    projected.readState = projectV5BaseConversationReadState(projected.readState);
  if (page && isDynamicRecord(projected.references)) {
    projected.references = Object.fromEntries(
      Object.entries(projected.references).map(([id, message]) => [id, projectV5BaseConversationMessage(message)]),
    );
  }
  if (page && isDynamicRecord(projected.pageInfo)) projected.pageInfo = projectV5BasePageInfo(projected.pageInfo);
  return projected;
}

function projectV5BaseConversationMessage(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, [
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
  if (Array.isArray(projected.attachments)) projected.attachments = projected.attachments.map(projectV5BaseAttachment);
  if (isDynamicRecord(projected.delivery)) {
    projected.delivery = projectV5BaseObject(projected.delivery, ["id", "status", "position"]);
  }
  if (isDynamicRecord(projected.exchange)) projected.exchange = projectV5BaseExchange(projected.exchange);
  if (Array.isArray(projected.reactions)) projected.reactions = projected.reactions.map(projectV5BaseReaction);
  if (isDynamicRecord(projected.routine)) {
    projected.routine = projectV5BaseObject(projected.routine, ["routineId", "runId", "name", "scheduledFor"]);
  }
  if (isDynamicRecord(projected.imageGeneration)) {
    projected.imageGeneration = projectV5BaseObject(projected.imageGeneration, [
      "prompt",
      "resolution",
      "aspectRatio",
      "error",
    ]);
  }
  if (isDynamicRecord(projected.questionPrompt)) {
    projected.questionPrompt = projectV5BaseConversationQuestionPrompt(projected.questionPrompt);
  }
  return projected;
}

function projectV5BaseExchange(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, [
    "direction",
    "messageId",
    "senderBotId",
    "recipientBotIds",
    "replyToMessageId",
    "deliveries",
  ]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectV5BaseObject(delivery, ["id", "recipientBotId", "status", "position", "error"]),
    );
  }
  return projected;
}

function projectV5BaseReaction(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, ["emoji", "actor"]);
  if (isDynamicRecord(projected.actor)) projected.actor = projectV5BaseObject(projected.actor, ["kind", "botId"]);
  return projected;
}

function projectV5BaseConversationQuestionPrompt(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, ["requestId", "questions", "resolution"]);
  if (Array.isArray(projected.questions)) projected.questions = projected.questions.map(projectV5BasePromptQuestion);
  if (isDynamicRecord(projected.resolution)) {
    const resolution = projectV5BaseObject(projected.resolution, ["status", "responses"]);
    if (isDynamicRecord(resolution.responses)) {
      resolution.responses = Object.fromEntries(
        Object.entries(resolution.responses).map(([id, response]) => [
          id,
          projectV5BaseObject(response, ["status", "answers"]),
        ]),
      );
    }
    projected.resolution = resolution;
  }
  return projected;
}

function projectV5BasePromptQuestion(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, ["id", "header", "question", "isSecret", "options"]);
  if (Array.isArray(projected.options)) {
    projected.options = projected.options.map((option) => projectV5BaseObject(option, ["label", "description"]));
  }
  return projected;
}

function projectV5BaseConversationReadState(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["unreadCount", "firstUnreadMessageId", "throughMessageId"]);
}

function projectV5BaseDirectReadState(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["unreadCount", "firstUnreadMessageId", "throughSequence"]);
}

function projectV5BasePageInfo(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["hasOlder", "olderCursor"]);
}

function projectV5BaseQueueSnapshot(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET queue"]);
  if (Array.isArray(projected.deliveries)) projected.deliveries = projected.deliveries.map(projectV5BaseQueueDelivery);
  return projected;
}

function projectV5BaseQueueDelivery(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, [
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
    projected.sender = projectV5BaseObject(projected.sender, [
      "kind",
      "botId",
      "routineId",
      "runId",
      "routineName",
      "scheduledFor",
    ]);
  }
  if (Array.isArray(projected.attachments)) projected.attachments = projected.attachments.map(projectV5BaseAttachment);
  return projected;
}

function projectV5BaseAttachment(value: unknown): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"]);
}

function projectV5BaseBrowserTakeover(value: unknown): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["requestId", "botId", "threadId", "turnId", "tabId"]);
}

function projectV5BaseApproval(value: unknown, runtime: boolean): TeamProtocolV5BaseJsonObject {
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
  const projected = projectV5BaseObject(value, runtime ? [...keys, "truncated"] : keys);
  if (isDynamicRecord(projected.permissions)) {
    const permissions = projectV5BaseObject(projected.permissions, ["fileSystem", "network"]);
    if (isDynamicRecord(permissions.fileSystem)) {
      permissions.fileSystem = projectV5BaseObject(permissions.fileSystem, ["read", "write"]);
    }
    projected.permissions = permissions;
  }
  return projected;
}

function projectV5BaseRuntimeSnapshot(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, [
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
      projectV5BaseObject(bot, [
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
      projectV5BaseObject(turn, ["botId", "threadId", "turnId"]),
    );
  }
  if (Array.isArray(projected.work)) {
    projected.work = projected.work.map((work) =>
      projectV5BaseObject(work, ["id", "botId", "turnId", "status", "text", "error"]),
    );
  }
  if (Array.isArray(projected.latestMessages)) {
    projected.latestMessages = projected.latestMessages.map((message) =>
      projectV5BaseObject(message, ["botId", "id", "text", "createdAt"]),
    );
  }
  if (Array.isArray(projected.pendingPrompts)) {
    projected.pendingPrompts = projected.pendingPrompts.map((prompt) => {
      const item = projectV5BaseObject(prompt, ["requestId", "botId", "threadId", "turnId", "questions"]);
      if (Array.isArray(item.questions)) item.questions = item.questions.map(projectV5BasePromptQuestion);
      return item;
    });
  }
  if (Array.isArray(projected.pendingApprovals)) {
    projected.pendingApprovals = projected.pendingApprovals.map((approval) => projectV5BaseApproval(approval, true));
  }
  if (Array.isArray(projected.pendingBrowserTakeovers)) {
    projected.pendingBrowserTakeovers = projected.pendingBrowserTakeovers.map(projectV5BaseBrowserTakeover);
  }
  if (Array.isArray(projected.failedTurns)) {
    projected.failedTurns = projected.failedTurns.map((turn) => projectV5BaseObject(turn, ["botId", "turnId"]));
  }
  return projected;
}

function projectV5BaseBrowserControl(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET browser-control"]);
  if (Array.isArray(projected.sessions)) {
    projected.sessions = projected.sessions.map((session) =>
      projectV5BaseObject(session, ["id", "threadId", "turnId", "callId", "tabId", "action", "phase", "startedAt"]),
    );
  }
  return projected;
}

function projectV5BaseRemoteDisplay(value: unknown): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["id", "label", "width", "height", "primary"]);
}

function projectV5BaseConversationSearch(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["GET message-search"]);
  if (Array.isArray(projected.results)) {
    projected.results = projected.results.map((result) => {
      const item = projectV5BaseObject(result, ["botId", "message"]);
      if (isDynamicRecord(item.message)) item.message = projectV5BaseConversationMessage(item.message);
      return item;
    });
  }
  return projected;
}

function projectV5BaseQueuedMessageReceipt(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, TEAM_PROTOCOL_V5Base_HTTP_RESPONSE_KEYS["POST messages"]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectV5BaseObject(delivery, ["id", "recipientBotId", "status", "position"]),
    );
  }
  return projected;
}

function projectV5BaseProviderStatus(value: unknown): TeamProtocolV5BaseJsonObject {
  return projectV5BaseObject(value, ["id", "state", "version", "message", "email", "connectionState", "checkError"]);
}

function projectV5BaseUsageLimit(value: unknown): TeamProtocolV5BaseJsonObject {
  const projected = projectV5BaseObject(value, ["id", "primary", "secondary"]);
  for (const key of ["primary", "secondary"] as const) {
    if (isDynamicRecord(projected[key])) {
      projected[key] = projectV5BaseObject(projected[key], ["usedPercent", "windowDurationMins", "resetsAt"]);
    }
  }
  return projected;
}

function projectV5BaseRoutineValue(value: TeamProtocolV5BaseJsonObject): TeamProtocolV5BaseJsonObject {
  const projected = { ...value };
  const trigger = projected.trigger;
  if (isDynamicRecord(trigger)) {
    const projectedTrigger = projectV5BaseObject(trigger, [
      "id",
      "routineId",
      "schedule",
      "nextRunAt",
      "createdAt",
      "updatedAt",
    ]);
    if (isDynamicRecord(projectedTrigger.schedule)) {
      projectedTrigger.schedule = projectV5BaseRoutineSchedule(projectedTrigger.schedule);
    }
    projected.trigger = projectedTrigger;
  }
  return projected;
}

function projectV5BaseObject(value: unknown, wireKeys: readonly string[]): TeamProtocolV5BaseJsonObject {
  if (!isDynamicRecord(value)) return {};
  const projected: TeamProtocolV5BaseJsonObject = {};
  for (const key of wireKeys) {
    const item = value[key];
    if (item !== undefined && isTeamProtocolV5BaseJsonValue(item)) projected[key] = item;
  }
  return projected;
}

function projectV5BaseRoutineSchedule(value: DynamicRecord): TeamProtocolV5BaseJsonObject {
  const common = ["kind"];
  switch (value.kind) {
    case "hourly":
      return projectV5BaseObject(value, [...common, "minute"]);
    case "daily":
    case "weekdays":
      return projectV5BaseObject(value, [...common, "time"]);
    case "weekly":
      return projectV5BaseObject(value, [...common, "weekday", "time"]);
    case "monthly":
      return projectV5BaseObject(value, [...common, "day", "time"]);
    case "interval":
      return projectV5BaseObject(value, [...common, "amount", "unit", "anchorAt"]);
    case "advanced":
      return projectV5BaseObject(value, [...common, "months", "days", "time"]);
    case "custom":
      return projectV5BaseObject(value, [...common, "expression"]);
    default:
      return projectV5BaseObject(value, common);
  }
}

// Exported for the shared route table's coverage case in `src/main/team-api-server.test.ts`. The host
// encodes every JSON response through this adapter, so a path `TEAM_API_ROUTES` builds that this
// frozen list cannot name is a route no client can be answered on. Classification only: it reads the
// list below and decides nothing, so exporting it leaves every released response meaning what it did.
export function teamProtocolV5BaseHttpRoute(method: string, path: string): TeamProtocolV5BaseHttpRoute | null {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  const exact: Record<string, TeamProtocolV5BaseHttpRoute> = {
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

function matchesTeamProtocolV5BaseHttpShape(
  payloadKind: TeamProtocolV5BaseHttpPayloadKind,
  value: unknown,
): value is TeamProtocolV5BaseJsonValue {
  if (payloadKind === "array") return Array.isArray(value) && value.every(isTeamProtocolV5BaseJsonValue);
  if (payloadKind === "nullable-object" && value === null) return true;
  return isTeamProtocolV5BaseJsonObject(value);
}

function validateTeamProtocolV5BaseHttpRequest(
  route: TeamProtocolV5BaseHttpRoute,
  value: TeamProtocolV5BaseJsonObject,
): void {
  let valid = false;
  switch (route) {
    case "POST invitation-preview":
      valid = isV5BaseIdentifier(value.inviteToken);
      break;
    case "POST join":
      valid =
        isV5BaseIdentifier(value.inviteToken) &&
        isV5BaseLimitedString(value.username, 64) &&
        isV5BaseLimitedString(value.password, 256);
      break;
    case "POST join-account":
      valid = isV5BaseIdentifier(value.inviteToken) && isV5BaseIdentifier(value.accountTicket);
      break;
    case "POST auth-login":
      valid = isV5BaseLimitedString(value.username, 64) && isV5BaseLimitedString(value.password, 256);
      break;
    case "POST auth-account":
      valid = isV5BaseIdentifier(value.accountTicket);
      break;
    case "POST auth-password":
      valid = isV5BaseLimitedString(value.currentPassword, 256) && isV5BaseLimitedString(value.newPassword, 256);
      break;
    case "POST remote-session":
      valid = Object.keys(value).length === 0;
      break;
    case "PUT remote-display":
      valid = isV5BaseIdentifier(value.displayId);
      break;
    case "POST direct-message":
      valid =
        isV5BaseIdentifier(value.memberId) &&
        isV5BaseLimitedString(value.text, 20_000) &&
        isV5BaseIdentifier(value.clientMessageId);
      break;
    case "POST direct-conversation-read":
      valid = isV5BaseNonNegativeInteger(value.throughSequence);
      break;
    case "POST browser-open":
      valid =
        isV5BaseHttpUrl(value.url, 8_192) &&
        isV5BaseOptionalNullableIdentifier(value.ownerThreadId) &&
        isV5BaseOptionalNullableIdentifier(value.ownerBotId) &&
        (value.focus === undefined || isBoolean(value.focus));
      break;
    case "POST browser-activate":
    case "POST browser-reload":
    case "POST browser-close":
    case "POST browser-preview":
      valid = isV5BaseIdentifier(value.tabId);
      break;
    case "POST browser-navigate":
      valid = isV5BaseIdentifier(value.tabId) && isV5BaseOneOf(["back", "forward"], value.direction);
      break;
    case "POST browser-visible":
      valid = isBoolean(value.visible) && (value.bounds === undefined || isV5BaseBrowserBounds(value.bounds));
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
        (value.email === undefined || isV5BaseLimitedString(value.email, 254));
      break;
    case "POST sidebar-action":
      valid = isV5BaseSidebarAction(value);
      break;
    case "POST agents":
      valid =
        isV5BaseLimitedString(value.name, 80) &&
        isV5BaseBoundedString(value.description, 2_000) &&
        isString(value.avatarSeed) &&
        (value.avatarHue === null || isV5BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
        isV5BaseBoundedString(value.initialMessage, 100_000);
      break;
    case "PATCH agent":
      valid = isV5BaseBotUpdate(value);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isV5BaseBoundedString(value.text, 20_000);
      break;
    case "POST routines":
      valid = isV5BaseRoutineMutation(value, true);
      break;
    case "PATCH routine":
      valid = isV5BaseRoutineMutation(value, false);
      break;
    case "POST conversation-read":
      valid = value.throughMessageId === null || isV5BaseIdentifier(value.throughMessageId);
      break;
    case "POST messages":
      valid =
        isV5BaseBoundedString(value.text, 100_000) &&
        (value.attachmentDraftIds === undefined || isV5BaseIdentifierList(value.attachmentDraftIds, 10)) &&
        isV5BaseOptionalNullableIdentifier(value.replyToMessageId);
      break;
    case "POST failure-acknowledge":
    case "POST interrupt":
      valid = isV5BaseIdentifier(value.turnId);
      break;
    case "POST reaction":
      valid = isV5BaseIdentifier(value.messageId) && (value.emoji === null || isV5BaseBoundedString(value.emoji, 32));
      break;
    case "POST queue-cancel":
      valid = isV5BaseIdentifier(value.deliveryId);
      break;
    case "POST queue-steer":
      valid = isV5BaseIdentifier(value.deliveryId) && isV5BaseIdentifier(value.expectedTurnId);
      break;
    case "POST queue-update":
      valid =
        isV5BaseIdentifier(value.deliveryId) &&
        isV5BaseBoundedString(value.text, 100_000) &&
        isV5BaseIdentifierList(value.keepAttachmentIds, 10) &&
        isV5BaseIdentifierList(value.attachmentDraftIds, 10);
      break;
    case "POST queue-reorder":
      valid = isV5BaseIdentifierList(value.deliveryIds, 100);
      break;
    case "POST prompt-response":
      valid = isV5BaseRequestId(value.requestId) && isV5BasePromptAnswers(value.answers);
      break;
    case "POST approval-response":
      valid = isV5BaseRequestId(value.requestId) && isV5BaseOneOf(["accept", "decline"], value.decision);
      break;
    case "POST browser-takeover-response":
      valid = isV5BaseRequestId(value.requestId) && isV5BaseOneOf(["complete", "cancel"], value.decision);
      break;
    default:
      valid = TEAM_PROTOCOL_V5Base_HTTP_CONTRACTS[route].request === "none";
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP request.");
}

function validateTeamProtocolV5BaseHttpResponse(
  route: TeamProtocolV5BaseHttpRoute,
  value: TeamProtocolV5BaseJsonValue,
): void {
  let valid = false;
  switch (route) {
    case "GET compatibility":
      try {
        decodeTeamProtocolSupportV5Base(value);
        valid = true;
      } catch {
        valid = false;
      }
      break;
    case "GET identity":
      valid = value === null || isV5BaseIdentity(value);
      break;
    case "POST invitation-preview":
      valid = isV5BaseInvitePreview(value);
      break;
    case "POST join":
    case "POST join-account":
    case "POST auth-login":
    case "POST auth-account":
      valid = isV5BaseJoinResult(value);
      break;
    case "GET me":
    case "PATCH team-member":
      valid = isV5BaseTeamMember(value);
      break;
    case "GET team-presence":
      valid = isTeamProtocolV5BasePresenceSnapshot(value);
      break;
    case "GET remote-capabilities":
      valid = isV5BaseRemoteCapabilities(value);
      break;
    case "POST remote-session":
      valid = isV5BaseRemoteSession(value);
      break;
    case "GET direct-threads":
      valid = Array.isArray(value) && value.every(isV5BaseDirectThread);
      break;
    case "POST direct-message":
      valid = isTeamProtocolV5BaseDirectMessage(value);
      break;
    case "GET direct-conversation":
      valid = isV5BaseDirectConversation(value, false);
      break;
    case "GET direct-conversation-page":
      valid = isV5BaseDirectConversation(value, true);
      break;
    case "POST direct-conversation-read":
      valid = isV5BaseDirectReadState(value);
      break;
    case "GET browser-tabs":
      valid = Array.isArray(value) && value.every(isV5BaseBrowserTab);
      break;
    case "GET browser-control":
      valid = isV5BaseBrowserControl(value);
      break;
    case "POST browser-open":
      valid = isV5BaseBrowserTab(value);
      break;
    case "POST browser-preview":
      valid = isV5BaseBrowserPreview(value);
      break;
    case "POST attachment-upload":
      valid = isV5BaseAttachment(value);
      break;
    case "GET team-members":
      valid = Array.isArray(value) && value.every(isV5BaseTeamMember);
      break;
    case "POST team-invites":
      valid = isV5BaseTeamInvite(value, true);
      break;
    case "GET team-invites":
      valid = Array.isArray(value) && value.every((invite) => isV5BaseTeamInvite(invite, false));
      break;
    case "GET team-sessions":
      valid = Array.isArray(value) && value.every(isV5BaseTeamSession);
      break;
    case "GET agent-status":
      valid = isV5BaseAgentStatus(value);
      break;
    case "GET sidebar-layout":
    case "POST sidebar-action":
      valid = isV5BaseSidebarLayout(value);
      break;
    case "GET agent-usage":
      valid = isV5BaseAccountUsage(value);
      break;
    case "GET agent-models":
      valid = Array.isArray(value) && value.every(isV5BaseAgentModelOption);
      break;
    case "GET agents":
      valid = Array.isArray(value) && value.every(isV5BaseBotSummary);
      break;
    case "POST agents":
    case "PATCH agent":
    case "PUT agent-avatar":
    case "DELETE agent-avatar":
      valid = isV5BaseBotSummary(value);
      break;
    case "GET conversation-reads":
      valid = isV5BaseConversationReadStates(value);
      break;
    case "GET memories":
      valid = Array.isArray(value) && value.every(isV5BaseMemory);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isV5BaseMemory(value);
      break;
    case "GET routines":
      valid = Array.isArray(value) && value.every(isV5BaseRoutine);
      break;
    case "POST routines":
    case "PATCH routine":
      valid = isV5BaseRoutine(value);
      break;
    case "POST routine-test":
      valid = isV5BaseRoutineRun(value);
      break;
    case "GET routine-runs":
      valid = Array.isArray(value) && value.every(isV5BaseRoutineRun);
      break;
    case "GET conversation":
      valid = isV5BaseConversationSnapshot(value) && isV5BaseConversationReadState(value.readState);
      break;
    case "GET conversation-page":
      valid = isV5BaseConversationPage(value);
      break;
    case "GET message-search":
      valid = isV5BaseConversationSearch(value);
      break;
    case "POST conversation-read":
      valid = isV5BaseConversationReadState(value);
      break;
    case "POST messages":
      valid = isV5BaseQueuedMessageReceipt(value);
      break;
    case "GET queue":
      valid = isV5BaseQueueSnapshot(value);
      break;
    default:
      valid = false;
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP response.");
}

function isV5BaseIdentity(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.serverId) &&
    isV5BaseLimitedString(value.serverName, 120) &&
    isV5BaseLimitedString(value.fingerprint, 256) &&
    isV5BaseBoundedString(value.publicKey, 8_192) &&
    isBoolean(value.enabledOnLaunch) &&
    (value.logoVersion === null || isV5BaseIdentifier(value.logoVersion)) &&
    (value.challenge === undefined || isV5BaseBoundedString(value.challenge, 256)) &&
    (value.signature === undefined || isV5BaseBoundedString(value.signature, 512))
  );
}

function isV5BaseInvitePreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseOneOf(["admin", "member"], value.role) &&
    isV5BaseTimestamp(value.expiresAt) &&
    isBoolean(value.emailBound)
  );
}

function isV5BaseJoinResult(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseTeamMember(value.member) &&
    isV5BaseLimitedString(value.sessionToken, 512) &&
    isV5BaseTimestamp(value.sessionExpiresAt)
  );
}

function isV5BaseTeamMember(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseLimitedString(value.username, 254) &&
    (value.email === null || isV5BaseLimitedString(value.email, 254)) &&
    (value.name === null || isV5BaseLimitedString(value.name, 120)) &&
    (value.avatarUrl === null || isV5BaseHttpUrl(value.avatarUrl, 2_048)) &&
    isV5BaseOneOf(["owner", "admin", "member"], value.role) &&
    isV5BaseTimestamp(value.createdAt) &&
    isBoolean(value.disabled)
  );
}

function isV5BaseRemoteDisplay(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseLimitedString(value.label, 160) &&
    isV5BasePositiveInteger(value.width) &&
    isV5BasePositiveInteger(value.height) &&
    isBoolean(value.primary)
  );
}

function isV5BaseRemoteCapabilities(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.ready) &&
    isV5BaseOneOf(["darwin", "win32", "linux"], value.platform) &&
    isBoolean(value.unattended) &&
    value.runtime === "sunshine-moonlight" &&
    value.protocolVersion === 2 &&
    Array.isArray(value.displays) &&
    value.displays.every(isV5BaseRemoteDisplay) &&
    (value.selectedDisplayId === null || isV5BaseIdentifier(value.selectedDisplayId)) &&
    isV5BaseNonNegativeInteger(value.activeSessions) &&
    isV5BasePositiveInteger(value.maxSessions)
  );
}

function isV5BaseRemoteSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.serverId) &&
    isV5BaseHttpUrl(value.viewerUrl, 8_192) &&
    isV5BaseLimitedString(value.viewerGrant, 512) &&
    Array.isArray(value.displays) &&
    value.displays.every(isV5BaseRemoteDisplay) &&
    (value.selectedDisplayId === null || isV5BaseIdentifier(value.selectedDisplayId)) &&
    isV5BaseOneOf(["starting_host", "connecting", "connected", "disconnecting", "error"], value.phase) &&
    isV5BaseOneOf(["unknown", "p2p", "relay"], value.transport) &&
    (value.errorCode === null ||
      isV5BaseOneOf(
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
    (value.message === null || isV5BaseBoundedString(value.message, 2_000)) &&
    isV5BaseTimestamp(value.createdAt) &&
    isV5BaseTimestamp(value.grantExpiresAt)
  );
}

function isV5BaseDirectThread(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.otherMemberId) &&
    isTeamProtocolV5BaseDirectMessage(value.lastMessage) &&
    isV5BaseNonNegativeInteger(value.unreadCount) &&
    isV5BaseTimestamp(value.updatedAt)
  );
}

function isV5BaseDirectConversation(value: unknown, paged: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.threadId) &&
    isV5BaseIdentifier(value.otherMemberId) &&
    Array.isArray(value.messages) &&
    value.messages.every(isTeamProtocolV5BaseDirectMessage) &&
    isV5BaseRevision(value.revision) &&
    (value.readState === undefined || isV5BaseDirectReadState(value.readState)) &&
    (!paged || isV5BasePageInfo(value.pageInfo))
  );
}

function isV5BaseDirectReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseNonNegativeInteger(value.unreadCount) &&
    (value.firstUnreadMessageId === null || isV5BaseIdentifier(value.firstUnreadMessageId)) &&
    isV5BaseNonNegativeInteger(value.throughSequence)
  );
}

function isV5BaseBrowserTab(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseBoundedString(value.title, 2_000) &&
    isV5BaseBoundedString(value.url, 8_192) &&
    isBoolean(value.loading) &&
    (value.ownerThreadId === null || isV5BaseIdentifier(value.ownerThreadId)) &&
    (value.ownerBotId === null || isV5BaseIdentifier(value.ownerBotId))
  );
}

function isV5BaseBrowserControl(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(
      (session) =>
        isDynamicRecord(session) &&
        isV5BaseIdentifier(session.id) &&
        isV5BaseIdentifier(session.threadId) &&
        isV5BaseIdentifier(session.turnId) &&
        isV5BaseIdentifier(session.callId) &&
        (session.tabId === null || isV5BaseIdentifier(session.tabId)) &&
        isV5BaseOneOf(
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
        isV5BaseOneOf(["acting", "waiting"], session.phase) &&
        isV5BaseTimestamp(session.startedAt),
    )
  );
}

function isV5BaseBrowserPreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseBoundedString(value.dataUrl, 2_000_000) &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.dataUrl) &&
    isV5BasePositiveInteger(value.width) &&
    value.width <= 960 &&
    isV5BasePositiveInteger(value.height) &&
    value.height <= 600
  );
}

function isV5BaseTeamInvite(value: unknown, includeUrl: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseOneOf(["admin", "member"], value.role) &&
    isV5BaseTimestamp(value.expiresAt) &&
    (value.usedAt === null || isV5BaseTimestamp(value.usedAt)) &&
    (value.email === null || isV5BaseLimitedString(value.email, 254)) &&
    (!includeUrl || isV5BaseBoundedString(value.inviteUrl, 8_192))
  );
}

function isV5BaseTeamSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.memberId) &&
    isV5BaseLimitedString(value.username, 254) &&
    isV5BaseTimestamp(value.createdAt) &&
    isV5BaseTimestamp(value.expiresAt)
  );
}

function isV5BaseAgentStatus(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseOneOf(["idle", "starting", "ready", "restarting", "blocked", "stopped"], value.phase) &&
    (value.cliVersion === null || isV5BaseBoundedString(value.cliVersion, 160)) &&
    isV5BaseAgentAuth(value.auth) &&
    (value.providers === undefined ||
      (Array.isArray(value.providers) && value.providers.every(isV5BaseProviderStatus))) &&
    isDynamicRecord(value.capabilities) &&
    isV5BaseCapabilityState(value.capabilities.chat) &&
    isV5BaseCapabilityState(value.capabilities.browser) &&
    isV5BaseCapabilityState(value.capabilities.computerUse) &&
    (value.message === null || isV5BaseBoundedString(value.message, 2_000)) &&
    value.fullAccess === true
  );
}

function isV5BaseAgentAuth(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "unknown" || value.kind === "signed-out") return true;
  if (value.kind === "unsupported") return isV5BaseBoundedString(value.accountType, 160);
  return (
    isV5BaseOneOf(["chatgpt", "claude", "grok", "opencode", "antigravity", "acp"], value.kind) &&
    (value.email === null || isV5BaseBoundedString(value.email, 254))
  );
}

function isV5BaseProviderStatus(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseOneOf(["codex", "claude", "grok", "opencode", "antigravity", "acp"], value.id) &&
    isV5BaseOneOf(
      ["not-started", "checking", "available", "sign-in-required", "not-installed", "outdated", "error"],
      value.state,
    ) &&
    (value.version === null || isV5BaseBoundedString(value.version, 160)) &&
    (value.message === null || isV5BaseBoundedString(value.message, 2_000)) &&
    (value.email === undefined || value.email === null || isV5BaseBoundedString(value.email, 254)) &&
    (value.connectionState === undefined || value.connectionState === "connecting") &&
    (value.checkError === undefined || value.checkError === null || isV5BaseBoundedString(value.checkError, 2_000))
  );
}

function isV5BaseCapabilityState(value: unknown): boolean {
  return isV5BaseOneOf(["ready", "setup-required", "unavailable"], value);
}

function isV5BaseAccountUsage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.limits) &&
    value.limits.every(
      (limit) =>
        isDynamicRecord(limit) &&
        isV5BaseIdentifier(limit.id) &&
        (limit.primary === null || isV5BaseUsageWindow(limit.primary)) &&
        (limit.secondary === null || isV5BaseUsageWindow(limit.secondary)),
    )
  );
}

function isV5BaseUsageWindow(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.usedPercent) &&
    Number.isFinite(value.usedPercent) &&
    (value.windowDurationMins === null || isV5BaseNonNegativeInteger(value.windowDurationMins)) &&
    (value.resetsAt === null || (isNumber(value.resetsAt) && Number.isFinite(value.resetsAt)))
  );
}

function isV5BaseAgentModelOption(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseOneOf(["codex", "claude", "grok", "opencode", "antigravity", "acp"], value.provider) &&
    isV5BaseBoundedString(value.id, 160) &&
    isV5BaseLimitedString(value.name, 160) &&
    isV5BaseBoundedString(value.description, 2_000) &&
    isV5BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.defaultReasoningEffort) &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.every((effort) => isV5BaseOneOf(["low", "medium", "high", "xhigh", "max"], effort))
  );
}

function isV5BaseConversationReadStates(value: unknown): boolean {
  return isDynamicRecord(value) && Object.values(value).every(isV5BaseConversationReadState);
}

function isV5BaseMemory(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseBoundedString(value.text, 20_000) &&
    isV5BaseOneOf(["automatic", "manual"], value.origin) &&
    (value.sourceTurnId === null || isV5BaseIdentifier(value.sourceTurnId)) &&
    isV5BaseTimestamp(value.createdAt) &&
    isV5BaseTimestamp(value.updatedAt)
  );
}

function isV5BaseRoutine(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.botId) &&
    isV5BaseLimitedString(value.name, 160) &&
    isV5BaseBoundedString(value.instruction, 100_000) &&
    isBoolean(value.active) &&
    isV5BaseLimitedString(value.timezone, 128) &&
    isDynamicRecord(value.trigger) &&
    isV5BaseIdentifier(value.trigger.id) &&
    isV5BaseIdentifier(value.trigger.routineId) &&
    isV5BaseRoutineSchedule(value.trigger.schedule) &&
    isV5BaseTimestamp(value.trigger.nextRunAt) &&
    isV5BaseTimestamp(value.trigger.createdAt) &&
    isV5BaseTimestamp(value.trigger.updatedAt) &&
    isV5BaseTimestamp(value.createdAt) &&
    isV5BaseTimestamp(value.updatedAt)
  );
}

function isV5BaseRoutineRun(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.id) &&
    isV5BaseIdentifier(value.routineId) &&
    isV5BaseIdentifier(value.botId) &&
    (value.triggerId === null || isV5BaseIdentifier(value.triggerId)) &&
    isV5BaseOneOf(["scheduled", "manual"], value.kind) &&
    isV5BaseTimestamp(value.scheduledFor) &&
    isV5BaseLimitedString(value.routineName, 160) &&
    isV5BaseBoundedString(value.instruction, 100_000) &&
    (value.deliveryId === null || isV5BaseIdentifier(value.deliveryId)) &&
    isV5BaseOneOf(
      ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"],
      value.status,
    ) &&
    (value.error === null || isV5BaseBoundedString(value.error, 100_000)) &&
    isV5BaseTimestamp(value.createdAt) &&
    isV5BaseTimestamp(value.updatedAt)
  );
}

function isV5BaseConversationSearch(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        isDynamicRecord(result) && isV5BaseIdentifier(result.botId) && isV5BaseConversationMessage(result.message),
    ) &&
    isV5BaseNonNegativeInteger(value.total) &&
    (value.nextCursor === null || isV5BaseBoundedString(value.nextCursor, 512))
  );
}

function isV5BaseQueuedMessageReceipt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isV5BaseIdentifier(value.messageId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isV5BaseIdentifier(delivery.id) &&
        isV5BaseIdentifier(delivery.recipientBotId) &&
        isV5BaseQueueStatus(delivery.status) &&
        isV5BaseQueuePosition(delivery.position),
    )
  );
}

function isV5BaseSidebarAction(value: TeamProtocolV5BaseJsonObject): boolean {
  if (!isString(value.type)) return false;
  if (value.type === "create")
    return isV5BaseLimitedString(value.name, 40) && (value.agentId === undefined || isV5BaseIdentifier(value.agentId));
  if (value.type === "rename") return isV5BaseIdentifier(value.sectionId) && isV5BaseLimitedString(value.name, 40);
  if (value.type === "delete") return isV5BaseIdentifier(value.sectionId);
  if (value.type === "move") {
    return (
      isV5BaseIdentifier(value.sectionId) &&
      isV5BaseOneOf(["up", "down"], value.direction) &&
      (value.steps === undefined || isV5BasePositiveInteger(value.steps))
    );
  }
  if (value.type === "assign")
    return isV5BaseIdentifier(value.agentId) && (value.sectionId === null || isV5BaseIdentifier(value.sectionId));
  return (
    value.type === "move-agent" &&
    isV5BaseIdentifier(value.agentId) &&
    (value.sectionId === null || isV5BaseIdentifier(value.sectionId)) &&
    (value.beforeAgentId === null || isV5BaseIdentifier(value.beforeAgentId))
  );
}

function isV5BaseBotUpdate(value: TeamProtocolV5BaseJsonObject): boolean {
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
    (value.name === undefined || isV5BaseBoundedString(value.name, 80)) &&
    (value.title === undefined || isV5BaseBoundedString(value.title, 120)) &&
    (value.description === undefined || isV5BaseBoundedString(value.description, 2_000)) &&
    (value.notifications === undefined || isBoolean(value.notifications)) &&
    (value.provider === undefined ||
      isV5BaseOneOf(["codex", "claude", "grok", "opencode", "antigravity", "acp"], value.provider)) &&
    (value.model === undefined || isV5BaseBoundedString(value.model, 160)) &&
    (value.reasoningEffort === undefined ||
      isV5BaseOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort)) &&
    (value.avatarSeed === undefined || isV5BaseBoundedString(value.avatarSeed, 128)) &&
    (value.avatarHue === undefined ||
      value.avatarHue === null ||
      isV5BaseOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue))
  );
}

function isV5BaseRoutineMutation(value: TeamProtocolV5BaseJsonObject, create: boolean): boolean {
  return (
    (!create ||
      (isV5BaseLimitedString(value.name, 160) &&
        isV5BaseBoundedString(value.instruction, 100_000) &&
        isBoolean(value.active) &&
        isV5BaseLimitedString(value.timezone, 128) &&
        isV5BaseRoutineSchedule(value.schedule))) &&
    (value.name === undefined || isV5BaseLimitedString(value.name, 160)) &&
    (value.instruction === undefined || isV5BaseBoundedString(value.instruction, 100_000)) &&
    (value.active === undefined || isBoolean(value.active)) &&
    (value.timezone === undefined || isV5BaseLimitedString(value.timezone, 128)) &&
    (value.schedule === undefined || isV5BaseRoutineSchedule(value.schedule))
  );
}

function isV5BaseRoutineSchedule(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case "hourly":
      return isV5BaseIntegerInRange(value.minute, 0, 59);
    case "daily":
    case "weekdays":
      return isV5BaseRoutineTime(value.time);
    case "weekly":
      return isV5BaseIntegerInRange(value.weekday, 0, 6) && isV5BaseRoutineTime(value.time);
    case "monthly":
      return isV5BaseIntegerInRange(value.day, 1, 31) && isV5BaseRoutineTime(value.time);
    case "interval":
      return (
        isV5BaseIntegerInRange(value.amount, 1, 100_000) &&
        isV5BaseOneOf(["minutes", "hours", "days"], value.unit) &&
        isV5BaseTimestamp(value.anchorAt)
      );
    case "advanced":
      return (
        Array.isArray(value.months) &&
        value.months.length > 0 &&
        value.months.every((month) => isV5BaseIntegerInRange(month, 1, 12)) &&
        isV5BaseRoutineDays(value.days) &&
        isV5BaseRoutineTimeSelection(value.time)
      );
    case "custom":
      return isV5BaseLimitedString(value.expression, 512);
    default:
      return false;
  }
}

function isV5BaseRoutineDays(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "every-day") return true;
  if (!Array.isArray(value.days) || value.days.length === 0) return false;
  if (value.kind === "days-of-week") return value.days.every((day) => isV5BaseIntegerInRange(day, 0, 6));
  return value.kind === "days-of-month" && value.days.every((day) => isV5BaseIntegerInRange(day, 1, 31));
}

function isV5BaseRoutineTimeSelection(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    ((value.kind === "at-time" && isV5BaseRoutineTime(value.time)) ||
      (value.kind === "every" &&
        isV5BaseIntegerInRange(value.amount, 1, 100_000) &&
        isV5BaseOneOf(["minutes", "hours"], value.unit)))
  );
}

function isV5BaseRoutineTime(value: unknown): boolean {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function isV5BasePromptAnswers(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length <= 32 &&
    Object.values(value).every(
      (answers) => Array.isArray(answers) && answers.every((answer) => isV5BaseBoundedString(answer, 20_000)),
    )
  );
}

function isV5BaseBrowserBounds(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    [value.x, value.y, value.width, value.height].every((item) => isNumber(item) && Number.isFinite(item))
  );
}

function isV5BasePageInfo(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.hasOlder) &&
    (value.olderCursor === null || isV5BaseBoundedString(value.olderCursor, 512))
  );
}

function isV5BaseOptionalNullableIdentifier(value: unknown): boolean {
  return value === undefined || value === null || isV5BaseIdentifier(value);
}

function isV5BaseNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isV5BasePositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

function isV5BaseIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
