// The user's own model endpoints: what is on disk, and every write that changes it.
//
// An endpoint carries an API key, and often a header that is a credential as well, so this file is
// the only place either exists outside the OpenCode process OpenBot spawns. The renderer is given
// `list()`, which cannot carry a secret; the backend is given `configs()`, which is what a spawn
// needs. Nothing else reads the file.
//
// Electron-free, with the cipher injected, so its tests need neither a keychain nor a display.

import { readFile } from "node:fs/promises";
import type { CustomProviderSummary, SaveCustomProviderInput, UpdateCustomProviderInput } from "@openbot/contracts/ipc";
import { sameCustomProviderOrigin } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import type { CustomProviderConfig } from "../backend/opencode-config";

export class CustomProviderFailure extends Schema.TaggedError<CustomProviderFailure>()("CustomProviderFailure", {
  cause: Schema.Defect(),
}) {}

function providerIO<A>(operation: () => Promise<A>): Effect.Effect<A, CustomProviderFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new CustomProviderFailure({ cause }) });
}
function providerSync<A>(operation: () => A): Effect.Effect<A, CustomProviderFailure> {
  return Effect.try({ try: operation, catch: (cause) => new CustomProviderFailure({ cause }) });
}
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

const READ_ONLY_MESSAGE = sourceText("error.provider.endpointsReadOnly");
const NO_SECURE_STORAGE_MESSAGE = sourceText("error.provider.endpointNoSecureStorage");
const DUPLICATE_MESSAGE = sourceText("error.provider.endpointDuplicate");
const NOT_SAVED_MESSAGE = sourceText("error.provider.endpointNotSaved");
const KEY_FOR_NEW_ADDRESS_MESSAGE = sourceText("error.provider.endpointKeyForNewAddress");
const SECRET_UNREADABLE_MESSAGE = sourceText("error.provider.endpointSecretUnreadable");

export class CustomProviderStore {
  readonly #path: string;
  readonly #cipher: CustomProviderCipher;
  #entries: Entry[] = [];
  /** Set when the file exists and this build cannot read it. See `load`. */
  #readOnly = false;
  #writes = Semaphore.makeUnsafe(1);

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
  load(): Effect.Effect<void, CustomProviderFailure> {
    return Effect.gen({ self: this }, function* () {
      const contents = yield* providerIO(() => readFile(this.#path, "utf8")).pipe(
        Effect.catch(({ cause }) =>
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(null)
            : Effect.fail(new CustomProviderFailure({ cause })),
        ),
      );
      if (contents === null) return;
      const file = parseProviderFile(contents);
      if (!file) {
        this.#readOnly = true;
        this.#entries = [];
        return;
      }
      this.#readOnly = false;
      this.#entries = yield* Effect.forEach(file.providers, (stored) =>
        this.#openSecret(stored.secret).pipe(Effect.map((secret) => ({ stored, secret }))),
      );
    });
  }

  /** What the renderer is allowed to know. Five fields, none of which can hold a credential. */
  list(): CustomProviderSummary[] {
    return this.#entries.map(({ stored, secret }) => ({
      id: stored.id,
      name: stored.name,
      baseUrl: stored.baseUrl,
      hasApiKey: Boolean(secret?.apiKey),
      // Copied, not shared: the renderer's list must not alias the stored entry.
      models: stored.models.map((model) => ({ id: model.id, name: model.name })),
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
  save(input: SaveCustomProviderInput): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      if (this.#entries.some((entry) => entry.stored.id === input.id)) throw new Error(DUPLICATE_MESSAGE);
      const secret: ProviderSecret | null =
        input.apiKey || input.headers.length > 0 ? { apiKey: input.apiKey || null, headers: input.headers } : null;
      // Refused only for an endpoint that has something to protect. A keyless local endpoint still
      // saves on a computer with no keychain, which is the common case for one.
      if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
      return [
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
    });
  }

