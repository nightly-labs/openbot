// What Signal and a host exchange for the OpenBot Discord app: the events Signal passes to a host,
// and the typed Discord calls a host asks Signal to make. Signal holds the bot token, so a host can
// ask only for these operations, and only in the guilds routed to its `ingress` socket.
//
// Signal normalizes each Gateway event before it passes it on: the host gets only the fields below,
// never the raw payload. Signal validates the requests with its own schema; the decoders here are
// what the host runs over Signal's output.

import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";

/** The prefix of the custom id of every button OpenBot posts: `openbot:<action>:<token>`. */
export const DISCORD_CUSTOM_ID_PREFIX = "openbot:";

/** Discord's limit for one message's text. */
export const DISCORD_MESSAGE_TEXT_LIMIT = 2_000;

/** The most messages one `listMessages` call returns. Discord's own page limit. */
export const DISCORD_LIST_MESSAGES_LIMIT = 100;

/** The most channels and threads one `listChannels` call returns. */
export const DISCORD_LIST_CHANNELS_LIMIT = 500;

/** The largest file a host uploads through Signal: Discord's default upload limit for a bot. */
export const DISCORD_UPLOAD_BYTES_LIMIT = 10 * 1024 * 1024;

/** The most attachments Signal passes on with one message. Discord's own limit. */
export const DISCORD_ATTACHMENTS_LIMIT = 10;

/** The most roles a guild has, and so the most a member or `listRoles` can name. Discord's own limit. */
export const DISCORD_ROLES_LIMIT = 250;

/** The longest text of a replied-to message that Signal passes on. Discord's limit is 4,000 with Nitro. */
export const DISCORD_QUOTE_TEXT_LIMIT = 4_000;

/** The longest replied-to text a host accepts: a later Signal can pass more without breaking a host. */
const QUOTE_DECODE_LIMIT = 8_000;

export interface DiscordInboundAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  /** A signed Discord CDN address. The host downloads it directly; it needs no token. */
  url: string;
}

/**
 * The message that a person's message replies to, when a person wrote it. Discord gives its text only
 * when the bot has the Message Content intent, or when that message mentions OpenBot.
 */
export interface DiscordInboundQuote {
  authorId: string;
  authorName: string;
  /** Discord markdown. Mentions stay as `<@id>`. Empty when the message has only attachments. */
  content: string;
  sentAt: string;
  /** Empty from an older Signal. */
  attachments: DiscordInboundAttachment[];
  /**
   * A forward: `content` and `attachments` are the forwarded message's, and both are empty when
   * Discord did not give them. False from an older Signal.
   */
  forwarded: boolean;
}

/** One guild message that mentions OpenBot. */
export interface DiscordInboundMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  /**
   * The author's role ids in the guild. Null from a Signal older than role lists: a host with a
   * role list then refuses the message.
   */
  authorRoleIds: string[] | null;
  /** Discord markdown. Mentions stay as `<@id>`. */
  content: string;
  /**
   * The message this one replies to. `rootId` is the message that the replied-to message itself
   * replies to, when OpenBot wrote it: OpenBot replies to the first message of a conversation, so
   * that names the conversation. `quote` is null when OpenBot wrote it, when Discord gave no text,
   * or from an older Signal.
   */
  replyTo: {
    messageId: string;
    authorIsBot: boolean;
    rootId: string | null;
    quote: DiscordInboundQuote | null;
  } | null;
  attachments: DiscordInboundAttachment[];
  sentAt: string;
}

/** A press of a button on an OpenBot message. Signal has already acknowledged it to Discord. */
export interface DiscordInboundInteraction {
  id: string;
  channelId: string;
  messageId: string;
  /** The message that the pressed message replies to, if any: the conversation's first message. */
  replyToId: string | null;
  userId: string;
  customId: string;
}

export type DiscordDelivery =
  | { kind: "message"; message: DiscordInboundMessage }
  | { kind: "interaction"; interaction: DiscordInboundInteraction }
  // OpenBot was removed from the guild. The host stops the connection; the user must connect again.
  | { kind: "removed" };

export type DiscordButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface DiscordButton {
  customId: string;
  label: string;
  style: DiscordButtonStyle;
}

/**
 * One Discord call that a host asks Signal to make. Every operation names its guild, and Signal
 * checks that each channel is in that guild. Signal sends no post that can ping anyone.
 */
