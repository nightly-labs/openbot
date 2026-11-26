import { isDynamicRecord, isString } from "./runtime-values";

export const WATCH_PROTOCOL_VERSION = 1;

export const WATCH_TEXT_LIMIT = 600;
export const WATCH_APPROVAL_LIMIT = 1_500;
export const WATCH_REPLY_LIMIT = 1_200;
export const WATCH_AGENT_LIMIT = 40;
export const WATCH_CHANNEL_LIMIT = 20;
export const WATCH_CHANNEL_MEMBERS = 4;

export type WatchAgentState = "waiting" | "working" | "idle";

export interface WatchApprovalWait {
  kind: "approval";
  requestId: string;
  title: string;
  body: string;
  where: string | null;
  why: string | null;
  whole: boolean;
}

export interface WatchQuestion {
  id: string;
  header: string;
  question: string;
  options: string[];
  multiSelect: boolean;
}

export interface WatchQuestionWait {
  kind: "question";
  requestId: string;
  questions: WatchQuestion[];
}

export interface WatchPhoneWait {
  kind: "phone";
  reason: "question" | "approval" | "takeover";
  text: string | null;
}

export type WatchWait = WatchApprovalWait | WatchQuestionWait | WatchPhoneWait;

export interface WatchFaces {
  waiting?: string;
  working?: string;
}

export interface WatchChannel {
  serverId: string;
  id: string;
  name: string;
  server: string;
  color: string;
  members: string[];
  folder?: string;
  position?: number;
  unread: number;
  working: boolean;
  updated: string | null;
  author: string | null;
  reply: string | null;
}

export interface WatchAgent {
  serverId: string;
  id: string;
  name: string;
  server: string;
  color: string;
  avatar?: string;
  faces?: WatchFaces;
  pinned: boolean;
  folder?: string;
  position?: number;
  unread: number;
  state: WatchAgentState;
  detail: string | null;
  updated: string | null;
  turnId: string | null;
  reply: string | null;
  wait: WatchWait | null;
}

export interface WatchServer {
  id: string;
  name: string;
  online: boolean;
  watchKey?: string;
}

export interface WatchDirectServer {
  serverId: string;
  hostId: string;
  watchKey: string;
}

export interface WatchDirectCredentials {
  account?: string;
  authUrl: string;
  watchSessionId: string;
  token: string;
  expiresAt: number;
  servers: WatchDirectServer[];
}

export type WatchSnapshot =
  | {
      version: typeof WATCH_PROTOCOL_VERSION;
      state: "ready";
      generatedAt: number;
      account?: string;
      live: boolean;
      paused: boolean;
      accent: string;
      language: string;
      text: Record<string, string>;
      servers: WatchServer[];
      agents: WatchAgent[];
      channels?: WatchChannel[];
    }
  | {
      version: typeof WATCH_PROTOCOL_VERSION;
      state: "locked";
      generatedAt: number;
      text: Record<string, string>;
    }
  | {
      version: typeof WATCH_PROTOCOL_VERSION;
      state: "signedOut";
      generatedAt: number;
    };

export type WatchCommand =
  | { type: "refresh"; language?: string }
  | { type: "pair"; publicKey: string }
  | { type: "avatars"; names: string[] }
  | { type: "approve" | "deny"; serverId: string; agentId: string; requestId: string }
  | { type: "answer"; serverId: string; agentId: string; requestId: string; answers: Record<string, string[]> }
  | { type: "send"; serverId: string; agentId: string; text: string; messageId?: string }
  | { type: "stop"; serverId: string; agentId: string; turnId: string }
  | { type: "open" | "read"; serverId: string; agentId: string }
  | { type: "sendChannel"; serverId: string; channelId: string; text: string; messageId?: string }
  | { type: "readChannel"; serverId: string; channelId: string };

export type WatchErrorCode = "inactive" | "offline" | "locked" | "failed" | "timeout" | "asleep";

