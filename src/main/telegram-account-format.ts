// Turns Telegram objects into small, plain records for agents: names instead of ids where a person
// would use names, ISO dates, a word for each kind of media, and long text cut short. GramJS is
// loaded with this module, so the main process loads it only when the connection is used.

import { Api, utils } from "telegram";
import type { TelegramAccountRecordAccount } from "./telegram-account-connector-store";

export type TelegramChatType = "saved" | "private" | "bot" | "group" | "channel";

export interface TelegramChatSummary {
  id: string;
  title: string;
  type: TelegramChatType;
  username: string | null;
}

/** The kinds of file that a message can carry and that `telegram_download_media` can save. */
export type TelegramAttachmentKind =
  | "photo"
  | "voice"
  | "audio"
  | "video"
  | "video_note"
  | "gif"
  | "sticker"
  | "document";

/** A file that a message carries, as an agent sees it before it downloads the file. */
export interface TelegramAttachment {
  kind: TelegramAttachmentKind;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
}

export interface TelegramMessageRecord {
  id: number;
  date: string;
  from: string;
  out: boolean;
  text: string;
  media: string | null;
  /** The file of the message, or null. `telegram_download_media` saves it. */
  attachment: TelegramAttachment | null;
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

function documentKind(document: Api.Document): { kind: TelegramAttachmentKind; duration: number | null } {
  const attributes = document.attributes;
  if (attributes.some((attribute) => attribute instanceof Api.DocumentAttributeSticker))
    return { kind: "sticker", duration: null };
  // A GIF also has a video attribute, so the animated attribute is checked first.
  if (attributes.some((attribute) => attribute instanceof Api.DocumentAttributeAnimated))
    return { kind: "gif", duration: null };
  for (const attribute of attributes) {
    if (attribute instanceof Api.DocumentAttributeAudio)
      return { kind: attribute.voice ? "voice" : "audio", duration: attribute.duration };
    if (attribute instanceof Api.DocumentAttributeVideo)
      return { kind: attribute.roundMessage ? "video_note" : "video", duration: Math.round(attribute.duration) };
  }
  return { kind: "document", duration: null };
}

/** The byte size of the largest size of a photo, which `downloadMedia` saves. */
function photoSize(photo: Api.Photo): number | null {
  let largest: number | null = null;
  for (const size of photo.sizes) {
    const bytes =
      size instanceof Api.PhotoSize
        ? size.size
        : size instanceof Api.PhotoSizeProgressive
          ? Math.max(...size.sizes)
          : size instanceof Api.PhotoCachedSize
            ? size.bytes.length
            : null;
    if (bytes !== null && (largest === null || bytes > largest)) largest = bytes;
  }
  return largest;
}

/** The file of a message that can be downloaded, or null. A web page preview or a poll has none. */
export function messageAttachment(message: Api.Message): TelegramAttachment | null {
  const media = message.media;
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    return {
      kind: "photo",
      file_name: null,
      mime_type: "image/jpeg",
      size_bytes: photoSize(media.photo),
      duration_seconds: null,
    };
  }
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const document = media.document;
    const { kind, duration } = documentKind(document);
    return {
      kind,
      file_name: documentName(document),
      mime_type: document.mimeType || null,
      size_bytes: document.size.toJSNumber(),
      duration_seconds: duration,
    };
  }
  return null;
}

/**
 * The name of a downloaded file: the sender's file name, or the kind, with the extension that
 * Telegram's type gives. Only letters, digits, spaces, dots, dashes and underscores stay, so the name
 * cannot leave its folder.
 */
export function attachmentFileName(message: Api.Message, attachment: TelegramAttachment): string {
  const base = (attachment.file_name ?? attachment.kind).normalize("NFC");
  const clean = base
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .replace(/^[.\s]+/u, "")
    .slice(0, 120);
  // GramJS answers ".jpg" for a photo and "ogg", without the dot, for a document.
  const found = attachment.file_name ? "" : utils.getExtension(message.media);
  const dotted = found && !found.startsWith(".") ? `.${found}` : found;
  // Voice messages are OGG with Opus; ".oga" is a name that few players and transcribers know.
  const extension = dotted === ".oga" ? ".ogg" : dotted;
  return `${message.id}-${clean || attachment.kind}${extension}`;
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
    attachment: service ? null : messageAttachment(message),
    reply_to: message.replyTo instanceof Api.MessageReplyHeader ? (message.replyTo.replyToMsgId ?? null) : null,
    forwarded_from: forwardedFrom(message),
    edited: Boolean(message.editDate && !message.editHide),
  };
}
