import type { IncomingMessage } from "node:http";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_WELCOME_ITEM_TYPE,
  type AgentAccessLevel,
  agentAccessRank,
  CHANNEL_RESUME_ITEM_TYPE,
  type ConversationMessage,
  type ConversationMessageSender,
  type ConversationPageAnchor,
  type ConversationSnapshot,
  type ConversationWithReadState,
  type CreateAgentInput,
  canAdministerServer,
  conversationMessageSender,
  HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX,
  isAgentModel,
  isAgentProvider,
  isAvatarHue,
  isAvatarSeed,
  isReasoningEffort,
  isReleasedRoutineSchedule,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
  type RespondToApprovalInput,
  type RespondToBrowserTakeoverInput,
  ROUTINE_EVENT_ITEM_TYPE_PREFIX,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX,
  SETTING_LINK_ITEM_TYPE_PREFIX,
  type TeamMemberSummary,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { teamProtocolCapabilityLimit } from "@openbot/contracts/team-protocol/capability-limits";
import {
  CHANNEL_BROWSER_CAPABILITY,
  CHANNEL_ISOLATION_CAPABILITY,
  CHANNEL_PICTURE_CAPABILITY,
  expandTeamCapabilitiesV10,
  isTeamCurrentCapability,
  supportsTeamSemanticTags,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { PROVIDER_MANY_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { ROUTINE_QUIET_ANSWERS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-quiet-answers-v1";
import { SETTING_LINK_MARKERS_CAPABILITY } from "@openbot/contracts/team-protocol/setting-link-markers-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import {
  readTeamCapabilitiesV10,
  TEAM_ABSENT_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V10,
  type TeamCapabilitiesV10,
} from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { readBodyWithin } from "../http-body";
import { HttpError } from "./http-error";
import type { TeamApiRequestContext } from "./request-context";

export const JSON_LIMIT = 1024 * 1024;
export const WEBRTC_FRAME_BODY_BUDGET = Math.floor(TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES * 0.75);

const CUT_TEXT_BYTES = 256 * 1024;

export function messageTextCut(
  messages: readonly ConversationMessage[],
  excessBytes: number,
): (message: ConversationMessage) => ConversationMessage {
  const sizes = new Map(messages.map((message) => [message, jsonBytes(message.text)]));
  const ascending = messages.map((message) => sizes.get(message) ?? 0).sort((left, right) => left - right);
  let remaining = ascending.reduce((sum, size) => sum + size, 0) - excessBytes;
  if (remaining <= 0) return (message) => message;
  let cap = Number.POSITIVE_INFINITY;
  for (const [index, size] of ascending.entries()) {
    const left = ascending.length - index;
    if (size * left > remaining) {
      cap = Math.max(0, Math.floor(remaining / left));
      break;
    }
    remaining -= size;
  }
  const limit = Math.min(cap, CUT_TEXT_BYTES);
  return (message) =>
    (sizes.get(message) ?? 0) > limit ? { ...message, text: cutText(message.text, limit) } : message;
}

function cutText(text: string, maxBytes: number): string {
  const textBytes = Buffer.byteLength(text);
  for (let keep = Math.floor(text.length / 2); ; ) {
    const end = isHighSurrogate(text.charCodeAt(keep - 1)) ? keep - 1 : keep;
    const start = isLowSurrogate(text.charCodeAt(text.length - keep)) ? text.length - keep + 1 : text.length - keep;
    const head = text.slice(0, end);
    const tail = text.slice(start);
    const size = (Math.ceil((textBytes - Buffer.byteLength(head) - Buffer.byteLength(tail)) / 104_857.6) / 10).toFixed(
      1,
    );
    const cut = `${head}\n\n${sourceText("status.remote.messageCut", { size })}\n\n${tail}`;
    const bytes = jsonBytes(cut);
    if (bytes <= maxBytes || keep === 0) return cut;
    keep = Math.floor(keep * Math.min(0.99, maxBytes / bytes));
  }
}

function jsonBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function requestCapabilities(request: IncomingMessage): Set<string> {
  const protocol = requestProtocol(request);
  if (protocol >= TEAM_PROTOCOL_V10) {
    const lists = requestCapabilityListsV10(request);
    return new Set(lists ? expandTeamCapabilitiesV10(lists).filter(isTeamCurrentCapability) : []);
  }
  const header = request.headers[TEAM_CAPABILITIES_HEADER.toLowerCase()];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value || value.length > (protocol >= TEAM_PROTOCOL_V9 ? 8_192 : 4_096)) return new Set();
  const capabilities = value.split(",").map((capability) => capability.trim());
  if (capabilities.length > teamProtocolCapabilityLimit(protocol)) return new Set();
  return new Set(capabilities.filter(isTeamCurrentCapability));
}

export function requestCapabilityListsV10(request: IncomingMessage): TeamCapabilitiesV10 | null {
  return readTeamCapabilitiesV10(
    headerCapabilityList(request, TEAM_CAPABILITIES_HEADER),
    headerCapabilityList(request, TEAM_ABSENT_CAPABILITIES_HEADER),
  );
}

function headerCapabilityList(request: IncomingMessage, name: string): string[] | null {
  const header = request.headers[name.toLowerCase()];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return [];
  if (value.length > 8_192) return null;
  return value.split(",").map((capability) => capability.trim());
}

export function conversationSnapshotForCapabilities(
  snapshot: ConversationSnapshot,
  capabilities: ReadonlySet<string>,
): ConversationSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.filter((message) => markerSupported(message.itemType, capabilities)),
  };
}

