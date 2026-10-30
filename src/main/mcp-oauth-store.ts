import { McpOperationError } from "../backend/mcp-effects";
// The OAuth registrations and tokens of the http MCP servers this machine has signed in to,
// encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { type McpOAuthRecord, type McpOAuthStorage, mcpOAuthRecordSchema } from "../backend/mcp-oauth-provider";
import type { SecretCipher } from "./provider-credential-store";

const { io: mcpIO, sync: mcpSync } = causeHelpers(McpOperationError);

/**
 * One envelope holding every server's record, each encrypted on its own.
 *
 * `version` is checked rather than tolerated, for the same reason the provider key file checks it:
 * an envelope this build cannot understand is reported as unreadable, not read as empty. Read as
 * empty it would look like a machine that had never signed in, and the next hand-off would quietly
 * drop the credential of every OAuth server the user connected.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), z.string()),
});

/** A token set and a registration are small; a file past this is not one this app wrote. */
const MAX_ENVELOPE_BYTES = 256 * 1024;

/**
 * Reads and writes the MCP OAuth records, holding the decrypted values only in memory.
 *
 * `electron` is never imported here: the cipher arrives as two callbacks, so the whole store runs
 * under a unit test with a fake one. `read` is synchronous because a hand-off asks for a token
 * while it builds the payload - the caller has to `load()` once at startup, and after that a read
 * is a map lookup.
 */
