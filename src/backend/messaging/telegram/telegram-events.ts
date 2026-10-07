import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { InboundAction, InboundFile, InboundMessage } from "../messaging-types";
import { plainText } from "./telegram-render";

export const TELEGRAM_ACTION_PREFIX = "openbot";

export const TELEGRAM_ACTION_IDS = {
  accept: "accept",
  decline: "decline",
  stop: "stop",
} as const;

function isChatAllowed(chatId: string | number, authorId?: string): boolean {
  const allowedEnv = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!allowedEnv) return true;
  const allowed = allowedEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  const idStr = String(chatId);
  return allowed.includes(idStr) || (authorId !== undefined && allowed.includes(authorId));
}

/**
 * Parses one Telegram Update into an InboundMessage for OpenBot, or null when it does not address OpenBot.
 */
export function telegramInboundMessage(
  update: unknown,
  botUserId: string,
  botUsername?: string,
): InboundMessage | null {
  if (!isDynamicRecord(update)) return null;
  const message = isDynamicRecord(update.message)
    ? update.message
    : isDynamicRecord(update.channel_post)
      ? update.channel_post
      : null;
  if (!message) return null;

  const chat = message.chat;
  const messageId = message.message_id;
  if (!isDynamicRecord(chat) || !isNumber(messageId)) return null;
  const chatId = isNumber(chat.id) || isString(chat.id) ? chat.id : null;
  if (chatId === null) return null;

  const from = isDynamicRecord(message.from) ? message.from : null;
  const authorId = from && isNumber(from.id) ? String(from.id) : String(chat.id);

  // Ignore bot own messages or other bots
  if (authorId === botUserId || (from && from.is_bot === true)) return null;

  // Filter allowed chat IDs when configured
  if (!isChatAllowed(chatId, authorId)) return null;

  const rawText = isString(message.text) ? message.text : isString(message.caption) ? message.caption : "";
  const cleanedText = plainText(rawText, botUsername);
  const files = inboundFiles(message);

  const isDirect = chat.type === "private";
  const isForum = chat.is_forum === true;
  const threadId = isNumber(message.message_thread_id) ? String(message.message_thread_id) : null;

  let requiresLink = false;
  if (isDirect) {
    requiresLink = false;
  } else {
    const hasOpenbotPrefix = /^\s*openbot\b/iu.test(rawText);
    const hasMention = botUsername ? new RegExp(`@${botUsername}\\b`, "i").test(rawText) : false;
    const isCommand = rawText.startsWith("/");
    const isReplyToBot =
      isDynamicRecord(message.reply_to_message) &&
      isDynamicRecord(message.reply_to_message.from) &&
      String(message.reply_to_message.from.id) === botUserId;

    if (hasMention || hasOpenbotPrefix || isCommand || isReplyToBot) {
      requiresLink = false;
    } else if (isForum) {
      // In a forum topic, replies without mention can continue an existing conversation
      requiresLink = true;
    } else {
      // In a normal group without mention, prefix or reply to bot, ignore
      return null;
    }
  }

  // Conversation key: message_thread_id in a forum, else the chat id (as per docs/messaging.md)
  const threadKey = isForum && threadId ? threadId : String(chat.id);
  const replyThreadId = isForum && threadId ? threadId : null;

  return {
    dedupKey: `${chat.id}:${messageId}`,
    platformChannelId: String(chat.id),
    threadKey,
    target: {
      platformChannelId: String(chat.id),
      replyThreadId,
    },
    platformMessageId: String(messageId),
    isDirect,
    requiresLink,
    authorId,
    text: cleanedText,
    files,
  };
}

/**
 * Parses one Telegram callback_query into an InboundAction, or null.
 */
export function telegramInboundAction(update: unknown): InboundAction | null {
  if (!isDynamicRecord(update) || !isDynamicRecord(update.callback_query)) return null;
  const query = update.callback_query;
  const data = query.data;
  if (!isString(data) || !data.startsWith(`${TELEGRAM_ACTION_PREFIX}:`)) return null;

  const parts = data.split(":");
  if (parts.length < 3) return null;
  const [, actionType, token] = parts;

  const from = isDynamicRecord(query.from) ? query.from : null;
  const actorId = from && isNumber(from.id) ? String(from.id) : "";
  if (!actorId || !token) return null;

  const message = isDynamicRecord(query.message) ? query.message : null;
  const chat = message && isDynamicRecord(message.chat) ? message.chat : null;
  if (!message || !chat || !isNumber(message.message_id) || !isNumber(chat.id)) return null;

  if (!isChatAllowed(chat.id, actorId)) return null;

  const platformChannelId = String(chat.id);
  const platformMessageId = String(message.message_id);
  const replyThreadId = isNumber(message.message_thread_id) ? String(message.message_thread_id) : null;
  const target = { platformChannelId, replyThreadId };

  const common = {
    token,
    actorId,
    target,
    platformMessageId,
  };

  switch (actionType) {
    case TELEGRAM_ACTION_IDS.accept:
      return { type: "approval", decision: "accept", ...common };
    case TELEGRAM_ACTION_IDS.decline:
      return { type: "approval", decision: "decline", ...common };
    case TELEGRAM_ACTION_IDS.stop:
      return { type: "stop", ...common };
    default:
      return null;
  }
}

function stringField(record: DynamicRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberField(record: DynamicRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function inboundFiles(message: DynamicRecord): InboundFile[] {
  const files: InboundFile[] = [];

  // Document
  if (isDynamicRecord(message.document)) {
    const fileId = stringField(message.document, "file_id");
    if (fileId) {
      files.push({
        id: fileId,
        name: stringField(message.document, "file_name") ?? "document",
        mimeType: stringField(message.document, "mime_type") ?? "application/octet-stream",
        size: numberField(message.document, "file_size") ?? 0,
        url: fileId,
      });
    }
  }

  // Photo
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photos = message.photo.filter(isDynamicRecord);
    const largest = photos[photos.length - 1];
    if (largest) {
      const fileId = stringField(largest, "file_id");
      if (fileId) {
        files.push({
          id: fileId,
          name: "photo.jpg",
          mimeType: "image/jpeg",
          size: numberField(largest, "file_size") ?? 0,
          url: fileId,
        });
      }
    }
  }

  // Audio
  if (isDynamicRecord(message.audio)) {
    const fileId = stringField(message.audio, "file_id");
    if (fileId) {
      files.push({
        id: fileId,
        name: stringField(message.audio, "file_name") ?? "audio.mp3",
        mimeType: stringField(message.audio, "mime_type") ?? "audio/mpeg",
        size: numberField(message.audio, "file_size") ?? 0,
        url: fileId,
      });
    }
  }

  // Voice
  if (isDynamicRecord(message.voice)) {
    const fileId = stringField(message.voice, "file_id");
    if (fileId) {
      files.push({
        id: fileId,
        name: "voice.ogg",
        mimeType: stringField(message.voice, "mime_type") ?? "audio/ogg",
        size: numberField(message.voice, "file_size") ?? 0,
        url: fileId,
      });
    }
  }

  return files;
}
