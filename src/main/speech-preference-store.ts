import {
  DEFAULT_SPEECH_SETTINGS,
  isElevenLabsSpeechVoice,
  isSpeechEngine,
  isSpeechSpeed,
  isSpeechVoice,
  type SpeechSettings,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * Whether replies are read aloud, which engine reads them, and in which voice. It is a file of its own
 * rather than a field of `voice-preference.json`, so an earlier version that rewrites that file keeps
 * this one.
 *
 * A file that is missing, unreadable as JSON or names an unknown Supertonic voice reads as the default:
 * replies are not read aloud. A file from before the engine field reads as Supertonic 3 and keeps its
 * voice. The ElevenLabs voice is kept beside it, so a switch back does not ask the user to choose again.
 * A file with no known speed, such as one from an earlier version, reads at normal speed. The speed is
 * an extra field of version 1, so an earlier version still reads the file.
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
        readPreferenceFile(this.#path, (parsed): SpeechSettings | null => decodeSpeechPreference(parsed)),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#settings = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): SpeechSettings {
    const settings = this.#settings;
    return {
      readReplies: settings.readReplies,
      voice: settings.voice,
      speed: settings.speed,
      engine: settings.engine,
      elevenLabsVoice: settings.elevenLabsVoice
        ? { id: settings.elevenLabsVoice.id, name: settings.elevenLabsVoice.name }
        : null,
    };
  }

  readonly set = Effect.fn("SpeechPreference.set")(function* (this: SpeechPreferenceStore, settings: SpeechSettings) {
    const saved = speechPreferenceRecord(settings);
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, saved).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#settings = speechSettingsFromRecord(saved);
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}

/** Version 1, plus the engine and speed fields. An older reader keeps `readReplies` and `voice`. */
function speechPreferenceRecord(settings: SpeechSettings) {
  return {
    version: 1 as const,
    readReplies: settings.readReplies,
    voice: settings.voice,
    speed: settings.speed,
    engine: settings.engine,
    elevenLabsVoice: settings.elevenLabsVoice
      ? { id: settings.elevenLabsVoice.id, name: settings.elevenLabsVoice.name }
      : null,
  };
}

function speechSettingsFromRecord(record: ReturnType<typeof speechPreferenceRecord>): SpeechSettings {
  return {
    readReplies: record.readReplies,
    voice: record.voice,
    speed: record.speed,
    engine: record.engine,
    elevenLabsVoice: record.elevenLabsVoice,
  };
}

/** A version-1 file. Unknown engine or voice fields fall back; a bad Supertonic voice rejects the file. */
function decodeSpeechPreference(parsed: unknown): SpeechSettings | null {
  if (
    !isDynamicRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.readReplies !== "boolean" ||
    !isSpeechVoice(parsed.voice)
  )
    return null;
  return {
    readReplies: parsed.readReplies,
    voice: parsed.voice,
    speed: isSpeechSpeed(parsed.speed) ? parsed.speed : DEFAULT_SPEECH_SETTINGS.speed,
    engine: isSpeechEngine(parsed.engine) ? parsed.engine : "supertonic",
    elevenLabsVoice: isElevenLabsSpeechVoice(parsed.elevenLabsVoice)
      ? { id: parsed.elevenLabsVoice.id, name: parsed.elevenLabsVoice.name }
      : null,
  };
}