export function conversationForCapabilities(
  conversation: ConversationWithReadState,
  capabilities: ReadonlySet<string>,
): ConversationWithReadState {
  const messages = conversation.messages.filter((message) => markerSupported(message.itemType, capabilities));
  if (!conversation.readState) return { ...conversation, messages };
  return {
    ...conversation,
    messages,
    readState: {
      ...conversation.readState,
      throughMessageId: supportedConversationCursor(
        conversation.messages,
        conversation.readState.throughMessageId,
        capabilities,
      ),
    },
  };
}

function supportedConversationCursor(
  messages: ConversationSnapshot["messages"],
  throughMessageId: string | null,
  capabilities: ReadonlySet<string>,
): string | null {
  if (!throughMessageId) return null;
  const boundary = messages.findIndex((message) => message.id === throughMessageId);
  for (let index = boundary; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && markerSupported(message.itemType, capabilities)) return message.id;
  }
  return null;
}

export function markerExclusionsForCapabilities(capabilities: ReadonlySet<string>): {
  excludeRoutineEvents: boolean;
  excludeRoutineRunEvents: boolean;
  excludeHostedSiteEvents: boolean;
  excludeRoutineQuietAnswers: boolean;
  excludeSettingLinks?: boolean;
} {
  return {
    excludeRoutineEvents: !capabilities.has("routine-event-markers"),
    excludeRoutineRunEvents: !capabilities.has("routine-run-event-markers"),
    excludeHostedSiteEvents: !capabilities.has("hosted-site-event-markers"),
    excludeRoutineQuietAnswers: !capabilities.has(ROUTINE_QUIET_ANSWERS_CAPABILITY),
    excludeSettingLinks: !capabilities.has(SETTING_LINK_MARKERS_CAPABILITY),
  };
}

export function markerSupported(itemType: string | undefined, capabilities: ReadonlySet<string>): boolean {
  if (itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE) return capabilities.has(ROUTINE_QUIET_ANSWERS_CAPABILITY);
  if (itemType === AGENT_WELCOME_ITEM_TYPE || itemType === CHANNEL_RESUME_ITEM_TYPE) return false;
  if (itemType?.startsWith(ROUTINE_EVENT_ITEM_TYPE_PREFIX)) return capabilities.has("routine-event-markers");
  if (itemType?.startsWith(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX)) return capabilities.has("routine-event-markers");
  if (itemType?.startsWith(ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX)) {
    return capabilities.has("routine-run-event-markers");
  }
  if (itemType?.startsWith(HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX)) {
    return capabilities.has("hosted-site-event-markers");
  }
  if (itemType?.startsWith(SETTING_LINK_ITEM_TYPE_PREFIX)) return capabilities.has(SETTING_LINK_MARKERS_CAPABILITY);
  return true;
}

