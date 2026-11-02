import { DEFAULT_SPEECH_SETTINGS, isSpeechVoice, type SpeechSettings } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * Whether replies are read aloud, and in which voice. It is a file of its own rather than a field of
 * `voice-preference.json`, so an earlier version that rewrites that file keeps this one.
 *
 * A file that is missing, unreadable as JSON or names an unknown voice reads as the default: replies
 * are not read aloud.
 */
export class SpeechPreferenceStore {
  readonly #path: string;
  #settings: SpeechSettings = { ...DEFAULT_SPEECH_SETTINGS };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): SpeechSettings | null =>
          isDynamicRecord(parsed) &&
          parsed.version === 1 &&
          typeof parsed.readReplies === "boolean" &&
          isSpeechVoice(parsed.voice)
            ? { readReplies: parsed.readReplies, voice: parsed.voice }
            : null,
        ),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): SpeechSettings {
    return { ...this.#settings };
  }

  readonly set = Effect.fn("SpeechPreference.set")(function* (
    this: SpeechPreferenceStore,
    { readReplies, voice }: SpeechSettings,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, readReplies, voice }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#settings = { readReplies, voice };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
