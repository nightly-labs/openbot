// The provider-aware base schema that protocols 4, 5 and 6 share. Each version file passes its own
// profile to `createProviderAwareCodec`; the profile is the only part of the schema that differs between
// these versions. Versions 1-3 retain their own codec.
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";

/**
 * What a released provider-aware protocol accepts. Each list is frozen with its protocol version: a value
 * added to a list is a new protocol version, never an edit to a released profile.
 */
export interface ProviderAwareProfile {
  /** Agent `provider`, provider status `id`, and model option `provider` values. */
  readonly providers: readonly string[];
  /** Agent auth `kind` values for a signed-in account, next to `unknown`, `signed-out` and `unsupported`. */
  readonly authKinds: readonly string[];
  /** The charset and length of an agent summary `model`. It must not have the `g` or `y` flag. */
  readonly agentModel: RegExp;
}

/** Binds the codec entry points that read the profile; the other exports do not depend on it. */
export function createProviderAwareCodec(profile: ProviderAwareProfile) {
  return {
    decodeEvent: (value: unknown): TeamProtocolProviderAwareEventDecodeResult =>
      decodeTeamProtocolProviderAwareEvent(profile, value),
    encodeEvent: (event: TeamProtocolProviderAwareEvent): string | null =>
      encodeTeamProtocolProviderAwareEvent(profile, event),
    decodeHttpRequest: (method: string, path: string, value: unknown): TeamProtocolProviderAwareJsonObject =>
      decodeTeamProtocolProviderAwareHttpRequest(profile, method, path, value),
    decodeHttpResponse: (
      method: string,
      path: string,
      status: number,
      value: unknown,
    ): TeamProtocolProviderAwareJsonValue =>
      decodeTeamProtocolProviderAwareHttpResponse(profile, method, path, status, value),
  };
}

export const TEAM_PROTOCOL_VERSION_HEADER = "OpenBot-Protocol-Version";
export const TEAM_APP_VERSION_HEADER = "OpenBot-App-Version";
export const TEAM_CAPABILITIES_HEADER = "OpenBot-Capabilities";

export const TEAM_PROTOCOL_ProviderAware_CAPABILITIES = [
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

export type TeamProtocolProviderAwareCapability = (typeof TEAM_PROTOCOL_ProviderAware_CAPABILITIES)[number];

const TEAM_PROTOCOL_ProviderAware_CAPABILITY_SET = new Set<string>(TEAM_PROTOCOL_ProviderAware_CAPABILITIES);

export type TeamProtocolProviderAwareEventDecodeResult =
  | { kind: "known"; event: TeamProtocolProviderAwareEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string | null };

export type TeamProtocolProviderAwareJsonValue =
  | null
  | boolean
  | number
  | string
  | TeamProtocolProviderAwareJsonValue[]
  | TeamProtocolProviderAwareJsonObject;

export interface TeamProtocolProviderAwareJsonObject {
  [key: string]: TeamProtocolProviderAwareJsonValue;
}

interface TeamProtocolProviderAwarePresenceMember {
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

interface TeamProtocolProviderAwarePresenceSnapshot {
  serverId: string | null;
  members: TeamProtocolProviderAwarePresenceMember[];
  updatedAt: string;
}

interface TeamProtocolProviderAwareDirectMessage {
  id: string;
  threadId: string;
  senderMemberId: string;
  recipientMemberId: string;
  text: string;
  createdAt: string;
  sequence: number;
}

export type TeamProtocolProviderAwareEvent =
  | { type: "status"; status: TeamProtocolProviderAwareJsonObject }
  | { type: "usage-changed"; usage: TeamProtocolProviderAwareJsonObject }
  | { type: "bots-changed"; bots: TeamProtocolProviderAwareJsonObject[] }
  | { type: "memories-changed"; botId: string }
  | { type: "routines-changed"; botId: string }
  | { type: "sidebar-layout-changed"; layout: TeamProtocolProviderAwareJsonObject }
  | { type: "conversation"; snapshot: TeamProtocolProviderAwareJsonObject }
  | { type: "conversation-invalidated"; botId: string; revision: number }
  | { type: "conversation-page"; page: TeamProtocolProviderAwareJsonObject }
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
  | { type: "queue-changed"; snapshot: TeamProtocolProviderAwareJsonObject }
  | { type: "turn-started"; botId: string; threadId: string; turnId: string; origin?: string }
  | { type: "turn-completed"; botId: string; threadId: string; turnId: string; status: string; origin?: string }
  | {
      type: "prompt";
      requestId: string | number;
      botId: string;
      threadId: string;
      turnId: string;
      questions: TeamProtocolProviderAwareJsonObject[];
    }
  | { type: "agent-input-resolved"; kind: "prompt" | "approval"; requestId: string | number; botId: string }
  | { type: "browser-takeover-requested"; request: TeamProtocolProviderAwareJsonObject }
  | { type: "browser-takeover-resolved"; requestId: string | number; botId: string }
  | { type: "approval"; approval: TeamProtocolProviderAwareJsonObject }
  | { type: "runtime-snapshot"; snapshot: TeamProtocolProviderAwareJsonObject }
  | { type: "browser-changed"; tabs: TeamProtocolProviderAwareJsonObject[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: TeamProtocolProviderAwareJsonObject }
  | { type: "error"; botId?: string; code: string; message: string }
  | { type: "team-identity"; serverId: string; serverName: string; logoVersion: string | null }
  | { type: "team-presence"; snapshot: TeamProtocolProviderAwarePresenceSnapshot }
  | { type: "team-direct-message"; message: TeamProtocolProviderAwareDirectMessage; memberIds: [string, string] }
  | { type: "team-direct-typing"; senderMemberId: string; recipientMemberId: string; typing: boolean };

export type TeamProtocolProviderAwareClientEvent =
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
const TEAM_PROTOCOL_ProviderAware_EVENT_TYPES = [...AGENT_EVENT_TYPES, ...TEAM_EVENT_TYPES] as const;
const TEAM_PROTOCOL_ProviderAware_EVENT_TYPE_SET = new Set<string>(TEAM_PROTOCOL_ProviderAware_EVENT_TYPES);

function decodeTeamProtocolProviderAwareEvent(
  profile: ProviderAwareProfile,
  value: unknown,
): TeamProtocolProviderAwareEventDecodeResult {
  if (!isDynamicRecord(value) || !isString(value.type)) return { kind: "invalid", type: null };
  if (!TEAM_PROTOCOL_ProviderAware_EVENT_TYPE_SET.has(value.type)) {
    return { kind: "unknown", type: value.type };
  }
  const projected = projectTeamProtocolProviderAwareEvent(value);
  if (isTeamProtocolProviderAwareKnownEvent(profile, projected)) return { kind: "known", event: projected };
  return { kind: "invalid", type: value.type };
}

function encodeTeamProtocolProviderAwareEvent(
  profile: ProviderAwareProfile,
  event: TeamProtocolProviderAwareEvent,
): string | null {
  const decoded = decodeTeamProtocolProviderAwareEvent(profile, event);
  return decoded.kind === "known" ? JSON.stringify(decoded.event) : null;
}

const TEAM_PROTOCOL_ProviderAware_EVENT_KEYS = {
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
} as const satisfies Record<(typeof TEAM_PROTOCOL_ProviderAware_EVENT_TYPES)[number], readonly string[]>;

function projectTeamProtocolProviderAwareEvent(value: DynamicRecord): DynamicRecord {
  if (!isString(value.type) || !isTeamProtocolProviderAwareEventType(value.type)) return value;
  const eventType = value.type;
  const projected = projectProviderAwareObject(value, TEAM_PROTOCOL_ProviderAware_EVENT_KEYS[eventType]);
  switch (eventType) {
    case "status":
      if (isDynamicRecord(projected.status)) {
        projected.status = projectTeamProtocolProviderAwareHttpResponse("GET agent-status", projected.status);
      }
      break;
    case "usage-changed":
      if (isDynamicRecord(projected.usage)) {
        projected.usage = projectTeamProtocolProviderAwareHttpResponse("GET agent-usage", projected.usage);
      }
      break;
    case "bots-changed":
      if (Array.isArray(projected.bots)) projected.bots = projected.bots.map(projectProviderAwareBot);
      break;
    case "sidebar-layout-changed":
      if (isDynamicRecord(projected.layout)) {
        projected.layout = projectProviderAwareSidebarLayout(projected.layout);
      }
      break;
    case "conversation":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectProviderAwareConversation(projected.snapshot, false, false);
      }
      break;
    case "conversation-page":
      if (isDynamicRecord(projected.page)) {
        projected.page = projectTeamProtocolProviderAwareHttpResponse("GET conversation-page", projected.page);
      }
      break;
    case "queue-changed":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectProviderAwareQueueSnapshot(projected.snapshot);
      }
      break;
    case "prompt":
      if (Array.isArray(projected.questions))
        projected.questions = projected.questions.map(projectProviderAwarePromptQuestion);
      break;
    case "browser-takeover-requested":
      if (isDynamicRecord(projected.request))
        projected.request = projectProviderAwareBrowserTakeover(projected.request);
      break;
    case "approval":
      if (isDynamicRecord(projected.approval))
        projected.approval = projectProviderAwareApproval(projected.approval, false);
      break;
    case "runtime-snapshot":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectProviderAwareRuntimeSnapshot(projected.snapshot);
      }
      break;
    case "browser-changed":
      if (Array.isArray(projected.tabs)) {
        projected.tabs = projected.tabs.map((tab) => projectProviderAwareObject(tab, ProviderAware_BROWSER_TAB_KEYS));
      }
      break;
    case "browser-control-changed":
      if (isDynamicRecord(projected.state)) {
        projected.state = projectProviderAwareBrowserControl(projected.state);
      }
      break;
    case "team-presence":
      if (isDynamicRecord(projected.snapshot)) {
        projected.snapshot = projectTeamProtocolProviderAwareHttpResponse("GET team-presence", projected.snapshot);
      }
      break;
    case "team-direct-message":
      if (isDynamicRecord(projected.message)) {
        projected.message = projectProviderAwareObject(projected.message, ProviderAware_DIRECT_MESSAGE_KEYS);
      }
      break;
  }
  return projected;
}

function isTeamProtocolProviderAwareEventType(
  value: string,
): value is keyof typeof TEAM_PROTOCOL_ProviderAware_EVENT_KEYS {
  return TEAM_PROTOCOL_ProviderAware_EVENT_TYPE_SET.has(value);
}