export function bearerToken(value: string | undefined): string | null {
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{20,512})$/);
  return match?.[1] ?? null;
}

export function publicHttpBaseUrl(request: IncomingMessage): string {
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const host = forwardedHost || request.headers.host;
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) {
    throw new HttpError(400, "A valid public host is required.");
  }
  const forwardedProtocol = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value?.split(",", 1)[0];
  return first?.trim();
}

export function memberSender(member: TeamMemberSummary): ConversationMessageSender | undefined {
  return conversationMessageSender(member.id, member.name?.trim() || member.email || member.username);
}

export function requireReleasedSchedule(schedule: unknown): void {
  if (schedule !== undefined && !isReleasedRoutineSchedule(schedule)) {
    throw new HttpError(400, sourceText("error.backend.routineScheduleInvalid"));
  }
}

export function requireAdmin(member: TeamMemberSummary): void {
  if (!canAdministerServer(member.role)) throw new HttpError(403, sourceText("error.team.adminRequired"));
}

export function requireOwner(member: TeamMemberSummary): void {
  if (member.role !== "owner") throw new HttpError(403, sourceText("error.team.ownerRequired"));
}

export function requireListedAgent(agents: { listAgents(): readonly { id: string }[] }, agentId: string): void {
  if (!agents.listAgents().some((agent) => agent.id === agentId)) {
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  }
}

export function requireVisibleBodyAgent(body: DynamicRecord, hiddenAgentIds: ReadonlySet<string>): void {
  if (isString(body.agentId) && hiddenAgentIds.has(body.agentId)) {
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  }
}

export function requireAgentLevel(
  context: Pick<TeamApiRequestContext, "agentLevel">,
  agentId: string,
  required: Exclude<AgentAccessLevel, "none">,
): void {
  if (agentAccessRank(context.agentLevel(agentId)) >= agentAccessRank(required)) return;
  throw new HttpError(
    403,
    sourceText(required === "manage" ? "error.team.agentManageDenied" : "error.team.agentViewOnly"),
  );
}

export function parseBrowserBounds(value: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!isDynamicRecord(value)) throw new HttpError(400, "Invalid browser bounds.");
  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  if (
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(width) ||
    !isNumber(height) ||
    ![x, y, width, height].every(Number.isFinite)
  ) {
    throw new HttpError(400, "Invalid browser bounds.");
  }
  return { x, y, width, height };
}

export async function readJson(request: IncomingMessage): Promise<DynamicRecord> {
  const body = await readBodyWithin(request, JSON_LIMIT);
  if (body === null) throw new HttpError(413, sourceText("error.team.requestTooLarge"));
  try {
    const value = JSON.parse(body.toString("utf8"));
    const path = request.url ?? "/";
    const sideRoute = teamSideRouteCodec(path);
    const capabilities = requestCapabilities(request);
    if (sideRoute) {
      const input = sideRoute.request(path, value, {
        channelIsolation: capabilities.has(CHANNEL_ISOLATION_CAPABILITY),
        channelPicture: capabilities.has(CHANNEL_PICTURE_CAPABILITY),
        channelBrowser: capabilities.has(CHANNEL_BROWSER_CAPABILITY),
        providerManyAccounts: capabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY),
      });
      if (!isDynamicRecord(input)) throw new Error("Invalid side-protocol request.");
      return input;
    }
    return teamHttpCodec(requestProtocol(request)).decodeRequest(request.method ?? "GET", path, value, {
      preserveSemanticTags: supportsTeamSemanticTags(capabilities),
      agentCreateModel: capabilities.has(TEAM_AGENT_CREATE_MODEL_CAPABILITY),
    });
  } catch {
    throw new HttpError(400, "A valid JSON object is required.");
  }
}

export function requestProtocol(request: IncomingMessage): number {
  const raw = firstHeaderValue(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()]);
  const protocol = raw ? Number(raw) : TEAM_PROTOCOL_V1;
  return Number.isSafeInteger(protocol) ? protocol : TEAM_PROTOCOL_V1;
}

