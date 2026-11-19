import type { WAMessage } from "@openbot/whatsapp/baileys";
import { matchesHistoryFilter } from "../messaging-history-store";
import type { ContextEntry, HistoryFilter, InboundFile, MessageBody } from "../messaging-types";
import type { WhatsAppArchive } from "./whatsapp-archive";

const RECENT_MESSAGES = 200;
const MENU_ENTRIES = 200;
const MESSAGE_ENTRIES = 500;

interface RecentMessage extends ContextEntry {
  chatJid: string;
  threadKey: string;
  authorId: string;
}

export interface MessageKeyFacts {
  fromMe: boolean;
  participant: string | null;
  text: string;
}

export interface MenuPost {
  chatJid: string;
  threadKey: string;
  buttons: NonNullable<MessageBody["buttons"]>;
}

export class WhatsAppChatState {
  readonly #names = new Map<string, string>();
  readonly #groups = new Map<string, string>();
  readonly #recent: RecentMessage[] = [];
  readonly #menus = new Map<string, MenuPost>();
  readonly #keys = new Map<string, MessageKeyFacts>();
  readonly #media = new Map<string, WAMessage>();
  #archive: WhatsAppArchive | null = null;

  attach(archive: WhatsAppArchive): void {
    if (this.#archive?.connectionId === archive.connectionId) return;
    this.#archive?.close();
    this.#archive = archive;
  }

  detach(): void {
    this.#archive?.close();
    this.#archive = null;
  }

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
    const file = message.files?.[0];
    this.#archive?.save(
      message.chatJid,
      message.threadKey,
      message.authorId,
      contextEntry(message),
      file ? this.media(file.id) : null,
    );
    if (this.#recent.some((entry) => entry.id === message.id && entry.chatJid === message.chatJid)) return;
    this.#recent.push(message);
    if (this.#recent.length > RECENT_MESSAGES) this.#recent.shift();
  }

  history(chatJid: string, threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    if (this.#archive) return this.#archive.between(chatJid, threadKey, afterId, beforeId);
    const conversation = this.#recent.filter((entry) => entry.chatJid === chatJid && entry.threadKey === threadKey);
    const end = conversation.findIndex((entry) => entry.id === beforeId);
    const start = afterId === null ? -1 : conversation.findIndex((entry) => entry.id === afterId);
    return conversation.slice(start + 1, end === -1 ? undefined : end).map(contextEntry);
  }

  recent(chatJid: string, threadKey: string | null, limit: number, filter: HistoryFilter = {}): ContextEntry[] {
    if (this.#archive) return this.#archive.recent(chatJid, threadKey, limit, filter);
    return this.#recent
      .filter(
        (entry) =>
          entry.chatJid === chatJid &&
          (threadKey === null || entry.threadKey === threadKey) &&
          matchesHistoryFilter(entry, filter),
      )
      .slice(-limit)
      .map(contextEntry);
  }

  rememberKey(messageId: string, facts: MessageKeyFacts): void {
    remember(this.#keys, messageId, facts);
  }

  keyOf(messageId: string): MessageKeyFacts | null {
    return this.#keys.get(messageId) ?? null;
  }

  rememberMedia(fileId: string, message: WAMessage): void {
    remember(this.#media, fileId, message);
  }

  media(fileId: string): WAMessage | null {
    return this.#media.get(fileId) ?? null;
  }

  async savedFile(file: InboundFile): Promise<string | null> {
    return (await this.#archive?.savedFile(file)) ?? null;
  }

  forgetMessage(chatJid: string, messageId: string, authorId: string): void {
    const index = this.#recent.findIndex((entry) => this.#isMessage(entry, chatJid, messageId, authorId));
    if (index !== -1) this.#recent.splice(index, 1);
    this.#archive?.forget(chatJid, messageId, authorId);
  }

  editMessage(chatJid: string, messageId: string, authorId: string, text: string): void {
    const entry = this.#recent.find((candidate) => this.#isMessage(candidate, chatJid, messageId, authorId));
    if (entry) entry.text = text;
    this.#archive?.edit(chatJid, messageId, authorId, text);
  }

  #isMessage(entry: RecentMessage, chatJid: string, messageId: string, authorId: string): boolean {
    return entry.id === messageId && entry.chatJid === chatJid && entry.authorId === authorId;
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

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MESSAGE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function contextEntry({
  chatJid: _chat,
  threadKey: _thread,
  authorId: _author,
  ...entry
}: RecentMessage): ContextEntry {
  return entry;
}
