import { type BrowsingMemoryPreference, DEFAULT_BROWSING_MEMORY_PREFERENCE } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export class BrowsingMemoryPreferenceStore {
  readonly #path: string;
  #preference: BrowsingMemoryPreference = { ...DEFAULT_BROWSING_MEMORY_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(preference: BrowsingMemoryPreference) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): BrowsingMemoryPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && typeof parsed.enabled === "boolean"
            ? { enabled: parsed.enabled }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): BrowsingMemoryPreference {
    return { ...this.#preference };
  }

  onChange(listener: (preference: BrowsingMemoryPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly set = Effect.fn("BrowsingMemoryPreference.set")(function* (
    this: BrowsingMemoryPreferenceStore,
    { enabled }: BrowsingMemoryPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, enabled }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const changed = this.#preference.enabled !== enabled;
              this.#preference = { enabled };
              const current = this.get();
              if (changed) for (const listener of this.#listeners) listener(current);
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
