import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from "@openbot/whatsapp/baileys";
import type { InboundAction, InboundFile, InboundMessage, MessageTarget } from "../messaging-types";
import type { WhatsAppChatState } from "./whatsapp-chats";
import { isOtherOpenBotPost } from "./whatsapp-loop-guard";
import { type SenderDecision, senderDecision, type WhatsAppSenderRules } from "./whatsapp-senders";

export const WHATSAPP_DIRECT_THREAD = "dm";
const APPEND_GRACE_MS = 60_000;
const HELD_MAX_AGE_MS = 20 * 60_000;
const MESSAGE_MAX_AGE_MS = 24 * 60 * 60_000;
const APPROVE_TEXT = /^(1|approve|yes)$/iu;
const DECLINE_TEXT = /^(2|deny|no)$/iu;
const CONTACT_LIMIT = 20;
const CONTACT_PHONE_LIMIT = 5;
const CONTACT_FIELD_LIMIT = 128;

export interface WhatsAppIdentity {
  number: string;
  lid: string | null;
}

export interface WhatsAppInboundContext {
  me: WhatsAppIdentity;
  openedAt: number;
  now: number;
  rules: WhatsAppSenderRules;
  chats: WhatsAppChatState;
  isOwnPost(messageId: string): boolean;
  threadOf(messageId: string): string | null;
  numberForLid(lid: string): Promise<string | null>;
  historyOnly?: boolean;
}

export type WhatsAppEvent =
  | { type: "message"; message: InboundMessage; chatJid: string; isGroup: boolean }
  | { type: "action"; action: InboundAction }
  | { type: "pairing"; chatJid: string; senderId: string; name: string }
  | { type: "otherOpenBot"; chatJid: string };

export interface WhatsAppUpsertWindow {
  openedAt: number;
  synced: boolean;
  now: number;
}

export function freshUpsert(type: string, message: WAMessage, upsertWindow: WhatsAppUpsertWindow): boolean {
  if (type === "notify") return true;
  if (type !== "append") return false;
  const sent = sentAt(message);
  return (
    sent >= upsertWindow.openedAt - APPEND_GRACE_MS ||
    (upsertWindow.synced && sent >= upsertWindow.now - HELD_MAX_AGE_MS)
  );
}

export function whatsAppDedupKey(message: WAMessage): string | null {
  const chat = message.key.remoteJid;
  const id = message.key.id;
  return chat && id ? `${jidNormalizedUser(chat)}:${id}` : null;
}

