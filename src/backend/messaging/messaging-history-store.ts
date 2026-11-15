import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import type { ContextEntry, HistoryFilter, InboundFile } from "./messaging-types";

/** The context of one conversation has at most this many earlier messages; the prompt keeps fewer. */
const CONTEXT_MESSAGES = 200;
/** A search uses at most this many words; more words find fewer messages, not other ones. */
const QUERY_WORDS = 8;

/**
 * The messages that a connection saw, in `projection_messaging_history`, for a platform that sends no
 * history to this computer (WhatsApp). The rows of one connection go when it disconnects, and each
 * row goes 90 days after it arrived (`prune`).
 */
export class MessagingHistoryStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  /**
   * Saves one message. `authorId` is the platform's id of its author, which an edit or a delete must
   * match. False when the message was saved before.
   */
  save(
    connectionId: string,
    platformChannelId: string,
    threadKey: string,
    authorId: string,
    entry: ContextEntry,
    savedAt: string,
  ): boolean {
    const result = this.#database.connection
      .prepare(
        `INSERT INTO projection_messaging_history
           (connection_id, platform_channel_id, message_id, thread_key, author_id, author_name, text, sent_at,
            files_json, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, platform_channel_id, message_id) DO NOTHING`,
      )
      .run(
        connectionId,
        platformChannelId,
        entry.id,
        threadKey,
        authorId,
        entry.authorName,
        entry.text,
        entry.sentAt,
        JSON.stringify(entry.files ?? []),
        savedAt,
      );
    return Number(result.changes) > 0;
  }

  /**
   * The messages of one conversation after `afterId` and before `beforeId`, oldest first: the newest
   * of them when there are more. A missing `afterId` reads from the start, a missing `beforeId` to the end.
   */
  between(
    connectionId: string,
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): ContextEntry[] {
    const seqOf = (messageId: string | null) => {
      if (messageId === null) return null;
      const row = databaseRow(
        this.#database.connection
          .prepare(
            `SELECT seq FROM projection_messaging_history
             WHERE connection_id = ? AND platform_channel_id = ? AND message_id = ? AND thread_key = ?`,
          )
          .get(connectionId, platformChannelId, messageId, threadKey),
      );
      return row ? requiredNumberColumn(row, "seq") : null;
    };
    const after = seqOf(afterId) ?? 0;
    const before = seqOf(beforeId) ?? Number.MAX_SAFE_INTEGER;
    return entries(
      this.#database.connection
        .prepare(
          `SELECT message_id, author_name, text, sent_at, files_json FROM projection_messaging_history
           WHERE connection_id = ? AND platform_channel_id = ? AND thread_key = ? AND seq > ? AND seq < ?
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(connectionId, platformChannelId, threadKey, after, before, CONTEXT_MESSAGES),
    );
  }

  /**
   * The newest messages of one conversation, or of the whole chat for null, by the time they were
   * sent, oldest first. A filter keeps only the messages sent before its time whose text or author has
   * each of its words. A read does not stop inside one second: a message sent in the same second as the
   * oldest one it gives comes too, so a next read with `before` = that time misses none of them.
   */
  recent(
    connectionId: string,
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
    filter: HistoryFilter = {},
  ): ContextEntry[] {
    const conditions = ["connection_id = ?", "platform_channel_id = ?"];
    const values: string[] = [connectionId, platformChannelId];
    if (threadKey !== null) {
      conditions.push("thread_key = ?");
      values.push(threadKey);
    }
    if (filter.before) {
      conditions.push("sent_at < ?");
      values.push(filter.before);
    }
    // The words are compared in JavaScript, as the chat state does: SQLite's LIKE ignores the case of
    // ASCII letters only, and "Łódź" must find "łódź".
    const rows = this.#database.connection
      .prepare(
        `SELECT message_id, author_name, text, sent_at, files_json FROM projection_messaging_history
         WHERE ${conditions.join(" AND ")} ORDER BY sent_at DESC, seq DESC`,
      )
      .iterate(...values);
    const found: ContextEntry[] = [];
    for (const raw of rows) {
      const row = databaseRow(raw);
      if (!row) continue;
      const message = entry(row);
      const last = found.at(-1);
      if (found.length >= limit && last && message.sentAt !== last.sentAt) break;
      if (matchesHistoryFilter(message, filter)) found.push(message);
    }
    return found.reverse();
  }

  /**
   * Records where the copy of a message's file is, and its real size, which the size limit counts.
   * False when the message or its file is gone.
   */
  saveFilePath(
    connectionId: string,
    platformChannelId: string,
    messageId: string,
    fileId: string,
    path: string,
    size: number,
  ): boolean {
    const files = this.#files(connectionId, platformChannelId, messageId);
    if (!files?.some((file) => file.id === fileId)) return false;
    const result = this.#database.connection
      .prepare(
        `UPDATE projection_messaging_history SET files_json = ?
         WHERE connection_id = ? AND platform_channel_id = ? AND message_id = ?`,
      )
      .run(
        JSON.stringify(files.map((file) => (file.id === fileId ? { ...file, path, size } : file))),
        connectionId,
        platformChannelId,
        messageId,
      );
    return Number(result.changes) > 0;
  }

  /** The path of the saved copy of a message's file, or null when there is none. */
  savedFile(connectionId: string, platformChannelId: string, messageId: string, fileId: string): string | null {
    return this.#files(connectionId, platformChannelId, messageId)?.find((file) => file.id === fileId)?.path ?? null;
  }

  /** Deletes the messages of every connection that arrived before `savedBefore`. Returns the paths of their files. */
  prune(savedBefore: string): string[] {
    return filePaths(
      this.#database.connection
        .prepare("DELETE FROM projection_messaging_history WHERE saved_at < ? RETURNING files_json")
        .all(savedBefore),
    );
  }

  /**
   * Deletes one message that its author deleted for everyone. A delete from a different author changes
   * nothing: the sender chooses the id of the message. Returns the paths of its files.
   */
  forgetMessage(connectionId: string, platformChannelId: string, messageId: string, authorId: string): string[] {
    return filePaths(
      this.#database.connection
        .prepare(
          `DELETE FROM projection_messaging_history
           WHERE connection_id = ? AND platform_channel_id = ? AND message_id = ? AND author_id = ?
           RETURNING files_json`,
        )
        .all(connectionId, platformChannelId, messageId, authorId),
    );
  }

  /** Replaces the text of a message that its author changed. A change from a different author does nothing. */
  editMessage(
    connectionId: string,
    platformChannelId: string,
    messageId: string,
    authorId: string,
    text: string,
  ): void {
    this.#database.connection
      .prepare(
        `UPDATE projection_messaging_history SET text = ?
         WHERE connection_id = ? AND platform_channel_id = ? AND message_id = ? AND author_id = ?`,
      )
      .run(text, connectionId, platformChannelId, messageId, authorId);
  }

  /**
   * Keeps the saved copies of a connection's files under `maxBytes`: the copies of the oldest
   * messages go first, and their messages keep only the names of the files. Returns the paths that go.
   */
  trimFiles(connectionId: string, maxBytes: number): string[] {
    const db = this.#database.connection;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const rows = databaseRows(
        db
          .prepare(
            `SELECT seq, files_json FROM projection_messaging_history
             WHERE connection_id = ? AND files_json LIKE '%"path":%' ORDER BY seq`,
          )
          .all(connectionId),
      ).map((row) => ({
        seq: requiredNumberColumn(row, "seq"),
        files: decodeFiles(requiredStringColumn(row, "files_json")),
      }));
      let total = rows.reduce((sum, row) => sum + savedBytes(row.files), 0);
      const removed: string[] = [];
      const update = db.prepare("UPDATE projection_messaging_history SET files_json = ? WHERE seq = ?");
      for (const row of rows) {
        if (total <= maxBytes) break;
        total -= savedBytes(row.files);
        removed.push(...row.files.flatMap((file) => (file.path ? [file.path] : [])));
        update.run(JSON.stringify(row.files.map(({ path: _path, ...file }) => file)), row.seq);
      }
      if (ownsTransaction) db.exec("COMMIT");
      return removed;
    } catch (error) {
      // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
      if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Deletes every message of a connection. Returns the paths of their files. */
  forget(connectionId: string): string[] {
    return filePaths(
      this.#database.connection
        .prepare("DELETE FROM projection_messaging_history WHERE connection_id = ? RETURNING files_json")
        .all(connectionId),
    );
  }

  #files(connectionId: string, platformChannelId: string, messageId: string): InboundFile[] | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT files_json FROM projection_messaging_history
           WHERE connection_id = ? AND platform_channel_id = ? AND message_id = ?`,
        )
        .get(connectionId, platformChannelId, messageId),
    );
    return row ? decodeFiles(requiredStringColumn(row, "files_json")) : null;
  }
}

