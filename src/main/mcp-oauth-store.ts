// The OAuth registrations and tokens of the http MCP servers this machine has signed in to,
// encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { type McpOAuthRecord, type McpOAuthStorage, mcpOAuthRecordSchema } from "../backend/mcp-oauth-provider";
import type { SecretCipher } from "./provider-credential-store";

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
  /** Why the file could not be read. Kept until a sign-in replaces the whole envelope. */
  #loadError: Error | null = null;
  /**
   * The encrypted records the file held when it could not be decrypted. Kept so a change that
   * cannot read them refuses rather than writing them away; cleared on a successful read or write.
   * `null` when the file held nothing worth keeping (missing or unparseable).
   */
  #unreadableServers: Record<string, string> | null = null;
  /** The change in progress, so a read-modify-write never overlaps another. See `#enqueue`. */
  #queue: Promise<void> = Promise.resolve();

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
  async load(): Promise<Error | null> {
    this.#records = new Map();
    this.#loadError = null;
    this.#unreadableServers = null;
    try {
      this.#records = await this.#read();
    } catch (error) {
      this.#loadError = error instanceof Error ? error : new Error("The MCP sign-in file is unreadable.");
    }
    this.#loaded = true;
    return this.#loadError;
  }

  /** The stored record, or `null`. Throws when `load` has not run, rather than reporting none. */
  read(resource: string): McpOAuthRecord | null {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return this.#records.get(resource) ?? null;
  }

  write(resource: string, record: McpOAuthRecord): Promise<void> {
    return this.#enqueue(async () => {
      await this.#reloadIfUnreadable();
      // A registration (`saveClientInformation`) carries no tokens and runs before the user signs
      // in. When the file holds encrypted records this build cannot read, replacing it here would
      // delete unrelated credentials even if the user cancels. Refuse instead: the retry above
      // already gave a temporarily locked keychain its chance, and a corrupt file (nothing to
      // keep) still takes the replacement path below.
      if (this.#loadError && this.#unreadableServers) {
        throw new Error("The MCP sign-in file is unreadable.");
      }
      const next = this.#editableRecords();
      // An empty record is the absence of one. `invalidateCredentials("all")` arrives as a clear, and
      // dropping everything about a server arrives here as an object with nothing in it. A record
      // that names only where the authorization server was found is not empty: the SDK saves
      // discovery state before it registers, and deleting it here would send the code exchange
      // back to default discovery.
      if (record.client === undefined && record.tokens === undefined && record.discovery === undefined)
        next.delete(resource);
      else next.set(resource, record);
      await this.#commit(next);
    });
  }

  clear(resource: string): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
      await this.#reloadIfUnreadable();
      // An envelope this build cannot read holds nothing this can remove, and the file stays where
      // it is: removing one server row is not the user asking to lose the sign-ins of the other
      // five. A commit here would start from an empty map, and an empty map is `rm`. `write` is the
      // one change that may replace an unreadable file, because it carries a sign-in that worked.
      if (this.#loadError || !this.#records.has(resource)) return;
      const next = this.#editableRecords();
      next.delete(resource);
      await this.#commit(next);
    });
  }

  /**
   * One more attempt to read a file that could not be read at startup.
   *
   * `safeStorage` can refuse once - a keychain still locked, an app started before the session was
   * ready - while the envelope itself is perfectly good. Reading it again at the moment something
   * wants to change it is what keeps that one refusal from costing the user every sign-in.
   */
  async #reloadIfUnreadable(): Promise<void> {
    if (!this.#loadError) return;
    try {
      this.#records = await this.#read();
      this.#loadError = null;
    } catch {
      // Still unreadable, and the two callers above decide what that means for their own change.
    }
  }

  /**
   * One change at a time, from the copy to the rename.
   *
   * A hand-off resolves every server at once, so two servers whose tokens both need refreshing
   * reach here together. Each change copies the records, and both copies would be taken before
   * either commit: the second write would drop the first one's rotated token, and both would write
   * and rename the same temporary file. Chaining makes the copy a change starts from the one the
   * change before it wrote.
   */
  #enqueue(change: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(change, change);
    // A change that fails must not fail the one after it; its own caller still sees the rejection.
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /**
   * A copy to change. A file with nothing worth keeping (missing or unparseable) starts from
   * empty, so the sign-in the user has just finished replaces it. A file holding encrypted
   * records never reaches here: `write` refuses above rather than writing them away.
   */
  #editableRecords(): Map<string, McpOAuthRecord> {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    return new Map(this.#loadError ? [] : this.#records);
  }

  /**
   * Writes `next` and only then makes it the store's state. A failed write leaves memory and disk
   * as they were, so a hand-off never sends a token the file does not hold.
   */
  async #commit(next: Map<string, McpOAuthRecord>): Promise<void> {
    if (next.size === 0) await rm(this.#path, { force: true });
    else await this.#write(next);
    this.#records = next;
    this.#loadError = null;
    this.#unreadableServers = null;
  }

  async #read(): Promise<Map<string, McpOAuthRecord>> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.#unreadableServers = null;
        return new Map();
      }
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error("The MCP sign-in file is too large.");
    let envelope: { version: 1; servers: Record<string, string> };
    try {
      envelope = envelopeSchema.parse(JSON.parse(source));
    } catch {
      // Nothing in it can be decrypted, so nothing is kept: a sign-in that succeeds replaces it.
      this.#unreadableServers = null;
      throw new Error("The MCP sign-in file is unreadable.");
    }
    try {
      const records = new Map<string, McpOAuthRecord>();
      for (const [resource, encrypted] of Object.entries(envelope.servers)) {
        records.set(
          resource,
          mcpOAuthRecordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64")))),
        );
      }
      this.#unreadableServers = null;
      return records;
    } catch {
      // The envelope parsed but a record did not decrypt: the encrypted records stay on disk and
      // in this stash, so a change refuses rather than writing them away.
      this.#unreadableServers = { ...envelope.servers };
      throw new Error("The MCP sign-in file is unreadable.");
    }
  }

  async #write(records: Map<string, McpOAuthRecord>): Promise<void> {
    const servers: Record<string, string> = {};
    for (const [resource, record] of records) {
      servers[resource] = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
    }
    // Write then rename, so a crash in the middle leaves the previous envelope readable rather than
    // a truncated one: half a token set is six sign-ins the user has to do again.
    await writeJsonFileAtomically(this.#path, { version: 1, servers }, { createDirectory: true });
  }
}
