import { rm } from "node:fs/promises";
import { VOICE_KEY_PROVIDER_NAMES, type VoiceKeyProvider } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export interface VoiceApiKeyCipher {
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export class VoiceApiKeyStore {
  readonly #path: string;
  readonly #cipher: VoiceApiKeyCipher;
  #key: string | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(options: { path: string; cipher: VoiceApiKeyCipher }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): string | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && typeof parsed.key === "string" ? parsed.key : null,
        ),
      );
      if (Result.isFailure(loaded)) {
        if (isMissingFileError(loaded.failure.cause) || loaded.failure.cause instanceof SyntaxError) return;
        return yield* loaded.failure;
      }
      if (!loaded.success) return;
      try {
        this.#key = this.#cipher.decrypt(Buffer.from(loaded.success, "base64")) || null;
      } catch {
        this.#key = null;
      }
      if (this.#key) registerSecretValue(this.#key);
    });
  }

  get(): string | null {
    return this.#key;
  }

  readonly set = Effect.fn("VoiceApiKey.set")(function* (this: VoiceApiKeyStore, key: string | null) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          if (key === null) {
            yield* Effect.tryPromise({
              try: () => rm(this.#path, { force: true }),
              catch: (cause) => new PreferenceFileFailure({ cause }),
            });
          } else {
            if (!this.#cipher.canPersist())
              return yield* new PreferenceFileFailure({
                cause: new Error(sourceText("error.app.secretStorageUnavailable")),
              });
            registerSecretValue(key);
            const sealed = this.#cipher.encrypt(key).toString("base64");
            yield* writePreferenceFile(this.#path, { version: 1, key: sealed });
          }
          this.#key = key;
        }),
      ),
    );
  });
}

export function savedKeyError(cause: unknown, provider: VoiceKeyProvider): Error {
  const unavailable = sourceText("error.app.secretStorageUnavailable");
  return new Error(
    cause instanceof Error && cause.message === unavailable
      ? unavailable
      : sourceText("error.voice.cloud.keySaveFailed", { provider: VOICE_KEY_PROVIDER_NAMES[provider] }),
  );
}
