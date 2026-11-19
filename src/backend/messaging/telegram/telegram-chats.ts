import type { ContextEntry } from "../messaging-types";

const RECENT_MESSAGES = 200;
const THREAD_ENTRIES = 2_000;
const PRECEDING_MESSAGES = 10;
const PRECEDING_WINDOW_MS = 15 * 60_000;

interface RecentMessage extends ContextEntry {
  threadKey: string;
}

export class TelegramChatState {
  title: string;
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

  recent(threadKey: string | null, limit: number): ContextEntry[] {
    return this.#recent
      .filter((entry) => threadKey === null || entry.threadKey === threadKey)
      .slice(-limit)
      .map(({ threadKey: _threadKey, ...entry }) => entry);
  }
}

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
