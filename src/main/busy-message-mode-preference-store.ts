import { type BusyMessageModePreference, DEFAULT_BUSY_MESSAGE_MODE, isBusyMessageMode } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The app default for a message sent to a busy agent. The backend reads it for each such message,
 * so it is held in memory after `load` rather than read from disk each time.
 *
 * A file that is missing, unreadable as JSON or names an unknown mode reads as `queue`, which is
 * what every message did before the setting existed. Writes are chained for the reason
 * `update-preference-store.ts` chains its own: an earlier rename that lands last would persist the
 * value the user just changed.
 */
export class BusyMessageModePreferenceStore {
  readonly #path: string;
  #preference: BusyMessageModePreference = { mode: DEFAULT_BUSY_MESSAGE_MODE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): BusyMessageModePreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isBusyMessageMode(parsed.mode)
            ? { mode: parsed.mode }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): BusyMessageModePreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("BusyMessageModePreference.set")(function* (
    this: BusyMessageModePreferenceStore,
    { mode }: BusyMessageModePreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, mode }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { mode };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