export type DiscordApiRequest =
  | {
      op: "createMessage";
      guildId: string;
      channelId: string;
      content: string;
      /** The message this post replies to, or null for a plain post. */
      replyTo: string | null;
      buttons: DiscordButton[];
    }
  | {
      op: "editMessage";
      guildId: string;
      channelId: string;
      messageId: string;
      content: string;
      /** An empty list removes the buttons. */
      buttons: DiscordButton[];
    }
  | { op: "deleteMessage"; guildId: string; channelId: string; messageId: string }
  | { op: "react"; guildId: string; channelId: string; messageId: string; emoji: string; on: boolean }
  | { op: "listMessages"; guildId: string; channelId: string; after: string; limit: number }
  | { op: "member"; guildId: string; userId: string }
  | { op: "channel"; guildId: string; channelId: string }
  /** The guild's text and announcement channels and its active threads. */
  | { op: "listChannels"; guildId: string }
  /**
   * The guild's roles that a person can have, highest first. Leaves out `@everyone` and the roles
   * that an integration manages. An older Signal answers `invalid_request`.
   */
  | { op: "listRoles"; guildId: string }
  /** A reply that only the person who pressed a button sees. */
  | { op: "interactionReply"; guildId: string; interactionId: string; content: string }
  /**
   * One file, sent as `multipart/form-data`: this JSON in the `request` field and the bytes in the
   * `file` field.
   */
  | { op: "upload"; guildId: string; channelId: string; replyTo: string | null; filename: string };

export interface DiscordHistoryMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  replyToId: string | null;
  sentAt: string;
  /** Empty from an older Signal. */
  attachments: DiscordInboundAttachment[];
  /** As in `DiscordInboundQuote`. */
  forwarded: boolean;
}

/** One place of `listChannels`. A thread is a channel too: a post to its id goes into the thread. */
export interface DiscordChannelSummary {
  id: string;
  name: string;
  kind: "channel" | "thread";
}

/** One role of `listRoles`. */
export interface DiscordRoleSummary {
  id: string;
  name: string;
}

export const DISCORD_API_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "unknown_guild",
  "forbidden",
  "not_found",
  "rate_limited",
  "discord_failed",
  "unavailable",
] as const;
export type DiscordApiErrorCode = (typeof DISCORD_API_ERROR_CODES)[number];

/** The body of every refused call. `retryAfterMs` comes with `rate_limited`. */
export interface DiscordApiErrorBody {
  error: { code: DiscordApiErrorCode; retryAfterMs?: number };
}

function invalid(): never {
  throw new Error("Signal returned an invalid Discord value.");
}

function text(value: unknown): string {
  if (!isString(value)) invalid();
  return value;
}

function snowflake(value: unknown): string {
  const candidate = text(value);
  if (!/^[0-9]{1,24}$/u.test(candidate)) invalid();
  return candidate;
}

function nullableSnowflake(value: unknown): string | null {
  return value === null ? null : snowflake(value);
}

function record(value: unknown) {
  if (!isDynamicRecord(value)) invalid();
  return value;
}

function attachment(value: unknown): DiscordInboundAttachment {
  const item = record(value);
  if (!isNumber(item.size) || !Number.isInteger(item.size) || item.size < 0) invalid();
  const url = text(item.url);
  if (new URL(url).protocol !== "https:") invalid();
  return {
    id: snowflake(item.id),
    filename: text(item.filename),
    contentType: item.contentType === null ? null : text(item.contentType),
    size: item.size,
    url,
  };
}

function roleIds(value: unknown): string[] | null {
  // An older Signal sends no roles.
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > DISCORD_ROLES_LIMIT) invalid();
  return value.map(snowflake);
}

function quote(value: unknown): DiscordInboundQuote | null {
  // An older Signal sends no quote.
  if (value === undefined || value === null) return null;
  const item = record(value);
  const content = text(item.content);
  if (content.length > QUOTE_DECODE_LIMIT) invalid();
  return {
    authorId: snowflake(item.authorId),
    authorName: text(item.authorName),
    content,
    sentAt: text(item.sentAt),
    attachments: attachments(item.attachments),
    forwarded: forwarded(item.forwarded),
  };
}

function forwarded(value: unknown): boolean {
  // An older Signal sends no flag.
  if (value === undefined) return false;
  if (!isBoolean(value)) invalid();
  return value;
}