// This is the frozen v1 wire validator. Do not replace its nested checks with current IPC validators.
function isTeamProtocolProviderAwareKnownEvent(
  profile: ProviderAwareProfile,
  value: DynamicRecord,
): value is TeamProtocolProviderAwareEvent {
  switch (value.type) {
    case "status":
      return isProviderAwareAgentStatus(profile, value.status);
    case "usage-changed":
      return isProviderAwareAccountUsage(value.usage);
    case "bots-changed":
      return (
        Array.isArray(value.bots) &&
        value.bots.length <= 100 &&
        value.bots.every((bot) => isProviderAwareBotSummary(profile, bot))
      );
    case "memories-changed":
    case "routines-changed":
    case "queue-invalidated":
      return isString(value.botId);
    case "sidebar-layout-changed":
      return isProviderAwareSidebarLayout(value.layout);
    case "conversation":
      return isProviderAwareConversationSnapshot(value.snapshot);
    case "queue-changed":
      return isProviderAwareQueueSnapshot(value.snapshot);
    case "conversation-invalidated":
      return isString(value.botId) && isNumber(value.revision);
    case "conversation-page":
      return isProviderAwareConversationPage(value.page);
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
        (value.origin === undefined || isProviderAwareOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "turn-completed":
      return (
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.status) &&
        (value.origin === undefined || isProviderAwareOneOf(["user", "routine", "bot", "unknown"], value.origin))
      );
    case "prompt":
      return (
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        Array.isArray(value.questions) &&
        value.questions.length <= 32 &&
        value.questions.every(isProviderAwarePromptQuestion)
      );
    case "agent-input-resolved":
      return (
        (value.kind === "prompt" || value.kind === "approval") &&
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.botId)
      );
    case "browser-takeover-requested":
      return isProviderAwareBrowserTakeover(value.request);
    case "browser-takeover-resolved":
      return (isString(value.requestId) || isNumber(value.requestId)) && isString(value.botId);
    case "approval":
      return isProviderAwareApproval(value.approval, false);
    case "runtime-snapshot":
      return isProviderAwareRuntimeSnapshot(value.snapshot);
    case "browser-changed":
      return (
        Array.isArray(value.tabs) &&
        value.tabs.every(isProviderAwareBrowserTab) &&
        (value.activeTabId === null || isString(value.activeTabId))
      );
    case "browser-control-changed":
      return isProviderAwareBrowserControl(value.state);
    case "error":
      return isString(value.code) && isString(value.message);
    case "team-identity":
      return (
        isString(value.serverId) &&
        isString(value.serverName) &&
        (value.logoVersion === null || isString(value.logoVersion))
      );
    case "team-presence":
      return isTeamProtocolProviderAwarePresenceSnapshot(value.snapshot);
    case "team-direct-message":
      return (
        isTeamProtocolProviderAwareDirectMessage(value.message) &&
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

function isTeamProtocolProviderAwareJsonValue(value: unknown): value is TeamProtocolProviderAwareJsonValue {
  return (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    (isNumber(value) && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isTeamProtocolProviderAwareJsonValue)) ||
    isTeamProtocolProviderAwareJsonObject(value)
  );
}

function isTeamProtocolProviderAwareJsonObject(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return isDynamicRecord(value) && Object.values(value).every(isTeamProtocolProviderAwareJsonValue);
}

function isProviderAwareBotSummary(
  profile: ProviderAwareProfile,
  value: unknown,
): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.name, 80) &&
    isProviderAwareBoundedString(value.title, 120) &&
    isProviderAwareBoundedString(value.description, 2_000) &&
    isBoolean(value.notifications) &&
    isProviderAwareOneOf(profile.providers, value.provider) &&
    isString(value.model) &&
    profile.agentModel.test(value.model) &&
    isProviderAwareOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort) &&
    (value.threadId === null || isProviderAwareIdentifier(value.threadId)) &&
    isProviderAwareBoundedString(value.workspacePath, 4_096) &&
    isProviderAwareBoundedString(value.preview, 100_000) &&
    (value.updatedAt === null || isProviderAwareBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null ||
      isProviderAwareOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isProviderAwareBoundedString(value.avatarUrl, 2_048)) &&
    (value.marketplaceSource === undefined || isProviderAwareMarketplaceSource(value.marketplaceSource))
  );
}

function isProviderAwareMarketplaceSource(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.agentId) &&
    isProviderAwareIdentifier(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    isProviderAwareIdentifierList(value.skillIds, 100) &&
    isProviderAwareIdentifierList(value.routineIds, 64)
  );
}

function isProviderAwareSidebarLayout(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  if (
    !isTeamProtocolProviderAwareJsonObject(value) ||
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
        isProviderAwareIdentifier(section.id) &&
        isProviderAwareBoundedString(section.name, 40) &&
        section.name.length > 0,
    ) &&
    value.order.every(isProviderAwareIdentifier) &&
    Object.values(value.agentAssignments).every(isProviderAwareIdentifier) &&
    value.agentOrder.every(isProviderAwareIdentifier) &&
    new Set(value.agentOrder).size === value.agentOrder.length
  );
}

function isProviderAwareConversationSnapshot(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareIdentifier(value.botId) &&
    (value.threadId === null || isProviderAwareIdentifier(value.threadId)) &&
    (value.activeTurnId === null || isProviderAwareIdentifier(value.activeTurnId)) &&
    isProviderAwareRevision(value.revision) &&
    Array.isArray(value.messages) &&
    value.messages.every(isProviderAwareConversationMessage)
  );
}

function isProviderAwareConversationPage(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  if (!isProviderAwareConversationSnapshot(value) || !Array.isArray(value.messages) || value.messages.length > 100)
    return false;
  return (
    isDynamicRecord(value.references) &&
    Object.values(value.references).every(isProviderAwareConversationMessage) &&
    isDynamicRecord(value.pageInfo) &&
    isBoolean(value.pageInfo.hasOlder) &&
    (value.pageInfo.olderCursor === null || isString(value.pageInfo.olderCursor)) &&
    (value.readState === undefined || isProviderAwareConversationReadState(value.readState))
  );
}

function isProviderAwareConversationMessage(value: unknown): boolean {
  if (!isTeamProtocolProviderAwareJsonObject(value)) return false;
  return (
    isProviderAwareIdentifier(value.id) &&
    isString(value.text) &&
    isProviderAwareBoundedString(value.createdAt, 160) &&
    isProviderAwareOneOf(["user", "assistant", "agent", "system"], value.author) &&
    isProviderAwareOneOf(["streaming", "completed", "failed", "interrupted"], value.status) &&
    (value.turnId === undefined || isProviderAwareIdentifier(value.turnId)) &&
    (value.itemType === undefined || isProviderAwareBoundedString(value.itemType, 128)) &&
    (value.source === undefined ||
      isProviderAwareOneOf(["user", "assistant", "agent", "system", "routine"], value.source)) &&
    (value.senderBotId === undefined || isProviderAwareIdentifier(value.senderBotId)) &&
    (value.replyToMessageId === undefined ||
      value.replyToMessageId === null ||
      isProviderAwareIdentifier(value.replyToMessageId)) &&
    (value.attachments === undefined || isProviderAwareAttachments(value.attachments)) &&
    (value.delivery === undefined || isProviderAwareConversationDelivery(value.delivery)) &&
    (value.exchange === undefined || isProviderAwareExchange(value.exchange)) &&
    (value.reaction === undefined || value.reaction === null || isProviderAwareBoundedString(value.reaction, 32)) &&
    (value.reactions === undefined ||
      (Array.isArray(value.reactions) &&
        value.reactions.length <= 100 &&
        value.reactions.every(isProviderAwareReaction))) &&
    (value.routine === undefined || isProviderAwareRoutineReference(value.routine)) &&
    (value.imageGeneration === undefined || isProviderAwareImageGeneration(value.imageGeneration)) &&
    (value.questionPrompt === undefined || isProviderAwareConversationQuestionPrompt(value.questionPrompt))
  );
}

function isProviderAwareConversationDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareQueueStatus(value.status) &&
    isProviderAwareQueuePosition(value.position)
  );
}

function isProviderAwareExchange(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareOneOf(["incoming", "outgoing"], value.direction) &&
    isProviderAwareIdentifier(value.messageId) &&
    isProviderAwareIdentifier(value.senderBotId) &&
    isProviderAwareIdentifierList(value.recipientBotIds, 100) &&
    (value.replyToMessageId === null || isProviderAwareIdentifier(value.replyToMessageId)) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.length <= 100 &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isProviderAwareIdentifier(delivery.id) &&
        isProviderAwareIdentifier(delivery.recipientBotId) &&
        isProviderAwareQueueStatus(delivery.status) &&
        isProviderAwareQueuePosition(delivery.position) &&
        (delivery.error === null || isProviderAwareBoundedString(delivery.error, 100_000)),
    )
  );
}

function isProviderAwareReaction(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareBoundedString(value.emoji, 32) &&
    isDynamicRecord(value.actor) &&
    (value.actor.kind === "user" || (value.actor.kind === "bot" && isProviderAwareIdentifier(value.actor.botId)))
  );
}

function isProviderAwareRoutineReference(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.routineId) &&
    isProviderAwareIdentifier(value.runId) &&
    isProviderAwareLimitedString(value.name, 160) &&
    isProviderAwareTimestamp(value.scheduledFor)
  );
}

function isProviderAwareImageGeneration(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    isString(value.resolution) &&
    isProviderAwareOneOf(["square", "portrait", "landscape"], value.aspectRatio) &&
    (value.error === undefined || isString(value.error))
  );
}

function isProviderAwareConversationQuestionPrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareRequestId(value.requestId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isProviderAwarePromptQuestion) &&
    (value.resolution === null || isProviderAwarePromptResolution(value.resolution))
  );
}

function isProviderAwarePromptResolution(value: unknown): boolean {
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

function isProviderAwareConversationReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.unreadCount) &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0 &&
    (value.firstUnreadMessageId === null || isProviderAwareIdentifier(value.firstUnreadMessageId)) &&
    (value.throughMessageId === null || isProviderAwareIdentifier(value.throughMessageId))
  );
}

function isProviderAwareQueueSnapshot(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareIdentifier(value.botId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isProviderAwareQueueDelivery)
  );
}

function isProviderAwareQueueDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.messageId) &&
    isProviderAwareIdentifier(value.recipientBotId) &&
    isProviderAwareQueueSender(value.sender) &&
    isProviderAwareBoundedString(value.text, 100_000) &&
    isProviderAwareAttachments(value.attachments) &&
    (value.replyToMessageId === null || isProviderAwareIdentifier(value.replyToMessageId)) &&
    isProviderAwareQueueStatus(value.status) &&
    isProviderAwareQueuePosition(value.position) &&
    (value.turnId === null || isProviderAwareIdentifier(value.turnId)) &&
    (value.error === null || isProviderAwareBoundedString(value.error, 100_000)) &&
    isProviderAwareBoundedString(value.createdAt, 160)
  );
}