export type WatchResult =
  | { ok: true; snapshot?: string; avatars?: Record<string, string>; direct?: WatchDirectCredentials }
  | { ok: false; error: WatchErrorCode; message: string; snapshot?: string };

const COMMAND_TEXT_LIMIT = 4_000;
const RAW_P256_KEY = /^B[A-Za-z0-9_-]{86}$/u;
const ANSWER_LIMIT = 20;
const AVATAR_NAME = /^[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9]{1,8}$/u;
const MESSAGE_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/iu;

function boundedString(value: unknown, limit = 200): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

export function decodeWatchCommand(text: string): WatchCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  const { type, serverId, agentId } = value;
  if (type === "refresh") {
    return boundedString(value.language, 35) ? { type, language: value.language } : { type };
  }
  if (type === "pair") {
    return isString(value.publicKey) && RAW_P256_KEY.test(value.publicKey)
      ? { type, publicKey: value.publicKey }
      : null;
  }
  if (type === "avatars") return decodeAvatarRequest(value.names);
  if (type === "sendChannel" || type === "readChannel") {
    const { channelId, text, messageId } = value;
    return decodeChannelCommand(type, { serverId, channelId, text, messageId });
  }
  if (!boundedString(serverId) || !boundedString(agentId)) return null;
  switch (type) {
    case "approve":
    case "deny":
      return boundedString(value.requestId) ? { type, serverId, agentId, requestId: value.requestId } : null;
    case "answer": {
      const { requestId } = value;
      const answers = decodeAnswers(value.answers);
      return boundedString(requestId) && answers ? { type, serverId, agentId, requestId, answers } : null;
    }
    case "send": {
      if (!boundedString(value.text, COMMAND_TEXT_LIMIT) || !value.text.trim()) return null;
      const { messageId } = value;
      if (messageId === undefined) return { type, serverId, agentId, text: value.text };
      return isString(messageId) && MESSAGE_ID.test(messageId)
        ? { type, serverId, agentId, text: value.text, messageId: messageId.toLowerCase() }
        : null;
    }
    case "stop":
      return boundedString(value.turnId) ? { type, serverId, agentId, turnId: value.turnId } : null;
    case "open":
    case "read":
      return { type, serverId, agentId };
    default:
      return null;
  }
}

interface ChannelCommandFields {
  readonly serverId: unknown;
  readonly channelId: unknown;
  readonly text: unknown;
  readonly messageId: unknown;
}

function decodeChannelCommand(
  type: "sendChannel" | "readChannel",
  { serverId, channelId, text, messageId }: ChannelCommandFields,
): WatchCommand | null {
  if (!boundedString(serverId) || !boundedString(channelId)) return null;
  if (type === "readChannel") return { type, serverId, channelId };
  if (!boundedString(text, COMMAND_TEXT_LIMIT) || !text.trim()) return null;
  if (messageId === undefined) return { type, serverId, channelId, text };
  return isString(messageId) && MESSAGE_ID.test(messageId)
    ? { type, serverId, channelId, text, messageId: messageId.toLowerCase() }
    : null;
}

function decodeAvatarRequest(names: unknown): WatchCommand | null {
  if (!Array.isArray(names) || names.length === 0 || names.length > WATCH_AGENT_LIMIT) return null;
  const valid = names.filter((item): item is string => isString(item) && AVATAR_NAME.test(item));
  return valid.length === names.length ? { type: "avatars", names: valid } : null;
}

function decodeAnswers(value: unknown): Record<string, string[]> | null {
  if (!isDynamicRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > ANSWER_LIMIT) return null;
  const answers: Record<string, string[]> = {};
  for (const [questionId, values] of entries) {
    if (!boundedString(questionId) || !Array.isArray(values)) return null;
    if (values.length === 0 || values.length > ANSWER_LIMIT) return null;
    const texts = values.filter((item): item is string => boundedString(item, COMMAND_TEXT_LIMIT));
    if (texts.length !== values.length) return null;
    answers[questionId] = texts;
  }
  return answers;
}

export function watchText(value: string | null | undefined, limit = WATCH_TEXT_LIMIT): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
