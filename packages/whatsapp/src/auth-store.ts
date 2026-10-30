// The auth state of one linked WhatsApp device, and the small records the connector keeps beside it.
//
// One SQLite file per connection (`<userData>/whatsapp/<connectionId>.db`). It holds secrets — the
// device's identity, prekeys, Signal sessions and sender keys — not user data: `openbot.db` stays the
// source of truth for connections, threads and memories. Every value is sealed with AES-256-GCM under a
// 32-byte store key that the main process keeps in its safeStorage credential file. The additional data
// of each value names its table and row, so a value moved to another row does not open.
//
// The database is held in exclusive locking mode for as long as the store is open. A second process
// that opens the same file gets `WhatsAppStoreLocked` at once, so two sockets never share one session
// (WhatsApp would close both with "connection replaced").
//
// Writes are synchronous and each `keys.set` is one transaction, so a crash leaves either the old or
// the new keys, never half of a ratchet step.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@openbot/whatsapp/baileys";
import { Schema } from "effect";

const SCHEMA_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** How long a sent message stays available for a retry receipt. */
const OUTBOUND_TTL_MS = 24 * 60 * 60 * 1000;
/** How long an inbound message stays in the journal, for replay after a crash. */
const INBOX_TTL_MS = 30 * 60 * 1000;
/** How long a post keeps its reply chain. */
const POSTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class WhatsAppStoreLocked extends Schema.TaggedError<WhatsAppStoreLocked>()("WhatsAppStoreLocked", {}) {}

export class WhatsAppStoreUnreadable extends Schema.TaggedError<WhatsAppStoreUnreadable>()(
  "WhatsAppStoreUnreadable",
  {},
) {}

/** One inbound message kept until the connector has handed it on. */
export interface InboxEntry {
  dedupKey: string;
  /** The normalized message, as the connector serialized it. */
  payload: string;
  receivedAt: number;
}

/** Where a post of OpenBot belongs: its chat and the conversation it answers. */
export interface PostRecord {
  chatJid: string;
  threadKey: string;
}

export interface WhatsAppAuthStoreOptions {
  path: string;
  /** 32 random bytes from the credential store. */
  key: Uint8Array;
  now?: () => number;
}

