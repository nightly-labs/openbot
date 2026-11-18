// The optional API keys a provider CLI needs, encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import type { AgentProviderId, ProviderApiKeyStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";

export class CredentialStoreFailure extends Schema.TaggedError<CredentialStoreFailure>()("CredentialStoreFailure", {
  cause: Schema.Defect(),
}) {}

const { io: credentialIO, sync: credentialSync } = causeHelpers(CredentialStoreFailure);

/** The name of a key in the envelope that is not a provider's. */
export type OpenBotSecretName = `openbot:${string}`;

function accountKeyName(provider: AgentProviderId, accountId: string): string {
  return `${provider}:${accountId}`;
}

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

/**
 * A file that `#read` would refuse. The write stops before it, so the saved keys stay readable: a file
 * over the limit would make every provider and account key unreadable at the next start.
 */
export class CredentialFileTooLarge extends Error {
  constructor() {
    super(sourceText("error.provider.credentialFileTooLarge"));
    this.name = "CredentialFileTooLarge";
  }
}

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
  #writes = Semaphore.makeUnsafe(1);

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
  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#keys = new Map();
      this.#loadError = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isSuccess(result)) this.#keys = result.success;
      else {
        const error = result.failure.cause;
        this.#loadError =
          error instanceof Error ? error : new Error(sourceText("error.provider.credentialFileUnreadable"));
      }
      this.#loaded = true;
      return this.#loadError;
    });
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

  /**
   * The key of a provider account that is a key, or `null`. It is in the envelope under the provider
   * and the account, so a build that does not know it keeps it and never reads it as a provider's key.
   */
  accountKey(provider: AgentProviderId, accountId: string): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(accountKeyName(provider, accountId)) ?? null;
  }

  /** Saves the key of a provider account, or removes it when `key` is null. */
  setAccountKey(
    provider: AgentProviderId,
    accountId: string,
    key: string | null,
  ): Effect.Effect<void, CredentialStoreFailure> {
    const name = accountKeyName(provider, accountId);
    return this.#edit((keys) => {
      if (key === null) return keys.delete(name);
      // A save into a file that could not be read replaces every provider key in it. The key dialog of
      // a provider warns before that; an account key has no such warning, so it does not replace the file.
      if (this.#loadError) throw new Error(sourceText("error.provider.credentialFileUnreadable"));
      registerSecretValue(key);
      keys.set(name, key);
      return true;
    });
  }

  /**
   * A key that is not a provider's, such as the key of the CLI proxy. Its name starts with
   * `openbot:`, so no provider and no account of a provider can have it, and a build that does not
   * know it keeps it and never reads it.
   */
  secret(name: OpenBotSecretName): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(name) ?? null;
  }

  /**
   * Saves the keys of `secret`, or removes the ones whose value is null, as one write of the file, so a
   * change of many keys encrypts and writes the envelope one time.
   */
  setSecrets(
    changes: readonly (readonly [OpenBotSecretName, string | null])[],
  ): Effect.Effect<void, CredentialStoreFailure> {
    return this.#edit((keys) => {
      let changed = false;
      for (const [name, value] of changes) {
        if (value === null) {
          changed = keys.delete(name) || changed;
          continue;
        }
        // As an account key: a save into a file that could not be read would replace every provider key.
        if (this.#loadError) throw new Error(sourceText("error.provider.credentialFileUnreadable"));
        registerSecretValue(value);
        keys.set(name, value);
        changed = true;
      }
      return changed;
    });
  }

  set(provider: AgentProviderId, key: string): Effect.Effect<void, CredentialStoreFailure> {
    return this.#edit((keys) => {
      registerSecretValue(key);
      keys.set(provider, key);
      return true;
    });
  }

  clear(provider: AgentProviderId): Effect.Effect<void, CredentialStoreFailure> {
    return this.#edit((keys) => {
      if (this.status(provider) === "missing") return false;
      keys.delete(provider);
      return true;
    });
  }

  /**
   * Runs one save or removal after the previous one. Each provider has its own command queue, so
   * two providers can change their keys at the same time; each edit must start from the keys the
   * previous edit committed, or the last write drops the other provider's key.
   */
  #edit(change: (keys: Map<string, string>) => boolean): Effect.Effect<void, CredentialStoreFailure> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const next = yield* credentialSync(() => this.#editableKeys());
        if (yield* credentialSync(() => change(next))) yield* this.#commit(next);
      }).pipe(Effect.uninterruptible),
    );
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
  #commit = Effect.fn("ProviderCredentialStore.commit")(function* (
    this: ProviderCredentialStore,
    next: Map<string, string>,
  ) {
    if (next.size === 0) yield* credentialIO(() => rm(this.#path, { force: true }));
    else yield* this.#write(next);
    this.#keys = next;
    this.#loadError = null;
  });

  #read = Effect.fn("ProviderCredentialStore.read")(function* (this: ProviderCredentialStore) {
    const source = yield* credentialIO(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new CredentialStoreFailure({ cause })),
      ),
    );
    if (source === null) return new Map<string, string>();
    return yield* credentialSync(() => {
      if (source.length > MAX_ENVELOPE_BYTES) throw new Error(sourceText("error.provider.credentialFileTooLarge"));
      const envelope = envelopeSchema.parse(JSON.parse(source));
      const keys = new Map<string, string>();
      for (const [provider, encrypted] of Object.entries(envelope.credentials)) {
        const key = this.#cipher.decrypt(Buffer.from(encrypted, "base64"));
        registerSecretValue(key);
        keys.set(provider, key);
      }
      return keys;
    });
  });

  #write = Effect.fn("ProviderCredentialStore.write")(function* (
    this: ProviderCredentialStore,
    keys: Map<string, string>,
  ) {
    const content = yield* credentialSync(() => {
      const credentials: Record<string, string> = {};
      for (const [provider, key] of keys) credentials[provider] = this.#cipher.encrypt(key).toString("base64");
      const text = `${JSON.stringify({ version: 1, credentials })}\n`;
      // The same measure as `#read`.
      if (text.length > MAX_ENVELOPE_BYTES) throw new CredentialFileTooLarge();
      return text;
    });
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new CredentialStoreFailure({ cause })),
    );
  });
}