export async function whatsAppInbound(
  message: WAMessage,
  context: WhatsAppInboundContext,
): Promise<WhatsAppEvent | null> {
  const key = message.key;
  const rawChat = key.remoteJid;
  const id = key.id;
  if (!rawChat || !id || !message.message) return null;
  if (message.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) return null;
  if (isJidStatusBroadcast(rawChat) || isJidNewsletter(rawChat) || isJidBroadcast(rawChat)) return null;
  if (key.fromMe && context.isOwnPost(id)) return null;
  if (context.now - sentAt(message) > MESSAGE_MAX_AGE_MS) return null;
  const content = normalizeMessageContent(message.message);
  if (!content || content.reactionMessage) return null;
  const protocol = content.protocolMessage;
  if (protocol && !savedChange(protocol)) return null;

  const rawChatJid = jidNormalizedUser(rawChat);
  const isGroup = Boolean(isJidGroup(rawChatJid));
  const authorJid = isGroup ? (key.participant ?? null) : key.fromMe ? null : rawChatJid;
  const authorNumber = key.fromMe
    ? context.me.number
    : await numberOf([key.participantAlt, key.remoteJidAlt, authorJid], context);
  const isSelfChat = !isGroup && (await isOwnChat(rawChatJid, key.remoteJidAlt, context));
  const chatJid = isGroup
    ? rawChatJid
    : isSelfChat
      ? userJid(context.me.number)
      : authorNumber && !key.fromMe
        ? userJid(authorNumber)
        : rawChatJid;
  const decision: SenderDecision = senderDecision(context.rules, {
    isGroup,
    chatJid,
    authorNumber,
    isSelfChat,
    fromMe: Boolean(key.fromMe),
  });
  if (decision.type === "ignore") return null;
  const historyOnly = decision.type === "save" || context.historyOnly === true;
  const authorId = authorNumber ?? userOf(authorJid) ?? context.me.number;
  if (protocol) {
    applyChange(protocol, chatJid, authorId, context.chats);
    return null;
  }
  const firstCopy = firstCopyId(message.message);
  if (firstCopy && context.chats.keyOf(firstCopy)) return null;
  const name = message.pushName?.trim() || authorNumber || "WhatsApp";
  if (decision.type === "pair")
    return authorNumber && !historyOnly ? { type: "pairing", chatJid, senderId: authorNumber, name } : null;

  context.chats.rememberName(authorId, key.fromMe ? null : message.pushName);
  const contextInfo = contextOf(content);
  const quotedId = contextInfo?.stanzaId ?? null;
  const mentioned = (contextInfo?.mentionedJid ?? []).map((jid) => jidNormalizedUser(jid));
  const namesMe = mentioned.some((jid) => isMe(jid, context.me));
  const repliesToMe =
    quotedId !== null &&
    (context.isOwnPost(quotedId) ||
      (contextInfo?.participant ? isMe(jidNormalizedUser(contextInfo.participant), context.me) : false));
  const text = textOf(content);
  if (isSelfChat && isOtherOpenBotPost(text)) return historyOnly ? null : { type: "otherOpenBot", chatJid };
  const files = filesOf(content, chatJid, id);
  context.chats.rememberKey(id, { fromMe: Boolean(key.fromMe), participant: key.participant ?? null, text });
  if (files[0]) context.chats.rememberMedia(files[0].id, message);

  const quotedThread = quotedId ? context.threadOf(quotedId) : null;
  const threadKey = !isGroup ? WHATSAPP_DIRECT_THREAD : (quotedThread ?? id);
  const target: MessageTarget = {
    platformChannelId: chatJid,
    replyThreadId: isGroup ? `${threadKey}:${id}` : isSelfChat ? `${WHATSAPP_DIRECT_THREAD}:${id}` : null,
  };

  const approve = APPROVE_TEXT.test(text.trim());
  if (!historyOnly && (approve || DECLINE_TEXT.test(text.trim())) && files.length === 0) {
    const menu =
      (quotedId ? ((m) => (m ? { messageId: quotedId, menu: m } : null))(context.chats.menu(quotedId)) : null) ??
      context.chats.latestMenu(chatJid, threadKey);
    const button = menu?.menu.buttons.find((candidate) => candidate.action === (approve ? "accept" : "decline"));
    if (menu && button)
      return {
        type: "action",
        action: {
          type: "approval",
          decision: approve ? "accept" : "decline",
          token: button.token,
          actorId: authorId,
          target,
          platformMessageId: menu.messageId,
        },
      };
  }

  const addressed = !isGroup || namesMe;
  const remembered = {
    id,
    chatJid,
    threadKey,
    authorId,
    authorName: name,
    text: text || files.map((file) => file.name).join(", "),
    sentAt: isoTime(message),
    ...(files.length ? { files } : {}),
  };
  if (historyOnly || (isGroup && !addressed && !quotedThread)) {
    context.chats.rememberMessage(remembered);
    return null;
  }
  const replyTo =
    quotedId && contextInfo?.quotedMessage && !repliesToMe
      ? quoteOf(contextInfo, { rawChat, chatJid, quotedId, isGroup }, context)
      : null;
  const inbound: InboundMessage = {
    dedupKey: `${chatJid}:${id}`,
    platformChannelId: chatJid,
    threadKey,
    target,
    platformMessageId: id,
    isDirect: !isGroup,
    requiresLink: isGroup && !namesMe,
    authorId,
    text: withMentions(text, mentioned, context.me),
    mentionedUserIds: mentioned.filter((jid) => !isMe(jid, context.me)).flatMap((jid) => userOf(jid) ?? []),
    files,
    ...(replyTo ? { replyTo } : {}),
  };
  context.chats.rememberMessage(remembered);
  return { type: "message", message: inbound, chatJid, isGroup };
}

export function whatsAppThreadKey(target: MessageTarget): string {
  return (target.replyThreadId ?? WHATSAPP_DIRECT_THREAD).split(":")[0] ?? WHATSAPP_DIRECT_THREAD;
}

