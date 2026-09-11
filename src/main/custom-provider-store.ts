// The user's own model endpoints: what is on disk, and every write that changes it.
//
// An endpoint carries an API key, and often a header that is a credential as well, so this file is
// the only place either exists outside the OpenCode process OpenBot spawns. The renderer is given
// `list()`, which cannot carry a secret; the backend is given `configs()`, which is what a spawn
// needs. Nothing else reads the file.
//
// Electron-free, with the cipher injected, so its tests need neither a keychain nor a display.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CustomProviderSummary, SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { z } from "zod";
import type { CustomProviderConfig } from "../backend/opencode-config";

export interface CustomProviderCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

const modelSchema = z.object({ id: z.string(), name: z.string() });
const headerSchema = z.object({ name: z.string(), value: z.string() });

/**
 * A plaintext envelope around one encrypted field, rather than a wholly encrypted file: a computer
 * that loses its keychain keeps its endpoint list and its models, and only the credentials are gone.
 */
const entrySchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(modelSchema),
  /** One ciphertext for the key and every header value together, or absent for an endpoint with neither. */
  secret: z.string().nullish(),
});

const fileSchema = z.object({ version: z.literal(1), providers: z.array(entrySchema) });
const secretSchema = z.object({ apiKey: z.string().nullish(), headers: z.array(headerSchema).optional() });

type StoredEntry = z.infer<typeof entrySchema>;
type ProviderFile = z.infer<typeof fileSchema>;

interface ProviderSecret {
  readonly apiKey: string | null;
  readonly headers: readonly { name: string; value: string }[];
}

interface Entry {
  readonly stored: StoredEntry;
  /**
   * The decrypted secret, or null for an endpoint that has none *and* for one whose ciphertext this
   * computer can no longer read. Resolved once, when the entry is loaded or saved: the same plaintext
   * is needed at every provider spawn, and `hasApiKey` has to be answerable without a keychain call
   * on every list.
   */
  readonly secret: ProviderSecret | null;
}

const READ_ONLY_MESSAGE =
  "The saved endpoints were written by a newer version of OpenBot, or the file cannot be read. Update OpenBot to change them.";
const NO_SECURE_STORAGE_MESSAGE =
  "This computer has no secure storage, so an API key or a header cannot be saved. Remove them, or use an endpoint that needs no credentials.";
const DUPLICATE_MESSAGE = "An endpoint with this provider ID is already saved. Remove it first, or use another ID.";

export class CustomProviderStore {
  readonly #path: string;
  readonly #cipher: CustomProviderCipher;
  #entries: Entry[] = [];
  /** Set when the file exists and this build cannot read it. See `load`. */
  #readOnly = false;
  #writeChain = Promise.resolve();

  constructor(options: { path: string; cipher: CustomProviderCipher }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
  }

  /**
   * A missing file is a first run. A file this build cannot read is not an empty list: it is a list
   * that must not be overwritten, because a newer build's endpoints would be lost with it. So the
   * app still starts, with no custom providers, and every write is refused until the file is
   * readable again.
   */
  async load(): Promise<void> {
    let contents: string | null = null;
    try {
      contents = await readFile(this.#path, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (contents === null) return;
    const file = parseProviderFile(contents);
    if (!file) {
      this.#readOnly = true;
      this.#entries = [];
      return;
    }
    this.#readOnly = false;
    this.#entries = file.providers.map((stored) => ({ stored, secret: this.#openSecret(stored.secret) }));
  }

  /** What the renderer is allowed to know. Four fields, none of which can hold a credential. */
  list(): CustomProviderSummary[] {
    return this.#entries.map(({ stored, secret }) => ({
      id: stored.id,
      name: stored.name,
      baseUrl: stored.baseUrl,
      hasApiKey: Boolean(secret?.apiKey),
    }));
  }

  /** What a provider spawn needs. Only ever passed to `AgentService`, never to an IPC handler. */
  configs(): readonly CustomProviderConfig[] {
    return this.#entries.map(({ stored, secret }) => ({
      id: stored.id,
      name: stored.name,
      baseUrl: stored.baseUrl,
      apiKey: secret?.apiKey ?? null,
      models: stored.models,
      headers: secret?.headers ?? [],
    }));
  }

  /**
   * Adds one endpoint. An id already in the list is refused rather than replaced, because editing a
   * saved endpoint is a different operation: the form has no way to say "keep the stored key", so a
   * second save under the same name would silently discard the key the user is not retyping.
   */
  async save(input: SaveCustomProviderInput): Promise<CustomProviderSummary[]> {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    if (this.#entries.some((entry) => entry.stored.id === input.id)) throw new Error(DUPLICATE_MESSAGE);
    const secret: ProviderSecret | null =
      input.apiKey || input.headers.length > 0 ? { apiKey: input.apiKey || null, headers: input.headers } : null;
    // Refused only for an endpoint that has something to protect. A keyless local endpoint still
    // saves on a computer with no keychain, which is the common case for one.
    if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
    this.#entries = [
      ...this.#entries,
      {
        stored: {
          id: input.id,
          name: input.name,
          baseUrl: input.baseUrl,
          models: input.models.map((model) => ({ id: model.id, name: model.name })),
          secret: secret ? this.#cipher.encrypt(JSON.stringify(secret)).toString("base64") : null,
        },
        secret,
      },
    ];
    await this.#persist();
    return this.list();
  }

  /** Removes one endpoint and its credentials. An id that is not saved writes nothing. */
  async remove(id: string): Promise<CustomProviderSummary[]> {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    const remaining = this.#entries.filter((entry) => entry.stored.id !== id);
    if (remaining.length === this.#entries.length) return this.list();
    this.#entries = remaining;
    await this.#persist();
    return this.list();
  }

  /**
   * A ciphertext this computer cannot read leaves the endpoint in the list with no credentials, and
   * throws nothing: the user can still see which endpoint it is, and remove it or add it again. The
   * alternative - refusing to start, or dropping the entry - loses the list to a keychain that a
   * migrated machine or a reinstalled system commonly changes.
   */
  #openSecret(sealed: string | null | undefined): ProviderSecret | null {
    if (!sealed) return null;
    try {
      const parsed = secretSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, "base64"))));
      return { apiKey: parsed.apiKey || null, headers: parsed.headers ?? [] };
    } catch {
      return null;
    }
  }

  async #persist(): Promise<void> {
    // The stored half only: every entry keeps the ciphertext it arrived with, so an untouched
    // endpoint is never decrypted and encrypted again.
    const providers = this.#entries.map((entry) => entry.stored);
    const operation = this.#writeChain.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 1, providers })}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.#path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.#writeChain = operation.catch(() => undefined);
    await operation;
  }
}

/**
 * The file, or null when this build cannot read it. Malformed JSON and a version this build does not
 * know are the same answer to the caller: do not overwrite it.
 */
function parseProviderFile(contents: string): ProviderFile | null {
  try {
    return fileSchema.parse(JSON.parse(contents));
  } catch {
    return null;
  }
}
