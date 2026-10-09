import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  TELEGRAM_LINK_CODE_PATTERN,
  type TelegramReplyParameters,
} from "@openbot/contracts/signal-protocol/telegram-route";
import type { InboundAction, InboundFile, InboundMessage, MessageTarget } from "../messaging-types";
import type { TelegramChatState } from "./telegram-chats";

/** The `callback_data` prefix of each button the agent posts. The token follows it. */
export const TELEGRAM_CALLBACK_PREFIXES = { accept: "a:", decline: "d:", stop: "s:" } as const;

/** The thread key of a private chat: one conversation for the whole chat. */
const TELEGRAM_DIRECT_THREAD = "dm";

const START_COMMAND = /^\/start(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S+))?\s*$/u;

export type TelegramUpdateEvent =
  | { type: "message"; message: InboundMessage }
  /** A button press. Every press is answered, so the button stops its spinner; `action` is null for a button OpenBot does not know. */
  | { type: "action"; callbackQueryId: string; action: InboundAction | null }
  /** The bot left the chat, was removed, or the group became a supergroup with a new ID. */
  | { type: "removed" }
  | { type: "renamed"; title: string };

/** A `/start <code>` that linked this chat to the host: Signal and the account service checked the code. */
export interface TelegramLink {
  title: string;
  isDirect: boolean;
}

/** A Telegram update is always a JSON object. Anything else is not from Telegram. */
export function parseTelegramUpdate(body: Uint8Array): DynamicRecord | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(body));
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function telegramLink(update: DynamicRecord): TelegramLink | null {
  const message = update.message;
  if (!isDynamicRecord(message) || !isString(message.text) || !isDynamicRecord(message.chat)) return null;
  const code = START_COMMAND.exec(message.text.trim())?.[1];
  if (!code || !TELEGRAM_LINK_CODE_PATTERN.test(code)) return null;
  const chat = message.chat;
  const isDirect = chat.type === "private";
  const title = isString(chat.title) && chat.title.trim() ? chat.title.trim() : isDirect ? personName(chat) : "";
  return { title: title || String(chat.id), isDirect };
}

/**
 * One update as an event for OpenBot, or null when it does not address OpenBot.
 *
 * - A private chat is one conversation. Every message in it addresses OpenBot.
 * - In a group, a message that mentions the bot, or a reply to the bot, starts or continues the
 *   conversation of its reply chain. Another message in a chain counts only in a conversation that
 *   an agent already answers (`requiresLink`). With privacy mode on, Telegram sends the bot only
 *   mentions, replies to it and commands.
 * - The conversation key: a supergroup gives each reply chain a `message_thread_id`, the ID of its
 *   first message. A forum topic is one conversation. A basic group has no thread IDs, so the chain
 *   comes from the reply map in `TelegramChatState`.
 * - Messages of bots, edits, `/start` and other service messages are ignored.
 */
export function telegramUpdateEvent(
  update: DynamicRecord,
  botId: string,
  chatId: string,
  state: TelegramChatState,
): TelegramUpdateEvent | null {
  if (telegramRemoval(update, botId, chatId)) return { type: "removed" };
  if (isDynamicRecord(update.my_chat_member)) return null;
  const query = update.callback_query;
  if (isDynamicRecord(query)) return callbackEvent(query, chatId, state);
  const message = update.message;
  if (!isDynamicRecord(message) || !isDynamicRecord(message.chat) || String(message.chat.id) !== chatId) return null;
  if (isString(message.new_chat_title) && message.new_chat_title.trim()) {
    state.title = message.new_chat_title.trim();
    return { type: "renamed", title: state.title };
  }
  return messageEvent(message, botId, chatId, state);
}

/** True when the bot left the chat, was removed, or the group became a supergroup with a new ID. */
export function telegramRemoval(update: DynamicRecord, botId: string, chatId: string): boolean {
  const member = update.my_chat_member;
  if (isDynamicRecord(member)) {
    const user = isDynamicRecord(member.new_chat_member) ? member.new_chat_member.user : undefined;
    const status = isDynamicRecord(member.new_chat_member) ? member.new_chat_member.status : undefined;
    return isDynamicRecord(user) && String(user.id) === botId && (status === "left" || status === "kicked");
  }
  const message = update.message;
  if (!isDynamicRecord(message) || !isDynamicRecord(message.chat) || String(message.chat.id) !== chatId) return false;
  return (
    message.migrate_to_chat_id !== undefined ||
    (isDynamicRecord(message.left_chat_member) && String(message.left_chat_member.id) === botId)
  );
}

