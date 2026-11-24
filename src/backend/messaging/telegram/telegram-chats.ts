import { createOpenBotLogger } from "@openbot/logging";
import { type MessagingHistoryStore, matchesHistoryFilter, type ThreadedEntry } from "../messaging-history-store";
import type { ContextEntry, HistoryFilter } from "../messaging-types";

const logger = createOpenBotLogger("telegram");

const RECENT_MESSAGES = 200;
const THREAD_ENTRIES = 2_000;
const PRECEDING_MESSAGES = 10;
const PRECEDING_WINDOW_MS = 15 * 60_000;
const FORUM_THREAD_KEY = /^t([0-9]+)(?:-([0-9]+))?$/u;

export function forumThreadKey(topic: number, rootMessageId: number): string {
  return `t${topic}-${rootMessageId}`;
}

export function forumTopicOf(threadKey: string): number | null {
  const topic = FORUM_THREAD_KEY.exec(threadKey)?.[1];
  return topic === undefined ? null : Number(topic);
}

function threadRootOf(threadKey: string): string {
  return FORUM_THREAD_KEY.exec(threadKey)?.[2] ?? threadKey;
}

export interface TelegramMessage extends ThreadedEntry {
  authorId: string;
}

export interface TelegramArchive {
  connectionId: string;
  chatId: string;
  store: MessagingHistoryStore;
}

export class TelegramChatState {
  title: string;
  botUsername: string;
  readonly #names = new Map<string, string>();
  readonly #threads = new Map<number, string>();
  readonly #recent: ThreadedEntry[] = [];
  #archive: TelegramArchive | null = null;

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

  attach(archive: TelegramArchive): void {
    this.#archive = archive;
    const saved = archived("restore", () =>
      archive.store.latest(archive.connectionId, archive.chatId, RECENT_MESSAGES),
    );
    if (!saved) return;
    this.#recent.length = 0;
    for (const message of saved) {
      this.#keep(message);
      this.rememberThread(Number(message.id), message.threadKey);
    }
  }

  rememberMessage({ authorId, ...message }: TelegramMessage): void {
    if (!this.#keep(message)) return;
    const archive = this.#archive;
    if (archive)
      archived("save", () =>
        archive.store.save(
          archive.connectionId,
          archive.chatId,
          message.threadKey,
          authorId,
          message,
          new Date().toISOString(),
        ),
      );
  }

  #keep(message: ThreadedEntry): boolean {
    if (this.#recent.some((entry) => entry.id === message.id)) return false;
    this.#recent.push(message);
    this.#recent.sort((left, right) => Number(left.id) - Number(right.id));
    if (this.#recent.length > RECENT_MESSAGES) this.#recent.shift();
    return true;
  }

  history(threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    if (threadRootOf(threadKey) === beforeId) {
      const first = this.#recent.find((entry) => entry.id === beforeId);
      const since = Date.parse(first?.sentAt ?? new Date().toISOString()) - PRECEDING_WINDOW_MS;
      const topic = forumTopicOf(threadKey);
      return this.#recent
        .filter(
          (entry) =>
            (topic === null || forumTopicOf(entry.threadKey) === topic) &&
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

  get searchesHistory(): boolean {
    return this.#archive !== null;
  }

  recent(threadKey: string | null, limit: number, filter: HistoryFilter = {}): ContextEntry[] {
    const archive = this.#archive;
    const saved =
      archive &&
      archived("restore", () => archive.store.recent(archive.connectionId, archive.chatId, threadKey, limit, filter));
    if (saved) return saved;
    return this.#recent
      .filter((entry) => (threadKey === null || entry.threadKey === threadKey) && matchesHistoryFilter(entry, filter))
      .slice(-limit)
      .map(({ threadKey: _threadKey, ...entry }) => entry);
  }
}

const ARCHIVE_FAILURES = {
  restore: "The saved Telegram messages could not be read.",
  save: "A Telegram message could not be saved.",
} as const;

function archived<T>(action: keyof typeof ARCHIVE_FAILURES, operation: () => T): T | null {
  try {
    return operation();
  } catch (cause) {
    logger.warn(ARCHIVE_FAILURES[action], {
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return null;
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
