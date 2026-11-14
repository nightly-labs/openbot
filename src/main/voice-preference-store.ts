import { DEFAULT_VOICE_SETTINGS, isVoiceLanguage, isVoiceModelId, type VoiceSettings } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The dictation model and language. Transcription reads it about once per second while the user
 * speaks, so it is held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or names an unknown model or language reads as
 * `defaults`, which the app makes from the user's language. They are not saved, so a later change of
 * that language changes them.
 */
export class VoicePreferenceStore {
  readonly #path: string;
  readonly #defaults: () => VoiceSettings;
  /** The user's choice, or null before they make one. */
  #settings: VoiceSettings | null = null;
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string, defaults: () => VoiceSettings = () => DEFAULT_VOICE_SETTINGS) {
    this.#path = path;
    this.#defaults = defaults;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): VoiceSettings | null =>
          isDynamicRecord(parsed) &&
          parsed.version === 1 &&
          isVoiceModelId(parsed.modelId) &&
          isVoiceLanguage(parsed.language)
            ? { modelId: parsed.modelId, language: parsed.language }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): VoiceSettings {
    return { ...(this.#settings ?? this.#defaults()) };
  }

  readonly set = Effect.fn("VoicePreference.set")(function* (
    this: VoicePreferenceStore,
    { modelId, language }: VoiceSettings,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, modelId, language }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#settings = { modelId, language };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