function messageEvent(
  message: DynamicRecord,
  botId: string,
  chatId: string,
  state: TelegramChatState,
): TelegramUpdateEvent | null {
  const from = message.from;
  const messageId = message.message_id;
  if (!isDynamicRecord(from) || !isNumber(messageId) || from.is_bot === true) return null;
  const authorId = String(from.id);
  state.rememberName(authorId, personName(from));
  const rawText = isString(message.text) ? message.text : isString(message.caption) ? message.caption : "";
  const entities = Array.isArray(message.entities)
    ? message.entities
    : Array.isArray(message.caption_entities)
      ? message.caption_entities
      : [];
  const isDirect = isDynamicRecord(message.chat) && message.chat.type === "private";
  if (START_COMMAND.test(rawText.trim())) return null;
  const threadKey = threadKeyOf(message, state);
  state.rememberThread(messageId, threadKey);
  const reply = isDynamicRecord(message.reply_to_message) ? message.reply_to_message : null;
  const replyFrom = reply && isDynamicRecord(reply.from) ? reply.from : null;
  const replyToBot = replyFrom !== null && String(replyFrom.id) === botId;
  // The message it answers is the best context of a reply chain. OpenBot's own posts are in the
  // agent's thread already.
  if (reply && replyFrom && !replyToBot && isNumber(reply.message_id)) {
    const replyAuthor = String(replyFrom.id);
    state.rememberName(replyAuthor, personName(replyFrom));
    state.rememberMessage({
      id: String(reply.message_id),
      threadKey,
      authorName: state.name(replyAuthor) ?? replyAuthor,
      text: isString(reply.text) ? reply.text : isString(reply.caption) ? reply.caption : "",
      sentAt: sentAt(reply.date),
    });
  }
  const { text, mentioned } = withoutMention(rawText, entities, botId, state.botUsername);
  state.rememberMessage({
    id: String(messageId),
    threadKey,
    authorName: state.name(authorId) ?? authorId,
    text,
    sentAt: sentAt(message.date),
  });
  const inChain = reply !== null || message.message_thread_id !== undefined;
  if (!isDirect && !mentioned && !replyToBot && !inChain) return null;
  return {
    type: "message",
    message: {
      dedupKey: `${chatId}:${messageId}`,
      platformChannelId: chatId,
      threadKey,
      target: { platformChannelId: chatId, replyThreadId: `${threadKey}:${messageId}` },
      platformMessageId: String(messageId),
      isDirect,
      // A reply to the bot, such as to its welcome message, can start a conversation.
      requiresLink: !isDirect && !mentioned && !replyToBot,
      authorId,
      text,
      files: inboundFiles(message),
    },
  };
}

function callbackEvent(query: DynamicRecord, chatId: string, state: TelegramChatState): TelegramUpdateEvent | null {
  if (!isString(query.id)) return null;
  const callbackQueryId = query.id;
  const from = query.from;
  const message = query.message;
  const data = query.data;
  if (
    !isDynamicRecord(from) ||
    !isDynamicRecord(message) ||
    !isNumber(message.message_id) ||
    !isDynamicRecord(message.chat) ||
    String(message.chat.id) !== chatId ||
    !isString(data)
  )
    return { type: "action", callbackQueryId, action: null };
  const actorId = String(from.id);
  state.rememberName(actorId, personName(from));
  const target: MessageTarget = {
    platformChannelId: chatId,
    replyThreadId: `${threadKeyOf(message, state)}:${message.message_id}`,
  };
  const common = { actorId, target, platformMessageId: String(message.message_id) };
  const token = (prefix: string) => (data.startsWith(prefix) ? data.slice(prefix.length) : null);
  const accept = token(TELEGRAM_CALLBACK_PREFIXES.accept);
  if (accept)
    return {
      type: "action",
      callbackQueryId,
      action: { type: "approval", decision: "accept", token: accept, ...common },
    };
  const decline = token(TELEGRAM_CALLBACK_PREFIXES.decline);
  if (decline)
    return {
      type: "action",
      callbackQueryId,
      action: { type: "approval", decision: "decline", token: decline, ...common },
    };
  const stop = token(TELEGRAM_CALLBACK_PREFIXES.stop);
  if (stop) return { type: "action", callbackQueryId, action: { type: "stop", token: stop, ...common } };
  return { type: "action", callbackQueryId, action: null };
}