function isProviderAwareQueueSender(value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "user") return true;
  if (value.kind === "bot") return isProviderAwareIdentifier(value.botId);
  return (
    value.kind === "routine" &&
    isProviderAwareIdentifier(value.routineId) &&
    isProviderAwareIdentifier(value.runId) &&
    isProviderAwareBoundedString(value.routineName, 80) &&
    isProviderAwareBoundedString(value.scheduledFor, 160)
  );
}

function isProviderAwareAttachments(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 10 && value.every(isProviderAwareAttachment);
}

function isProviderAwareAttachment(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.name, 255) &&
    isNumber(value.size) &&
    value.size >= 0 &&
    isProviderAwareOneOf(["image", "file"], value.kind) &&
    isProviderAwareBoundedString(value.mimeType, 255) &&
    isProviderAwareOneOf(["image", "pdf", "text", "none"], value.previewKind) &&
    (value.previewUrl === null || isProviderAwareBoundedString(value.previewUrl, 2_048))
  );
}

function isProviderAwarePromptQuestion(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareBoundedString(value.id, 128) &&
    isProviderAwareBoundedString(value.header, 120) &&
    isProviderAwareBoundedString(value.question, 2_000) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isProviderAwareBoundedString(option.label, 120) &&
            isProviderAwareBoundedString(option.description, 2_000),
        )))
  );
}

function isProviderAwareBrowserTakeover(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareRequestId(value.requestId) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.turnId) &&
    isProviderAwareIdentifier(value.tabId)
  );
}

function isProviderAwareApproval(value: unknown, runtime: boolean): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    isProviderAwareRequestId(value.requestId) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.turnId) &&
    isProviderAwareOneOf(["command", "file-change", "permissions"], value.kind) &&
    isProviderAwareNullableString(value.command, runtime ? 240 : 100_000) &&
    isProviderAwareNullableString(value.cwd, runtime ? 240 : 4_096) &&
    isProviderAwareNullableString(value.reason, runtime ? 240 : 100_000) &&
    isProviderAwareNullableString(value.grantRoot, runtime ? 240 : 4_096) &&
    (!runtime || isBoolean(value.truncated)) &&
    (value.permissions === null || isProviderAwareApprovalPermissions(value.permissions, runtime))
  );
}

function isProviderAwareApprovalPermissions(value: unknown, runtime: boolean): boolean {
  const maximumItems = runtime ? 3 : 100;
  const maximumPath = runtime ? 240 : 4_096;
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.fileSystem) &&
    isProviderAwareStringList(value.fileSystem.read, maximumItems, maximumPath) &&
    isProviderAwareStringList(value.fileSystem.write, maximumItems, maximumPath) &&
    isBoolean(value.network)
  );
}

function isProviderAwareRuntimeSnapshot(value: unknown): value is TeamProtocolProviderAwareJsonObject {
  return (
    isTeamProtocolProviderAwareJsonObject(value) &&
    Array.isArray(value.bots) &&
    value.bots.length <= 100 &&
    value.bots.every(isProviderAwareRuntimeBot) &&
    Array.isArray(value.activeTurns) &&
    value.activeTurns.length <= 100 &&
    value.activeTurns.every(isProviderAwareRuntimeTurn) &&
    Array.isArray(value.work) &&
    value.work.length <= 7 &&
    value.work.every(isProviderAwareRuntimeWork) &&
    Array.isArray(value.latestMessages) &&
    value.latestMessages.length <= 100 &&
    value.latestMessages.every(isProviderAwareRuntimeMessage) &&
    isBoolean(value.attentionComplete) &&
    Array.isArray(value.pendingPrompts) &&
    value.pendingPrompts.length <= 4 &&
    value.pendingPrompts.every(isProviderAwareRuntimePrompt) &&
    Array.isArray(value.pendingApprovals) &&
    value.pendingApprovals.length <= 4 &&
    value.pendingApprovals.every((approval) => isProviderAwareApproval(approval, true)) &&
    Array.isArray(value.pendingBrowserTakeovers) &&
    value.pendingBrowserTakeovers.length <= 4 &&
    value.pendingBrowserTakeovers.every(isProviderAwareBrowserTakeover) &&
    value.pendingPrompts.length + value.pendingApprovals.length + value.pendingBrowserTakeovers.length <= 4 &&
    Array.isArray(value.failedTurns) &&
    value.failedTurns.length <= 100 &&
    value.failedTurns.every(isProviderAwareFailedTurn)
  );
}

function isProviderAwareRuntimeBot(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.name, 80) &&
    isBoolean(value.notifications) &&
    isProviderAwareBoundedString(value.preview, 240) &&
    (value.updatedAt === null || isProviderAwareBoundedString(value.updatedAt, 160)) &&
    isString(value.avatarSeed) &&
    /^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) &&
    (value.avatarHue === null ||
      isProviderAwareOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
    (value.avatarUrl === null || isProviderAwareBoundedString(value.avatarUrl, 2_048))
  );
}

function isProviderAwareRuntimeTurn(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.turnId)
  );
}

function isProviderAwareFailedTurn(value: unknown): boolean {
  return isDynamicRecord(value) && isProviderAwareIdentifier(value.botId) && isProviderAwareIdentifier(value.turnId);
}

function isProviderAwareRuntimeWork(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.botId) &&
    (value.turnId === null || isProviderAwareIdentifier(value.turnId)) &&
    isProviderAwareOneOf(["starting", "running", "failed"], value.status) &&
    isProviderAwareBoundedString(value.text, 240) &&
    isProviderAwareNullableString(value.error, 240)
  );
}

function isProviderAwareRuntimeMessage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.text, 240) &&
    isProviderAwareBoundedString(value.createdAt, 160)
  );
}

function isProviderAwareRuntimePrompt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareRequestId(value.requestId) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.turnId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= 32 &&
    value.questions.every(isProviderAwareRuntimePromptQuestion)
  );
}

function isProviderAwareRuntimePromptQuestion(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.header, 80) &&
    isProviderAwareBoundedString(value.question, 240) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= 5 &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isProviderAwareBoundedString(option.label, 120) &&
            isProviderAwareBoundedString(option.description, 120),
        )))
  );
}

function isProviderAwareQueueStatus(value: unknown): boolean {
  return isProviderAwareOneOf(
    ["queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"],
    value,
  );
}

function isProviderAwareQueuePosition(value: unknown): boolean {
  return value === null || (isNumber(value) && Number.isInteger(value) && value >= 1);
}

function isProviderAwareRevision(value: unknown): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isProviderAwareRequestId(value: unknown): value is string | number {
  return isNumber(value) || isProviderAwareIdentifier(value);
}

function isProviderAwareIdentifierList(value: unknown, limit: number): boolean {
  return Array.isArray(value) && value.length <= limit && value.every(isProviderAwareIdentifier);
}

function isProviderAwareStringList(value: unknown, count: number, length: number): boolean {
  return (
    Array.isArray(value) && value.length <= count && value.every((item) => isProviderAwareBoundedString(item, length))
  );
}

function isProviderAwareNullableString(value: unknown, limit: number): boolean {
  return value === null || isProviderAwareBoundedString(value, limit);
}

function isProviderAwareBoundedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length <= limit;
}

function isProviderAwareOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value);
}

function isTeamProtocolProviderAwarePresenceSnapshot(
  value: unknown,
): value is TeamProtocolProviderAwarePresenceSnapshot {
  return (
    isDynamicRecord(value) &&
    (value.serverId === null || isProviderAwareIdentifier(value.serverId)) &&
    Array.isArray(value.members) &&
    value.members.length <= 100 &&
    value.members.every(isTeamProtocolProviderAwarePresenceMember) &&
    isProviderAwareTimestamp(value.updatedAt)
  );
}

function isTeamProtocolProviderAwarePresenceMember(value: unknown): value is TeamProtocolProviderAwarePresenceMember {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareLimitedString(value.username, 254) &&
    (value.email === null || isProviderAwareLimitedString(value.email, 254)) &&
    (value.name === null || isProviderAwareLimitedString(value.name, 120)) &&
    (value.avatarUrl === undefined || value.avatarUrl === null || isProviderAwareHttpUrl(value.avatarUrl, 2_048)) &&
    (value.role === "owner" || value.role === "admin" || value.role === "member") &&
    isProviderAwareTimestamp(value.createdAt) &&
    isBoolean(value.disabled) &&
    isBoolean(value.online) &&
    (value.typingBotId === null || isProviderAwareIdentifier(value.typingBotId))
  );
}

function isTeamProtocolProviderAwareDirectMessage(value: unknown): value is TeamProtocolProviderAwareDirectMessage {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.senderMemberId) &&
    isProviderAwareIdentifier(value.recipientMemberId) &&
    value.senderMemberId !== value.recipientMemberId &&
    isProviderAwareLimitedString(value.text, 20_000) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isNumber(value.sequence) &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0
  );
}

function isProviderAwareIdentifier(value: unknown): value is string {
  return isProviderAwareLimitedString(value, 128);
}

function isProviderAwareTimestamp(value: unknown): value is string {
  return isProviderAwareLimitedString(value, 64) && Number.isFinite(Date.parse(value));
}

