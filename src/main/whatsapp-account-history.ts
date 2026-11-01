// The chats and messages that WhatsApp sent to this linked device. WhatsApp has no server-side
// history to ask: the phone sends recent history when the device links, then every new message. The
// connector keeps them here, encrypted on disk, and the agent tools read them from here. Only text
// and a word for media are kept, never the media itself.

import { z } from "zod";

export type WhatsAppChatKind = "private" | "group" | "self";

export interface WhatsAppStoredChat {
  /** The WhatsApp id of the chat, such as `48123456789@s.whatsapp.net` or `123-456@g.us`. */
  id: string;
  /** The name of the group, or of the contact as the phone or the contact gave it. */
  name: string | null;
  kind: WhatsAppChatKind;
  unread: number;
  archived: boolean;
  /** The time of the last message, in seconds since the epoch, or 0. */
  lastAt: number;
}

export interface WhatsAppStoredMessage {
  id: string;
  chat: string;
  /** The WhatsApp id of the sender in a group, or of the other person in a private chat. Null for the user. */
  sender: string | null;
  fromMe: boolean;
  /** The name that the sender set in WhatsApp, as it came with the message. */
  pushName: string | null;
  /** Seconds since the epoch. */
  at: number;
  text: string;
  /** A word for what the message carries besides its text, such as "image" or "voice message (12s)". */
  media: string | null;
  replyTo: string | null;
  edited: boolean;
  deleted: boolean;
}

const chatSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  kind: z.enum(["private", "group", "self"]),
  unread: z.number(),
  archived: z.boolean(),
  lastAt: z.number(),
});

const messageSchema = z.object({
  id: z.string(),
  chat: z.string(),
  sender: z.string().nullable(),
  fromMe: z.boolean(),
  pushName: z.string().nullable(),
  at: z.number(),
  text: z.string(),
  media: z.string().nullable(),
  replyTo: z.string().nullable(),
  edited: z.boolean(),
  deleted: z.boolean(),
});

const historySchema = z.object({
  version: z.literal(1),
  chats: z.array(chatSchema),
  messages: z.array(messageSchema),
  contacts: z.array(z.tuple([z.string(), z.string()])),
  pushNames: z.array(z.tuple([z.string(), z.string()])).default([]),
});

/** How many messages one chat keeps, newest first. Older ones go when new ones come. */
export const MESSAGES_PER_CHAT = 200;
/** How many chats are kept, by their last activity. */
export const MAX_CHATS = 1_000;
const MAX_TEXT = 4_000;