/** The conversation of one message. See `telegramUpdateEvent`. */
function threadKeyOf(message: DynamicRecord, state: TelegramChatState): string {
  const chat = isDynamicRecord(message.chat) ? message.chat : {};
  if (chat.type === "private") return TELEGRAM_DIRECT_THREAD;
  const threadId = isNumber(message.message_thread_id) ? message.message_thread_id : null;
  if (chat.is_forum === true) return `t${message.is_topic_message === true && threadId ? threadId : 0}`;
  if (threadId) return String(threadId);
  const reply = isDynamicRecord(message.reply_to_message) ? message.reply_to_message : null;
  if (reply && isNumber(reply.message_id)) return state.threadOf(reply.message_id) ?? String(reply.message_id);
  return String(message.message_id);
}

/**
 * The thread and reply of a post. `replyThreadId` is `<thread key>` or `<thread key>:<message ID>`.
 * A post replies to that message, or to the first message of the chain, so Telegram keeps it in the
 * same reply chain. A forum post goes to its topic.
 */
export function telegramPlacement(target: MessageTarget): {
  message_thread_id?: number;
  reply_parameters?: TelegramReplyParameters;
} {
  const [threadKey = "", replyTo = ""] = (target.replyThreadId ?? "").split(":");
  const topic = threadKey.startsWith("t") ? Number(threadKey.slice(1)) : 0;
  const replyId = /^[0-9]+$/u.test(replyTo) ? Number(replyTo) : /^[0-9]+$/u.test(threadKey) ? Number(threadKey) : 0;
  return {
    ...(Number.isSafeInteger(topic) && topic > 0 ? { message_thread_id: topic } : {}),
    ...(Number.isSafeInteger(replyId) && replyId > 0
      ? { reply_parameters: { message_id: replyId, allow_sending_without_reply: true } }
      : {}),
  };
}

/** The conversation key in a target. */
export function telegramThreadKey(target: MessageTarget): string {
  return (target.replyThreadId ?? TELEGRAM_DIRECT_THREAD).split(":")[0] ?? TELEGRAM_DIRECT_THREAD;
}

/**
 * The text without OpenBot's own mentions, and whether the message names OpenBot. A command such as
 * `/help@bot` keeps its name, so the agent sees it.
 */
function withoutMention(
  text: string,
  entities: unknown[],
  botId: string,
  botUsername: string,
): { text: string; mentioned: boolean } {
  const handle = botUsername ? `@${botUsername.toLowerCase()}` : null;
  const cuts: Array<{ offset: number; length: number }> = [];
  for (const entity of entities) {
    if (!isDynamicRecord(entity) || !isNumber(entity.offset) || !isNumber(entity.length)) continue;
    const { offset, length } = entity;
    const part = text.slice(offset, offset + length).toLowerCase();
    if (entity.type === "mention" && handle !== null && part === handle) cuts.push({ offset, length });
    else if (entity.type === "text_mention" && isDynamicRecord(entity.user) && String(entity.user.id) === botId)
      cuts.push({ offset, length });
    else if (entity.type === "bot_command" && handle !== null && part.endsWith(handle))
      cuts.push({ offset: offset + length - handle.length, length: handle.length });
  }
  let result = text;
  for (const { offset, length } of cuts.sort((left, right) => right.offset - left.offset))
    result = result.slice(0, offset) + result.slice(offset + length);
  return { text: result.replace(/[ \t]{2,}/gu, " ").trim(), mentioned: cuts.length > 0 };
}

function inboundFiles(message: DynamicRecord): InboundFile[] {
  const files: InboundFile[] = [];
  const add = (value: unknown, fallbackName: string, fallbackType: string) => {
    if (!isDynamicRecord(value) || !isString(value.file_id)) return;
    files.push({
      id: value.file_id,
      name: isString(value.file_name) && value.file_name ? value.file_name : fallbackName,
      mimeType: isString(value.mime_type) ? value.mime_type : fallbackType,
      size: isNumber(value.file_size) ? value.file_size : 0,
      url: value.file_id,
    });
  };
  if (Array.isArray(message.photo)) {
    // Telegram sends each size of a photo. The last is the largest.
    add(message.photo.filter(isDynamicRecord).at(-1), "photo.jpg", "image/jpeg");
  }
  add(message.document, "document", "application/octet-stream");
  add(message.video, "video.mp4", "video/mp4");
  add(message.audio, "audio.mp3", "audio/mpeg");
  add(message.voice, "voice.ogg", "audio/ogg");
  add(message.animation, "animation.mp4", "video/mp4");
  add(message.video_note, "video-note.mp4", "video/mp4");
  return files;
}

function personName(value: DynamicRecord): string {
  const name = [value.first_name, value.last_name].filter(isString).join(" ").trim();
  if (name) return name;
  return isString(value.username) ? value.username : "";
}

function sentAt(date: unknown): string {
  return new Date((isNumber(date) ? date : Date.now() / 1_000) * 1_000).toISOString();
}
