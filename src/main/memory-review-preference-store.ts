import {
  DEFAULT_MEMORY_REVIEW_INTERVAL,
  isMemoryReviewInterval,
  type MemoryReviewPreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export class MemoryReviewPreferenceStore {
  readonly #path: string;
  #preference: MemoryReviewPreference = { interval: DEFAULT_MEMORY_REVIEW_INTERVAL };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): MemoryReviewPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isMemoryReviewInterval(parsed.interval)
            ? { interval: parsed.interval }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): MemoryReviewPreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("MemoryReviewPreference.set")(function* (
    this: MemoryReviewPreferenceStore,
    { interval }: MemoryReviewPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, interval }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { interval };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