export function whatsAppQuoteId(target: MessageTarget): string | null {
  if (target.replyThreadId === null) return null;
  const [threadKey = "", replyTo = ""] = target.replyThreadId.split(":");
  if (replyTo) return replyTo;
  return threadKey && threadKey !== WHATSAPP_DIRECT_THREAD ? threadKey : null;
}

const SECOND_UPLOADS: ReadonlySet<number> = new Set([
  proto.MessageAssociation.AssociationType.HD_IMAGE_DUAL_UPLOAD,
  proto.MessageAssociation.AssociationType.HD_VIDEO_DUAL_UPLOAD,
  proto.MessageAssociation.AssociationType.HEVC_VIDEO_DUAL_UPLOAD,
]);

function firstCopyId(message: proto.IMessage): string | null {
  let current: proto.IMessage | null | undefined = message;
  for (let depth = 0; current && depth < 4; depth++) {
    const association = current.messageContextInfo?.messageAssociation;
    if (association?.associationType != null && SECOND_UPLOADS.has(association.associationType))
      return association.parentMessageKey?.id ?? null;
    current = current.ephemeralMessage?.message ?? current.associatedChildMessage?.message;
  }
  return null;
}

function savedChange(protocol: proto.Message.IProtocolMessage): boolean {
  return (
    protocol.type === proto.Message.ProtocolMessage.Type.REVOKE ||
    protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
  );
}

function applyChange(
  protocol: proto.Message.IProtocolMessage,
  chatJid: string,
  authorId: string,
  chats: WhatsAppChatState,
): void {
  const messageId = protocol.key?.id;
  if (!messageId) return;
  if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
    chats.forgetMessage(chatJid, messageId, authorId);
    return;
  }
  const edited = normalizeMessageContent(protocol.editedMessage);
  const text = edited ? textOf(edited) : "";
  if (text) chats.editMessage(chatJid, messageId, authorId, text);
}

function contextOf(content: proto.IMessage): proto.IContextInfo | null {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    null
  );
}

function textOf(content: proto.IMessage): string {
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    contactsText(content)
  ).trim();
}

function contactsText(content: proto.IMessage): string {
  const contacts = content.contactMessage ? [content.contactMessage] : (content.contactsArrayMessage?.contacts ?? []);
  return contacts.slice(0, CONTACT_LIMIT).map(contactLine).join("\n");
}

function contactLine(contact: proto.Message.IContactMessage): string {
  const card = vcardFields(contact.vcard);
  const name = contactValue(contact.displayName ?? "") || card.name;
  const details = [name, card.phones.join(", ")].filter(Boolean).join(" ");
  return details ? `[Contact: ${details}]` : "[Contact]";
}

function vcardFields(vcard: string | null | undefined): { name: string; phones: string[] } {
  let fullName = "";
  let structuredName = "";
  const phones: string[] = [];
  for (const line of (vcard ?? "").split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(";")[0]?.split(".").pop()?.trim().toUpperCase();
    const value = contactValue(line.slice(colon + 1));
    if (!value) continue;
    if (key === "FN") fullName ||= value;
    else if (key === "N") structuredName ||= contactValue(value.replace(/;/gu, " "));
    else if (key === "TEL" && phones.length < CONTACT_PHONE_LIMIT) phones.push(value.replace(/^tel:/iu, "").trim());
  }
  return { name: fullName || structuredName, phones: phones.filter(Boolean) };
}

function contactValue(value: string): string {
  return value
    .replace(/\\n/giu, " ")
    .replace(/\\([,;\\])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, CONTACT_FIELD_LIMIT);
}

function filesOf(content: proto.IMessage, chatJid: string, messageId: string): InboundFile[] {
  const id = `${chatJid}|${messageId}`;
  const size = (value: number | Long | null | undefined) => Number(value ?? 0);
  if (content.imageMessage)
    return [
      {
        id,
        name: `image-${messageId}.${extension(content.imageMessage.mimetype, "jpg")}`,
        mimeType: content.imageMessage.mimetype ?? "image/jpeg",
        size: size(content.imageMessage.fileLength),
        url: id,
      },
    ];
  if (content.videoMessage)
    return [
      {
        id,
        name: `video-${messageId}.${extension(content.videoMessage.mimetype, "mp4")}`,
        mimeType: content.videoMessage.mimetype ?? "video/mp4",
        size: size(content.videoMessage.fileLength),
        url: id,
      },
    ];
  if (content.audioMessage)
    return [
      {
        id,
        name: `${content.audioMessage.ptt ? "voice" : "audio"}-${messageId}.${extension(content.audioMessage.mimetype, "ogg")}`,
        mimeType: content.audioMessage.mimetype ?? "audio/ogg",
        size: size(content.audioMessage.fileLength),
        url: id,
      },
    ];
  if (content.documentMessage)
    return [
      {
        id,
        name: content.documentMessage.fileName?.trim() || `file-${messageId}`,
        mimeType: content.documentMessage.mimetype ?? "application/octet-stream",
        size: size(content.documentMessage.fileLength),
        url: id,
      },
    ];
  return [];
}

