import { DEFAULT_SKILL_LEARNING_MODE, isSkillLearningMode, type SkillLearningPreference } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * What the background memory reviews do when a chat teaches an agent a skill. A review reads it when
 * it runs, so it is held in memory after `load` rather than read from disk each time.
 *
 * A file that is missing, unreadable as JSON or names a value that is not a choice reads as the
 * default. Writes are chained for the reason `update-preference-store.ts` chains its own.
 */
export class SkillLearningPreferenceStore {
  readonly #path: string;
  #preference: SkillLearningPreference = { mode: DEFAULT_SKILL_LEARNING_MODE };
  #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(preference: SkillLearningPreference) => void>();

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): SkillLearningPreference | null =>
          isDynamicRecord(parsed) && parsed.version === 1 && isSkillLearningMode(parsed.mode)
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

  get(): SkillLearningPreference {
    return { ...this.#preference };
  }

  /** Calls `listener` after each saved change. Returns the function that removes it. */
  onChange(listener: (preference: SkillLearningPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly set = Effect.fn("SkillLearningPreference.set")(function* (
    this: SkillLearningPreferenceStore,
    { mode }: SkillLearningPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, mode }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const changed = this.#preference.mode !== mode;
              this.#preference = { mode };
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
