import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";

export const DISCORD_CUSTOM_ID_PREFIX = "openbot:";

export const DISCORD_MESSAGE_TEXT_LIMIT = 2_000;

export const DISCORD_LIST_MESSAGES_LIMIT = 100;

export const DISCORD_LIST_CHANNELS_LIMIT = 500;

export const DISCORD_UPLOAD_BYTES_LIMIT = 10 * 1024 * 1024;

export const DISCORD_ATTACHMENTS_LIMIT = 10;

export const DISCORD_ROLES_LIMIT = 250;

export const DISCORD_QUOTE_TEXT_LIMIT = 4_000;

const QUOTE_DECODE_LIMIT = 8_000;

export const DISCORD_EMBEDS_LIMIT = 10;

export const DISCORD_EMBED_TEXT_LIMIT = 6_000;

export const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4_096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1_024,
  footerText: 2_048,
  authorName: 256,
  url: 2_048,
} as const;

const EMBED_DECODE_LIMIT = 16_000;

export interface DiscordInboundAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  url: string;
}

export interface DiscordInboundQuote {
  authorId: string;
  authorName: string;
  content: string;
  sentAt: string;
  attachments: DiscordInboundAttachment[];
  embeds: string[];
  forwarded: boolean;
}

export interface DiscordInboundMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorRoleIds: string[] | null;
  content: string;
  replyTo: {
    messageId: string;
    authorIsBot: boolean;
    rootId: string | null;
    quote: DiscordInboundQuote | null;
  } | null;
  attachments: DiscordInboundAttachment[];
  sentAt: string;
}

export interface DiscordInboundInteraction {
  id: string;
  channelId: string;
  messageId: string;
  replyToId: string | null;
  userId: string;
  customId: string;
}

export type DiscordDelivery =
  | { kind: "message"; message: DiscordInboundMessage }
  | { kind: "interaction"; interaction: DiscordInboundInteraction }
  | { kind: "removed" };

export type DiscordButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface DiscordButton {
  customId: string;
  label: string;
  style: DiscordButtonStyle;
}

export interface DiscordEmbed {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
  color?: number | undefined;
  timestamp?: string | undefined;
  author?: { name: string; url?: string | undefined; icon_url?: string | undefined } | undefined;
  footer?: { text: string; icon_url?: string | undefined } | undefined;
  thumbnail?: { url: string } | undefined;
  image?: { url: string } | undefined;
  fields?: { name: string; value: string; inline?: boolean | undefined }[] | undefined;
}

export function discordEmbedTextLength(embeds: readonly DiscordEmbed[]): number {
  let length = 0;
  for (const embed of embeds) {
    length += (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
    length += (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0);
    for (const field of embed.fields ?? []) length += field.name.length + field.value.length;
  }
  return length;
}

export type DiscordApiRequest =
  | {
      op: "createMessage";
      guildId: string;
      channelId: string;
      content: string;
      replyTo: string | null;
      buttons: DiscordButton[];
      embeds?: DiscordEmbed[] | undefined;
    }
  | {
      op: "editMessage";
      guildId: string;
      channelId: string;
      messageId: string;
      content: string;
      buttons: DiscordButton[];
    }
  | { op: "deleteMessage"; guildId: string; channelId: string; messageId: string }
  | { op: "react"; guildId: string; channelId: string; messageId: string; emoji: string; on: boolean }
  | { op: "listMessages"; guildId: string; channelId: string; after: string; limit: number }
  | { op: "member"; guildId: string; userId: string }
  | { op: "channel"; guildId: string; channelId: string }
  | { op: "listChannels"; guildId: string }
  | { op: "listRoles"; guildId: string }
  | { op: "interactionReply"; guildId: string; interactionId: string; content: string }
  | {
      op: "upload";
      guildId: string;
      channelId: string;
      replyTo: string | null;
      filename: string;
      content?: string | undefined;
    };

export interface DiscordHistoryMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  replyToId: string | null;
  sentAt: string;
  attachments: DiscordInboundAttachment[];
  embeds: string[];
  forwarded: boolean;
}

export interface DiscordChannelSummary {
  id: string;
  name: string;
  kind: "channel" | "thread";
}

export interface DiscordChannelList {
  channels: DiscordChannelSummary[];
  omitted: number;
}

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
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > DISCORD_ROLES_LIMIT) invalid();
  return value.map(snowflake);
}

function quote(value: unknown): DiscordInboundQuote | null {
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
    embeds: embeds(item.embeds),
    forwarded: forwarded(item.forwarded),
  };
}

function embeds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > DISCORD_EMBEDS_LIMIT) invalid();
  return value.map((entry) => {
    const embed = text(entry);
    if (embed.length > EMBED_DECODE_LIMIT) invalid();
    return embed;
  });
}

function forwarded(value: unknown): boolean {
  if (value === undefined) return false;
  if (!isBoolean(value)) invalid();
  return value;
}

function attachments(value: unknown): DiscordInboundAttachment[] {
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

export function decodeDiscordMessageId(value: unknown): string {
  return snowflake(record(value).messageId);
}

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
      embeds: embeds(item.embeds),
      forwarded: forwarded(item.forwarded),
    };
  });
}

export function decodeDiscordChannels(value: unknown): DiscordChannelList {
  const { channels, omitted = 0 } = record(value);
  if (!Array.isArray(channels) || channels.length > DISCORD_LIST_CHANNELS_LIMIT) invalid();
  if (!isNumber(omitted) || !Number.isSafeInteger(omitted) || omitted < 0) invalid();
  return {
    channels: channels.map((entry) => {
      const item = record(entry);
      if (item.kind !== "channel" && item.kind !== "thread") invalid();
      return { id: snowflake(item.id), name: text(item.name), kind: item.kind };
    }),
    omitted,
  };
}

export function decodeDiscordRoles(value: unknown): DiscordRoleSummary[] {
  const roles = record(value).roles;
  if (!Array.isArray(roles) || roles.length > DISCORD_ROLES_LIMIT) invalid();
  return roles.map((entry) => {
    const item = record(entry);
    return { id: snowflake(item.id), name: text(item.name) };
  });
}

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