export function stringField(
  value: DynamicRecord,
  field: string,
  allowEmpty = false,
  maxLength: number = INPUT_LIMITS.identifier,
): string {
  const item = value[field];
  if (!isString(item) || (!allowEmpty && !item.trim())) {
    throw new HttpError(400, `${field} is required.`);
  }
  if (item.length > maxLength) throw new HttpError(400, `${field} is too long.`);
  return item;
}

export function nullableString(
  value: DynamicRecord,
  field: string,
  maxLength: number = INPUT_LIMITS.identifier,
): string | null {
  const item = value[field];
  if (item === undefined || item === null || item === "") return null;
  if (!isString(item)) throw new HttpError(400, `${field} must be a string.`);
  if (item.length > maxLength) throw new HttpError(400, `${field} is too long.`);
  return item;
}

export function pathIdentifier(value: string | undefined, field: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value ?? "");
  } catch {
    throw new HttpError(400, `${field} is invalid.`);
  }
  if (!decoded || decoded.length > INPUT_LIMITS.identifier) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return decoded;
}

export function stringArray(
  value: DynamicRecord,
  field: string,
  maxItems: number = INPUT_LIMITS.attachments,
  maxLength: number = INPUT_LIMITS.identifier,
): string[] {
  const item = value[field];
  if (item === undefined) return [];
  if (
    !Array.isArray(item) ||
    item.length > maxItems ||
    !item.every((entry) => isString(entry) && entry.length <= maxLength)
  ) {
    throw new HttpError(400, `${field} must be a string array.`);
  }
  return item;
}

export function promptRequestId(value: unknown): string | number {
  if (isNumber(value) && Number.isSafeInteger(value)) return value;
  if (isString(value) && value.length > 0 && value.length <= INPUT_LIMITS.identifier) {
    return value;
  }
  throw new HttpError(400, "requestId is invalid.");
}

export function promptAnswers(value: unknown): Record<string, string[]> {
  if (!isDynamicRecord(value)) {
    throw new HttpError(400, "answers is required.");
  }
  const entries = Object.entries(value);
  if (entries.length > INPUT_LIMITS.promptQuestions) {
    throw new HttpError(400, "Too many prompt answers.");
  }
  const answers: Record<string, string[]> = {};
  let totalTextLength = 0;
  for (const [key, answer] of entries) {
    if (
      key.length > INPUT_LIMITS.identifier ||
      !Array.isArray(answer) ||
      answer.length > INPUT_LIMITS.promptAnswersPerQuestion ||
      !answer.every((item) => isString(item) && item.length <= INPUT_LIMITS.promptAnswerText)
    ) {
      throw new HttpError(400, "A prompt answer is invalid.");
    }
    totalTextLength += answer.reduce((length, item) => length + item.length, 0);
    if (totalTextLength > INPUT_LIMITS.promptAnswersTotalText) {
      throw new HttpError(400, sourceText("error.agent.promptAnswersTooLong"));
    }
    answers[key] = answer;
  }
  return answers;
}

export function approvalDecision(value: unknown): RespondToApprovalInput["decision"] {
  if (value === "accept" || value === "decline") return value;
  throw new HttpError(400, "approval decision is invalid.");
}

export function browserTakeoverDecision(value: unknown): RespondToBrowserTakeoverInput["decision"] {
  if (value === "complete" || value === "cancel") return value;
  throw new HttpError(400, "browser takeover decision is invalid.");
}

