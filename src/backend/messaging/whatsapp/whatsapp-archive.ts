import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { createOpenBotLogger } from "@openbot/logging";
import type { WAMessage } from "@openbot/whatsapp/baileys";
import type { MessagingHistoryStore } from "../messaging-history-store";
import type { ContextEntry, HistoryFilter, InboundFile } from "../messaging-types";
import { downloadWhatsAppMedia } from "./whatsapp-media";
import type { WhatsAppSession } from "./whatsapp-session";

const logger = createOpenBotLogger("whatsapp");

/** A saved message, and the copy of its file, go this long after they arrived. */
export const WHATSAPP_HISTORY_KEEP_MS = 90 * 24 * 60 * 60_000;
/** The copies of one number's files stay under this size: the oldest go first. */
const WHATSAPP_FILES_MAX_BYTES = 2 * 1024 ** 3;
/** A download that takes longer stops, so that the files after it are saved too. */
const DOWNLOAD_DEADLINE_MS = 10 * 60_000;

/** Where the messages of one linked number are saved. */
export interface WhatsAppHistory {
  connectionId: string;
  store: MessagingHistoryStore;
}

export interface WhatsAppArchiveOptions extends WhatsAppHistory {
  /** The folder for the copies of the files, which only this user can read. */
  folder: string;
  session: WhatsAppSession;
  now?: () => number;
}

/**
 * The saved messages of one linked number. WhatsApp sends no history to a new device, so the messages
 * of the allowed chats that it sees are saved in the database for 90 days, also those that do not
 * address an agent. The file of each message is downloaded when it arrives, one at a time, as WhatsApp
 * deletes old files from its servers; the copies of one number stay under 2 GB. The messaging service
 * deletes what is older than 90 days. It never logs message text, names or numbers.
 */
export class WhatsAppArchive {
  readonly connectionId: string;
  readonly #store: MessagingHistoryStore;
  readonly #folder: string;
  readonly #session: WhatsAppSession;
  readonly #now: () => number;
  readonly #closed = new AbortController();
  /** The downloads that did not finish, by file id. A call starts one now, or waits for it. */
  readonly #pending = new Map<string, () => Promise<void>>();
  #queue: Promise<void> = Promise.resolve();

  constructor(options: WhatsAppArchiveOptions) {
    this.connectionId = options.connectionId;
    this.#store = options.store;
    this.#folder = resolve(options.folder);
    this.#session = options.session;
    this.#now = options.now ?? Date.now;
  }

  /** Saves a message. A new message with a file and its stored WhatsApp message gets the file downloaded. */
  save(chatJid: string, threadKey: string, authorId: string, entry: ContextEntry, media: WAMessage | null): void {
    const saved = this.#write(() =>
      this.#store.save(this.connectionId, chatJid, threadKey, authorId, entry, new Date(this.#now()).toISOString()),
    );
    if (!saved || !media) return;
    for (const file of entry.files ?? [])
      if (file.size <= ATTACHMENT_LIMITS.fileBytes) this.#enqueue(chatJid, entry.id, file, media);
  }

  between(chatJid: string, threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    return this.#store.between(this.connectionId, chatJid, threadKey, afterId, beforeId);
  }

  recent(chatJid: string, threadKey: string | null, limit: number, filter: HistoryFilter): ContextEntry[] {
    return this.#store.recent(this.connectionId, chatJid, threadKey, limit, filter);
  }

  /**
   * The copy of a file, or null when it was not saved. A download that waits in the queue starts now,
   * and a running one is awaited, so that an agent's turn does not download the same file again.
   * The file id is `<chat JID>|<message id>`.
   */
  async savedFile(file: InboundFile): Promise<string | null> {
    await this.#pending.get(file.id)?.();
    const [chatJid, messageId] = file.id.split("|");
    if (!chatJid || !messageId) return null;
    const path = this.#write(() => this.#store.savedFile(this.connectionId, chatJid, messageId, file.id));
    return path && this.#owns(path) ? path : null;
  }

  /** A message that its author deleted for everyone goes, with its files. */
  forget(chatJid: string, messageId: string, authorId: string): void {
    const paths = this.#write(() => this.#store.forgetMessage(this.connectionId, chatJid, messageId, authorId));
    for (const path of paths ?? []) this.#delete(path);
  }

  /** A message that its author changed keeps the new text. */
  edit(chatJid: string, messageId: string, authorId: string, text: string): void {
    this.#write(() => this.#store.editMessage(this.connectionId, chatJid, messageId, authorId, text));
  }

  /** Stops the downloads, also the one that runs. A disconnect deletes the folder after this. */
  close(): void {
    this.#closed.abort();
  }

  #enqueue(chatJid: string, messageId: string, file: InboundFile, media: WAMessage): void {
    let running: Promise<void> | null = null;
    const start = () => {
      running ??= this.#download(chatJid, messageId, file, media).finally(() => this.#pending.delete(file.id));
      return running;
    };
    this.#pending.set(file.id, start);
    this.#queue = this.#queue.then(start);
  }

  /** Never fails: a file that could not be saved keeps only its name. */
  async #download(chatJid: string, messageId: string, file: InboundFile, media: WAMessage): Promise<void> {
    if (this.#closed.signal.aborted) return;
    const path = join(this.#folder, savedName(file));
    const part = `${path}.part`;
    let size: number;
    try {
      mkdirSync(this.#folder, { recursive: true, mode: 0o700 });
      const signal = AbortSignal.any([this.#closed.signal, AbortSignal.timeout(DOWNLOAD_DEADLINE_MS)]);
      await downloadWhatsAppMedia(this.#session, media, part, ATTACHMENT_LIMITS.fileBytes, signal);
      renameSync(part, path);
      // The size that the sender declares can be wrong; the limit counts the bytes on disk.
      size = statSync(path).size;
    } catch (cause) {
      this.#delete(part);
      // Only the name: a WhatsApp error can hold the file's link.
      const reason =
        cause instanceof Error ? (cause.message === "file_too_large" ? cause.message : cause.name) : "unknown";
      logger.warn("A WhatsApp file could not be saved.", { cause: reason });
      return;
    }
    // The message went while the file downloaded (a revoke, a prune or a disconnect): the copy goes too.
    if (!this.#write(() => this.#store.saveFilePath(this.connectionId, chatJid, messageId, file.id, path, size))) {
      this.#delete(path);
      return;
    }
    for (const old of this.#write(() => this.#store.trimFiles(this.connectionId, WHATSAPP_FILES_MAX_BYTES)) ?? [])
      this.#delete(old);
  }

  /** A database call that must not stop the read of a message. */
  #write<T>(write: () => T): T | null {
    try {
      return write();
    } catch (cause) {
      logger.warn("A WhatsApp message could not be saved.", { cause: cause instanceof Error ? cause.name : "unknown" });
      return null;
    }
  }

  #owns(path: string): boolean {
    return resolve(path).startsWith(`${this.#folder}${sep}`);
  }

  /** Never fails: an open file (EBUSY, EPERM) must not stop the download queue or a message event. */
  #delete(path: string): void {
    if (!this.#owns(path)) return;
    try {
      rmSync(path, { force: true });
    } catch (cause) {
      logger.warn("A saved WhatsApp file could not be deleted.", {
        cause: cause instanceof Error ? cause.name : "unknown",
      });
    }
  }
}

/** A unique name for the copy, which keeps the end of the file's own name for the agent to read. */
function savedName(file: InboundFile): string {
  const hash = createHash("sha256").update(file.id).digest("hex").slice(0, 16);
  const name = file.name
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+/u, "")
    .slice(-100);
  return `${hash}-${name || "file"}`;
}
