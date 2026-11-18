import type { ContextEntry } from "../messaging-types";

/** What one chat remembers of the messages it saw. Telegram has no history API. */
const RECENT_MESSAGES = 200;
/** The reply map of a basic group, which has no thread IDs. */
const THREAD_ENTRIES = 2_000;
/** The most messages, and the time before it, that give the context of a conversation's first message. */
const PRECEDING_MESSAGES = 10;
const PRECEDING_WINDOW_MS = 15 * 60_000;

interface RecentMessage extends ContextEntry {
  threadKey: string;
}

/**
 * What the host knows of one Telegram chat, in memory only: the names of the people it saw, the
 * messages it saw (the context of a reply chain), and, in a basic group, which conversation each
 * message belongs to. The adapter and the transport of the chat share it. A restart forgets it: a
 * reply in a basic group to a message from before the restart starts a new conversation.
 */
export class TelegramChatState {
  title: string;
  /** The bot's username, without `@`, for mention detection. Empty until known. */
  botUsername: string;
  readonly #names = new Map<string, string>();
  readonly #threads = new Map<number, string>();
  readonly #recent: RecentMessage[] = [];

  constructor(title: string, botUsername: string) {
    this.title = title;
    this.botUsername = botUsername;
  }

  name(userId: string): string | null {
    return this.#names.get(userId) ?? null;
  }

  rememberName(userId: string, name: string): void {
    if (name) this.#names.set(userId, name);
  }

  threadOf(messageId: number): string | null {
    return this.#threads.get(messageId) ?? null;
  }

  rememberThread(messageId: number, threadKey: string): void {
    this.#threads.delete(messageId);
    this.#threads.set(messageId, threadKey);
    if (this.#threads.size > THREAD_ENTRIES) {
      const oldest = this.#threads.keys().next().value;
      if (oldest !== undefined) this.#threads.delete(oldest);
    }
  }

  rememberMessage(message: RecentMessage): void {
    if (this.#recent.some((entry) => entry.id === message.id)) return;
    this.#recent.push(message);
    this.#recent.sort((left, right) => Number(left.id) - Number(right.id));
    if (this.#recent.length > RECENT_MESSAGES) this.#recent.shift();
  }

  /**
   * The messages of one conversation after `afterId` and before `beforeId`, oldest first. The first
   * message of a conversation has no chain before it: its context is the chat's messages of the last
   * minutes before it, such as a voice note that a person sent without a mention, as on Discord.
   */
  history(threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    if (threadKey === beforeId) {
      const first = this.#recent.find((entry) => entry.id === beforeId);
      const since = Date.parse(first?.sentAt ?? new Date().toISOString()) - PRECEDING_WINDOW_MS;
      return this.#recent
        .filter(
          (entry) =>
            Number(entry.id) < Number(beforeId) &&
            Date.parse(entry.sentAt) >= since &&
            (afterId === null || Number(entry.id) > Number(afterId)),
        )
        .slice(-PRECEDING_MESSAGES)
        .map(({ threadKey: _threadKey, ...entry }) => entry);
    }
    return this.#recent
      .filter(
        (entry) =>
          entry.threadKey === threadKey &&
          Number(entry.id) < Number(beforeId) &&
          (afterId === null || Number(entry.id) > Number(afterId)),
      )
      .map(({ threadKey: _threadKey, ...entry }) => entry);
  }

  /** The newest messages of one conversation, or of the whole chat for null, oldest first. */
  recent(threadKey: string | null, limit: number): ContextEntry[] {
    return this.#recent
      .filter((entry) => threadKey === null || entry.threadKey === threadKey)
      .slice(-limit)
      .map(({ threadKey: _threadKey, ...entry }) => entry);
  }
}

/** The state of each chat, by `<bot ID>:<chat ID>`, for one driver. */
export class TelegramChats {
  readonly #chats = new Map<string, TelegramChatState>();

  get(botId: string, chatId: string, title: string, botUsername: string): TelegramChatState {
    const key = `${botId}:${chatId}`;
    const existing = this.#chats.get(key);
    if (existing) {
      if (botUsername) existing.botUsername = botUsername;
      return existing;
    }
    const created = new TelegramChatState(title, botUsername);
    this.#chats.set(key, created);
    return created;
  }
}
