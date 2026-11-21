import {
  DEFAULT_SPEECH_SETTINGS,
  ELEVENLABS_AGENT_VOICE_IDS_LIMIT,
  isCodexLiveVoice,
  isElevenLabsAgentVoiceIds,
  isElevenLabsSpeechVoice,
  isElevenLabsVoiceId,
  isSpeechModelId,
  isSpeechSpeed,
  isSpeechVoice,
  isVoiceTurnPause,
  isXaiSpeechVoice,
  type SpeechSettings,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";
import { VoiceOperationError } from "./voice-model-service";

export class SpeechPreferenceStore {
  readonly #path: string;
  #settings: SpeechSettings = {
    ...DEFAULT_SPEECH_SETTINGS,
    elevenLabsAgentVoiceIds: { ...DEFAULT_SPEECH_SETTINGS.elevenLabsAgentVoiceIds },
  };
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
            ? {
                readReplies: parsed.readReplies,
                modelId: isSpeechModelId(parsed.modelId) ? parsed.modelId : DEFAULT_SPEECH_SETTINGS.modelId,
                voice: parsed.voice,
                elevenLabsVoice: isElevenLabsSpeechVoice(parsed.elevenLabsVoice)
                  ? parsed.elevenLabsVoice
                  : DEFAULT_SPEECH_SETTINGS.elevenLabsVoice,
                elevenLabsCustomVoiceId: isElevenLabsVoiceId(parsed.elevenLabsCustomVoiceId)
                  ? parsed.elevenLabsCustomVoiceId
                  : null,
                elevenLabsAgentVoiceIds: isElevenLabsAgentVoiceIds(parsed.elevenLabsAgentVoiceIds)
                  ? { ...parsed.elevenLabsAgentVoiceIds }
                  : {},
                xaiVoice: isXaiSpeechVoice(parsed.xaiVoice) ? parsed.xaiVoice : DEFAULT_SPEECH_SETTINGS.xaiVoice,
                speed: isSpeechSpeed(parsed.speed) ? parsed.speed : DEFAULT_SPEECH_SETTINGS.speed,
                codexLive: parsed.codexLive === true,
                codexLiveVoice: isCodexLiveVoice(parsed.codexLiveVoice) ? parsed.codexLiveVoice : null,
                turnPauseMs: isVoiceTurnPause(parsed.turnPauseMs)
                  ? parsed.turnPauseMs
                  : DEFAULT_SPEECH_SETTINGS.turnPauseMs,
              }
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
    return { ...this.#settings, elevenLabsAgentVoiceIds: { ...this.#settings.elevenLabsAgentVoiceIds } };
  }

  readonly set = Effect.fn("SpeechPreference.set")(function* (this: SpeechPreferenceStore, input: SpeechSettings) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() => {
          const settings: SpeechSettings = {
            readReplies: input.readReplies,
            modelId: input.modelId,
            voice: input.voice,
            elevenLabsVoice: input.elevenLabsVoice,
            elevenLabsCustomVoiceId: input.elevenLabsCustomVoiceId,
            elevenLabsAgentVoiceIds: { ...this.#settings.elevenLabsAgentVoiceIds },
            xaiVoice: input.xaiVoice,
            speed: input.speed,
            codexLive: input.codexLive,
            codexLiveVoice: input.codexLiveVoice,
            turnPauseMs: input.turnPauseMs,
          };
          return writePreferenceFile(this.#path, { version: 1, ...settings }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#settings = settings;
              }),
            ),
          );
        }),
      ),
    );
    return this.get();
  });

  readonly setAgentElevenLabsVoiceId = Effect.fn("SpeechPreference.setAgentElevenLabsVoiceId")(function* (
    this: SpeechPreferenceStore,
    agentKey: string,
    voiceId: string | null,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend<void, PreferenceFileFailure | VoiceOperationError, never>(() => {
          const elevenLabsAgentVoiceIds = { ...this.#settings.elevenLabsAgentVoiceIds };
          if (voiceId === null) delete elevenLabsAgentVoiceIds[agentKey];
          else elevenLabsAgentVoiceIds[agentKey] = voiceId;
          if (Object.keys(elevenLabsAgentVoiceIds).length > ELEVENLABS_AGENT_VOICE_IDS_LIMIT) {
            return Effect.fail(
              new VoiceOperationError({
                cause: new Error(
                  sourceText("error.voice.speech.agentOverrideLimit", { limit: ELEVENLABS_AGENT_VOICE_IDS_LIMIT }),
                ),
              }),
            );
          }
          const settings: SpeechSettings = { ...this.#settings, elevenLabsAgentVoiceIds };
          return writePreferenceFile(this.#path, { version: 1, ...settings }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.#settings = settings;
              }),
            ),
          );
        }),
      ),
    );
    return this.get();
  });
}