type Long = { toNumber(): number } | number;

function extension(mimeType: string | null | undefined, fallback: string): string {
  const subtype = mimeType?.split(";")[0]?.split("/")[1]?.trim();
  return subtype && /^[a-z0-9.+-]{1,12}$/u.test(subtype) ? subtype.replace("jpeg", "jpg") : fallback;
}

function quoteOf(
  contextInfo: proto.IContextInfo,
  where: { rawChat: string; chatJid: string; quotedId: string; isGroup: boolean },
  context: WhatsAppInboundContext,
) {
  const quoted = normalizeMessageContent(contextInfo.quotedMessage);
  if (!quoted) return null;
  const author = contextInfo.participant ? userOf(jidNormalizedUser(contextInfo.participant)) : null;
  const stored = context.chats.media(`${where.chatJid}|${where.quotedId}`);
  const files = filesOf(
    (stored?.message ? normalizeMessageContent(stored.message) : null) ?? quoted,
    where.chatJid,
    where.quotedId,
  );
  if (files[0] && !stored)
    context.chats.rememberMedia(files[0].id, {
      key: {
        remoteJid: where.rawChat,
        id: where.quotedId,
        fromMe: false,
        ...(where.isGroup && contextInfo.participant ? { participant: contextInfo.participant } : {}),
      },
      message: contextInfo.quotedMessage ?? null,
    });
  const names = files.length ? `(Attached files: ${files.map((file) => file.name).join(", ")})` : "";
  return {
    authorName: (author && context.chats.name(author)) ?? author ?? "WhatsApp",
    text: [textOf(quoted), names].filter(Boolean).join("\n"),
    mentionedUserIds: [],
    sentAt: new Date(context.now).toISOString(),
    messageId: where.quotedId,
    files,
  };
}

function withMentions(text: string, mentioned: string[], me: WhatsAppIdentity): string {
  let result = text;
  for (const jid of mentioned) {
    const user = userOf(jid);
    if (!user) continue;
    result = result.replaceAll(`@${user}`, isMe(jid, me) ? "" : `@${user}`);
  }
  return result.replace(/\s{2,}/gu, " ").trim();
}

function isMe(jid: string, me: WhatsAppIdentity): boolean {
  const user = userOf(jid);
  return user !== null && (user === me.number || (me.lid !== null && `${user}@lid` === me.lid));
}

async function isOwnChat(chatJid: string, alt: string | null | undefined, context: WhatsAppInboundContext) {
  if (isMe(chatJid, context.me)) return true;
  if (alt && isMe(jidNormalizedUser(alt), context.me)) return true;
  if (isLidUser(chatJid)) return (await context.numberForLid(chatJid)) === context.me.number;
  return false;
}

async function numberOf(
  jids: ReadonlyArray<string | null | undefined>,
  context: WhatsAppInboundContext,
): Promise<string | null> {
  for (const jid of jids) if (jid && isPnUser(jid)) return userOf(jidNormalizedUser(jid));
  for (const jid of jids)
    if (jid && isLidUser(jid)) {
      const number = await context.numberForLid(jidNormalizedUser(jid));
      if (number) return number;
    }
  return null;
}

export function userJid(number: string): string {
  return `${number}@s.whatsapp.net`;
}

function userOf(jid: string | null | undefined): string | null {
  return jid ? (jidDecode(jid)?.user ?? null) : null;
}

export function sentAt(message: WAMessage): number {
  const value = message.messageTimestamp;
  const seconds = typeof value === "number" ? value : value ? value.toNumber() : 0;
  return seconds * 1_000;
}

function isoTime(message: WAMessage): string {
  return new Date(sentAt(message) || Date.now()).toISOString();
}