function isProviderAwareHttpUrl(value: unknown, limit: number): value is string {
  if (!isProviderAwareLimitedString(value, limit)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isProviderAwareLimitedString(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

export function encodeTeamProtocolProviderAwareClientEvent(event: TeamProtocolProviderAwareClientEvent): string {
  return JSON.stringify(event);
}

export function decodeTeamProtocolProviderAwareClientEvent(value: unknown): TeamProtocolProviderAwareClientEvent {
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
    const event: Extract<TeamProtocolProviderAwareClientEvent, { type: "agent-event-scope" }> = {
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

export function isTeamProtocolProviderAwareCapability(value: string): value is TeamProtocolProviderAwareCapability {
  return TEAM_PROTOCOL_ProviderAware_CAPABILITY_SET.has(value);
}

export interface TeamProtocolSupportProviderAware {
  appVersion: string;
  protocol: {
    minimum: number;
    maximum: number;
  };
  capabilities: string[];
}

export function decodeTeamProtocolSupportProviderAware(value: unknown): TeamProtocolSupportProviderAware {
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
  local: TeamProtocolSupportProviderAware["protocol"],
  remote: TeamProtocolSupportProviderAware["protocol"],
): number | null {
  const minimum = Math.max(local.minimum, remote.minimum);
  const maximum = Math.min(local.maximum, remote.maximum);
  return minimum <= maximum ? maximum : null;
}

export function teamProtocolUpdateDirection(
  local: TeamProtocolSupportProviderAware["protocol"],
  remote: TeamProtocolSupportProviderAware["protocol"],
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

export type TeamProtocolProviderAwareHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

type TeamProtocolProviderAwareHttpPayloadKind = "array" | "nullable-object" | "object";

interface TeamProtocolProviderAwareHttpContract {
  request: "none" | "object";
  response: TeamProtocolProviderAwareHttpPayloadKind;
}

// This registry is the frozen v1 HTTP surface. A new route or a changed payload must use a new protocol.
const TEAM_PROTOCOL_ProviderAware_HTTP_CONTRACTS = {
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
} as const satisfies Record<string, TeamProtocolProviderAwareHttpContract>;

type TeamProtocolProviderAwareHttpRoute = keyof typeof TEAM_PROTOCOL_ProviderAware_HTTP_CONTRACTS;

const ProviderAware_MEMBER_KEYS = [
  "id",
  "username",
  "email",
  "name",
  "avatarUrl",
  "role",
  "createdAt",
  "disabled",
] as const;
const ProviderAware_BOT_KEYS = [
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
const ProviderAware_DIRECT_MESSAGE_KEYS = [
  "id",
  "threadId",
  "senderMemberId",
  "recipientMemberId",
  "text",
  "createdAt",
  "sequence",
] as const;
const ProviderAware_BROWSER_TAB_KEYS = ["id", "title", "url", "loading", "ownerThreadId", "ownerBotId"] as const;

const TEAM_PROTOCOL_ProviderAware_HTTP_REQUEST_KEYS = {
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
} as const satisfies Partial<Record<TeamProtocolProviderAwareHttpRoute, readonly string[]>>;

const TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS = {
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
  "GET me": ProviderAware_MEMBER_KEYS,
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
  "POST direct-message": ProviderAware_DIRECT_MESSAGE_KEYS,
  "GET direct-conversation": ["threadId", "otherMemberId", "messages", "revision", "readState"],
  "GET direct-conversation-page": ["threadId", "otherMemberId", "messages", "revision", "pageInfo", "readState"],
  "POST direct-conversation-read": ["unreadCount", "firstUnreadMessageId", "throughSequence"],
  "GET browser-tabs": ProviderAware_BROWSER_TAB_KEYS,
  "GET browser-control": ["sessions"],
  "POST browser-open": ProviderAware_BROWSER_TAB_KEYS,
  "POST browser-preview": ["dataUrl", "width", "height"],
  "POST attachment-upload": ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"],
  "GET team-members": ProviderAware_MEMBER_KEYS,
  "PATCH team-member": ProviderAware_MEMBER_KEYS,
  "POST team-invites": ["id", "role", "expiresAt", "usedAt", "inviteUrl", "email"],
  "GET team-invites": ["id", "role", "expiresAt", "usedAt", "email"],
  "GET team-sessions": ["id", "memberId", "username", "createdAt", "expiresAt"],
  "GET agent-status": ["phase", "cliVersion", "auth", "providers", "capabilities", "message", "fullAccess"],
  "GET sidebar-layout": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "POST sidebar-action": ["revision", "sections", "order", "agentAssignments", "agentOrder"],
  "GET agent-usage": ["limits"],
  "GET agent-models": ["provider", "id", "name", "description", "defaultReasoningEffort", "supportedReasoningEfforts"],
  "GET agents": ProviderAware_BOT_KEYS,
  "POST agents": ProviderAware_BOT_KEYS,
  "PATCH agent": ProviderAware_BOT_KEYS,
  "PUT agent-avatar": ProviderAware_BOT_KEYS,
  "DELETE agent-avatar": ProviderAware_BOT_KEYS,
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
} as const satisfies Partial<Record<TeamProtocolProviderAwareHttpRoute, readonly string[]>>;

function decodeTeamProtocolProviderAwareHttpRequest(
  profile: ProviderAwareProfile,
  method: string,
  path: string,
  value: unknown,
): TeamProtocolProviderAwareJsonObject {
  const route = teamProtocolProviderAwareHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP request.");
  const contract = TEAM_PROTOCOL_ProviderAware_HTTP_CONTRACTS[route];
  if (contract.request !== "object" || !isTeamProtocolProviderAwareJsonObject(value)) {
    throw new Error("Invalid Team protocol v1 HTTP request.");
  }
  const projected = projectTeamProtocolProviderAwareHttpRequest(route, value);
  validateTeamProtocolProviderAwareHttpRequest(profile, route, projected);
  return projected;
}

function decodeTeamProtocolProviderAwareHttpResponse(
  profile: ProviderAwareProfile,
  method: string,
  path: string,
  status: number,
  value: unknown,
): TeamProtocolProviderAwareJsonValue {
  if (status >= 400) {
    if (!isTeamProtocolProviderAwareJsonObject(value) || !isString(value.error)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    return projectTeamProtocolProviderAwareError(value);
  }
  const route = teamProtocolProviderAwareHttpRoute(method, path);
  if (!route) throw new Error("Invalid Team protocol v1 HTTP response.");
  const contract = TEAM_PROTOCOL_ProviderAware_HTTP_CONTRACTS[route];
  if (!matchesTeamProtocolProviderAwareHttpShape(contract.response, value)) {
    throw new Error("Invalid Team protocol v1 HTTP response.");
  }
  const projected = projectTeamProtocolProviderAwareHttpResponse(route, value);
  validateTeamProtocolProviderAwareHttpResponse(profile, route, projected);
  return projected;
}

function projectTeamProtocolProviderAwareHttpRequest(
  route: TeamProtocolProviderAwareHttpRoute,
  value: TeamProtocolProviderAwareJsonObject,
): TeamProtocolProviderAwareJsonObject {
  if (!hasTeamProtocolProviderAwareHttpRequestProjection(route)) {
    throw new Error("Team protocol v1 HTTP request projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_ProviderAware_HTTP_REQUEST_KEYS[route];
  const projected = projectProviderAwareObject(value, wireKeys);
  if (route === "POST browser-visible" && isDynamicRecord(projected.bounds)) {
    projected.bounds = projectProviderAwareObject(projected.bounds, ["x", "y", "width", "height"]);
  }
  if ((route === "POST routines" || route === "PATCH routine") && isDynamicRecord(projected.schedule)) {
    projected.schedule = projectProviderAwareRoutineSchedule(projected.schedule);
  }
  return projected;
}

function projectTeamProtocolProviderAwareHttpResponse(
  route: TeamProtocolProviderAwareHttpRoute,
  value: TeamProtocolProviderAwareJsonValue,
): TeamProtocolProviderAwareJsonValue {
  if (route === "GET conversation-reads" && isDynamicRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([botId, state]) => [
        botId,
        isDynamicRecord(state)
          ? projectProviderAwareObject(state, ["unreadCount", "firstUnreadMessageId", "throughMessageId"])
          : null,
      ]),
    );
  }
  if (!hasTeamProtocolProviderAwareHttpResponseProjection(route)) {
    throw new Error("Team protocol v1 HTTP response projection is missing.");
  }
  const wireKeys = TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS[route];
  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected =
        route === "GET agents" ? projectProviderAwareBot(item) : projectProviderAwareObject(item, wireKeys);
      if (route === "GET direct-threads" && isDynamicRecord(projected.lastMessage)) {
        projected.lastMessage = projectProviderAwareObject(projected.lastMessage, ProviderAware_DIRECT_MESSAGE_KEYS);
      } else if (route === "GET agent-usage") {
        return projectProviderAwareUsageLimit(item);
      } else if (route === "GET routines" || route === "GET routine-runs") {
        return projectProviderAwareRoutineValue(projected);
      }
      return projected;
    });
  }
  if (value === null) return null;
  const projected =
    route === "POST agents" || route === "PATCH agent" || route.endsWith("agent-avatar")
      ? projectProviderAwareBot(value)
      : projectProviderAwareObject(value, wireKeys);
  if (["POST join", "POST join-account", "POST auth-login", "POST auth-account"].includes(route)) {
    if (isDynamicRecord(projected.member))
      projected.member = projectProviderAwareObject(projected.member, ProviderAware_MEMBER_KEYS);
  } else if (route === "GET team-presence" && Array.isArray(projected.members)) {
    projected.members = projected.members.map((member) =>
      projectProviderAwareObject(member, [...ProviderAware_MEMBER_KEYS, "online", "typingBotId"]),
    );
  } else if (
    (route === "GET direct-conversation" || route === "GET direct-conversation-page") &&
    Array.isArray(projected.messages)
  ) {
    projected.messages = projected.messages.map((message) =>
      projectProviderAwareObject(message, ProviderAware_DIRECT_MESSAGE_KEYS),
    );
    if (isDynamicRecord(projected.readState))
      projected.readState = projectProviderAwareDirectReadState(projected.readState);
    if (isDynamicRecord(projected.pageInfo)) projected.pageInfo = projectProviderAwarePageInfo(projected.pageInfo);
  } else if (route === "GET compatibility" && isDynamicRecord(projected.protocol)) {
    projected.protocol = projectProviderAwareObject(projected.protocol, ["minimum", "maximum"]);
  } else if (route === "GET agent-status") {
    if (isDynamicRecord(projected.auth)) {
      projected.auth = projectProviderAwareObject(projected.auth, ["kind", "accountType", "email"]);
    }
    if (Array.isArray(projected.providers)) {
      projected.providers = projected.providers.map(projectProviderAwareProviderStatus);
    }
    if (isDynamicRecord(projected.capabilities)) {
      projected.capabilities = projectProviderAwareObject(projected.capabilities, ["chat", "browser", "computerUse"]);
    }
  } else if (route === "GET agent-usage" && Array.isArray(projected.limits)) {
    projected.limits = projected.limits.map(projectProviderAwareUsageLimit);
  } else if (route === "GET sidebar-layout" || route === "POST sidebar-action") {
    return projectProviderAwareSidebarLayout(projected);
  } else if (route === "GET remote-capabilities" && Array.isArray(projected.displays)) {
    projected.displays = projected.displays.map(projectProviderAwareRemoteDisplay);
  } else if (route === "POST remote-session") {
    if (Array.isArray(projected.displays))
      projected.displays = projected.displays.map(projectProviderAwareRemoteDisplay);
  } else if (route === "GET browser-control") {
    return projectProviderAwareBrowserControl(projected);
  } else if (route === "POST routines" || route === "PATCH routine" || route === "POST routine-test") {
    return projectProviderAwareRoutineValue(projected);
  } else if (route === "GET conversation") {
    return projectProviderAwareConversation(projected, false, true);
  } else if (route === "GET conversation-page") {
    return projectProviderAwareConversation(projected, true);
  } else if (route === "GET message-search") {
    return projectProviderAwareConversationSearch(projected);
  } else if (route === "GET queue") {
    return projectProviderAwareQueueSnapshot(projected);
  } else if (route === "POST messages") {
    return projectProviderAwareQueuedMessageReceipt(projected);
  }
  return projected;
}

function hasTeamProtocolProviderAwareHttpRequestProjection(
  route: TeamProtocolProviderAwareHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_ProviderAware_HTTP_REQUEST_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_ProviderAware_HTTP_REQUEST_KEYS, route);
}

function hasTeamProtocolProviderAwareHttpResponseProjection(
  route: TeamProtocolProviderAwareHttpRoute,
): route is keyof typeof TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS {
  return Object.hasOwn(TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS, route);
}

const ProviderAware_HTTP_ERROR_CODES = new Set([
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

function projectTeamProtocolProviderAwareError(
  value: TeamProtocolProviderAwareJsonObject,
): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ["error", "code", "host", "client"]);
  if (!isProviderAwareBoundedString(projected.error, 100_000))
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  if (
    projected.code !== undefined &&
    (!isString(projected.code) || !ProviderAware_HTTP_ERROR_CODES.has(projected.code))
  ) {
    throw new Error("Invalid Team protocol v1 HTTP error response.");
  }
  if (projected.host !== undefined) {
    if (!isDynamicRecord(projected.host)) throw new Error("Invalid Team protocol v1 HTTP error response.");
    const host = projectProviderAwareObject(projected.host, ["appVersion", "protocol", "capabilities"]);
    if (isDynamicRecord(host.protocol))
      host.protocol = projectProviderAwareObject(host.protocol, ["minimum", "maximum"]);
    try {
      const decoded = decodeTeamProtocolSupportProviderAware(host);
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
    const client = projectProviderAwareObject(projected.client, ["appVersion", "protocol"]);
    if (!isProviderAwareBoundedString(client.appVersion, 64) || !isProtocolVersion(client.protocol)) {
      throw new Error("Invalid Team protocol v1 HTTP error response.");
    }
    projected.client = client;
  }
  return projected;
}

function projectProviderAwareBot(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ProviderAware_BOT_KEYS);
  if (isDynamicRecord(projected.marketplaceSource)) {
    projected.marketplaceSource = projectProviderAwareObject(projected.marketplaceSource, [
      "agentId",
      "versionId",
      "version",
      "skillIds",
      "routineIds",
    ]);
  }
  return projected;
}

function projectProviderAwareSidebarLayout(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(
    value,
    TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET sidebar-layout"],
  );
  if (Array.isArray(projected.sections)) {
    projected.sections = projected.sections.map((section) => projectProviderAwareObject(section, ["id", "name"]));
  }
  return projected;
}

function projectProviderAwareConversation(
  value: unknown,
  page: boolean,
  includeReadState = true,
): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(
    value,
    page
      ? TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET conversation-page"]
      : TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET conversation"],
  );
  if (Array.isArray(projected.messages))
    projected.messages = projected.messages.map(projectProviderAwareConversationMessage);
  if (!includeReadState) delete projected.readState;
  else if (isDynamicRecord(projected.readState))
    projected.readState = projectProviderAwareConversationReadState(projected.readState);
  if (page && isDynamicRecord(projected.references)) {
    projected.references = Object.fromEntries(
      Object.entries(projected.references).map(([id, message]) => [
        id,
        projectProviderAwareConversationMessage(message),
      ]),
    );
  }
  if (page && isDynamicRecord(projected.pageInfo))
    projected.pageInfo = projectProviderAwarePageInfo(projected.pageInfo);
  return projected;
}

function projectProviderAwareConversationMessage(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, [
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
  if (Array.isArray(projected.attachments))
    projected.attachments = projected.attachments.map(projectProviderAwareAttachment);
  if (isDynamicRecord(projected.delivery)) {
    projected.delivery = projectProviderAwareObject(projected.delivery, ["id", "status", "position"]);
  }
  if (isDynamicRecord(projected.exchange)) projected.exchange = projectProviderAwareExchange(projected.exchange);
  if (Array.isArray(projected.reactions)) projected.reactions = projected.reactions.map(projectProviderAwareReaction);
  if (isDynamicRecord(projected.routine)) {
    projected.routine = projectProviderAwareObject(projected.routine, ["routineId", "runId", "name", "scheduledFor"]);
  }
  if (isDynamicRecord(projected.imageGeneration)) {
    projected.imageGeneration = projectProviderAwareObject(projected.imageGeneration, [
      "prompt",
      "resolution",
      "aspectRatio",
      "error",
    ]);
  }
  if (isDynamicRecord(projected.questionPrompt)) {
    projected.questionPrompt = projectProviderAwareConversationQuestionPrompt(projected.questionPrompt);
  }
  return projected;
}

function projectProviderAwareExchange(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, [
    "direction",
    "messageId",
    "senderBotId",
    "recipientBotIds",
    "replyToMessageId",
    "deliveries",
  ]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectProviderAwareObject(delivery, ["id", "recipientBotId", "status", "position", "error"]),
    );
  }
  return projected;
}

function projectProviderAwareReaction(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ["emoji", "actor"]);
  if (isDynamicRecord(projected.actor))
    projected.actor = projectProviderAwareObject(projected.actor, ["kind", "botId"]);
  return projected;
}

function projectProviderAwareConversationQuestionPrompt(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ["requestId", "questions", "resolution"]);
  if (Array.isArray(projected.questions))
    projected.questions = projected.questions.map(projectProviderAwarePromptQuestion);
  if (isDynamicRecord(projected.resolution)) {
    const resolution = projectProviderAwareObject(projected.resolution, ["status", "responses"]);
    if (isDynamicRecord(resolution.responses)) {
      resolution.responses = Object.fromEntries(
        Object.entries(resolution.responses).map(([id, response]) => [
          id,
          projectProviderAwareObject(response, ["status", "answers"]),
        ]),
      );
    }
    projected.resolution = resolution;
  }
  return projected;
}

