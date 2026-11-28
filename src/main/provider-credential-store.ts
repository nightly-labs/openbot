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

export type OpenBotSecretName = `openbot:${string}`;

function accountKeyName(provider: AgentProviderId, accountId: string): string {
  return `${provider}:${accountId}`;
}

const envelopeSchema = z.object({
  version: z.literal(1),
  credentials: z.record(z.string(), z.string()),
});

const MAX_ENVELOPE_BYTES = 64 * 1024;

export class CredentialFileTooLarge extends Error {
  constructor() {
    super(sourceText("error.provider.credentialFileTooLarge"));
    this.name = "CredentialFileTooLarge";
  }
}

export class SecretStorageClosedError extends Error {
  constructor() {
    super(sourceText("error.app.macSecureStorageUnavailable"));
    this.name = "SecretStorageClosedError";
  }
}

export interface SecretCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export class ProviderCredentialStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #keys = new Map<string, string>();
  #loaded = false;
  #loadError: Error | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

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

  get(provider: AgentProviderId): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(provider) ?? null;
  }

  status(provider: AgentProviderId): ProviderApiKeyStatus {
    if (this.get(provider) !== null) return "saved";
    return this.#loadError ? "unreadable" : "missing";
  }

  accountKey(provider: AgentProviderId, accountId: string): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(accountKeyName(provider, accountId)) ?? null;
  }

  setAccountKey(
    provider: AgentProviderId,
    accountId: string,
    key: string | null,
  ): Effect.Effect<void, CredentialStoreFailure> {
    const name = accountKeyName(provider, accountId);
    return this.#edit((keys) => {
      if (key === null) return keys.delete(name);
      if (this.#loadError) throw new Error(sourceText("error.provider.credentialFileUnreadable"));
      registerSecretValue(key);
      keys.set(name, key);
      return true;
    });
  }

  secret(name: OpenBotSecretName): string | null {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return this.#keys.get(name) ?? null;
  }

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

  #edit(change: (keys: Map<string, string>) => boolean): Effect.Effect<void, CredentialStoreFailure> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const next = yield* credentialSync(() => this.#editableKeys());
        if (yield* credentialSync(() => change(next))) yield* this.#commit(next);
      }).pipe(Effect.uninterruptible),
    );
  }

  #editableKeys(): Map<string, string> {
    if (!this.#loaded) throw new Error("The provider credential store is not loaded.");
    return new Map(this.#loadError ? [] : this.#keys);
  }

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
      if (text.length > MAX_ENVELOPE_BYTES) throw new CredentialFileTooLarge();
      return text;
    });
    yield* writeFileAtomically(this.#path, content, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new CredentialStoreFailure({ cause })),
    );
  });
}