/** True when the message was sent before the filter's time and has each word of its query. */
export function matchesHistoryFilter(entry: ContextEntry, filter: HistoryFilter): boolean {
  if (filter.before && !(Date.parse(entry.sentAt) < Date.parse(filter.before))) return false;
  const haystack = `${entry.authorName}\n${entry.text}`.toLocaleLowerCase();
  return queryWords(filter.query).every((word) => haystack.includes(word.toLocaleLowerCase()));
}

function queryWords(query: string | undefined): string[] {
  return (query ?? "").split(/\s+/u).filter(Boolean).slice(0, QUERY_WORDS);
}

/** Rows read newest first, as entries oldest first. */
function entries(rows: unknown): ContextEntry[] {
  return databaseRows(rows).map(entry).reverse();
}

function entry(row: DynamicRecord): ContextEntry {
  const files = decodeFiles(requiredStringColumn(row, "files_json"));
  return {
    id: requiredStringColumn(row, "message_id"),
    authorName: requiredStringColumn(row, "author_name"),
    text: requiredStringColumn(row, "text"),
    sentAt: requiredStringColumn(row, "sent_at"),
    ...(files.length ? { files } : {}),
  };
}

/** The bytes of the saved copies of a message's files. */
function savedBytes(files: readonly InboundFile[]): number {
  return files.reduce((sum, file) => sum + (file.path ? file.size : 0), 0);
}

function filePaths(rows: unknown): string[] {
  return databaseRows(rows).flatMap((row) =>
    decodeFiles(requiredStringColumn(row, "files_json")).flatMap((file) => (file.path ? [file.path] : [])),
  );
}

/** The files of a row. A file that does not decode is left out: it cannot be downloaded or opened. */
function decodeFiles(json: string): InboundFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value): InboundFile[] => {
    if (!isDynamicRecord(value)) return [];
    const { id, name, mimeType, size, url, path } = value;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof mimeType !== "string" ||
      typeof size !== "number" ||
      typeof url !== "string"
    )
      return [];
    return [{ id, name, mimeType, size, url, ...(typeof path === "string" ? { path } : {}) }];
  });
}
