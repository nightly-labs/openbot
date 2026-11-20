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

export const WHATSAPP_HISTORY_KEEP_MS = 90 * 24 * 60 * 60_000;
const WHATSAPP_FILES_MAX_BYTES = 2 * 1024 ** 3;
const DOWNLOAD_DEADLINE_MS = 10 * 60_000;

export interface WhatsAppHistory {
  connectionId: string;
  store: MessagingHistoryStore;
}

export interface WhatsAppArchiveOptions extends WhatsAppHistory {
  folder: string;
  session: WhatsAppSession;
  now?: () => number;
}

export class WhatsAppArchive {
  readonly connectionId: string;
  readonly #store: MessagingHistoryStore;
  readonly #folder: string;
  readonly #session: WhatsAppSession;
  readonly #now: () => number;
  readonly #closed = new AbortController();
  readonly #pending = new Map<string, () => Promise<void>>();
  #queue: Promise<void> = Promise.resolve();

  constructor(options: WhatsAppArchiveOptions) {
    this.connectionId = options.connectionId;
    this.#store = options.store;
    this.#folder = resolve(options.folder);
    this.#session = options.session;
    this.#now = options.now ?? Date.now;
  }

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

  async savedFile(file: InboundFile): Promise<string | null> {
    await this.#pending.get(file.id)?.();
    const [chatJid, messageId] = file.id.split("|");
    if (!chatJid || !messageId) return null;
    const path = this.#write(() => this.#store.savedFile(this.connectionId, chatJid, messageId, file.id));
    return path && this.#owns(path) ? path : null;
  }

  forget(chatJid: string, messageId: string, authorId: string): void {
    const paths = this.#write(() => this.#store.forgetMessage(this.connectionId, chatJid, messageId, authorId));
    for (const path of paths ?? []) this.#delete(path);
  }

  edit(chatJid: string, messageId: string, authorId: string, text: string): void {
    this.#write(() => this.#store.editMessage(this.connectionId, chatJid, messageId, authorId, text));
  }

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
      size = statSync(path).size;
    } catch (cause) {
      this.#delete(part);
      const reason =
        cause instanceof Error ? (cause.message === "file_too_large" ? cause.message : cause.name) : "unknown";
      logger.warn("A WhatsApp file could not be saved.", { cause: reason });
      return;
    }
    if (!this.#write(() => this.#store.saveFilePath(this.connectionId, chatJid, messageId, file.id, path, size))) {
      this.#delete(path);
      return;
    }
    for (const old of this.#write(() => this.#store.trimFiles(this.connectionId, WHATSAPP_FILES_MAX_BYTES)) ?? [])
      this.#delete(old);
  }

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

function savedName(file: InboundFile): string {
  const hash = createHash("sha256").update(file.id).digest("hex").slice(0, 16);
  const name = file.name
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._]+/u, "")
    .slice(-100);
  return `${hash}-${name || "file"}`;
}
