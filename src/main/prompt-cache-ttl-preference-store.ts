import {
  DEFAULT_PROMPT_CACHE_TTL,
  isPromptCacheTtl,
  type PromptCacheTtl,
  type PromptCacheTtlSetting,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * How long this server asks the provider to keep the prompt cache of its agents. A Claude process
 * reads it when it starts, so a change applies to the next process, not to a running turn.
 *
 * A file that is missing, unreadable as JSON or names a value that is not a choice reads as the
 * default. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class PromptCacheTtlPreferenceStore {
  readonly #path: string;
  #ttl: PromptCacheTtl = DEFAULT_PROMPT_CACHE_TTL.ttl;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): PromptCacheTtl | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isPromptCacheTtl(parsed.ttl) ? parsed.ttl : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#ttl = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): PromptCacheTtlSetting {
    return { ttl: this.#ttl };
  }

  readonly set = Effect.fn("PromptCacheTtlPreference.set")((ttl: PromptCacheTtl) =>
    this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, ttl }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#ttl = ttl;
            }),
          ),
          Effect.map(() => this.get()),
        ),
      ),
    ),
  );
}