function projectProviderAwarePromptQuestion(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ["id", "header", "question", "isSecret", "options"]);
  if (Array.isArray(projected.options)) {
    projected.options = projected.options.map((option) => projectProviderAwareObject(option, ["label", "description"]));
  }
  return projected;
}

function projectProviderAwareConversationReadState(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["unreadCount", "firstUnreadMessageId", "throughMessageId"]);
}

function projectProviderAwareDirectReadState(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["unreadCount", "firstUnreadMessageId", "throughSequence"]);
}

function projectProviderAwarePageInfo(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["hasOlder", "olderCursor"]);
}

function projectProviderAwareQueueSnapshot(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET queue"]);
  if (Array.isArray(projected.deliveries))
    projected.deliveries = projected.deliveries.map(projectProviderAwareQueueDelivery);
  return projected;
}

function projectProviderAwareQueueDelivery(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, [
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
    projected.sender = projectProviderAwareObject(projected.sender, [
      "kind",
      "botId",
      "routineId",
      "runId",
      "routineName",
      "scheduledFor",
    ]);
  }
  if (Array.isArray(projected.attachments))
    projected.attachments = projected.attachments.map(projectProviderAwareAttachment);
  return projected;
}

function projectProviderAwareAttachment(value: unknown): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["id", "name", "size", "kind", "mimeType", "previewKind", "previewUrl"]);
}

function projectProviderAwareBrowserTakeover(value: unknown): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["requestId", "botId", "threadId", "turnId", "tabId"]);
}

function projectProviderAwareApproval(value: unknown, runtime: boolean): TeamProtocolProviderAwareJsonObject {
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
  const projected = projectProviderAwareObject(value, runtime ? [...keys, "truncated"] : keys);
  if (isDynamicRecord(projected.permissions)) {
    const permissions = projectProviderAwareObject(projected.permissions, ["fileSystem", "network"]);
    if (isDynamicRecord(permissions.fileSystem)) {
      permissions.fileSystem = projectProviderAwareObject(permissions.fileSystem, ["read", "write"]);
    }
    projected.permissions = permissions;
  }
  return projected;
}

function projectProviderAwareRuntimeSnapshot(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, [
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
      projectProviderAwareObject(bot, [
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
      projectProviderAwareObject(turn, ["botId", "threadId", "turnId"]),
    );
  }
  if (Array.isArray(projected.work)) {
    projected.work = projected.work.map((work) =>
      projectProviderAwareObject(work, ["id", "botId", "turnId", "status", "text", "error"]),
    );
  }
  if (Array.isArray(projected.latestMessages)) {
    projected.latestMessages = projected.latestMessages.map((message) =>
      projectProviderAwareObject(message, ["botId", "id", "text", "createdAt"]),
    );
  }
  if (Array.isArray(projected.pendingPrompts)) {
    projected.pendingPrompts = projected.pendingPrompts.map((prompt) => {
      const item = projectProviderAwareObject(prompt, ["requestId", "botId", "threadId", "turnId", "questions"]);
      if (Array.isArray(item.questions)) item.questions = item.questions.map(projectProviderAwarePromptQuestion);
      return item;
    });
  }
  if (Array.isArray(projected.pendingApprovals)) {
    projected.pendingApprovals = projected.pendingApprovals.map((approval) =>
      projectProviderAwareApproval(approval, true),
    );
  }
  if (Array.isArray(projected.pendingBrowserTakeovers)) {
    projected.pendingBrowserTakeovers = projected.pendingBrowserTakeovers.map(projectProviderAwareBrowserTakeover);
  }
  if (Array.isArray(projected.failedTurns)) {
    projected.failedTurns = projected.failedTurns.map((turn) => projectProviderAwareObject(turn, ["botId", "turnId"]));
  }
  return projected;
}

function projectProviderAwareBrowserControl(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(
    value,
    TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET browser-control"],
  );
  if (Array.isArray(projected.sessions)) {
    projected.sessions = projected.sessions.map((session) =>
      projectProviderAwareObject(session, [
        "id",
        "threadId",
        "turnId",
        "callId",
        "tabId",
        "action",
        "phase",
        "startedAt",
      ]),
    );
  }
  return projected;
}

function projectProviderAwareRemoteDisplay(value: unknown): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, ["id", "label", "width", "height", "primary"]);
}

function projectProviderAwareConversationSearch(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(
    value,
    TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["GET message-search"],
  );
  if (Array.isArray(projected.results)) {
    projected.results = projected.results.map((result) => {
      const item = projectProviderAwareObject(result, ["botId", "message"]);
      if (isDynamicRecord(item.message)) item.message = projectProviderAwareConversationMessage(item.message);
      return item;
    });
  }
  return projected;
}

function projectProviderAwareQueuedMessageReceipt(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, TEAM_PROTOCOL_ProviderAware_HTTP_RESPONSE_KEYS["POST messages"]);
  if (Array.isArray(projected.deliveries)) {
    projected.deliveries = projected.deliveries.map((delivery) =>
      projectProviderAwareObject(delivery, ["id", "recipientBotId", "status", "position"]),
    );
  }
  return projected;
}

function projectProviderAwareProviderStatus(value: unknown): TeamProtocolProviderAwareJsonObject {
  return projectProviderAwareObject(value, [
    "id",
    "state",
    "version",
    "message",
    "email",
    "connectionState",
    "checkError",
  ]);
}

