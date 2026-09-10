// The optional API keys a provider CLI needs, encrypted at rest by the operating system.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { z } from "zod";

/**
 * One envelope holding every provider's key, each encrypted on its own.
 *
 * `version` is checked rather than tolerated: an envelope OpenBot does not understand is rejected
 * instead of silently read as empty, because "no key" and "a key OpenBot cannot decode" have to
 * behave differently -- one starts the free tier, the other must not quietly drop a saved account.
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
  readonly #keys = new Map<string, string>();
  #loaded = false;

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the envelope. A missing file is an empty store; anything else is an error. */
  async load(): Promise<void> {
    this.#keys.clear();
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.#loaded = true;
        return;
      }
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error("The provider credential file is too large.");
    const envelope = envelopeSchema.parse(JSON.parse(source));
    for (const [provider, encrypted] of Object.entries(envelope.credentials)) {
      this.#keys.set(provider, this.#cipher.decrypt(Buffer.from(encrypted, "base64")));
    }
    this.#loaded = true;
  }

  /** The stored key, or `null`. Throws when `load` has not run, rather than reporting no key. */
  get(provider: AgentProviderId): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(provider) ?? null;
  }

  /** True when a key is stored. This is the only fact that may cross the IPC boundary. */
  has(provider: AgentProviderId): boolean {
    return this.get(provider) !== null;
  }

  async set(provider: AgentProviderId, key: string): Promise<void> {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    this.#keys.set(provider, key);
    await this.#write();
  }

  async clear(provider: AgentProviderId): Promise<void> {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    if (!this.#keys.delete(provider)) return;
    if (this.#keys.size === 0) {
      await rm(this.#path, { force: true });
      return;
    }
    await this.#write();
  }

  async #write(): Promise<void> {
    const credentials: Record<string, string> = {};
    for (const [provider, key] of this.#keys) {
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
