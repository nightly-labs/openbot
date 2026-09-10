// The optional API keys a provider CLI needs, encrypted at rest by the operating system.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentProviderId, ProviderApiKeyStatus } from "@openbot/contracts/ipc";
import { z } from "zod";

/**
 * One envelope holding every provider's key, each encrypted on its own.
 *
 * `version` is checked rather than tolerated: an envelope OpenBot does not understand is reported
 * as unreadable instead of silently read as empty, because "no key" and "a key OpenBot cannot
 * decode" have to behave differently -- one starts the free tier, the other must not quietly drop a
 * saved account.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  credentials: z.record(z.string(), z.string()),
});

const MAX_ENVELOPE_BYTES = 64 * 1024;

export interface SecretCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

/**
 * Reads and writes the provider keys, holding the decrypted values only in memory.
 *
 * `electron` is never imported here: the cipher arrives as two callbacks, so the whole store runs
 * under a unit test with a fake one. `get` is synchronous because a spawn cannot await: the caller
 * has to `load()` once at startup, and after that a read is a map lookup.
 */
export class ProviderCredentialStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #keys = new Map<string, string>();
  #loaded = false;
  /** Why the file on disk could not be read. Until the user saves or removes a key, it is kept. */
  #loadError: Error | null = null;

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /**
   * Reads the envelope, and returns the error when the file is there but cannot be read.
   *
   * That error does not stop startup. Every other service still starts, the providers run with no
   * key, and the file stays as it is: a keychain that refuses once must not cost the user the key,
   * so only an explicit save or removal replaces it.
   */
  async load(): Promise<Error | null> {
    this.#keys = new Map();
    this.#loadError = null;
    try {
      this.#keys = await this.#read();
    } catch (error) {
      this.#loadError = error instanceof Error ? error : new Error("The provider credential file is unreadable.");
    }
    this.#loaded = true;
    return this.#loadError;
  }

  /** The stored key, or `null`. Throws when `load` has not run, rather than reporting no key. */
  get(provider: AgentProviderId): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(provider) ?? null;
  }

  /** Whether a key is stored. This is the only fact that may cross the IPC boundary. */
  status(provider: AgentProviderId): ProviderApiKeyStatus {
    if (this.get(provider) !== null) return "saved";
    return this.#loadError ? "unreadable" : "missing";
  }

  async set(provider: AgentProviderId, key: string): Promise<void> {
    const next = this.#editableKeys();
    next.set(provider, key);
    await this.#commit(next);
  }

  async clear(provider: AgentProviderId): Promise<void> {
    if (this.status(provider) === "missing") return;
    const next = this.#editableKeys();
    next.delete(provider);
    await this.#commit(next);
  }

  /**
   * A copy to change. An unreadable envelope starts from empty: nothing in it can be decrypted, so
   * a save or a removal the user asked for replaces the whole file.
   */
  #editableKeys(): Map<string, string> {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return new Map(this.#loadError ? [] : this.#keys);
  }

  /**
   * Writes `next` and only then makes it the store's state. A failed write leaves memory and disk
   * as they were, so a spawn never reads a key the file does not hold, and a retry runs again.
   */
  async #commit(next: Map<string, string>): Promise<void> {
    if (next.size === 0) {
      await rm(this.#path, { force: true });
    } else {
      await this.#write(next);
    }
    this.#keys = next;
    this.#loadError = null;
  }

  async #read(): Promise<Map<string, string>> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error("The provider credential file is too large.");
    const envelope = envelopeSchema.parse(JSON.parse(source));
    const keys = new Map<string, string>();
    for (const [provider, encrypted] of Object.entries(envelope.credentials)) {
      keys.set(provider, this.#cipher.decrypt(Buffer.from(encrypted, "base64")));
    }
    return keys;
  }

  async #write(keys: Map<string, string>): Promise<void> {
    const credentials: Record<string, string> = {};
    for (const [provider, key] of keys) {
      credentials[provider] = this.#cipher.encrypt(key).toString("base64");
    }
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#path}.tmp`;
    // Write then rename, so a crash in the middle leaves the previous envelope readable rather
    // than a truncated one: a half-written key locks the user out of a paid account.
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, credentials })}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.#path);
  }
}
