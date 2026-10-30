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
import { type SenderDecision, senderDecision, type WhatsAppSenderRules } from "./whatsapp-senders";

/** The conversation of a direct chat: the whole chat. */
export const WHATSAPP_DIRECT_THREAD = "dm";
/** An `append` message older than the connect time minus this is history, not a new message. */
const APPEND_GRACE_MS = 60_000;
/** A message older than this is not answered: its asker has moved on. */
const MESSAGE_MAX_AGE_MS = 24 * 60 * 60_000;
const APPROVE_TEXT = /^(1|approve|yes)$/iu;
const DECLINE_TEXT = /^(2|deny|no)$/iu;

/** The linked number, in both of its forms. */
export interface WhatsAppIdentity {
  /** The phone number in digits. */
  number: string;
  /** The LID user, such as `1234@lid`, when WhatsApp gave one. */
  lid: string | null;
}

export interface WhatsAppInboundContext {
  me: WhatsAppIdentity;
  /** When the socket opened, in milliseconds. */
  openedAt: number;
  now: number;
  rules: WhatsAppSenderRules;
  chats: WhatsAppChatState;
  isOwnPost(messageId: string): boolean;
  /** The conversation that a stored message (a post, or a message of a conversation) belongs to. */
  threadOf(messageId: string): string | null;
  /** The phone number of a LID user, from WhatsApp's mapping. */
  numberForLid(lid: string): Promise<string | null>;
}

export type WhatsAppEvent =
  | { type: "message"; message: InboundMessage; chatJid: string; isGroup: boolean }
  | { type: "action"; action: InboundAction }
  /** An unknown person wrote to a dedicated number. */
  | { type: "pairing"; chatJid: string; senderId: string; name: string };

/** True for an upsert that can carry a new message: live ones, and recent `append` ones. */
export function freshUpsert(type: string, message: WAMessage, openedAt: number): boolean {
  if (type === "notify") return true;
  return type === "append" && sentAt(message) >= openedAt - APPEND_GRACE_MS;
}

/** The dedup key of a message, stable across redeliveries. */
export function whatsAppDedupKey(message: WAMessage): string | null {
  const chat = message.key.remoteJid;
  const id = message.key.id;
  return chat && id ? `${jidNormalizedUser(chat)}:${id}` : null;
}

/**
 * Turns one WhatsApp message into a message for the agents, an answer to an approval menu, a pairing
 * request, or nothing. The sender rules run first, so a chat that may not give work leaves no trace.
 */
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
  if (!content || content.protocolMessage || content.reactionMessage) return null;

  const rawChatJid = jidNormalizedUser(rawChat);
  const isGroup = Boolean(isJidGroup(rawChatJid));
  const authorJid = isGroup ? (key.participant ?? null) : key.fromMe ? null : rawChatJid;
  const authorNumber = key.fromMe
    ? context.me.number
    : await numberOf([key.participantAlt, key.remoteJidAlt, authorJid], context);
  const isSelfChat = !isGroup && (await isOwnChat(rawChatJid, key.remoteJidAlt, context));
  // A direct chat goes by the phone number when it is known, so its conversation stays the same when
  // WhatsApp moves the chat between the phone and the LID form.
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
  context.chats.allowChat(chatJid);
  const name = message.pushName?.trim() || authorNumber || "WhatsApp";
  if (decision.type === "pair") return authorNumber ? { type: "pairing", chatJid, senderId: authorNumber, name } : null;

  const authorId = authorNumber ?? userOf(authorJid) ?? context.me.number;
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
  const files = filesOf(content, chatJid, id);
  context.chats.rememberKey(id, { fromMe: Boolean(key.fromMe), participant: key.participant ?? null, text });
  if (files[0]) context.chats.rememberMedia(files[0].id, message);

  const quotedThread = quotedId ? context.threadOf(quotedId) : null;
  const threadKey = !isGroup ? WHATSAPP_DIRECT_THREAD : (quotedThread ?? id);
  const target: MessageTarget = {
    platformChannelId: chatJid,
    replyThreadId: isGroup ? `${threadKey}:${id}` : null,
  };

  // A numbered answer to an approval menu: the quoted menu, or the newest one of the conversation.
  const approve = APPROVE_TEXT.test(text.trim());
  if ((approve || DECLINE_TEXT.test(text.trim())) && files.length === 0) {
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

  // In a group, only a mention, or a message of a conversation that an agent answers, counts.
  const addressed = !isGroup || namesMe;
  if (isGroup && !addressed && !quotedThread) {
    context.chats.rememberMessage({ id, chatJid, threadKey, authorName: name, text, sentAt: isoTime(message) });
    return null;
  }
  const replyTo = quotedId && contextInfo?.quotedMessage && !repliesToMe ? quoteOf(contextInfo, context) : null;
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
  context.chats.rememberMessage({
    id,
    chatJid,
    threadKey,
    authorName: name,
    text: text || files.map((file) => file.name).join(", "),
    sentAt: isoTime(message),
    ...(files.length ? { files } : {}),
  });
  return { type: "message", message: inbound, chatJid, isGroup };
}

/** The conversation of a post's target: the part before `:`, or the direct chat. */
export function whatsAppThreadKey(target: MessageTarget): string {
  return (target.replyThreadId ?? WHATSAPP_DIRECT_THREAD).split(":")[0] ?? WHATSAPP_DIRECT_THREAD;
}

/** The message a post quotes: the one it answers, or the first message of its group conversation. */
export function whatsAppQuoteId(target: MessageTarget): string | null {
  if (target.replyThreadId === null) return null;
  const [threadKey = "", replyTo = ""] = target.replyThreadId.split(":");
  if (replyTo) return replyTo;
  return threadKey && threadKey !== WHATSAPP_DIRECT_THREAD ? threadKey : null;
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
    ""
  ).trim();
}

/** The files of a message. The file id names the message, which the download reads again. */
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

function quoteOf(contextInfo: proto.IContextInfo, context: WhatsAppInboundContext) {
  const quoted = normalizeMessageContent(contextInfo.quotedMessage);
  if (!quoted) return null;
  const author = contextInfo.participant ? userOf(jidNormalizedUser(contextInfo.participant)) : null;
  return {
    authorName: (author && context.chats.name(author)) ?? author ?? "WhatsApp",
    text: textOf(quoted),
    mentionedUserIds: [],
    sentAt: new Date(context.now).toISOString(),
  };
}

/** The text with each mention as `@<id>`, and OpenBot's own mention taken out. */
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

/** The first phone number among a message's author forms. */
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

/** The send time in milliseconds. Baileys gives a number, or a protobuf Long after a decode. */
function sentAt(message: WAMessage): number {
  const value = message.messageTimestamp;
  const seconds = typeof value === "number" ? value : value ? value.toNumber() : 0;
  return seconds * 1_000;
}

function isoTime(message: WAMessage): string {
  return new Date(sentAt(message) || Date.now()).toISOString();
}
