// The OAuth registrations and tokens of the http MCP servers this machine has signed in to,
// encrypted at rest by the operating system.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
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

  async write(resource: string, record: McpOAuthRecord): Promise<void> {
    const next = this.#editableRecords();
    // An empty record is the absence of one. `invalidateCredentials("all")` arrives as a clear, and
    // dropping everything about a server arrives here as an object with nothing in it.
    if (record.client === undefined && record.tokens === undefined) next.delete(resource);
    else next.set(resource, record);
    await this.#commit(next);
  }

  async clear(resource: string): Promise<void> {
    if (!this.#loaded) throw new Error("The MCP sign-in store is not loaded.");
    if (!this.#loadError && !this.#records.has(resource)) return;
    const next = this.#editableRecords();
    next.delete(resource);
    await this.#commit(next);
  }

  /**
   * A copy to change. An unreadable envelope starts from empty: nothing in it can be decrypted, so
   * the sign-in the user has just finished replaces the whole file.
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
  }

  async #read(): Promise<Map<string, McpOAuthRecord>> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error("The MCP sign-in file is too large.");
    const envelope = envelopeSchema.parse(JSON.parse(source));
    const records = new Map<string, McpOAuthRecord>();
    for (const [resource, encrypted] of Object.entries(envelope.servers)) {
      records.set(
        resource,
        mcpOAuthRecordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64")))),
      );
    }
    return records;
  }

  async #write(records: Map<string, McpOAuthRecord>): Promise<void> {
    const servers: Record<string, string> = {};
    for (const [resource, record] of records) {
      servers[resource] = this.#cipher.encrypt(JSON.stringify(record)).toString("base64");
    }
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#path}.tmp`;
    // Write then rename, so a crash in the middle leaves the previous envelope readable rather than
    // a truncated one: half a token set is six sign-ins the user has to do again.
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, servers })}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.#path);
  }
}
