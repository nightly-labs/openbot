import {
  DEFAULT_VOICE_SETTINGS,
  isVoiceLanguage,
  isVoiceModelId,
  type VoiceSettings,
  type VoiceSettingsState,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export class VoicePreferenceStore {
  readonly #path: string;
  readonly #defaults: () => VoiceSettings;
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

  get(): VoiceSettingsState {
    return { ...(this.#settings ?? this.#defaults()), saved: this.#settings !== null };
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
