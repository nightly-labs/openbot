import type { WAMessage } from "@openbot/whatsapp/baileys";
import type { ContextEntry, MessageBody } from "../messaging-types";

/** What one number remembers of the messages it saw. WhatsApp sends no history to a new device. */
const RECENT_MESSAGES = 200;
/** The approval and stop posts whose numbered answers the transport still reads. */
const MENU_ENTRIES = 200;
/** The messages whose keys a reaction or a quote needs, and whose files a download reads. */
const MESSAGE_ENTRIES = 500;

interface RecentMessage extends ContextEntry {
  chatJid: string;
  threadKey: string;
}

/** What a reaction or a quote needs of a message: who wrote it. */
export interface MessageKeyFacts {
  fromMe: boolean;
  participant: string | null;
  text: string;
}

/** The buttons of one post, which WhatsApp shows as a numbered menu. */
export interface MenuPost {
  chatJid: string;
  threadKey: string;
  buttons: NonNullable<MessageBody["buttons"]>;
}

/**
 * What the host knows of the chats of one linked number, in memory only: the names of the people and
 * groups it saw, the messages of the chats it answers (the context of a conversation), and the
 * numbered menus of its approval posts. The adapter and the transport share it. A restart forgets it.
 * Only messages of allowed chats come here; the transport drops every other chat before this.
 */
export class WhatsAppChatState {
  readonly #names = new Map<string, string>();
  readonly #groups = new Map<string, string>();
  readonly #recent: RecentMessage[] = [];
  readonly #menus = new Map<string, MenuPost>();
  readonly #keys = new Map<string, MessageKeyFacts>();
  readonly #media = new Map<string, WAMessage>();
  readonly #allowedChats = new Set<string>();

  name(userId: string): string | null {
    return this.#names.get(userId) ?? null;
  }

  rememberName(userId: string, name: string | null | undefined): void {
    const trimmed = name?.trim();
    if (trimmed) this.#names.set(userId, trimmed.slice(0, 256));
  }

  groupName(chatJid: string): string | null {
    return this.#groups.get(chatJid) ?? null;
  }

  rememberGroup(chatJid: string, subject: string | null | undefined): void {
    const trimmed = subject?.trim();
    if (trimmed) this.#groups.set(chatJid, trimmed.slice(0, 256));
  }

  rememberMessage(message: RecentMessage): void {
    if (this.#recent.some((entry) => entry.id === message.id && entry.chatJid === message.chatJid)) return;
    this.#recent.push(message);
    if (this.#recent.length > RECENT_MESSAGES) this.#recent.shift();
  }

  /** The messages of one conversation after `afterId` and before `beforeId`, oldest first. */
  history(chatJid: string, threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    const conversation = this.#recent.filter((entry) => entry.chatJid === chatJid && entry.threadKey === threadKey);
    const end = conversation.findIndex((entry) => entry.id === beforeId);
    const start = afterId === null ? -1 : conversation.findIndex((entry) => entry.id === afterId);
    return conversation.slice(start + 1, end === -1 ? undefined : end).map(contextEntry);
  }

  /** The newest messages of one conversation, or of the whole chat for null, oldest first. */
  recent(chatJid: string, threadKey: string | null, limit: number): ContextEntry[] {
    return this.#recent
      .filter((entry) => entry.chatJid === chatJid && (threadKey === null || entry.threadKey === threadKey))
      .slice(-limit)
      .map(contextEntry);
  }

  /** A chat whose message the sender rules let through, so OpenBot may answer in it. */
  allowChat(chatJid: string): void {
    this.#allowedChats.add(chatJid);
  }

  isAllowedChat(chatJid: string): boolean {
    return this.#allowedChats.has(chatJid);
  }

  rememberKey(messageId: string, facts: MessageKeyFacts): void {
    remember(this.#keys, messageId, facts);
  }

  keyOf(messageId: string): MessageKeyFacts | null {
    return this.#keys.get(messageId) ?? null;
  }

  /** Keeps a message with files, so a download can read it. The id is `<chat JID>|<message id>`. */
  rememberMedia(fileId: string, message: WAMessage): void {
    remember(this.#media, fileId, message);
  }

  media(fileId: string): WAMessage | null {
    return this.#media.get(fileId) ?? null;
  }

  rememberMenu(messageId: string, menu: MenuPost): void {
    this.#menus.delete(messageId);
    this.#menus.set(messageId, menu);
    if (this.#menus.size > MENU_ENTRIES) {
      const oldest = this.#menus.keys().next().value;
      if (oldest !== undefined) this.#menus.delete(oldest);
    }
  }

  menu(messageId: string): MenuPost | null {
    return this.#menus.get(messageId) ?? null;
  }

  /** The newest menu of a conversation, for a numbered answer that does not quote it. */
  latestMenu(chatJid: string, threadKey: string): { messageId: string; menu: MenuPost } | null {
    let found: { messageId: string; menu: MenuPost } | null = null;
    for (const [messageId, menu] of this.#menus)
      if (menu.chatJid === chatJid && menu.threadKey === threadKey) found = { messageId, menu };
    return found;
  }

  forgetMenu(messageId: string): void {
    this.#menus.delete(messageId);
  }
}

/** Sets a value as the newest entry of a bounded map. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MESSAGE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function contextEntry({ chatJid: _chat, threadKey: _thread, ...entry }: RecentMessage): ContextEntry {
  return entry;
}