/** Makes a new random store key. */
export function newStoreKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export class WhatsAppAuthStore {
  readonly #db: DatabaseSync;
  readonly #key: Uint8Array;
  readonly #now: () => number;
  #creds: AuthenticationCreds;
  #closed = false;

  private constructor(db: DatabaseSync, key: Uint8Array, now: () => number, creds: AuthenticationCreds) {
    this.#db = db;
    this.#key = key;
    this.#now = now;
    this.#creds = creds;
  }

  /** Opens or creates the store. Fails with `WhatsAppStoreLocked` when another process holds it. */
  static open(options: WhatsAppAuthStoreOptions): WhatsAppAuthStore {
    if (options.key.byteLength !== KEY_BYTES) throw new WhatsAppStoreUnreadable();
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(options.path);
    try {
      db.exec("PRAGMA busy_timeout = 0");
      db.exec("PRAGMA locking_mode = EXCLUSIVE");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      // The first write takes the exclusive lock and keeps it until close.
      db.exec("BEGIN IMMEDIATE");
      db.exec("COMMIT");
    } catch (cause) {
      db.close();
      if (isBusy(cause)) throw new WhatsAppStoreLocked();
      throw cause;
    }
    try {
      chmodSync(options.path, 0o600);
      migrate(db);
      const store = new WhatsAppAuthStore(db, options.key, options.now ?? Date.now, initAuthCreds());
      const saved = store.#readCreds();
      if (saved) store.#creds = saved;
      else store.saveCreds();
      return store;
    } catch (cause) {
      // A store that does not open, such as one with another key, must not keep its lock.
      db.close();
      throw cause;
    }
  }

  /** The Baileys auth state. `creds` is the live object that Baileys changes; call `saveCreds` after. */
  get state(): AuthenticationState {
    return {
      creds: this.#creds,
      keys: {
        get: (type, ids) => this.#getKeys(type, ids),
        set: (data) => this.#setKeys(data),
        clear: () => {
          this.#db.exec("DELETE FROM keys");
        },
      },
    };
  }

  /** True once the device is linked: WhatsApp gave it an account. */
  get linked(): boolean {
    return Boolean(this.#creds.me?.id);
  }

  get creds(): AuthenticationCreds {
    return this.#creds;
  }

  saveCreds(): void {
    this.#run("INSERT INTO creds (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", [
      this.#seal("creds", JSON.stringify(this.#creds, BufferJSON.replacer)),
    ]);
  }

  /** Keeps a sent message for WhatsApp's retry receipts. */
  putOutbound(messageId: string, message: proto.IMessage): void {
    this.#run(
      "INSERT INTO outbound (id, value, sent_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
      [messageId, this.#sealBytes(`outbound:${messageId}`, proto.Message.encode(message).finish()), this.#now()],
    );
  }

  /** True for a message that this device sent in the last day. */
  hasOutbound(messageId: string): boolean {
    return this.#db.prepare("SELECT 1 FROM outbound WHERE id = ?").get(messageId) !== undefined;
  }

  getOutbound(messageId: string): proto.IMessage | undefined {
    const row = this.#db.prepare("SELECT value FROM outbound WHERE id = ?").get(messageId);
    if (!row) return undefined;
    return proto.Message.decode(this.#openBytes(`outbound:${messageId}`, blob(row.value)));
  }

  /** Journals an inbound message before it is handed on. Returns false when it was already there. */
  journal(entry: InboxEntry): boolean {
    const result = this.#db
      .prepare("INSERT OR IGNORE INTO inbox (dedup_key, value, received_at, handled) VALUES (?, ?, ?, 0)")
      .run(entry.dedupKey, this.#seal(`inbox:${entry.dedupKey}`, entry.payload), entry.receivedAt);
    return result.changes > 0;
  }

  markHandled(dedupKey: string): void {
    this.#run("UPDATE inbox SET handled = 1 WHERE dedup_key = ?", [dedupKey]);
  }

  /** The journaled messages that were never handed on, oldest first. */
  unhandled(): InboxEntry[] {
    const since = this.#now() - INBOX_TTL_MS;
    return this.#db
      .prepare(
        "SELECT dedup_key, value, received_at FROM inbox WHERE handled = 0 AND received_at >= ? ORDER BY received_at",
      )
      .all(since)
      .map((row) => {
        const dedupKey = String(row.dedup_key);
        return {
          dedupKey,
          payload: this.#open(`inbox:${dedupKey}`, blob(row.value)),
          receivedAt: Number(row.received_at),
        };
      });
  }

  putPost(messageId: string, record: PostRecord): void {
    this.#run("INSERT INTO posts (message_id, value, created_at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO NOTHING", [
      messageId,
      this.#seal(`post:${messageId}`, JSON.stringify(record)),
      this.#now(),
    ]);
  }

  getPost(messageId: string): PostRecord | undefined {
    const row = this.#db.prepare("SELECT value FROM posts WHERE message_id = ?").get(messageId);
    if (!row) return undefined;
    return parsePostRecord(this.#open(`post:${messageId}`, blob(row.value)));
  }

  getMeta(name: string): string | undefined {
    const row = this.#db.prepare("SELECT value FROM meta WHERE name = ?").get(name);
    return row ? this.#open(`meta:${name}`, blob(row.value)) : undefined;
  }

  setMeta(name: string, value: string): void {
    this.#run("INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", [
      name,
      this.#seal(`meta:${name}`, value),
    ]);
  }

  /** Removes outbound, journal and post rows past their time. */
  prune(): void {
    const now = this.#now();
    this.#transaction(() => {
      this.#db.prepare("DELETE FROM outbound WHERE sent_at < ?").run(now - OUTBOUND_TTL_MS);
      this.#db.prepare("DELETE FROM inbox WHERE received_at < ?").run(now - INBOX_TTL_MS);
      this.#db.prepare("DELETE FROM posts WHERE created_at < ?").run(now - POSTS_TTL_MS);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #readCreds(): AuthenticationCreds | null {
    const row = this.#db.prepare("SELECT value FROM creds WHERE id = 1").get();
    if (!row) return null;
    const creds: AuthenticationCreds = JSON.parse(this.#open("creds", blob(row.value)), BufferJSON.reviver);
    return creds;
  }

  #getKeys<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): { [id: string]: SignalDataTypeMap[T] } {
    const result: { [id: string]: SignalDataTypeMap[T] } = {};
    const select = this.#db.prepare("SELECT value FROM keys WHERE type = ? AND id = ?");
    for (const id of ids) {
      const row = select.get(type, id);
      if (!row) continue;
      // Plain objects: an app state key is read through its fields only, as Baileys' own stores do.
      const value: SignalDataTypeMap[T] = JSON.parse(
        this.#open(`keys:${type}:${id}`, blob(row.value)),
        BufferJSON.reviver,
      );
      result[id] = value;
    }
    return result;
  }

  #setKeys(data: SignalDataSet): void {
    const upsert = this.#db.prepare(
      "INSERT INTO keys (type, id, value) VALUES (?, ?, ?) ON CONFLICT(type, id) DO UPDATE SET value = excluded.value",
    );
    const remove = this.#db.prepare("DELETE FROM keys WHERE type = ? AND id = ?");
    this.#transaction(() => {
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values ?? {})) {
          if (value === null || value === undefined) remove.run(type, id);
          else upsert.run(type, id, this.#seal(`keys:${type}:${id}`, JSON.stringify(value, BufferJSON.replacer)));
        }
      }
    });
  }

  #transaction(work: () => void): void {
    this.#db.exec("BEGIN");
    try {
      work();
      this.#db.exec("COMMIT");
    } catch (cause) {
      this.#db.exec("ROLLBACK");
      throw cause;
    }
  }

  #run(sql: string, params: Array<string | number | Uint8Array>): void {
    this.#db.prepare(sql).run(...params);
  }

  #seal(aad: string, text: string): Uint8Array {
    return this.#sealBytes(aad, Buffer.from(text, "utf8"));
  }

  #open(aad: string, sealed: Uint8Array): string {
    return Buffer.from(this.#openBytes(aad, sealed)).toString("utf8");
  }

  #sealBytes(aad: string, plain: Uint8Array): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  }

  #openBytes(aad: string, sealed: Uint8Array): Uint8Array {
    if (sealed.byteLength < IV_BYTES + TAG_BYTES) throw new WhatsAppStoreUnreadable();
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, sealed.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(sealed.subarray(sealed.byteLength - TAG_BYTES));
      return Buffer.concat([
        decipher.update(sealed.subarray(IV_BYTES, sealed.byteLength - TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new WhatsAppStoreUnreadable();
    }
  }
}

function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version === SCHEMA_VERSION) return;
  if (version > SCHEMA_VERSION) throw new WhatsAppStoreUnreadable();
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creds (id INTEGER PRIMARY KEY CHECK (id = 1), value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS keys (type TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL,
        PRIMARY KEY (type, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS outbound (id TEXT PRIMARY KEY, value BLOB NOT NULL, sent_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS outbound_sent ON outbound (sent_at);
      CREATE TABLE IF NOT EXISTS inbox (dedup_key TEXT PRIMARY KEY, value BLOB NOT NULL,
        received_at INTEGER NOT NULL, handled INTEGER NOT NULL CHECK (handled IN (0, 1)));
      CREATE INDEX IF NOT EXISTS inbox_received ON inbox (received_at);
      CREATE TABLE IF NOT EXISTS posts (message_id TEXT PRIMARY KEY, value BLOB NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at);
      CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value BLOB NOT NULL);
    `);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

function blob(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new WhatsAppStoreUnreadable();
}

function isBusy(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const code = "code" in cause ? String(cause.code) : "";
  return /SQLITE_BUSY|database is locked/i.test(`${cause.message} ${code}`);
}

function parsePostRecord(text: string): PostRecord | undefined {
  const value = JSON.parse(text);
  return typeof value?.chatJid === "string" && typeof value.threadKey === "string"
    ? { chatJid: value.chatJid, threadKey: value.threadKey }
    : undefined;
}
