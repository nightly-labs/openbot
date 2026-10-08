import { DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE, type RemoteSessionReusePreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * Whether the desktop keeps its remote server sessions between runs. Main reads it at start and when
 * the app quits, so it is held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or without the switch reads as the default, on. Writes
 * are chained for the reason `update-preference-store.ts` chains its own: an earlier rename that
 * lands last would persist the value the user just changed.
 */
export class RemoteSessionReusePreferenceStore {
  readonly #path: string;
  #preference: RemoteSessionReusePreference = { ...DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): RemoteSessionReusePreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.keepBetweenRuns)
            ? { keepBetweenRuns: parsed.keepBetweenRuns }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): RemoteSessionReusePreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("RemoteSessionReusePreference.set")(function* (
    this: RemoteSessionReusePreferenceStore,
    { keepBetweenRuns }: RemoteSessionReusePreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, keepBetweenRuns }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { keepBetweenRuns };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