  /**
   * Changes one saved endpoint. An absent `apiKey` or `headers` keeps the stored part.
   *
   * A kept part may not follow the endpoint to another origin: the user typed the key for one server,
   * and an edit of the address alone must not send it to another one. When nothing secret changes,
   * the stored ciphertext is kept byte for byte, so an edit on a computer whose keychain is gone does
   * not lose a key that a later keychain could still open.
   */
  update(input: UpdateCustomProviderInput): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      const { index, current } = this.#checkUpdate(input);
      const keepKey = input.apiKey === undefined;
      const keepHeaders = input.headers === undefined;
      let sealed = current.stored.secret ?? null;
      let secret = current.secret;
      if (!keepKey || !keepHeaders) {
        const apiKey = keepKey ? (current.secret?.apiKey ?? null) : input.apiKey || null;
        const headers = keepHeaders ? (current.secret?.headers ?? []) : (input.headers ?? []);
        secret = apiKey || headers.length > 0 ? { apiKey, headers } : null;
        if (secret && !this.#cipher.canPersist()) throw new Error(NO_SECURE_STORAGE_MESSAGE);
        sealed = secret ? this.#cipher.encrypt(JSON.stringify(secret)).toString("base64") : null;
      }
      const next: Entry = {
        stored: {
          id: current.stored.id,
          name: input.name,
          baseUrl: input.baseUrl,
          models: input.models.map((model) => ({ id: model.id, name: model.name })),
          secret: sealed,
        },
        secret,
      };
      return this.#entries.map((entry, position) => (position === index ? next : entry));
    });
  }

  /**
   * Throws what `update` would refuse for this input, and writes nothing. The caller moves agents
   * off removed models before the write, so a refused edit must fail before that.
   */
  checkUpdate(input: UpdateCustomProviderInput): void {
    if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
    const { current } = this.#checkUpdate(input);
    const replacesSecret = input.apiKey !== undefined || input.headers !== undefined;
    if (replacesSecret && !this.#cipher.canPersist()) {
      const apiKey = input.apiKey ?? current.secret?.apiKey ?? null;
      const headers = input.headers ?? current.secret?.headers ?? [];
      if (apiKey || headers.length > 0) throw new Error(NO_SECURE_STORAGE_MESSAGE);
    }
  }

  #checkUpdate(input: UpdateCustomProviderInput): { index: number; current: Entry } {
    const index = this.#entries.findIndex((entry) => entry.stored.id === input.id);
    const current = this.#entries[index];
    if (!current) throw new Error(NOT_SAVED_MESSAGE);
    const keepKey = input.apiKey === undefined;
    const keepHeaders = input.headers === undefined;
    // A ciphertext this computer cannot open cannot be merged: replacing one part would drop the other.
    if (keepKey !== keepHeaders && current.stored.secret && !current.secret) {
      throw new Error(SECRET_UNREADABLE_MESSAGE);
    }
    const keptSecret =
      (keepKey && Boolean(current.secret?.apiKey)) ||
      (keepHeaders && (current.secret?.headers.length ?? 0) > 0) ||
      // A ciphertext that this computer cannot open still holds something the user saved.
      (keepKey && keepHeaders && Boolean(current.stored.secret) && !current.secret);
    if (keptSecret && !sameCustomProviderOrigin(current.stored.baseUrl, input.baseUrl)) {
      throw new Error(KEY_FOR_NEW_ADDRESS_MESSAGE);
    }
    return { index, current };
  }

  /** Removes one endpoint and its credentials. An id that is not saved writes nothing. */
  remove(id: string): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#mutate(() => {
      const remaining = this.#entries.filter((entry) => entry.stored.id !== id);
      return remaining.length === this.#entries.length ? null : remaining;
    });
  }

  /**
   * One endpoint change, start to end, with no other change between its read and its write.
   *
   * `build` reads `#entries` and returns the list that replaces it, or null for "nothing to do".
   * Serializing the file write alone was not enough: two saves that ran together both read the list
   * before either wrote, so the second one dropped the first endpoint, and two removals restored the
   * endpoint the other had taken out. The list is published only after the durable write, so a
   * failed write leaves the caller with exactly what the file still holds.
   */
  #mutate(build: () => Entry[] | null): Effect.Effect<CustomProviderSummary[], CustomProviderFailure> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const entries = yield* providerSync(() => {
          if (this.#readOnly) throw new Error(READ_ONLY_MESSAGE);
          return build();
        });
        if (entries) {
          yield* this.#persist(entries);
          this.#entries = entries;
        }
        return this.list();
      }).pipe(Effect.uninterruptible),
    );
  }

  /**
   * A ciphertext this computer cannot read leaves the endpoint in the list with no credentials, and
   * throws nothing: the user can still see which endpoint it is, and remove it or add it again. The
   * alternative - refusing to start, or dropping the entry - loses the list to a keychain that a
   * migrated machine or a reinstalled system commonly changes.
   */
  #openSecret = Effect.fn("CustomProviderStore.openSecret")(function* (
    this: CustomProviderStore,
    sealed: string | null | undefined,
  ) {
    if (!sealed) return null;
    return yield* providerSync(() => {
      const parsed = secretSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(sealed, "base64"))));
      return { apiKey: parsed.apiKey || null, headers: parsed.headers ?? [] };
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  });

  /** Keep ciphertext unchanged until an explicit credential edit. */
  #persist = Effect.fn("CustomProviderStore.persist")(function* (this: CustomProviderStore, entries: readonly Entry[]) {
    const content = yield* providerSync(
      () => `${JSON.stringify({ version: 1, providers: entries.map((entry) => entry.stored) })}\n`,
    );
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new CustomProviderFailure({ cause })),
    );
  });
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