/** Text that agents read: messages stay whole up to a limit. */
function clip(text: string, limit = MAX_TEXT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [${text.length - limit} more characters]`;
}

export function isoDate(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : "";
}

/** The digits of a WhatsApp user id, such as `48123456789` for `48123456789:3@s.whatsapp.net`. */
export function jidPhone(jid: string): string | null {
  const match = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/u.exec(jid);
  return match?.[1] ?? null;
}

export interface WhatsAppChatListItem {
  id: string;
  name: string;
  type: WhatsAppChatKind;
  phone: string | null;
  unread_count: number;
  archived: boolean;
  last_message: { date: string; from: string; text: string } | null;
}

export interface WhatsAppMessageItem {
  id: string;
  date: string;
  from: string;
  from_me: boolean;
  text: string;
  media: string | null;
  reply_to: string | null;
  edited: boolean;
  deleted: boolean;
}

/**
 * The chats and messages of the linked device, in memory. `changed` is called after each change, so
 * the owner can schedule a write.
 */
export class WhatsAppHistory {
  readonly #chats = new Map<string, WhatsAppStoredChat>();
  /** Per chat, oldest first. */
  readonly #messages = new Map<string, WhatsAppStoredMessage[]>();
  /** The names that the user saved for people on the phone. */
  readonly #contacts = new Map<string, string>();
  /** The names that people set for themselves in WhatsApp. A saved name comes first. */
  readonly #pushNames = new Map<string, string>();
  #ownId: string | null = null;
  #changed: () => void = () => {};

  static fromJSON(value: unknown): WhatsAppHistory {
    const history = new WhatsAppHistory();
    const parsed = historySchema.safeParse(value);
    if (!parsed.success) return history;
    for (const chat of parsed.data.chats) history.#chats.set(chat.id, chat);
    for (const [id, name] of parsed.data.contacts) history.#contacts.set(id, name);
    for (const [id, name] of parsed.data.pushNames) history.#pushNames.set(id, name);
    for (const message of parsed.data.messages) history.#insert(message);
    return history;
  }

  toJSON(): z.infer<typeof historySchema> {
    return {
      version: 1,
      chats: [...this.#chats.values()],
      messages: [...this.#messages.values()].flat(),
      contacts: [...this.#contacts.entries()],
      pushNames: [...this.#pushNames.entries()],
    };
  }

  onChanged(listener: () => void): void {
    this.#changed = listener;
  }

  /** The id of the linked account, so its own chat shows as "self". */
  setOwnId(id: string | null): void {
    this.#ownId = id;
  }

  counts(): { chats: number; messages: number } {
    let messages = 0;
    for (const list of this.#messages.values()) messages += list.length;
    return { chats: this.#chats.size, messages };
  }

  // --- changes -----------------------------------------------------------------------------------

  /**
   * Adds or changes a chat. `unread` follows Baileys: a count from a history sync replaces the count,
   * a positive count from a new message adds to it, 0 means read and -1 means marked as unread.
   */
  upsertChat(update: {
    id: string;
    name?: string | null;
    kind?: WhatsAppChatKind;
    unread?: { set: number } | { add: number } | null;
    archived?: boolean;
    lastAt?: number;
  }): void {
    const current = this.#chats.get(update.id);
    const chat: WhatsAppStoredChat = current ?? {
      id: update.id,
      name: null,
      kind: update.kind ?? (update.id.endsWith("@g.us") ? "group" : "private"),
      unread: 0,
      archived: false,
      lastAt: 0,
    };
    if (update.name) chat.name = update.name;
    if (update.kind) chat.kind = update.kind;
    if (update.archived !== undefined) chat.archived = update.archived;
    if (update.lastAt && update.lastAt > chat.lastAt) chat.lastAt = update.lastAt;
    if (update.unread) {
      if ("set" in update.unread) chat.unread = Math.max(0, update.unread.set);
      else if (update.unread.add > 0) chat.unread += update.unread.add;
      else if (update.unread.add === 0) chat.unread = 0;
      else chat.unread = Math.max(chat.unread, 1);
    }
    if (this.#ownId && update.id === this.#ownId) chat.kind = "self";
    this.#chats.set(chat.id, chat);
    this.#trimChats();
    this.#changed();
  }

  deleteChat(id: string): void {
    this.#chats.delete(id);
    this.#messages.delete(id);
    this.#changed();
  }

  /** The name that the user saved for `id` on the phone. */
  setContactName(id: string, name: string | null | undefined): void {
    if (!name || this.#contacts.get(id) === name) return;
    this.#contacts.set(id, name);
    this.#changed();
  }

  /** The name that `id` set for themselves in WhatsApp. */
  setPushName(id: string, name: string | null | undefined): void {
    if (!name || this.#pushNames.get(id) === name) return;
    this.#pushNames.set(id, name);
    this.#changed();
  }

  /** Adds a message, or replaces the one with the same id. */
  upsertMessage(message: WhatsAppStoredMessage): void {
    if (!this.#chats.has(message.chat)) this.upsertChat({ id: message.chat });
    this.#insert(message);
    const chat = this.#chats.get(message.chat);
    if (chat && message.at > chat.lastAt) chat.lastAt = message.at;
    if (message.sender && message.pushName && !message.fromMe) this.#pushNames.set(message.sender, message.pushName);
    this.#changed();
  }

  /** Applies an edit or a deletion that came as its own message. */
  changeMessage(chat: string, id: string, change: { text?: string; deleted?: boolean }): void {
    const message = this.#messages.get(chat)?.find((item) => item.id === id);
    if (!message) return;
    if (change.deleted) {
      message.deleted = true;
      message.text = "";
      message.media = null;
    }
    if (change.text !== undefined) {
      message.text = clip(change.text);
      message.edited = true;
    }
    this.#changed();
  }

  #insert(message: WhatsAppStoredMessage): void {
    const list = this.#messages.get(message.chat) ?? [];
    const index = list.findIndex((item) => item.id === message.id);
    if (index >= 0) list[index] = message;
    else {
      // Most messages are newer than the rest; a history batch can bring older ones.
      let at = list.length;
      while (at > 0 && (list[at - 1]?.at ?? 0) > message.at) at -= 1;
      list.splice(at, 0, message);
      if (list.length > MESSAGES_PER_CHAT) list.splice(0, list.length - MESSAGES_PER_CHAT);
    }
    this.#messages.set(message.chat, list);
  }

  #trimChats(): void {
    if (this.#chats.size <= MAX_CHATS) return;
    const oldest = [...this.#chats.values()].sort((a, b) => a.lastAt - b.lastAt);
    for (const chat of oldest.slice(0, this.#chats.size - MAX_CHATS)) {
      this.#chats.delete(chat.id);
      this.#messages.delete(chat.id);
    }
  }

  // --- reading -----------------------------------------------------------------------------------

  /** A name for a person: the name the user saved, the chat's name, the name they set, or their number. */
  personName(id: string | null): string {
    if (id === null) return "you";
    if (this.#ownId && id === this.#ownId) return "you";
    const name = this.#contacts.get(id) ?? this.#chats.get(id)?.name ?? this.#pushNames.get(id);
    const phone = jidPhone(id);
    if (name && phone) return `${name} (+${phone})`;
    return name ?? (phone ? `+${phone}` : id.replace(/@.*$/u, ""));
  }

  chatName(chat: WhatsAppStoredChat): string {
    if (chat.kind === "self") return "You (Message yourself)";
    if (chat.name) return chat.name;
    if (chat.kind === "group") return "Unnamed group";
    return this.personName(chat.id);
  }

  chat(id: string): WhatsAppStoredChat | null {
    return this.#chats.get(id) ?? null;
  }

  messages(chat: string): readonly WhatsAppStoredMessage[] {
    return this.#messages.get(chat) ?? [];
  }

  #item(message: WhatsAppStoredMessage): WhatsAppMessageItem {
    return {
      id: message.id,
      date: isoDate(message.at),
      from: message.fromMe ? "you" : this.personName(message.sender ?? message.chat),
      from_me: message.fromMe,
      text: message.deleted ? "" : message.text,
      media: message.media,
      reply_to: message.replyTo,
      edited: message.edited,
      deleted: message.deleted,
    };
  }

  listChats(options: {
    limit: number;
    unreadOnly: boolean;
    archived: boolean;
    type: WhatsAppChatKind | "all";
    query: string | null;
  }): WhatsAppChatListItem[] {
    const query = options.query?.toLocaleLowerCase() ?? null;
    return [...this.#chats.values()]
      .filter((chat) => chat.archived === options.archived)
      .filter((chat) => !options.unreadOnly || chat.unread > 0)
      .filter((chat) => options.type === "all" || chat.kind === options.type)
      .filter((chat) => {
        if (!query) return true;
        const phone = jidPhone(chat.id);
        return this.chatName(chat).toLocaleLowerCase().includes(query) || (phone?.includes(query) ?? false);
      })
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, options.limit)
      .map((chat) => {
        const last = this.#messages.get(chat.id)?.at(-1);
        return {
          id: chat.id,
          name: this.chatName(chat),
          type: chat.kind,
          phone: jidPhone(chat.id) ? `+${jidPhone(chat.id)}` : null,
          unread_count: chat.unread,
          archived: chat.archived,
          last_message: last
            ? {
                date: isoDate(last.at),
                from: last.fromMe ? "you" : this.personName(last.sender ?? last.chat),
                text: clip(last.deleted ? "" : last.text || (last.media ?? ""), 200),
              }
            : null,
        };
      });
  }

  /** Messages of one chat, oldest to newest: the newest ones, or the ones before `beforeId`. */
  read(
    chat: string,
    options: { limit: number; beforeId: string | null; since: Date | null },
  ): { messages: WhatsAppMessageItem[]; has_more: boolean; before_found: boolean } {
    let list = this.#messages.get(chat) ?? [];
    let beforeFound = true;
    if (options.beforeId) {
      const index = list.findIndex((message) => message.id === options.beforeId);
      beforeFound = index >= 0;
      list = index >= 0 ? list.slice(0, index) : [];
    }
    if (options.since) {
      const since = options.since.getTime() / 1000;
      list = list.filter((message) => message.at >= since);
    }
    const page = list.slice(-options.limit);
    return {
      messages: page.map((message) => this.#item(message)),
      has_more: list.length > page.length,
      before_found: beforeFound,
    };
  }

  /** Messages whose text contains every word of `query`, newest first. */
  search(
    query: string,
    options: { chat: string | null; limit: number },
  ): Array<WhatsAppMessageItem & { chat: { id: string; name: string } }> {
    const words = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const chats = options.chat ? [options.chat] : [...this.#messages.keys()];
    const found: Array<{ message: WhatsAppStoredMessage; chat: WhatsAppStoredChat }> = [];
    for (const id of chats) {
      const chat = this.#chats.get(id);
      if (!chat) continue;
      for (const message of this.#messages.get(id) ?? []) {
        const text = `${message.text} ${message.media ?? ""}`.toLocaleLowerCase();
        if (!message.deleted && words.every((word) => text.includes(word))) found.push({ message, chat });
      }
    }
    return found
      .sort((a, b) => b.message.at - a.message.at)
      .slice(0, options.limit)
      .map(({ message, chat }) => ({ ...this.#item(message), chat: { id: chat.id, name: this.chatName(chat) } }));
  }

  /**
   * The chat that `reference` names: an id, a phone number, "me", or a name. With `exact`, a name
   * must be the whole name of one chat; otherwise a part of a name is enough when one chat has it.
   * Answers the chat, or a sentence for the agent.
   */
  resolveChat(reference: string, exact: boolean): WhatsAppStoredChat | string {
    const value = reference.trim();
    const known = this.#chats.get(value);
    if (known) return known;
    const lower = value.toLocaleLowerCase();
    if (lower === "me" || lower === "self") {
      const own = this.#ownId ? this.#chats.get(this.#ownId) : undefined;
      return own ?? (this.#ownId ? { ...this.#newChat(this.#ownId), kind: "self" } : "Your own chat is not known yet.");
    }
    const digits = /^\+?[\d\s\-()]{7,20}$/u.test(value) ? value.replace(/\D/gu, "") : null;
    if (digits) {
      const id = `${digits}@s.whatsapp.net`;
      return this.#chats.get(id) ?? this.#newChat(id);
    }
    const chats = [...this.#chats.values()];
    const named = chats.filter((chat) => this.chatName(chat).toLocaleLowerCase() === lower);
    if (named.length === 1 && named[0]) return named[0];
    if (named.length > 1)
      return `More than one chat is named "${value}": ${named.map((chat) => chat.id).join(", ")}. Use the id.`;
    if (exact)
      return `No chat is named exactly "${value}". Use whatsapp_list_chats and pass the id, or pass a phone number with its country code.`;
    const partial = chats.filter((chat) => this.chatName(chat).toLocaleLowerCase().includes(lower));
    if (partial.length === 1 && partial[0]) return partial[0];
    if (partial.length > 1)
      return `"${value}" matches ${partial.length} chats: ${partial
        .slice(0, 10)
        .map((chat) => `${this.chatName(chat)} (${chat.id})`)
        .join(", ")}. Use the id.`;
    return `No chat matches "${value}". Use whatsapp_list_chats to find it.`;
  }

  #newChat(id: string): WhatsAppStoredChat {
    return { id, name: null, kind: "private", unread: 0, archived: false, lastAt: 0 };
  }
}
