// The tokens of the messaging connections (a Slack bot token and app-level token per agent, or the
// credentials of a managed Slack app), and the manager token of each connected Slack workspace,
// encrypted at rest by the operating system. Every value is registered for redaction, including the
// few that are not secret, such as a workspace name: none of them belongs in a log.

import { readFile, rm } from "node:fs/promises";
import type { MessagingCredentialState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { MessagingCredentials } from "../backend/messaging/messaging-service";
import type { SecretCipher } from "./provider-credential-store";

/**
 * One envelope with the tokens of every connection, each connection encrypted on its own. The
 * version is checked for the reason `ProviderCredentialStore` gives: an envelope that cannot be
 * read is not an empty one.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  connections: z.record(z.string(), z.string()),
});
const valuesSchema = z.record(z.string(), z.string());

const MAX_ENVELOPE_BYTES = 256 * 1024;

/**
 * Reads and writes the connection tokens, holding the decrypted values only in memory. `electron`
 * is never imported here: the cipher arrives as callbacks. Only the state of a connection's tokens
 * (`missing`, `saved` or `unreadable`) leaves this class towards a client.
 */
export class MessagingCredentialStore implements MessagingCredentials {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #values = new Map<string, Record<string, string>>();
  #loaded = false;
  #loadError: Error | null = null;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the envelope. A file that cannot be read does not stop startup, and stays until the user saves. */
  async load(): Promise<Error | null> {
    this.#values = new Map();
    this.#loadError = null;
    try {
      this.#values = await this.#read();
    } catch (error) {
      this.#loadError =
        error instanceof Error ? error : new Error(sourceText("error.provider.credentialFileUnreadable"));
    }
    this.#loaded = true;
    return this.#loadError;
  }

  get(connectionId: string): Record<string, string> | null {
    if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
    const values = this.#values.get(connectionId);
    return values ? { ...values } : null;
  }

  keys(): string[] {
    if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
    return [...this.#values.keys()];
  }

  status(connectionId: string): MessagingCredentialState {
    if (this.get(connectionId) !== null) return "saved";
    return this.#loadError ? "unreadable" : "missing";
  }

  async set(connectionId: string, values: Record<string, string>): Promise<void> {
    for (const value of Object.values(values)) registerSecretValue(value);
    await this.#edit((next) => {
      next.set(connectionId, { ...values });
      return true;
    });
  }

  async clear(connectionId: string): Promise<void> {
    await this.#edit((next) => next.delete(connectionId));
  }

  async retain(connectionIds: ReadonlySet<string>): Promise<void> {
    await this.#edit((next) => {
      let changed = false;
      for (const connectionId of [...next.keys()])
        if (!connectionIds.has(connectionId)) changed = next.delete(connectionId) || changed;
      return changed;
    });
  }

  /** One change after the previous one, each from the values the previous change committed. */
  async #edit(change: (next: Map<string, Record<string, string>>) => boolean): Promise<void> {
    const operation = this.#writeChain.then(async () => {
      if (!this.#loaded) throw new Error("The messaging credential store is not loaded.");
      // An unreadable envelope starts from empty: nothing in it can be decrypted.
      const next = new Map(this.#loadError ? [] : this.#values);
      if (!change(next)) return;
      if (next.size === 0) await rm(this.#path, { force: true });
      else await this.#write(next);
      this.#values = next;
      this.#loadError = null;
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
  }

  async #read(): Promise<Map<string, Record<string, string>>> {
    let source: string;
    try {
      source = await readFile(this.#path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
      throw error;
    }
    if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.provider.credentialFileTooLarge"));
    const envelope = envelopeSchema.parse(JSON.parse(source));
    const values = new Map<string, Record<string, string>>();
    for (const [connectionId, encrypted] of Object.entries(envelope.connections)) {
      const decoded = valuesSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(encrypted, "base64"))));
      for (const value of Object.values(decoded)) registerSecretValue(value);
      values.set(connectionId, decoded);
    }
    return values;
  }

  async #write(values: Map<string, Record<string, string>>): Promise<void> {
    const connections: Record<string, string> = {};
    for (const [connectionId, value] of values)
      connections[connectionId] = this.#cipher.encrypt(JSON.stringify(value)).toString("base64");
    await writeJsonFileAtomically(this.#path, { version: 1, connections }, { createDirectory: true });
  }
}
