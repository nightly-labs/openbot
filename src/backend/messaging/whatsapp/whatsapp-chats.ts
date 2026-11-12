import { createOpenBotLogger } from "@openbot/logging";
import type { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import type { WAMessage } from "@openbot/whatsapp/baileys";
import { Option, Schema } from "effect";
import type { ContextEntry, MessageBody } from "../messaging-types";

const logger = createOpenBotLogger("whatsapp");

/** What one number remembers of the messages it saw. WhatsApp sends no history to a new device. */
const RECENT_MESSAGES = 200;
/** The store value that keeps the recent messages across a restart. */
const RECENT_META = "recent-messages";
/** The text that a stored message keeps. The prompt reads at most 12,000 characters of context. */
const STORED_TEXT = 2_000;
/** The messages of this time go to the store in one write. */
const SAVE_DELAY_MS = 1_000;
/** The approval and stop posts whose numbered answers the transport still reads. */
const MENU_ENTRIES = 200;
/** The messages whose keys a reaction or a quote needs, and whose files a download reads. */
const MESSAGE_ENTRIES = 500;

interface RecentMessage extends ContextEntry {
  chatJid: string;
  threadKey: string;
}

const StoredRecentMessages = Schema.Struct({
  version: Schema.Literal(1),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      chatJid: Schema.String,
      threadKey: Schema.String,
      authorName: Schema.String,
      text: Schema.String,
      sentAt: Schema.String,
    }),
  ),
});
const StoredRecentMessagesJson = Schema.fromJsonString(StoredRecentMessages);
const decodeStoredRecentMessages = Schema.decodeUnknownOption(StoredRecentMessagesJson);
const encodeStoredRecentMessages = Schema.encodeSync(StoredRecentMessagesJson);

/** Where the recent messages stay across a restart: the number's encrypted store. */
export type RecentMessageStore = Pick<WhatsAppAuthStore, "getMeta" | "setMeta">;

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
 * What the host knows of the chats of one linked number: the names of the people and groups it saw,
 * the messages of the chats it answers (the context of a conversation), and the numbered menus of its
 * approval posts. The adapter and the transport share it. The recent messages stay in the number's
 * store, without their files, so the context and `messaging_history` have them after a restart. A
 * restart forgets the rest. Only messages of allowed chats come here; the transport drops every other
 * chat before this.
 */
export class WhatsAppChatState {
  readonly #names = new Map<string, string>();
  readonly #groups = new Map<string, string>();
  readonly #recent: RecentMessage[];
  readonly #menus = new Map<string, MenuPost>();
  readonly #keys = new Map<string, MessageKeyFacts>();
  readonly #media = new Map<string, WAMessage>();
  readonly #store: RecentMessageStore | null;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: RecentMessageStore | null = null) {
    this.#store = store;
    this.#recent = store ? storedMessages(store) : [];
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
    if (this.#recent.some((entry) => entry.id === message.id && entry.chatJid === message.chatJid)) return;
    this.#recent.push(message);
    if (this.#recent.length > RECENT_MESSAGES) this.#recent.shift();
    if (!this.#store || this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.#saveTimer.unref?.();
  }

  /**
   * Writes the recent messages to the store now, when a write waits. The runtime calls it before it
   * closes the store. A failed write keeps them in memory only.
   */
  flush(): void {
    if (!this.#store || !this.#saveTimer) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    const messages = this.#recent.map((message) => ({
      id: message.id,
      chatJid: message.chatJid,
      threadKey: message.threadKey,
      authorName: message.authorName,
      text: storedText(message),
      sentAt: message.sentAt,
    }));
    try {
      this.#store.setMeta(RECENT_META, encodeStoredRecentMessages({ version: 1, messages }));
    } catch (cause) {
      logger.warn("The recent WhatsApp messages could not be saved.", {
        cause: cause instanceof Error ? cause.name : "unknown",
      });
    }
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

/** The text that the store keeps of a message: a long text is shortened, and the files are named. */
function storedText({ text, files }: RecentMessage): string {
  const kept = text.length > STORED_TEXT ? `${text.slice(0, STORED_TEXT)}… (shortened)` : text;
  const names = (files ?? []).map((file) => file.name).join(", ");
  if (!names || text === names) return kept;
  return kept ? `${kept}\nFiles: ${names}` : `Files: ${names}`;
}

/** The recent messages that the store kept, or none when it has none or cannot read them. */
function storedMessages(store: RecentMessageStore): RecentMessage[] {
  try {
    const text = store.getMeta(RECENT_META);
    if (text === undefined) return [];
    const stored = decodeStoredRecentMessages(text);
    if (Option.isSome(stored)) return stored.value.messages.slice(-RECENT_MESSAGES).map((message) => ({ ...message }));
    logger.warn("The stored recent WhatsApp messages have an unknown form.");
  } catch (cause) {
    logger.warn("The stored recent WhatsApp messages could not be read.", {
      cause: cause instanceof Error ? cause.name : "unknown",
    });
  }
  return [];
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