export class McpOAuthStore implements McpOAuthStorage {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #records = new Map<string, McpOAuthRecord>();
  #loaded = false;
  /** Why no record in the file could be read. Cleared by the first change this store writes. */
  #loadError: Error | null = null;
  /**
   * Ciphertext for servers this build could not decrypt. Each blob is written back unchanged until
   * a record with tokens, or a sign-in app the administrator saved, replaces that server's row.
   * Discovery and a registration come before the user signs in, so they stay in memory, and a
   * cancelled sign-in leaves the file as it was.
   * `null` when the file held nothing worth keeping (missing or unparseable).
   */
  #unreadableServers: Record<string, string> | null = null;
  /** The file is there, but the operating system refused to read it. */
  #readFailed = false;
  /** The change in progress, so a read-modify-write never overlaps another. See `#enqueue`. */
  #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /**
   * Reads the envelope, and returns the error when the file is there but cannot be read.
   *
   * That error does not stop startup. Every stdio server still starts, an http server with a key in
   * its own headers still starts, and the file stays as it is: a keychain that refuses once must
   * not cost the user six sign-ins, so only a sign-in that succeeds replaces it.
   */
  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#records = new Map();
      this.#loadError = null;
      this.#unreadableServers = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isSuccess(result)) {
        this.#records = result.success;
        for (const record of result.success.values()) registerAppSecret(record);
      } else
        this.#loadError =
          result.failure.cause instanceof Error
            ? result.failure.cause
            : new Error(sourceText("error.mcp.signInFileUnreadable"));
      this.#loaded = true;
      return this.#loadError;
    });
  }

  /** The stored record, or `null`. Throws when `load` has not run, rather than reporting none. */
  read(resource: string): McpOAuthRecord | null {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return this.#records.get(resource) ?? null;
  }

  write(resource: string, record: McpOAuthRecord): Effect.Effect<void, McpOperationError> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        yield* this.#reloadIfUnreadable();
        // Nothing of this file was ever read, so a write would replace rows this store never saw.
        if (this.#readFailed && this.#loadError)
          return yield* new McpOperationError({ cause: new Error(sourceText("error.mcp.signInFileUnreadable")) });
        const next = yield* mcpSync(() => this.#editableRecords());
        registerAppSecret(record);
        // An empty record is the absence of one. `invalidateCredentials("all")` arrives as a clear, and
        // dropping everything about a server arrives here as an object with nothing in it. A record
        // that names only where the authorization server was found is not empty: the SDK saves
        // discovery state before it registers, and deleting it here would send the code exchange
        // back to default discovery. A sign-in app alone is not empty either: the administrator saves
        // it before the first sign-in. Nor is a sign-in the server ended: `lostAt` is what lets the
        // row say so.
        if (
          record.app === undefined &&
          record.client === undefined &&
          record.tokens === undefined &&
          record.discovery === undefined &&
          record.lostAt === undefined
        )
          next.delete(resource);
        else next.set(resource, record);
        yield* this.#commit(next);
      }),
    );
  }

  clear(resource: string): Effect.Effect<void, McpOperationError> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        if (!this.#loaded)
          return yield* new McpOperationError({ cause: new Error("The MCP sign-in store is not loaded.") });
        yield* this.#reloadIfUnreadable();
        // A row this build cannot read holds nothing this can remove, and its ciphertext stays: the
        // SDK clears a record when a sign-in fails, which is not the user asking to lose that server.
        if (this.#loadError || !this.#records.has(resource)) return;
        const next = yield* mcpSync(() => this.#editableRecords());
        next.delete(resource);
        yield* this.#commit(next);
      }),
    );
  }

  /**
   * One more attempt to read a file that could not be read at startup.
   *
   * `safeStorage` can refuse once - a keychain still locked, an app started before the session was
   * ready - while the envelope itself is perfectly good. Reading it again at the moment something
   * wants to change it is what keeps that one refusal from costing the user every sign-in.
   */
  #reloadIfUnreadable = Effect.fn("McpOAuthStore.reload")(function* (this: McpOAuthStore) {
    if (!this.#loadError && !this.#unreadableServers) return;
    const result = yield* Effect.result(this.#read());
    if (Result.isSuccess(result)) {
      // A record whose row on disk is still unread was never written: it is the sign-in in progress.
      for (const [resource, record] of this.#records)
        if (!result.success.has(resource) && this.#unreadableServers?.[resource] !== undefined)
          result.success.set(resource, record);
      this.#records = result.success;
      for (const record of result.success.values()) registerAppSecret(record);
      this.#loadError = null;
    }
  });

  /**
   * One change at a time, from the copy to the rename.
   *
   * A hand-off resolves every server at once, so two servers whose tokens both need refreshing
   * reach here together. Each change copies the records, and both copies would be taken before
   * either commit: the second write would drop the first one's rotated token, and both would write
   * and rename the same temporary file. Chaining makes the copy a change starts from the one the
   * change before it wrote.
   */
  #enqueue(change: Effect.Effect<void, McpOperationError>): Effect.Effect<void, McpOperationError> {
    return this.#queue.withPermit(Effect.uninterruptible(change));
  }

  /**
   * A copy to change. A missing or unparseable file starts empty, so the sign-in the user has just
   * finished replaces it. Unread rows are not in the copy: `#commit` writes them back.
   */
  #editableRecords(): Map<string, McpOAuthRecord> {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return new Map(this.#loadError ? [] : this.#records);
  }

  /**
   * Writes `next` and only then makes it the store's state. A failed write leaves memory and disk
   * as they were, so a hand-off never sends a token the file does not hold. An unread row stays as
   * it is on disk until a record with tokens or a sign-in app replaces it.
   */
  #commit = Effect.fn("McpOAuthStore.commit")(function* (this: McpOAuthStore, next: Map<string, McpOAuthRecord>) {
    const preserved = preservedUnread(this.#unreadableServers, next);
    if (next.size === 0 && !preserved) yield* mcpIO(() => rm(this.#path, { force: true }));
    else yield* this.#write(next, preserved);
    this.#records = next;
    this.#unreadableServers = preserved;
    this.#loadError = null;
  });

  #read = Effect.fn("McpOAuthStore.read")(function* (this: McpOAuthStore) {
    const source = yield* mcpIO(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return Effect.succeed(null);
        this.#readFailed = true;
        return Effect.fail(new McpOperationError({ cause }));
      }),
    );
    this.#readFailed = false;
    if (source === null) {
      this.#unreadableServers = null;
      return new Map<string, McpOAuthRecord>();
    }
    return yield* mcpSync(() => {
      if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.mcp.signInFileTooLarge"));
      let envelope: { version: 1; servers: Record<string, string> };
      try {
        envelope = envelopeSchema.parse(JSON.parse(source));
      } catch {
        // Nothing in it can be decrypted, so nothing is kept: a sign-in that succeeds replaces it.
        this.#unreadableServers = null;
        throw new Error(sourceText("error.mcp.signInFileUnreadable"));
      }
      const records = new Map<string, McpOAuthRecord>();
      const unreadable: Record<string, string> = {};
      for (const [resource, encrypted] of Object.entries(envelope.servers)) {
        try {
          records.set(
            resource,
            mcpOAuthRecordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64")))),
          );
        } catch {
          unreadable[resource] = encrypted;
        }
      }
      if (records.size === 0 && Object.keys(unreadable).length > 0) {
        this.#unreadableServers = unreadable;
        throw new Error(sourceText("error.mcp.signInFileUnreadable"));
      }
      this.#unreadableServers = Object.keys(unreadable).length > 0 ? unreadable : null;
      return records;
    });
  });

  #write = Effect.fn("McpOAuthStore.write")(function* (
    this: McpOAuthStore,
    records: Map<string, McpOAuthRecord>,
    preserved: Record<string, string> | null,
  ) {
    const content = yield* mcpSync(() => {
      const servers: Record<string, string> = {};
      for (const [resource, record] of records)
        servers[resource] = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
      if (preserved) Object.assign(servers, preserved);
      return `${JSON.stringify({ version: 1, servers })}\n`;
    });
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new McpOperationError({ cause })),
    );
  });
}

/** A sign-in app's secret is masked in every log line, as the other stored credentials are. */
function registerAppSecret(record: McpOAuthRecord): void {
  if (record.app?.clientSecret) registerSecretValue(record.app.clientSecret);
}

/** Unread ciphertext that `next` does not replace with tokens or a sign-in app. */
function preservedUnread(
  unreadable: Record<string, string> | null,
  next: Map<string, McpOAuthRecord>,
): Record<string, string> | null {
  if (!unreadable) return null;
  const preserved: Record<string, string> = {};
  for (const [resource, encrypted] of Object.entries(unreadable)) {
    const record = next.get(resource);
    if (record?.tokens === undefined && record?.app === undefined) preserved[resource] = encrypted;
  }
  return Object.keys(preserved).length > 0 ? preserved : null;
}
