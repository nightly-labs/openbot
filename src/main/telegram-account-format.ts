// Turns Telegram objects into small, plain records for agents: names instead of ids where a person
// would use names, ISO dates, a word for each kind of media, and long text cut short. GramJS is
// loaded with this module, so the main process loads it only when the connection is used.

import { Api } from "telegram";
import type { TelegramAccountRecordAccount } from "./telegram-account-connector-store";

export type TelegramChatType = "saved" | "private" | "bot" | "group" | "channel";

export interface TelegramChatSummary {
  id: string;
  title: string;
  type: TelegramChatType;
  username: string | null;
}

export interface TelegramMessageRecord {
  id: number;
  date: string;
  from: string;
  out: boolean;
  text: string;
  media: string | null;
  reply_to: number | null;
  forwarded_from: string | null;
  edited: boolean;
}

const MAX_TEXT = 4000;

export function clip(text: string, limit = MAX_TEXT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [${text.length - limit} more characters]`;
}

export function isoDate(unixSeconds: number | undefined): string {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : "";
}

/** A person's or chat's name as Telegram shows it, with the @username when there is one. */
export function entityName(entity: unknown): string {
  if (entity instanceof Api.User) {
    if (entity.self) return "you";
    if (entity.deleted) return "Deleted Account";
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ") || "Unknown";
    return entity.username ? `${name} (@${entity.username})` : name;
  }
  if (
    entity instanceof Api.Chat ||
    entity instanceof Api.Channel ||
    entity instanceof Api.ChatForbidden ||
    entity instanceof Api.ChannelForbidden
  ) {
    return entity.title;
  }
  return "Unknown";
}

export function chatType(entity: unknown): TelegramChatType {
  if (entity instanceof Api.User) {
    if (entity.self) return "saved";
    return entity.bot ? "bot" : "private";
  }
  if (entity instanceof Api.Channel) return entity.broadcast ? "channel" : "group";
  return "group";
}

export function chatTitle(entity: unknown): string {
  if (entity instanceof Api.User) {
    if (entity.self) return "Saved Messages";
    if (entity.deleted) return "Deleted Account";
    return [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || "Unknown";
  }
  return entityName(entity);
}

export function chatUsername(entity: unknown): string | null {
  if ((entity instanceof Api.User || entity instanceof Api.Channel) && entity.username) return entity.username;
  return null;
}

export function accountFromUser(user: unknown): TelegramAccountRecordAccount {
  if (!(user instanceof Api.User)) throw new Error("Telegram did not return the signed-in user.");
  return {
    id: user.id.toString(),
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    username: user.username ?? null,
    phone: user.phone ? `+${user.phone.replace(/^\+/u, "")}` : null,
  };
}

function documentName(document: Api.Document): string | null {
  for (const attribute of document.attributes) {
    if (attribute instanceof Api.DocumentAttributeFilename) return attribute.fileName;
  }
  return null;
}

function documentLabel(document: Api.Document): string {
  for (const attribute of document.attributes) {
    if (attribute instanceof Api.DocumentAttributeSticker) return `sticker ${attribute.alt}`.trim();
    if (attribute instanceof Api.DocumentAttributeAudio) {
      return attribute.voice
        ? `voice message (${attribute.duration}s)`
        : `audio: ${attribute.title ?? documentName(document) ?? "file"}`;
    }
    if (attribute instanceof Api.DocumentAttributeVideo) {
      return attribute.roundMessage
        ? `video message (${Math.round(attribute.duration)}s)`
        : `video (${Math.round(attribute.duration)}s)`;
    }
    if (attribute instanceof Api.DocumentAttributeAnimated) return "GIF";
  }
  return `file: ${documentName(document) ?? document.mimeType}`;
}

/** A word for what a message carries besides its text. */
function mediaLabel(message: Api.Message): string | null {
  const media = message.media;
  if (!media || media instanceof Api.MessageMediaEmpty) return null;
  if (media instanceof Api.MessageMediaPhoto) return "photo";
  if (media instanceof Api.MessageMediaGeo || media instanceof Api.MessageMediaGeoLive) return "location";
  if (media instanceof Api.MessageMediaVenue) return `venue: ${media.title}`;
  if (media instanceof Api.MessageMediaContact)
    return `contact: ${[media.firstName, media.lastName].filter(Boolean).join(" ")}`;
  if (media instanceof Api.MessageMediaPoll) {
    const question = media.poll.question;
    return `poll: ${typeof question === "string" ? question : question.text}`;
  }
  if (media instanceof Api.MessageMediaWebPage) return "link preview";
  if (media instanceof Api.MessageMediaDice) return `dice: ${media.emoticon} ${media.value}`;
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document)
    return documentLabel(media.document);
  return media.className.replace(/^MessageMedia/u, "").toLowerCase();
}

function forwardedFrom(message: Api.Message): string | null {
  const header = message.fwdFrom;
  if (!header) return null;
  if (header.fromName) return header.fromName;
  const forward = message.forward;
  const source = forward?.sender ?? forward?.chat;
  return source ? entityName(source) : "someone";
}

/** The service action of a message, such as a member that joined, or null for an ordinary message. */
function serviceAction(message: Api.Message): string | null {
  return message.action ? message.action.className : null;
}

export function messageRecord(message: Api.Message): TelegramMessageRecord {
  const service = serviceAction(message);
  const text = service ? `[${service.replace(/^MessageAction/u, "")}]` : clip(message.message ?? "");
  return {
    id: message.id,
    date: isoDate(message.date),
    from: message.out ? "you" : entityName(message.sender),
    out: Boolean(message.out),
    text,
    media: service ? null : mediaLabel(message),
    reply_to: message.replyTo instanceof Api.MessageReplyHeader ? (message.replyTo.replyToMsgId ?? null) : null,
    forwarded_from: forwardedFrom(message),
    edited: Boolean(message.editDate && !message.editHide),
  };
}
