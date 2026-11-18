import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cloudSpeechModel,
  SPEECH_MODEL_ID,
  SPEECH_VOICES,
  type SpeechAudio,
  type SpeechInput,
  type SpeechModelStatus,
  type SpeechSettings,
  VOICE_KEY_PROVIDER_NAMES,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Scope, Semaphore } from "effect";
import type { SpeechPreferenceStore } from "./speech-preference-store";
import { savedKeyError, type VoiceApiKeyStore } from "./voice-api-key-store";
import { type SpeechFetch, speakInCloud } from "./voice-cloud-speech";
import {
  SPEECH_HOST_THREADS,
  SPEECH_SESSION_CONFIG,
  VOICE_RUNTIME_ADDON,
  VoiceModelService,
  VoiceOperationError,
} from "./voice-model-service";
import type { VoiceSpeechFailure, VoiceSpeechHostProcess, VoiceSpeechResponse } from "./voice-speech-protocol";

const logger = createOpenBotLogger("voice-speech-service");

/** One request is at most `SPEECH_LIMITS.maximumTextLength` characters: about a minute of speech. */
const SPEECH_TIMEOUT_MS = 120_000;
/** The loaded model holds about 300 MB. A reply asks for its next part while the part before plays. */
const HOST_IDLE_MS = 60_000;

interface VoiceSpeechEvents {
  modelStatus: [status: SpeechModelStatus];
}

interface VoiceSpeechServiceOptions {
  resourcesRoot: string;
  modelDirectory: string;
  preferences: SpeechPreferenceStore;
  spawnHost: () => VoiceSpeechHostProcess;
  /** The keys of the cloud models. The ElevenLabs key is the store of ElevenLabs dictation. */
  apiKeys: { elevenlabs: VoiceApiKeyStore; xai: VoiceApiKeyStore };
  fetch?: SpeechFetch;
  /** The download of the Supertonic model. Without it, `fetch`. */
  modelFetch?: SpeechFetch;
}

/** A failure the host reported. Only its category is known; the addon's own message stays there. */
class HostFailure extends Error {
  constructor(readonly category: VoiceSpeechFailure | "host-exited") {
    super(category);
  }
}

interface PendingRequest {
  id: number;
  settle: (result: Effect.Effect<SpeechAudio, VoiceOperationError>) => void;
}

/**
 * Reads replies aloud with Supertonic 3 on this computer, where nothing leaves the computer, or with a
 * cloud model that the user chose, which sends the reply text to its provider with the user's own key.
 */