function projectProviderAwareUsageLimit(value: unknown): TeamProtocolProviderAwareJsonObject {
  const projected = projectProviderAwareObject(value, ["id", "primary", "secondary"]);
  for (const key of ["primary", "secondary"] as const) {
    if (isDynamicRecord(projected[key])) {
      projected[key] = projectProviderAwareObject(projected[key], ["usedPercent", "windowDurationMins", "resetsAt"]);
    }
  }
  return projected;
}

function projectProviderAwareRoutineValue(
  value: TeamProtocolProviderAwareJsonObject,
): TeamProtocolProviderAwareJsonObject {
  const projected = { ...value };
  const trigger = projected.trigger;
  if (isDynamicRecord(trigger)) {
    const projectedTrigger = projectProviderAwareObject(trigger, [
      "id",
      "routineId",
      "schedule",
      "nextRunAt",
      "createdAt",
      "updatedAt",
    ]);
    if (isDynamicRecord(projectedTrigger.schedule)) {
      projectedTrigger.schedule = projectProviderAwareRoutineSchedule(projectedTrigger.schedule);
    }
    projected.trigger = projectedTrigger;
  }
  return projected;
}

function projectProviderAwareObject(value: unknown, wireKeys: readonly string[]): TeamProtocolProviderAwareJsonObject {
  if (!isDynamicRecord(value)) return {};
  const projected: TeamProtocolProviderAwareJsonObject = {};
  for (const key of wireKeys) {
    const item = value[key];
    if (item !== undefined && isTeamProtocolProviderAwareJsonValue(item)) projected[key] = item;
  }
  return projected;
}

function projectProviderAwareRoutineSchedule(value: DynamicRecord): TeamProtocolProviderAwareJsonObject {
  const common = ["kind"];
  switch (value.kind) {
    case "hourly":
      return projectProviderAwareObject(value, [...common, "minute"]);
    case "daily":
    case "weekdays":
      return projectProviderAwareObject(value, [...common, "time"]);
    case "weekly":
      return projectProviderAwareObject(value, [...common, "weekday", "time"]);
    case "monthly":
      return projectProviderAwareObject(value, [...common, "day", "time"]);
    case "interval":
      return projectProviderAwareObject(value, [...common, "amount", "unit", "anchorAt"]);
    case "advanced":
      return projectProviderAwareObject(value, [...common, "months", "days", "time"]);
    case "custom":
      return projectProviderAwareObject(value, [...common, "expression"]);
    default:
      return projectProviderAwareObject(value, common);
  }
}

// Exported for the shared route table's coverage case in `src/main/team-api-server.test.ts`. The host
// encodes every JSON response through this adapter, so a path `TEAM_API_ROUTES` builds that this
// frozen list cannot name is a route no client can be answered on. Classification only: it reads the
// list below and decides nothing, so exporting it leaves every released response meaning what it did.
export function teamProtocolProviderAwareHttpRoute(
  method: string,
  path: string,
): TeamProtocolProviderAwareHttpRoute | null {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  const exact: Record<string, TeamProtocolProviderAwareHttpRoute> = {
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

function matchesTeamProtocolProviderAwareHttpShape(
  payloadKind: TeamProtocolProviderAwareHttpPayloadKind,
  value: unknown,
): value is TeamProtocolProviderAwareJsonValue {
  if (payloadKind === "array") return Array.isArray(value) && value.every(isTeamProtocolProviderAwareJsonValue);
  if (payloadKind === "nullable-object" && value === null) return true;
  return isTeamProtocolProviderAwareJsonObject(value);
}

function validateTeamProtocolProviderAwareHttpRequest(
  profile: ProviderAwareProfile,
  route: TeamProtocolProviderAwareHttpRoute,
  value: TeamProtocolProviderAwareJsonObject,
): void {
  let valid = false;
  switch (route) {
    case "POST invitation-preview":
      valid = isProviderAwareIdentifier(value.inviteToken);
      break;
    case "POST join":
      valid =
        isProviderAwareIdentifier(value.inviteToken) &&
        isProviderAwareLimitedString(value.username, 64) &&
        isProviderAwareLimitedString(value.password, 256);
      break;
    case "POST join-account":
      valid = isProviderAwareIdentifier(value.inviteToken) && isProviderAwareIdentifier(value.accountTicket);
      break;
    case "POST auth-login":
      valid = isProviderAwareLimitedString(value.username, 64) && isProviderAwareLimitedString(value.password, 256);
      break;
    case "POST auth-account":
      valid = isProviderAwareIdentifier(value.accountTicket);
      break;
    case "POST auth-password":
      valid =
        isProviderAwareLimitedString(value.currentPassword, 256) &&
        isProviderAwareLimitedString(value.newPassword, 256);
      break;
    case "POST remote-session":
      valid = Object.keys(value).length === 0;
      break;
    case "PUT remote-display":
      valid = isProviderAwareIdentifier(value.displayId);
      break;
    case "POST direct-message":
      valid =
        isProviderAwareIdentifier(value.memberId) &&
        isProviderAwareLimitedString(value.text, 20_000) &&
        isProviderAwareIdentifier(value.clientMessageId);
      break;
    case "POST direct-conversation-read":
      valid = isProviderAwareNonNegativeInteger(value.throughSequence);
      break;
    case "POST browser-open":
      valid =
        isProviderAwareHttpUrl(value.url, 8_192) &&
        isProviderAwareOptionalNullableIdentifier(value.ownerThreadId) &&
        isProviderAwareOptionalNullableIdentifier(value.ownerBotId) &&
        (value.focus === undefined || isBoolean(value.focus));
      break;
    case "POST browser-activate":
    case "POST browser-reload":
    case "POST browser-close":
    case "POST browser-preview":
      valid = isProviderAwareIdentifier(value.tabId);
      break;
    case "POST browser-navigate":
      valid = isProviderAwareIdentifier(value.tabId) && isProviderAwareOneOf(["back", "forward"], value.direction);
      break;
    case "POST browser-visible":
      valid = isBoolean(value.visible) && (value.bounds === undefined || isProviderAwareBrowserBounds(value.bounds));
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
        (value.email === undefined || isProviderAwareLimitedString(value.email, 254));
      break;
    case "POST sidebar-action":
      valid = isProviderAwareSidebarAction(value);
      break;
    case "POST agents":
      valid =
        isProviderAwareLimitedString(value.name, 80) &&
        isProviderAwareBoundedString(value.description, 2_000) &&
        isString(value.avatarSeed) &&
        (value.avatarHue === null ||
          isProviderAwareOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue)) &&
        isProviderAwareBoundedString(value.initialMessage, 100_000);
      break;
    case "PATCH agent":
      valid = isProviderAwareBotUpdate(profile, value);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isProviderAwareBoundedString(value.text, 20_000);
      break;
    case "POST routines":
      valid = isProviderAwareRoutineMutation(value, true);
      break;
    case "PATCH routine":
      valid = isProviderAwareRoutineMutation(value, false);
      break;
    case "POST conversation-read":
      valid = value.throughMessageId === null || isProviderAwareIdentifier(value.throughMessageId);
      break;
    case "POST messages":
      valid =
        isProviderAwareBoundedString(value.text, 100_000) &&
        (value.attachmentDraftIds === undefined || isProviderAwareIdentifierList(value.attachmentDraftIds, 10)) &&
        isProviderAwareOptionalNullableIdentifier(value.replyToMessageId);
      break;
    case "POST failure-acknowledge":
    case "POST interrupt":
      valid = isProviderAwareIdentifier(value.turnId);
      break;
    case "POST reaction":
      valid =
        isProviderAwareIdentifier(value.messageId) &&
        (value.emoji === null || isProviderAwareBoundedString(value.emoji, 32));
      break;
    case "POST queue-cancel":
      valid = isProviderAwareIdentifier(value.deliveryId);
      break;
    case "POST queue-steer":
      valid = isProviderAwareIdentifier(value.deliveryId) && isProviderAwareIdentifier(value.expectedTurnId);
      break;
    case "POST queue-update":
      valid =
        isProviderAwareIdentifier(value.deliveryId) &&
        isProviderAwareBoundedString(value.text, 100_000) &&
        isProviderAwareIdentifierList(value.keepAttachmentIds, 10) &&
        isProviderAwareIdentifierList(value.attachmentDraftIds, 10);
      break;
    case "POST queue-reorder":
      valid = isProviderAwareIdentifierList(value.deliveryIds, 100);
      break;
    case "POST prompt-response":
      valid = isProviderAwareRequestId(value.requestId) && isProviderAwarePromptAnswers(value.answers);
      break;
    case "POST approval-response":
      valid = isProviderAwareRequestId(value.requestId) && isProviderAwareOneOf(["accept", "decline"], value.decision);
      break;
    case "POST browser-takeover-response":
      valid = isProviderAwareRequestId(value.requestId) && isProviderAwareOneOf(["complete", "cancel"], value.decision);
      break;
    default:
      valid = TEAM_PROTOCOL_ProviderAware_HTTP_CONTRACTS[route].request === "none";
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP request.");
}

function validateTeamProtocolProviderAwareHttpResponse(
  profile: ProviderAwareProfile,
  route: TeamProtocolProviderAwareHttpRoute,
  value: TeamProtocolProviderAwareJsonValue,
): void {
  let valid = false;
  switch (route) {
    case "GET compatibility":
      try {
        decodeTeamProtocolSupportProviderAware(value);
        valid = true;
      } catch {
        valid = false;
      }
      break;
    case "GET identity":
      valid = value === null || isProviderAwareIdentity(value);
      break;
    case "POST invitation-preview":
      valid = isProviderAwareInvitePreview(value);
      break;
    case "POST join":
    case "POST join-account":
    case "POST auth-login":
    case "POST auth-account":
      valid = isProviderAwareJoinResult(value);
      break;
    case "GET me":
    case "PATCH team-member":
      valid = isProviderAwareTeamMember(value);
      break;
    case "GET team-presence":
      valid = isTeamProtocolProviderAwarePresenceSnapshot(value);
      break;
    case "GET remote-capabilities":
      valid = isProviderAwareRemoteCapabilities(value);
      break;
    case "POST remote-session":
      valid = isProviderAwareRemoteSession(value);
      break;
    case "GET direct-threads":
      valid = Array.isArray(value) && value.every(isProviderAwareDirectThread);
      break;
    case "POST direct-message":
      valid = isTeamProtocolProviderAwareDirectMessage(value);
      break;
    case "GET direct-conversation":
      valid = isProviderAwareDirectConversation(value, false);
      break;
    case "GET direct-conversation-page":
      valid = isProviderAwareDirectConversation(value, true);
      break;
    case "POST direct-conversation-read":
      valid = isProviderAwareDirectReadState(value);
      break;
    case "GET browser-tabs":
      valid = Array.isArray(value) && value.every(isProviderAwareBrowserTab);
      break;
    case "GET browser-control":
      valid = isProviderAwareBrowserControl(value);
      break;
    case "POST browser-open":
      valid = isProviderAwareBrowserTab(value);
      break;
    case "POST browser-preview":
      valid = isProviderAwareBrowserPreview(value);
      break;
    case "POST attachment-upload":
      valid = isProviderAwareAttachment(value);
      break;
    case "GET team-members":
      valid = Array.isArray(value) && value.every(isProviderAwareTeamMember);
      break;
    case "POST team-invites":
      valid = isProviderAwareTeamInvite(value, true);
      break;
    case "GET team-invites":
      valid = Array.isArray(value) && value.every((invite) => isProviderAwareTeamInvite(invite, false));
      break;
    case "GET team-sessions":
      valid = Array.isArray(value) && value.every(isProviderAwareTeamSession);
      break;
    case "GET agent-status":
      valid = isProviderAwareAgentStatus(profile, value);
      break;
    case "GET sidebar-layout":
    case "POST sidebar-action":
      valid = isProviderAwareSidebarLayout(value);
      break;
    case "GET agent-usage":
      valid = isProviderAwareAccountUsage(value);
      break;
    case "GET agent-models":
      valid = Array.isArray(value) && value.every((option) => isProviderAwareAgentModelOption(profile, option));
      break;
    case "GET agents":
      valid = Array.isArray(value) && value.every((bot) => isProviderAwareBotSummary(profile, bot));
      break;
    case "POST agents":
    case "PATCH agent":
    case "PUT agent-avatar":
    case "DELETE agent-avatar":
      valid = isProviderAwareBotSummary(profile, value);
      break;
    case "GET conversation-reads":
      valid = isProviderAwareConversationReadStates(value);
      break;
    case "GET memories":
      valid = Array.isArray(value) && value.every(isProviderAwareMemory);
      break;
    case "POST memories":
    case "PATCH memory":
      valid = isProviderAwareMemory(value);
      break;
    case "GET routines":
      valid = Array.isArray(value) && value.every(isProviderAwareRoutine);
      break;
    case "POST routines":
    case "PATCH routine":
      valid = isProviderAwareRoutine(value);
      break;
    case "POST routine-test":
      valid = isProviderAwareRoutineRun(value);
      break;
    case "GET routine-runs":
      valid = Array.isArray(value) && value.every(isProviderAwareRoutineRun);
      break;
    case "GET conversation":
      valid = isProviderAwareConversationSnapshot(value) && isProviderAwareConversationReadState(value.readState);
      break;
    case "GET conversation-page":
      valid = isProviderAwareConversationPage(value);
      break;
    case "GET message-search":
      valid = isProviderAwareConversationSearch(value);
      break;
    case "POST conversation-read":
      valid = isProviderAwareConversationReadState(value);
      break;
    case "POST messages":
      valid = isProviderAwareQueuedMessageReceipt(value);
      break;
    case "GET queue":
      valid = isProviderAwareQueueSnapshot(value);
      break;
    default:
      valid = false;
  }
  if (!valid) throw new Error("Invalid Team protocol v1 HTTP response.");
}

function isProviderAwareIdentity(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.serverId) &&
    isProviderAwareLimitedString(value.serverName, 120) &&
    isProviderAwareLimitedString(value.fingerprint, 256) &&
    isProviderAwareBoundedString(value.publicKey, 8_192) &&
    isBoolean(value.enabledOnLaunch) &&
    (value.logoVersion === null || isProviderAwareIdentifier(value.logoVersion)) &&
    (value.challenge === undefined || isProviderAwareBoundedString(value.challenge, 256)) &&
    (value.signature === undefined || isProviderAwareBoundedString(value.signature, 512))
  );
}

function isProviderAwareInvitePreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareOneOf(["admin", "member"], value.role) &&
    isProviderAwareTimestamp(value.expiresAt) &&
    isBoolean(value.emailBound)
  );
}

function isProviderAwareJoinResult(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareTeamMember(value.member) &&
    isProviderAwareLimitedString(value.sessionToken, 512) &&
    isProviderAwareTimestamp(value.sessionExpiresAt)
  );
}

function isProviderAwareTeamMember(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareLimitedString(value.username, 254) &&
    (value.email === null || isProviderAwareLimitedString(value.email, 254)) &&
    (value.name === null || isProviderAwareLimitedString(value.name, 120)) &&
    (value.avatarUrl === null || isProviderAwareHttpUrl(value.avatarUrl, 2_048)) &&
    isProviderAwareOneOf(["owner", "admin", "member"], value.role) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isBoolean(value.disabled)
  );
}

function isProviderAwareRemoteDisplay(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareLimitedString(value.label, 160) &&
    isProviderAwarePositiveInteger(value.width) &&
    isProviderAwarePositiveInteger(value.height) &&
    isBoolean(value.primary)
  );
}

function isProviderAwareRemoteCapabilities(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.ready) &&
    isProviderAwareOneOf(["darwin", "win32", "linux"], value.platform) &&
    isBoolean(value.unattended) &&
    value.runtime === "sunshine-moonlight" &&
    value.protocolVersion === 2 &&
    Array.isArray(value.displays) &&
    value.displays.every(isProviderAwareRemoteDisplay) &&
    (value.selectedDisplayId === null || isProviderAwareIdentifier(value.selectedDisplayId)) &&
    isProviderAwareNonNegativeInteger(value.activeSessions) &&
    isProviderAwarePositiveInteger(value.maxSessions)
  );
}

function isProviderAwareRemoteSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.serverId) &&
    isProviderAwareHttpUrl(value.viewerUrl, 8_192) &&
    isProviderAwareLimitedString(value.viewerGrant, 512) &&
    Array.isArray(value.displays) &&
    value.displays.every(isProviderAwareRemoteDisplay) &&
    (value.selectedDisplayId === null || isProviderAwareIdentifier(value.selectedDisplayId)) &&
    isProviderAwareOneOf(["starting_host", "connecting", "connected", "disconnecting", "error"], value.phase) &&
    isProviderAwareOneOf(["unknown", "p2p", "relay"], value.transport) &&
    (value.errorCode === null ||
      isProviderAwareOneOf(
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
    (value.message === null || isProviderAwareBoundedString(value.message, 2_000)) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isProviderAwareTimestamp(value.grantExpiresAt)
  );
}

function isProviderAwareDirectThread(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.otherMemberId) &&
    isTeamProtocolProviderAwareDirectMessage(value.lastMessage) &&
    isProviderAwareNonNegativeInteger(value.unreadCount) &&
    isProviderAwareTimestamp(value.updatedAt)
  );
}

function isProviderAwareDirectConversation(value: unknown, paged: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.threadId) &&
    isProviderAwareIdentifier(value.otherMemberId) &&
    Array.isArray(value.messages) &&
    value.messages.every(isTeamProtocolProviderAwareDirectMessage) &&
    isProviderAwareRevision(value.revision) &&
    (value.readState === undefined || isProviderAwareDirectReadState(value.readState)) &&
    (!paged || isProviderAwarePageInfo(value.pageInfo))
  );
}

function isProviderAwareDirectReadState(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareNonNegativeInteger(value.unreadCount) &&
    (value.firstUnreadMessageId === null || isProviderAwareIdentifier(value.firstUnreadMessageId)) &&
    isProviderAwareNonNegativeInteger(value.throughSequence)
  );
}

function isProviderAwareBrowserTab(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareBoundedString(value.title, 2_000) &&
    isProviderAwareBoundedString(value.url, 8_192) &&
    isBoolean(value.loading) &&
    (value.ownerThreadId === null || isProviderAwareIdentifier(value.ownerThreadId)) &&
    (value.ownerBotId === null || isProviderAwareIdentifier(value.ownerBotId))
  );
}

function isProviderAwareBrowserControl(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(
      (session) =>
        isDynamicRecord(session) &&
        isProviderAwareIdentifier(session.id) &&
        isProviderAwareIdentifier(session.threadId) &&
        isProviderAwareIdentifier(session.turnId) &&
        isProviderAwareIdentifier(session.callId) &&
        (session.tabId === null || isProviderAwareIdentifier(session.tabId)) &&
        isProviderAwareOneOf(
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
        isProviderAwareOneOf(["acting", "waiting"], session.phase) &&
        isProviderAwareTimestamp(session.startedAt),
    )
  );
}

function isProviderAwareBrowserPreview(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareBoundedString(value.dataUrl, 2_000_000) &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.dataUrl) &&
    isProviderAwarePositiveInteger(value.width) &&
    value.width <= 960 &&
    isProviderAwarePositiveInteger(value.height) &&
    value.height <= 600
  );
}

function isProviderAwareTeamInvite(value: unknown, includeUrl: boolean): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareOneOf(["admin", "member"], value.role) &&
    isProviderAwareTimestamp(value.expiresAt) &&
    (value.usedAt === null || isProviderAwareTimestamp(value.usedAt)) &&
    (value.email === null || isProviderAwareLimitedString(value.email, 254)) &&
    (!includeUrl || isProviderAwareBoundedString(value.inviteUrl, 8_192))
  );
}

function isProviderAwareTeamSession(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.memberId) &&
    isProviderAwareLimitedString(value.username, 254) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isProviderAwareTimestamp(value.expiresAt)
  );
}

function isProviderAwareAgentStatus(profile: ProviderAwareProfile, value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareOneOf(["idle", "starting", "ready", "restarting", "blocked", "stopped"], value.phase) &&
    (value.cliVersion === null || isProviderAwareBoundedString(value.cliVersion, 160)) &&
    isProviderAwareAgentAuth(profile, value.auth) &&
    (value.providers === undefined ||
      (Array.isArray(value.providers) &&
        value.providers.every((status) => isProviderAwareProviderStatus(profile, status)))) &&
    isDynamicRecord(value.capabilities) &&
    isProviderAwareCapabilityState(value.capabilities.chat) &&
    isProviderAwareCapabilityState(value.capabilities.browser) &&
    isProviderAwareCapabilityState(value.capabilities.computerUse) &&
    (value.message === null || isProviderAwareBoundedString(value.message, 2_000)) &&
    value.fullAccess === true
  );
}

function isProviderAwareAgentAuth(profile: ProviderAwareProfile, value: unknown): boolean {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "unknown" || value.kind === "signed-out") return true;
  if (value.kind === "unsupported") return isProviderAwareBoundedString(value.accountType, 160);
  return (
    isProviderAwareOneOf(profile.authKinds, value.kind) &&
    (value.email === null || isProviderAwareBoundedString(value.email, 254))
  );
}

function isProviderAwareProviderStatus(profile: ProviderAwareProfile, value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareOneOf(profile.providers, value.id) &&
    isProviderAwareOneOf(
      ["not-started", "checking", "available", "sign-in-required", "not-installed", "outdated", "error"],
      value.state,
    ) &&
    (value.version === null || isProviderAwareBoundedString(value.version, 160)) &&
    (value.message === null || isProviderAwareBoundedString(value.message, 2_000)) &&
    (value.email === undefined || value.email === null || isProviderAwareBoundedString(value.email, 254)) &&
    (value.connectionState === undefined || value.connectionState === "connecting") &&
    (value.checkError === undefined ||
      value.checkError === null ||
      isProviderAwareBoundedString(value.checkError, 2_000))
  );
}