export function agentUpdate(value: DynamicRecord, agentId: string): UpdateAgentInput {
  if (value.role !== undefined) throw new HttpError(400, "role is invalid.");
  const result: UpdateAgentInput = { agentId };
  const textFields = {
    name: INPUT_LIMITS.agentName,
    title: INPUT_LIMITS.agentTitle,
    description: INPUT_LIMITS.agentDescription,
  } as const;
  for (const [field, maxLength] of Object.entries(textFields)) {
    const item = value[field];
    if (item === undefined) continue;
    if (!isString(item) || item.length > maxLength) {
      throw new HttpError(400, `${field} is invalid.`);
    }
    if (field === "name") result.name = item;
    else if (field === "title") result.title = item;
    else result.description = item;
  }
  if (value.notifications !== undefined) {
    if (!isBoolean(value.notifications)) {
      throw new HttpError(400, "notifications is invalid.");
    }
    result.notifications = value.notifications;
  }
  if (value.provider !== undefined) {
    if (!isAgentProvider(value.provider)) {
      throw new HttpError(400, "provider is invalid.");
    }
    result.provider = value.provider;
  }
  if (value.model !== undefined) {
    if (!isAgentModel(value.model)) throw new HttpError(400, "model is invalid.");
    result.model = value.model;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) {
      throw new HttpError(400, "reasoningEffort is invalid.");
    }
    result.reasoningEffort = value.reasoningEffort;
  }
  if (value.avatarSeed !== undefined) {
    if (!isAvatarSeed(value.avatarSeed)) throw new HttpError(400, "avatarSeed is invalid.");
    result.avatarSeed = value.avatarSeed;
  }
  if (value.avatarHue !== undefined) {
    if (value.avatarHue !== null && !isAvatarHue(value.avatarHue)) {
      throw new HttpError(400, "avatarHue is invalid.");
    }
    result.avatarHue = value.avatarHue;
  }
  return result;
}

export function agentCreate(value: DynamicRecord): CreateAgentInput {
  const avatarHue = value.avatarHue;
  if (!isAvatarSeed(value.avatarSeed)) throw new HttpError(400, "avatarSeed is invalid.");
  if (avatarHue !== null && !isAvatarHue(avatarHue)) throw new HttpError(400, "avatarHue is invalid.");
  if (!isString(value.description) || value.description.length > INPUT_LIMITS.agentDescription) {
    throw new HttpError(400, "description is invalid.");
  }
  if (value.provider !== undefined && !isAgentProvider(value.provider)) {
    throw new HttpError(400, "provider is invalid.");
  }
  if (value.model !== undefined && !isAgentModel(value.model)) {
    throw new HttpError(400, "model is invalid.");
  }
  if (value.reasoningEffort !== undefined && !isReasoningEffort(value.reasoningEffort)) {
    throw new HttpError(400, "reasoningEffort is invalid.");
  }
  return {
    name: requiredCreateText(value.name, "name", INPUT_LIMITS.agentName),
    description: value.description,
    avatarSeed: value.avatarSeed,
    avatarHue,
    initialMessage: requiredCreateText(value.initialMessage, "initialMessage", INPUT_LIMITS.messageText),
    ...(value.provider === undefined ? {} : { provider: value.provider }),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
    ...(isString(value.operationId) ? { operationId: value.operationId } : {}),
  };
}

function requiredCreateText(value: unknown, field: string, maximum: number): string {
  if (!isString(value) || !value.trim() || value.length > maximum) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return value;
}

export async function readBinary(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "Attachment exceeds the 100 MB limit.");
  const header = request.headers["content-length"];
  const declared = header !== undefined && /^\d+$/u.test(header) ? Number(header) : null;
  if (declared !== null && declared > limit) throw tooLarge();
  const target = declared === null ? null : new Uint8Array(declared);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (size + bytes.length > limit) throw tooLarge();
    if (!target) chunks.push(bytes);
    else if (size + bytes.length > target.length)
      throw new Error("The request body is longer than its Content-Length.");
    else target.set(bytes, size);
    size += bytes.length;
  }
  if (target) return size === target.length ? target : target.slice(0, size);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export function pageAnchor(url: URL): ConversationPageAnchor {
  const before = url.searchParams.get("before");
  const around = url.searchParams.get("around");
  if (before && around) throw new HttpError(400, "Choose one conversation page anchor.");
  if (before) return { type: "before", cursor: before };
  if (around) return { type: "around", messageId: around };
  return { type: "latest" };
}

export function pageLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new HttpError(400, "The conversation page limit must be between 1 and 100.");
  }
  return value;
}