export class VoiceSpeechService extends EventEmitter<VoiceSpeechEvents> {
  readonly #scope = Scope.makeUnsafe();
  readonly #addonPath: string;
  readonly #model: VoiceModelService<typeof SPEECH_MODEL_ID>;
  readonly #preferences: SpeechPreferenceStore;
  readonly #spawnHost: () => VoiceSpeechHostProcess;
  readonly #apiKeys: VoiceSpeechServiceOptions["apiKeys"];
  readonly #fetch: SpeechFetch;
  /** The host synthesizes one text at a time, so a request waits for the one before it. */
  readonly #requests = Semaphore.makeUnsafe(1);
  #host: VoiceSpeechHostProcess | null = null;
  #pending: PendingRequest | null = null;
  #nextRequestId = 1;
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(options: VoiceSpeechServiceOptions) {
    super();
    this.#addonPath = join(options.resourcesRoot, "runtime", VOICE_RUNTIME_ADDON);
    this.#preferences = options.preferences;
    this.#spawnHost = options.spawnHost;
    this.#apiKeys = options.apiKeys;
    this.#fetch = options.fetch ?? fetch;
    const modelFetch = options.modelFetch ?? options.fetch;
    this.#model = new VoiceModelService({
      modelId: SPEECH_MODEL_ID,
      directory: options.modelDirectory,
      ...(modelFetch === undefined ? {} : { fetch: modelFetch }),
    });
    // The status event is the status of the model in the settings.
    this.#model.on("status", (status) => {
      if (this.#preferences.get().modelId === SPEECH_MODEL_ID) this.emit("modelStatus", status);
    });
  }

  getSettings(): SpeechSettings {
    return this.#preferences.get();
  }

  readonly setSettings = Effect.fn("VoiceSpeech.setSettings")(function* (
    this: VoiceSpeechService,
    settings: SpeechSettings,
  ) {
    const before = this.#preferences.get().modelId;
    const saved = yield* this.#preferences.set(settings);
    if (saved.modelId !== before) {
      // A Supertonic download that the user left stops. Its files stay until the user removes them.
      if (before === SPEECH_MODEL_ID) yield* this.#model.cancel();
      yield* this.announceStatus();
    }
    return saved;
  }).bind(this);

  /** The status of the model in the settings. A cloud model is ready while its provider's key is saved. */
  readonly getModelStatus = Effect.fn("VoiceSpeech.getModelStatus")(function* (this: VoiceSpeechService) {
    return this.#cloudStatus() ?? this.#runtimeMissing() ?? (yield* this.#model.getStatus());
  }).bind(this);

  /** Sends the status of the model in the settings, after a key or the model changed. */
  readonly announceStatus = Effect.fn("VoiceSpeech.announceStatus")(function* (this: VoiceSpeechService) {
    const status = yield* this.getModelStatus();
    this.emit("modelStatus", status);
    return status;
  }).bind(this);

  /** Saves or removes the xAI key. The ElevenLabs key is saved by ElevenLabs dictation. */
  readonly setXaiApiKey = Effect.fn("VoiceSpeech.setXaiApiKey")(function* (
    this: VoiceSpeechService,
    key: string | null,
  ) {
    yield* this.#apiKeys.xai
      .set(key)
      .pipe(Effect.mapError(({ cause }) => new VoiceOperationError({ cause: savedKeyError(cause, "xai") })));
    return yield* this.announceStatus();
  }).bind(this);

  /** Downloads Supertonic 3. A cloud model needs no download: its status is answered. */
  readonly downloadModel = Effect.fn("VoiceSpeech.downloadModel")(function* (this: VoiceSpeechService) {
    return this.#cloudStatus() ?? this.#runtimeMissing() ?? (yield* this.#model.prepare());
  }).bind(this);

  readonly cancelModelDownload = Effect.fn("VoiceSpeech.cancelModelDownload")(function* (this: VoiceSpeechService) {
    return this.#cloudStatus() ?? this.#runtimeMissing() ?? (yield* this.#model.cancel());
  }).bind(this);

  /**
   * Deletes the model from this computer, and stops its download first. A part that is read now
   * finishes before the host ends. Replies are not read aloud until the model is downloaded again.
   */
  readonly removeModel = Effect.fn("VoiceSpeech.removeModel")(function* (this: VoiceSpeechService) {
    const removed = yield* this.#requests.withPermit(this.#model.remove(Effect.suspend(() => this.#endHost())));
    return this.#cloudStatus() ?? removed;
  }).bind(this);

  /** Reads one part of a reply with the model and voice in the settings. It does not download the model. */
  readonly speak = Effect.fn("VoiceSpeech.speak")(function* (this: VoiceSpeechService, input: SpeechInput) {
    const settings = this.#preferences.get();
    const cloud = cloudSpeechModel(settings.modelId);
    if (cloud) {
      const key = this.#apiKeys[cloud.provider].get();
      if (!key)
        return yield* new VoiceOperationError({
          cause: new Error(
            sourceText("error.voice.cloud.keyRequired", { provider: VOICE_KEY_PROVIDER_NAMES[cloud.provider] }),
          ),
        });
      const startedAt = Date.now();
      // The key and the text are never logged: only the provider, the length and the time.
      return yield* speakInCloud(this.#fetch, {
        model: cloud,
        key,
        text: input.text,
        language: input.language,
        elevenLabsVoice: settings.elevenLabsVoice,
        xaiVoice: settings.xaiVoice,
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() =>
            logger.warn(
              `${cloud.provider} speech of ${input.text.length} characters failed after ${Date.now() - startedAt}ms.`,
            ),
          ),
        ),
      );
    }
    const speakerId = SPEECH_VOICES.indexOf(settings.voice);
    const startedAt = Date.now();
    // The status is read with the permit: a removal that holds it can delete the model first.
    const speech = Effect.gen({ self: this }, function* () {
      const status = yield* this.getModelStatus();
      if (status.phase !== "ready")
        return yield* new VoiceOperationError({
          cause: new Error(status.message ?? sourceText("error.voice.speech.modelRequired")),
        });
      return yield* this.#request(input, speakerId).pipe(
        Effect.mapError((error) => {
          logger.error(
            `Speech of ${input.text.length} characters failed after ${Date.now() - startedAt}ms.`,
            errorCategory(error.cause),
          );
          return new VoiceOperationError({ cause: userFacingError(error.cause) });
        }),
      );
    });
    return yield* this.#requests
      .withPermit(speech)
      .pipe(
        Effect.tap((audio) =>
          Effect.sync(() =>
            logger.info(
              `Speech of ${input.text.length} characters (${(audio.pcm.byteLength / 2 / audio.sampleRate).toFixed(1)}s) completed in ${Date.now() - startedAt}ms.`,
            ),
          ),
        ),
      );
  }).bind(this);

  /**
   * Loads the model in the host, so the next `speak` does not wait for it. The host stays loaded
   * until it is idle. A failure is only logged: the `speak` that follows reports it to the user.
   */
  readonly warm = Effect.fn("VoiceSpeech.warm")(function* (this: VoiceSpeechService) {
    if (this.#preferences.get().modelId !== SPEECH_MODEL_ID) return;
    const startedAt = Date.now();
    yield* this.#requests.withPermit(
      Effect.gen({ self: this }, function* () {
        // As in `speak`, a removal that holds the permit can delete the model first.
        const status = yield* this.getModelStatus();
        if (status.phase !== "ready") return;
        yield* this.#request({ text: "", language: "en" }, 0, true).pipe(
          Effect.tap(() => Effect.sync(() => logger.info(`Speech model loaded in ${Date.now() - startedAt}ms.`))),
          Effect.catch((error) =>
            Effect.sync(() => logger.warn("Could not load the speech model in advance.", errorCategory(error.cause))),
          ),
        );
      }),
    );
  }).bind(this);

  readonly shutdown = Effect.fn("VoiceSpeech.shutdown")(function* (this: VoiceSpeechService) {
    this.#stopHost();
    yield* this.#model.shutdown();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  /** The status of a cloud model in the settings, or null while Supertonic is in the settings. */
  #cloudStatus(): SpeechModelStatus | null {
    const { modelId } = this.#preferences.get();
    const cloud = cloudSpeechModel(modelId);
    if (!cloud) return null;
    return this.#apiKeys[cloud.provider].get()
      ? { modelId, phase: "ready", progress: 100, message: null }
      : {
          modelId,
          phase: "missing",
          progress: null,
          // A voice conversation shows this when it cannot start.
          message: sourceText("error.voice.cloud.keyRequired", {
            provider: VOICE_KEY_PROVIDER_NAMES[cloud.provider],
          }),
        };
  }

  /** Reports a build with no bundled sherpa-onnx runtime, as dictation does. */
  #runtimeMissing(): SpeechModelStatus | null {
    if (existsSync(this.#addonPath)) return null;
    const status: SpeechModelStatus = {
      modelId: SPEECH_MODEL_ID,
      phase: "error",
      progress: null,
      message: sourceText("error.voice.speech.runtimeUnavailable"),
    };
    this.emit("modelStatus", status);
    return status;
  }

  /** Sends one request to the host, starting it if needed, and keeps it loaded until it is idle. */
  #request(input: SpeechInput, speakerId: number, loadOnly = false): Effect.Effect<SpeechAudio, VoiceOperationError> {
    return Effect.callback<SpeechAudio, VoiceOperationError>((resume) => {
      this.#cancelIdleStop();
      const host = this.#ensureHost();
      const id = this.#nextRequestId++;
      let settled = false;
      this.#pending = {
        id,
        settle: (result) => {
          settled = true;
          resume(result);
        },
      };
      host.send({
        id,
        addonPath: this.#addonPath,
        modelDirectory: this.#model.directory,
        text: input.text,
        language: input.language,
        speakerId,
        loadOnly,
        numThreads: SPEECH_HOST_THREADS,
        sessionConfig: SPEECH_SESSION_CONFIG,
      });
      return Effect.sync(() => {
        if (this.#pending?.id === id) this.#pending = null;
        // A synthesis cannot be cancelled, and a host that still works on it would answer late.
        if (!settled) this.#stopHost();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: SPEECH_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.speech.timedOut")) })),
      }),
      Effect.ensuring(Effect.sync(() => this.#scheduleIdleStop())),
    );
  }

  #ensureHost(): VoiceSpeechHostProcess {
    if (this.#host) return this.#host;
    const host = this.#spawnHost();
    this.#host = host;
    host.onResponse((response) => {
      if (this.#host !== host) return;
      this.#settle(response.id, responseResult(response));
    });
    host.onExit(() => {
      if (this.#host !== host) return;
      this.#host = null;
      this.#cancelIdleStop();
      const pending = this.#pending;
      if (pending)
        this.#settle(pending.id, Effect.fail(new VoiceOperationError({ cause: new HostFailure("host-exited") })));
    });
    return host;
  }

  #settle(id: number, result: Effect.Effect<SpeechAudio, VoiceOperationError>): void {
    const pending = this.#pending;
    if (pending?.id !== id) return;
    this.#pending = null;
    pending.settle(result);
  }

  #scheduleIdleStop(): void {
    this.#cancelIdleStop();
    if (!this.#host) return;
    this.#idleTimer = setTimeout(() => this.#stopHost(), HOST_IDLE_MS);
    this.#idleTimer.unref();
  }

  #cancelIdleStop(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  /** Ends the host and waits until it exits, so that no process has the model files open. */
  #endHost(): Effect.Effect<void> {
    const host = this.#host;
    if (!host) return Effect.void;
    return Effect.callback<void>((resume) => {
      host.onExit(() => resume(Effect.void));
      this.#stopHost();
    });
  }

  /** Ends the host. Its exit is not reported as a failure: nothing waits on it any more. */
  #stopHost(): void {
    this.#cancelIdleStop();
    const host = this.#host;
    this.#host = null;
    host?.kill();
  }
}

function responseResult(response: VoiceSpeechResponse): Effect.Effect<SpeechAudio, VoiceOperationError> {
  if ("error" in response) return Effect.fail(new VoiceOperationError({ cause: new HostFailure(response.error) }));
  return Effect.succeed({ pcm: response.pcm, sampleRate: response.sampleRate });
}

function errorCategory(error: unknown): VoiceSpeechFailure | "host-exited" | "timeout" | "unknown" {
  if (error instanceof HostFailure) return error.category;
  if (error instanceof Error && error.message === sourceText("error.voice.speech.timedOut")) return "timeout";
  return "unknown";
}

function userFacingError(error: unknown): Error {
  if (error instanceof Error && error.message === sourceText("error.voice.speech.timedOut")) return error;
  if (error instanceof HostFailure && error.category === "runtime-unavailable")
    return new Error(sourceText("error.voice.speech.runtimeUnavailable"));
  return new Error(sourceText("error.voice.speech.failed"));
}
