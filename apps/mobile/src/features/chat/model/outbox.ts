import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { ChatMessage } from "./chat-messages";
import type { ImageDimensions } from "./image-dimensions";

export type OutboxTarget =
  | { kind: "agent"; serverId: string; agentId: string }
  | { kind: "channel"; serverId: string; channelId: string; recipientAgentId: string | null };

type OutboxState = "waiting" | "sending" | "failed" | "sent";

export interface OutboxFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  fileName: string;
  dimensions?: ImageDimensions;
}

export interface OutboxMessage {
  clientMessageId: string;
  target: OutboxTarget;
  text: string;
  replyToMessageId: string | null;
  files: OutboxFile[];
  createdAt: string;
  firstAttemptAt: string | null;
  repeatSafe: boolean;
  state: OutboxState;
  messageId: string | null;
  error: string | null;
  returned: boolean;
  stopped: boolean;
}

const OUTBOX_RETRY_WINDOW_MS = 12 * 60 * 60 * 1000;

const OUTBOX_ROW_PREFIX = "outbox:";

export function outboxRowId(message: Pick<OutboxMessage, "clientMessageId">): string {
  return `${OUTBOX_ROW_PREFIX}${message.clientMessageId}`;
}

export function outboxChatMessage(
  message: OutboxMessage,
  previewUri: (file: OutboxFile) => string | null,
): Extract<ChatMessage, { kind: "message" }> {
  return {
    id: outboxRowId(message),
    kind: "message",
    author: "user",
    body: message.text,
    streaming: false,
    replyToMessageId: message.replyToMessageId,
    attachments: message.files.map((file) => {
      const image = file.mimeType.startsWith("image/");
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        kind: image ? "image" : "file",
        previewKind: "none",
        previewUrl: image ? previewUri(file) : null,
      };
    }),
  };
}

export function outboxChatKey(target: { kind: "agent" | "channel"; serverId: string; id: string }): string {
  return `${target.kind}:${target.serverId}:${target.id}`;
}

export function outboxTargetKey(target: OutboxTarget): string {
  return outboxChatKey({
    kind: target.kind,
    serverId: target.serverId,
    id: target.kind === "agent" ? target.agentId : target.channelId,
  });
}

export function outboxRetrySafe(message: OutboxMessage, now: number): boolean {
  if (message.firstAttemptAt === null) return true;
  if (!message.repeatSafe) return false;
  return message.target.kind === "channel" || now - Date.parse(message.firstAttemptAt) < OUTBOX_RETRY_WINDOW_MS;
}

export interface PersistedOutbox {
  version: 1;
  messages: OutboxMessage[];
}

export interface DecodedOutbox {
  messages: OutboxMessage[];
  dropped: boolean;
}

export function decodePersistedOutbox(value: unknown): DecodedOutbox {
  if (!isDynamicRecord(value) || value.version !== 1 || !Array.isArray(value.messages))
    return { messages: [], dropped: true };
  const messages = value.messages.flatMap((item) => {
    const message = decodeOutboxMessage(item);
    return message ? [message] : [];
  });
  return { messages, dropped: messages.length !== value.messages.length };
}

function isOutboxState(value: unknown): value is OutboxState {
  return value === "waiting" || value === "sending" || value === "failed" || value === "sent";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && Number.isFinite(Date.parse(value));
}

function decodeTarget(value: unknown): OutboxTarget | null {
  if (!isDynamicRecord(value) || !isString(value.serverId) || !value.serverId) return null;
  if (value.kind === "agent" && isString(value.agentId) && value.agentId)
    return { kind: "agent", serverId: value.serverId, agentId: value.agentId };
  if (
    value.kind === "channel" &&
    isString(value.channelId) &&
    value.channelId &&
    isNullableString(value.recipientAgentId)
  )
    return {
      kind: "channel",
      serverId: value.serverId,
      channelId: value.channelId,
      recipientAgentId: value.recipientAgentId,
    };
  return null;
}

function decodeDimensions(value: unknown): ImageDimensions | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isDynamicRecord(value) ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !(value.width > 0) ||
    !(value.height > 0)
  )
    return null;
  return { width: value.width, height: value.height };
}

function decodeFile(value: unknown): OutboxFile | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !value.id.startsWith("mobile-draft-attachment-") ||
    !isString(value.name) ||
    !isString(value.mimeType) ||
    typeof value.size !== "number" ||
    !Number.isFinite(value.size) ||
    value.size < 0 ||
    !isString(value.fileName) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(value.fileName) ||
    value.fileName.includes("..")
  )
    return null;
  const dimensions = decodeDimensions(value.dimensions);
  if (dimensions === null) return null;
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    fileName: value.fileName,
    ...(dimensions ? { dimensions } : {}),
  };
}

function decodeOutboxMessage(value: unknown): OutboxMessage | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.clientMessageId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.clientMessageId) ||
    !isString(value.text) ||
    !isNullableString(value.replyToMessageId) ||
    !Array.isArray(value.files) ||
    value.files.length > INPUT_LIMITS.attachments ||
    !isTimestamp(value.createdAt) ||
    !(value.firstAttemptAt === null || isTimestamp(value.firstAttemptAt)) ||
    !isBoolean(value.repeatSafe) ||
    !isOutboxState(value.state) ||
    !isNullableString(value.messageId) ||
    !isNullableString(value.error) ||
    !isBoolean(value.returned) ||
    !(value.stopped === undefined || isBoolean(value.stopped))
  )
    return null;
  const target = decodeTarget(value.target);
  const files = value.files.map(decodeFile);
  if (!target || files.some((file) => file === null)) return null;
  return {
    clientMessageId: value.clientMessageId,
    target,
    text: value.text,
    replyToMessageId: value.replyToMessageId,
    files: files.filter((file) => file !== null),
    createdAt: value.createdAt,
    firstAttemptAt: value.firstAttemptAt,
    repeatSafe: value.repeatSafe,
    state: value.state,
    messageId: value.messageId,
    error: value.error,
    returned: value.returned,
    stopped: value.stopped === true,
  };
}