function attachments(value: unknown): DiscordInboundAttachment[] {
  // An older Signal sends no attachments.
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > DISCORD_ATTACHMENTS_LIMIT) invalid();
  return value.map(attachment);
}

function inboundMessage(value: unknown): DiscordInboundMessage {
  const item = record(value);
  let replyTo: DiscordInboundMessage["replyTo"] = null;
  if (item.replyTo !== null) {
    const reply = record(item.replyTo);
    if (!isBoolean(reply.authorIsBot)) invalid();
    replyTo = {
      messageId: snowflake(reply.messageId),
      authorIsBot: reply.authorIsBot,
      rootId: nullableSnowflake(reply.rootId),
      quote: quote(reply.quote),
    };
  }
  if (!Array.isArray(item.attachments) || item.attachments.length > DISCORD_ATTACHMENTS_LIMIT) invalid();
  return {
    id: snowflake(item.id),
    channelId: snowflake(item.channelId),
    authorId: snowflake(item.authorId),
    authorName: text(item.authorName),
    authorRoleIds: roleIds(item.authorRoleIds),
    content: text(item.content),
    replyTo,
    attachments: item.attachments.map(attachment),
    sentAt: text(item.sentAt),
  };
}

function inboundInteraction(value: unknown): DiscordInboundInteraction {
  const item = record(value);
  return {
    id: snowflake(item.id),
    channelId: snowflake(item.channelId),
    messageId: snowflake(item.messageId),
    replyToId: nullableSnowflake(item.replyToId),
    userId: snowflake(item.userId),
    customId: text(item.customId),
  };
}

/** Throws for a delivery that does not match: the host cannot act on it. */
export function decodeDiscordDelivery(value: unknown): DiscordDelivery {
  const item = record(value);
  switch (item.kind) {
    case "message":
      return { kind: "message", message: inboundMessage(item.message) };
    case "interaction":
      return { kind: "interaction", interaction: inboundInteraction(item.interaction) };
    case "removed":
      return { kind: "removed" };
    default:
      return invalid();
  }
}

/** The answer of `createMessage` and `upload`. */
export function decodeDiscordMessageId(value: unknown): string {
  return snowflake(record(value).messageId);
}

/** The answer of `member` and `channel`. */
export function decodeDiscordName(value: unknown): string {
  return text(record(value).name);
}

export function decodeDiscordHistory(value: unknown): DiscordHistoryMessage[] {
  const messages = record(value).messages;
  if (!Array.isArray(messages) || messages.length > DISCORD_LIST_MESSAGES_LIMIT) invalid();
  return messages.map((entry) => {
    const item = record(entry);
    if (!isBoolean(item.authorIsBot)) invalid();
    return {
      id: snowflake(item.id),
      authorId: snowflake(item.authorId),
      authorName: text(item.authorName),
      authorIsBot: item.authorIsBot,
      content: text(item.content),
      replyToId: nullableSnowflake(item.replyToId),
      sentAt: text(item.sentAt),
      attachments: attachments(item.attachments),
      forwarded: forwarded(item.forwarded),
    };
  });
}

export function decodeDiscordChannels(value: unknown): DiscordChannelSummary[] {
  const channels = record(value).channels;
  if (!Array.isArray(channels) || channels.length > DISCORD_LIST_CHANNELS_LIMIT) invalid();
  return channels.map((entry) => {
    const item = record(entry);
    if (item.kind !== "channel" && item.kind !== "thread") invalid();
    return { id: snowflake(item.id), name: text(item.name), kind: item.kind };
  });
}

export function decodeDiscordRoles(value: unknown): DiscordRoleSummary[] {
  const roles = record(value).roles;
  if (!Array.isArray(roles) || roles.length > DISCORD_ROLES_LIMIT) invalid();
  return roles.map((entry) => {
    const item = record(entry);
    return { id: snowflake(item.id), name: text(item.name) };
  });
}

/** The code of a refused call, or null for a body that is not one. */
export function decodeDiscordApiError(value: unknown): DiscordApiErrorBody["error"] | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.error)) return null;
  const code = value.error.code;
  if (!isOneOf(DISCORD_API_ERROR_CODES, code)) return null;
  const retryAfterMs = value.error.retryAfterMs;
  return {
    code,
    ...(isNumber(retryAfterMs) && retryAfterMs >= 0 ? { retryAfterMs } : {}),
  };
}