function isProviderAwareCapabilityState(value: unknown): boolean {
  return isProviderAwareOneOf(["ready", "setup-required", "unavailable"], value);
}

function isProviderAwareAccountUsage(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.limits) &&
    value.limits.every(
      (limit) =>
        isDynamicRecord(limit) &&
        isProviderAwareIdentifier(limit.id) &&
        (limit.primary === null || isProviderAwareUsageWindow(limit.primary)) &&
        (limit.secondary === null || isProviderAwareUsageWindow(limit.secondary)),
    )
  );
}

function isProviderAwareUsageWindow(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isNumber(value.usedPercent) &&
    Number.isFinite(value.usedPercent) &&
    (value.windowDurationMins === null || isProviderAwareNonNegativeInteger(value.windowDurationMins)) &&
    (value.resetsAt === null || (isNumber(value.resetsAt) && Number.isFinite(value.resetsAt)))
  );
}

function isProviderAwareAgentModelOption(profile: ProviderAwareProfile, value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareOneOf(profile.providers, value.provider) &&
    isProviderAwareBoundedString(value.id, 160) &&
    isProviderAwareLimitedString(value.name, 160) &&
    isProviderAwareBoundedString(value.description, 2_000) &&
    isProviderAwareOneOf(["low", "medium", "high", "xhigh", "max"], value.defaultReasoningEffort) &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.every((effort) =>
      isProviderAwareOneOf(["low", "medium", "high", "xhigh", "max"], effort),
    )
  );
}

function isProviderAwareConversationReadStates(value: unknown): boolean {
  return isDynamicRecord(value) && Object.values(value).every(isProviderAwareConversationReadState);
}

function isProviderAwareMemory(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareBoundedString(value.text, 20_000) &&
    isProviderAwareOneOf(["automatic", "manual"], value.origin) &&
    (value.sourceTurnId === null || isProviderAwareIdentifier(value.sourceTurnId)) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isProviderAwareTimestamp(value.updatedAt)
  );
}

function isProviderAwareRoutine(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.botId) &&
    isProviderAwareLimitedString(value.name, 160) &&
    isProviderAwareBoundedString(value.instruction, 100_000) &&
    isBoolean(value.active) &&
    isProviderAwareLimitedString(value.timezone, 128) &&
    isDynamicRecord(value.trigger) &&
    isProviderAwareIdentifier(value.trigger.id) &&
    isProviderAwareIdentifier(value.trigger.routineId) &&
    isProviderAwareRoutineSchedule(value.trigger.schedule) &&
    isProviderAwareTimestamp(value.trigger.nextRunAt) &&
    isProviderAwareTimestamp(value.trigger.createdAt) &&
    isProviderAwareTimestamp(value.trigger.updatedAt) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isProviderAwareTimestamp(value.updatedAt)
  );
}

function isProviderAwareRoutineRun(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.id) &&
    isProviderAwareIdentifier(value.routineId) &&
    isProviderAwareIdentifier(value.botId) &&
    (value.triggerId === null || isProviderAwareIdentifier(value.triggerId)) &&
    isProviderAwareOneOf(["scheduled", "manual"], value.kind) &&
    isProviderAwareTimestamp(value.scheduledFor) &&
    isProviderAwareLimitedString(value.routineName, 160) &&
    isProviderAwareBoundedString(value.instruction, 100_000) &&
    (value.deliveryId === null || isProviderAwareIdentifier(value.deliveryId)) &&
    isProviderAwareOneOf(
      ["queued", "running", "needs-attention", "succeeded", "failed", "interrupted", "cancelled"],
      value.status,
    ) &&
    (value.error === null || isProviderAwareBoundedString(value.error, 100_000)) &&
    isProviderAwareTimestamp(value.createdAt) &&
    isProviderAwareTimestamp(value.updatedAt)
  );
}

function isProviderAwareConversationSearch(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        isDynamicRecord(result) &&
        isProviderAwareIdentifier(result.botId) &&
        isProviderAwareConversationMessage(result.message),
    ) &&
    isProviderAwareNonNegativeInteger(value.total) &&
    (value.nextCursor === null || isProviderAwareBoundedString(value.nextCursor, 512))
  );
}

function isProviderAwareQueuedMessageReceipt(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isProviderAwareIdentifier(value.messageId) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isProviderAwareIdentifier(delivery.id) &&
        isProviderAwareIdentifier(delivery.recipientBotId) &&
        isProviderAwareQueueStatus(delivery.status) &&
        isProviderAwareQueuePosition(delivery.position),
    )
  );
}

function isProviderAwareSidebarAction(value: TeamProtocolProviderAwareJsonObject): boolean {
  if (!isString(value.type)) return false;
  if (value.type === "create")
    return (
      isProviderAwareLimitedString(value.name, 40) &&
      (value.agentId === undefined || isProviderAwareIdentifier(value.agentId))
    );
  if (value.type === "rename")
    return isProviderAwareIdentifier(value.sectionId) && isProviderAwareLimitedString(value.name, 40);
  if (value.type === "delete") return isProviderAwareIdentifier(value.sectionId);
  if (value.type === "move") {
    return (
      isProviderAwareIdentifier(value.sectionId) &&
      isProviderAwareOneOf(["up", "down"], value.direction) &&
      (value.steps === undefined || isProviderAwarePositiveInteger(value.steps))
    );
  }
  if (value.type === "assign")
    return (
      isProviderAwareIdentifier(value.agentId) &&
      (value.sectionId === null || isProviderAwareIdentifier(value.sectionId))
    );
  return (
    value.type === "move-agent" &&
    isProviderAwareIdentifier(value.agentId) &&
    (value.sectionId === null || isProviderAwareIdentifier(value.sectionId)) &&
    (value.beforeAgentId === null || isProviderAwareIdentifier(value.beforeAgentId))
  );
}

function isProviderAwareBotUpdate(profile: ProviderAwareProfile, value: TeamProtocolProviderAwareJsonObject): boolean {
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
    (value.name === undefined || isProviderAwareBoundedString(value.name, 80)) &&
    (value.title === undefined || isProviderAwareBoundedString(value.title, 120)) &&
    (value.description === undefined || isProviderAwareBoundedString(value.description, 2_000)) &&
    (value.notifications === undefined || isBoolean(value.notifications)) &&
    (value.provider === undefined || isProviderAwareOneOf(profile.providers, value.provider)) &&
    (value.model === undefined || isProviderAwareBoundedString(value.model, 160)) &&
    (value.reasoningEffort === undefined ||
      isProviderAwareOneOf(["low", "medium", "high", "xhigh", "max"], value.reasoningEffort)) &&
    (value.avatarSeed === undefined || isProviderAwareBoundedString(value.avatarSeed, 128)) &&
    (value.avatarHue === undefined ||
      value.avatarHue === null ||
      isProviderAwareOneOf([0, 30, 55, 100, 150, 185, 215, 245, 280, 320], value.avatarHue))
  );
}

function isProviderAwareRoutineMutation(value: TeamProtocolProviderAwareJsonObject, create: boolean): boolean {
  return (
    (!create ||
      (isProviderAwareLimitedString(value.name, 160) &&
        isProviderAwareBoundedString(value.instruction, 100_000) &&
        isBoolean(value.active) &&
        isProviderAwareLimitedString(value.timezone, 128) &&
        isProviderAwareRoutineSchedule(value.schedule))) &&
    (value.name === undefined || isProviderAwareLimitedString(value.name, 160)) &&
    (value.instruction === undefined || isProviderAwareBoundedString(value.instruction, 100_000)) &&
    (value.active === undefined || isBoolean(value.active)) &&
    (value.timezone === undefined || isProviderAwareLimitedString(value.timezone, 128)) &&
    (value.schedule === undefined || isProviderAwareRoutineSchedule(value.schedule))
  );
}

function isProviderAwareRoutineSchedule(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case "hourly":
      return isProviderAwareIntegerInRange(value.minute, 0, 59);
    case "daily":
    case "weekdays":
      return isProviderAwareRoutineTime(value.time);
    case "weekly":
      return isProviderAwareIntegerInRange(value.weekday, 0, 6) && isProviderAwareRoutineTime(value.time);
    case "monthly":
      return isProviderAwareIntegerInRange(value.day, 1, 31) && isProviderAwareRoutineTime(value.time);
    case "interval":
      return (
        isProviderAwareIntegerInRange(value.amount, 1, 100_000) &&
        isProviderAwareOneOf(["minutes", "hours", "days"], value.unit) &&
        isProviderAwareTimestamp(value.anchorAt)
      );
    case "advanced":
      return (
        Array.isArray(value.months) &&
        value.months.length > 0 &&
        value.months.every((month) => isProviderAwareIntegerInRange(month, 1, 12)) &&
        isProviderAwareRoutineDays(value.days) &&
        isProviderAwareRoutineTimeSelection(value.time)
      );
    case "custom":
      return isProviderAwareLimitedString(value.expression, 512);
    default:
      return false;
  }
}

function isProviderAwareRoutineDays(value: unknown): boolean {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "every-day") return true;
  if (!Array.isArray(value.days) || value.days.length === 0) return false;
  if (value.kind === "days-of-week") return value.days.every((day) => isProviderAwareIntegerInRange(day, 0, 6));
  return value.kind === "days-of-month" && value.days.every((day) => isProviderAwareIntegerInRange(day, 1, 31));
}

function isProviderAwareRoutineTimeSelection(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    ((value.kind === "at-time" && isProviderAwareRoutineTime(value.time)) ||
      (value.kind === "every" &&
        isProviderAwareIntegerInRange(value.amount, 1, 100_000) &&
        isProviderAwareOneOf(["minutes", "hours"], value.unit)))
  );
}

function isProviderAwareRoutineTime(value: unknown): boolean {
  return isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function isProviderAwarePromptAnswers(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    Object.keys(value).length <= 32 &&
    Object.values(value).every(
      (answers) => Array.isArray(answers) && answers.every((answer) => isProviderAwareBoundedString(answer, 20_000)),
    )
  );
}

function isProviderAwareBrowserBounds(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    [value.x, value.y, value.width, value.height].every((item) => isNumber(item) && Number.isFinite(item))
  );
}

function isProviderAwarePageInfo(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.hasOlder) &&
    (value.olderCursor === null || isProviderAwareBoundedString(value.olderCursor, 512))
  );
}

function isProviderAwareOptionalNullableIdentifier(value: unknown): boolean {
  return value === undefined || value === null || isProviderAwareIdentifier(value);
}

function isProviderAwareNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isProviderAwarePositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

function isProviderAwareIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
