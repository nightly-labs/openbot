import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AUTOMATIC_VOICE_LANGUAGE,
  type CloudVoiceModelId,
  type CloudVoiceModelInfo,
  type DictationKeyProvider,
  ELEVENLABS_VOICE_MODEL_ID,
  type GroqVoiceModelId,
  isGroqVoiceModelId,
  isLocalVoiceModelId,
  LOCAL_VOICE_MODEL_IDS,
  type LocalVoiceModelId,
  modelLanguage,
  VOICE_AUDIO_LIMITS,
  VOICE_KEY_PROVIDER_NAMES,
  VOICE_MODEL_IDS,
  VOICE_MODELS,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceSettings,
  type VoiceStream,
  type VoiceStreamAudio,
  type VoiceStreamTranscript,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Scope, Semaphore } from "effect";
import { savedKeyError, type VoiceApiKeyStore } from "./voice-api-key-store";
import {
  type OpenVoiceStreamSocket,
  ScribeRealtimeSession,
  scribeRealtimeUrl,
  VoiceStreamFailure,
} from "./voice-cloud-stream";
import {
  TRANSCRIPTION_SESSION_CONFIGS,
  transcriptionHostThreads,
  VOICE_RUNTIME_ADDON,
  VoiceModelService,
  VoiceOperationError,
} from "./voice-model-service";
import type { VoicePreferenceStore } from "./voice-preference-store";
import { transcribeRecording } from "./voice-server-service";
import type {
  VoiceTranscriptionEngine,
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const logger = createOpenBotLogger("voice-transcription-service");

const TRANSCRIPTION_TIMEOUT_MS = 180_000;
/** Groq's OpenAI-compatible API. Only the recording, the model and the language go there. */
const GROQ_API_ADDRESS = "https://api.groq.com/openai/v1";
/** The model name that Groq takes for each Groq dictation model. */
const GROQ_MODELS: Record<GroqVoiceModelId, string> = {
  "groq-whisper-large-v3-turbo": "whisper-large-v3-turbo",
  "groq-whisper-large-v3": "whisper-large-v3",
};
const CLOUD_MODELS = VOICE_MODELS.filter((model): model is CloudVoiceModelInfo => model.kind === "cloud");
/** The sherpa-onnx engine of each local model. The bench and smoke scripts use it too. */
export const MODEL_ENGINES: Record<LocalVoiceModelId, VoiceTranscriptionEngine> = {
  "parakeet-tdt-0.6b-v3": "nemo-transducer",
  "parakeet-unified-en-0.6b": "nemo-transducer",
  "bark-3.0-plus": "nemo-transducer",
  "whisper-turbo": "whisper",
  "cohere-transcribe-03-2026": "cohere-transcribe",
};
/** Bark was evaluated with 0.25 s of silence before the speech; without it, it can lose the first word. */
const LEADING_SILENCE_SAMPLES: Record<LocalVoiceModelId, number> = {
  "parakeet-tdt-0.6b-v3": 0,
  "parakeet-unified-en-0.6b": 0,
  "bark-3.0-plus": 4_000,
  "whisper-turbo": 0,
  "cohere-transcribe-03-2026": 0,
};

/**
 * The language the host gets: a code, or empty to let Whisper find it. Parakeet and Bark take none,
 * and Cohere Transcribe takes only its own languages.
 */
function hostLanguage(modelId: LocalVoiceModelId, language: VoiceSettings["language"]): string {
  if (MODEL_ENGINES[modelId] === "nemo-transducer") return "";
  const model = VOICE_MODELS.find((candidate) => candidate.id === modelId);
  const used = model ? modelLanguage(model, language) : language;
  return used === AUTOMATIC_VOICE_LANGUAGE ? "" : used;
}

/**
 * The loaded model holds about 2 GB, so the host ends after this long without a request. While
 * the user speaks, the renderer asks about once per second, so the host stays loaded until then.
 */
const HOST_IDLE_MS = 60_000;
/** A loaded model keeps its thread count, so the count is read once. */
const HOST_THREADS = transcriptionHostThreads();
/** `parseVoiceTranscription` accepts only the canonical 44-byte header before the PCM data. */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SECOND = 32_000;
/** A stream carries at most as much audio as one recording may hold. */
const MAXIMUM_STREAM_BYTES = VOICE_AUDIO_LIMITS.maximumSeconds * BYTES_PER_SECOND;

interface VoiceTranscriptionEvents {
  modelStatus: [status: VoiceModelStatus];
  streamTranscript: [transcript: VoiceStreamTranscript];
}

interface ActiveStream {
  id: string;
  session: ScribeRealtimeSession;
  bytes: number;
}

/**
 * What the renderer is told when the build carries no speech recognition runtime at all: a stated
 * limit, not a download of a model that nothing can read.
 */
const RUNTIME_UNAVAILABLE_MESSAGE = sourceText("error.voice.runtimeUnavailable");

interface VoiceTranscriptionServiceOptions {
  resourcesRoot: string;
  modelDirectories: Record<LocalVoiceModelId, string>;
  preferences: VoicePreferenceStore;
  /** The key of each dictation provider. The ElevenLabs key also reads replies aloud. */
  apiKeys: Record<DictationKeyProvider, VoiceApiKeyStore>;
  spawnHost: () => VoiceTranscriptionHostProcess;
  openStreamSocket: OpenVoiceStreamSocket;
  fetch?: typeof fetch;
  /** The download of the dictation models. Without it, `fetch`. */
  modelFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** A failure the host reported. Only its category is known; the addon's own message stays there. */
class HostFailure extends Error {
  constructor(readonly category: VoiceTranscriptionFailure | "host-exited") {
    super(category);
  }
}

interface PendingRequest {
  id: number;
  settle: (result: Effect.Effect<string, VoiceOperationError>) => void;
}

export class VoiceTranscriptionService extends EventEmitter<VoiceTranscriptionEvents> {
  readonly #scope = Scope.makeUnsafe();
  readonly #addonPath: string;
  readonly #models: Record<LocalVoiceModelId, VoiceModelService<LocalVoiceModelId>>;
  readonly #preferences: VoicePreferenceStore;
  readonly #apiKeys: Record<DictationKeyProvider, VoiceApiKeyStore>;
  readonly #fetch: typeof fetch;
  readonly #spawnHost: () => VoiceTranscriptionHostProcess;
  readonly #openStreamSocket: OpenVoiceStreamSocket;
  #host: VoiceTranscriptionHostProcess | null = null;
  /** The model the running host loaded. The host holds one model, so another one starts a new host. */
  #hostModelId: LocalVoiceModelId | null = null;
  /** The cloud dictation in progress. A new one ends it. */
  #stream: ActiveStream | null = null;
  #pending: PendingRequest | null = null;
  #nextRequestId = 1;
  #idleTimer: NodeJS.Timeout | null = null;
  #busy = false;
  /** Transcriptions run one at a time: dictation and the parts of a video wait in one queue. */
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(options: VoiceTranscriptionServiceOptions) {
    super();
    this.#addonPath = join(options.resourcesRoot, "runtime", VOICE_RUNTIME_ADDON);
    this.#spawnHost = options.spawnHost;
    this.#openStreamSocket = options.openStreamSocket;
    this.#preferences = options.preferences;
    this.#apiKeys = options.apiKeys;
    this.#fetch = options.fetch ?? fetch;
    const modelFetch = options.modelFetch ?? options.fetch;
    const model = (modelId: LocalVoiceModelId) => {
      const service = new VoiceModelService<LocalVoiceModelId>({
        modelId,
        directory: options.modelDirectories[modelId],
        ...(modelFetch === undefined ? {} : { fetch: modelFetch }),
      });
      service.on("status", (status) => this.emit("modelStatus", status));
      return service;
    };
    this.#models = {
      "parakeet-tdt-0.6b-v3": model("parakeet-tdt-0.6b-v3"),
      "parakeet-unified-en-0.6b": model("parakeet-unified-en-0.6b"),
      "bark-3.0-plus": model("bark-3.0-plus"),
      "whisper-turbo": model("whisper-turbo"),
      "cohere-transcribe-03-2026": model("cohere-transcribe-03-2026"),
    };
  }

  /** The status of the model in use. */
  readonly getModelStatus = Effect.fn("VoiceTranscription.getModelStatus")(function* (this: VoiceTranscriptionService) {
    return yield* this.#status(this.#preferences.get().modelId);
  }).bind(this);

  readonly getModelStatuses = Effect.fn("VoiceTranscription.getModelStatuses")(function* (
    this: VoiceTranscriptionService,
  ) {
    const statuses: VoiceModelStatus[] = [];
    for (const modelId of VOICE_MODEL_IDS) statuses.push(yield* this.#status(modelId));
    return statuses;
  }).bind(this);

  /** Downloads the model in use when it is missing. */
  readonly prepareModel = Effect.fn("VoiceTranscription.prepareModel")(function* (this: VoiceTranscriptionService) {
    return yield* this.downloadModel(this.#preferences.get().modelId);
  }).bind(this);

  readonly downloadModel = Effect.fn("VoiceTranscription.downloadModel")(function* (
    this: VoiceTranscriptionService,
    modelId: VoiceModelId,
  ) {
    // A cloud model has nothing to download: it is ready when its key is saved.
    if (!isLocalVoiceModelId(modelId)) return this.#cloudStatus(modelId);
    return this.#runtimeMissing(modelId) ?? (yield* this.#models[modelId].prepare());
  }).bind(this);

  readonly cancelModelDownload = Effect.fn("VoiceTranscription.cancelModelDownload")(function* (
    this: VoiceTranscriptionService,
    modelId: VoiceModelId,
  ) {
    if (!isLocalVoiceModelId(modelId)) return this.#cloudStatus(modelId);
    return this.#runtimeMissing(modelId) ?? (yield* this.#models[modelId].cancel());
  }).bind(this);

  /**
   * Deletes a downloaded model from this computer, and stops its download first. The model in use
   * can go too: the next dictation downloads it again, as it does for a model not downloaded yet.
   */
  readonly removeModel = Effect.fn("VoiceTranscription.removeModel")(function* (
    this: VoiceTranscriptionService,
    modelId: VoiceModelId,
  ) {
    if (!isLocalVoiceModelId(modelId))
      return yield* new VoiceOperationError({ cause: new Error("A cloud model has no files to remove.") });
    if (this.#busy) return yield* new VoiceOperationError({ cause: new Error(sourceText("error.voice.removeBusy")) });
    // A transcription that starts during the removal waits in `prepare`, then downloads the model again.
    return yield* this.#models[modelId].remove(
      Effect.suspend(() => (this.#hostModelId === modelId ? this.#endHost() : Effect.void)),
    );
  }).bind(this);

  getSettings(): VoiceSettings {
    return this.#preferences.get();
  }

  readonly setSettings = Effect.fn("VoiceTranscription.setSettings")(function* (
    this: VoiceTranscriptionService,
    settings: VoiceSettings,
  ) {
    return yield* this.#preferences.set(settings);
  }).bind(this);

  readonly transcribe = Effect.fn("VoiceTranscription.transcribe")(
    (audio: Uint8Array): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError> =>
      Effect.gen({ self: this }, function* () {
        return yield* this.#queue.withPermit(
          Effect.acquireUseRelease(
            Effect.sync(() => {
              this.#busy = true;
            }),
            () =>
              Effect.gen({ self: this }, function* () {
                const settings = this.#preferences.get();
                const { modelId } = settings;
                if (isGroqVoiceModelId(modelId))
                  return yield* this.#transcribeAtGroq(audio, modelId, settings.language);
                // ElevenLabs takes a stream, not a recording.
                if (!isLocalVoiceModelId(modelId))
                  return yield* new VoiceOperationError({
                    cause: new Error(sourceText("error.voice.transcriptionFailed")),
                  });
                // After the first full check in this process, this is a `stat` of each model file.
                const modelStatus = yield* this.downloadModel(modelId);
                if (modelStatus.phase !== "ready")
                  return yield* new VoiceOperationError({
                    cause: new Error(modelStatus.message ?? sourceText("error.voice.modelUnavailable")),
                  });
                const startedAt = Date.now();
                const pcm = audio.slice(WAV_HEADER_BYTES);
                const audioSeconds = (pcm.byteLength / BYTES_PER_SECOND).toFixed(1);
                return yield* Effect.gen({ self: this }, function* () {
                  const text = yield* this.#request(pcm, modelId, settings.language);
                  if (text.length > INPUT_LIMITS.messageText)
                    return yield* new VoiceOperationError({ cause: new Error("The voice transcript is too long.") });
                  logger.info(`Voice transcription of ${audioSeconds}s completed in ${Date.now() - startedAt}ms.`);
                  return { text };
                }).pipe(
                  Effect.mapError((error) => {
                    logger.error(
                      `Voice transcription of ${audioSeconds}s failed after ${Date.now() - startedAt}ms.`,
                      errorCategory(error.cause),
                    );
                    return new VoiceOperationError({ cause: userFacingError(error.cause) });
                  }),
                );
              }),
            () =>
              Effect.sync(() => {
                this.#busy = false;
              }),
          ),
        );
      }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }), Effect.flatMap(Fiber.join)),
  );

  /**
   * Saves or removes the key of a dictation provider, and announces the status of each of its
   * models. Answers the status of its model in use, or of its first model.
   */
  readonly setApiKey = Effect.fn("VoiceTranscription.setApiKey")(function* (
    this: VoiceTranscriptionService,
    provider: DictationKeyProvider,
    key: string | null,
  ) {
    yield* this.#apiKeys[provider]
      .set(key)
      .pipe(Effect.mapError(({ cause }) => new VoiceOperationError({ cause: savedKeyError(cause, provider) })));
    // A stream holds the key it opened with; a removed key ends it.
    if (key === null && provider === "elevenlabs") this.#endStream();
    const statuses = CLOUD_MODELS.filter((model) => model.provider === provider).map((model) =>
      this.#cloudStatus(model.id),
    );
    for (const status of statuses) this.emit("modelStatus", status);
    const inUse = this.#preferences.get().modelId;
    // Each provider has at least one model, so the last fallback does not run.
    return (
      statuses.find((status) => status.modelId === inUse) ?? statuses[0] ?? this.#cloudStatus(ELEVENLABS_VOICE_MODEL_ID)
    );
  }).bind(this);

  /**
   * Opens a dictation with ElevenLabs, with the language in the settings. Answers when ElevenLabs
   * started the session. A stream that is still open ends: one recording streams at a time.
   */
  readonly startStream = Effect.fn("VoiceTranscription.startStream")(function* (this: VoiceTranscriptionService) {
    this.#endStream();
    const { modelId, language } = this.#preferences.get();
    const apiKey = this.#apiKeys.elevenlabs.get();
    if (modelId !== ELEVENLABS_VOICE_MODEL_ID || !apiKey)
      return yield* new VoiceOperationError({
        cause: new Error(
          sourceText("error.voice.cloud.keyRequired", { provider: VOICE_KEY_PROVIDER_NAMES.elevenlabs }),
        ),
      });
    const id = randomUUID();
    const session = new ScribeRealtimeSession({
      url: scribeRealtimeUrl(language),
      apiKey,
      open: this.#openStreamSocket,
      onText: (text) => {
        if (this.#stream?.id === id) this.emit("streamTranscript", { streamId: id, text });
      },
    });
    this.#stream = { id, session, bytes: 0 };
    yield* Effect.tryPromise({ try: () => session.ready, catch: streamError }).pipe(
      Effect.tapError(() => Effect.sync(() => this.#endStream(id))),
      Effect.onInterrupt(() => Effect.sync(() => this.#endStream(id))),
    );
    return { streamId: id } satisfies VoiceStream;
  }).bind(this);

  readonly appendStream = Effect.fn("VoiceTranscription.appendStream")(function* (
    this: VoiceTranscriptionService,
    { streamId, pcm }: VoiceStreamAudio,
  ) {
    const stream = yield* this.#activeStream(streamId);
    stream.bytes += pcm.byteLength;
    if (stream.bytes > MAXIMUM_STREAM_BYTES) {
      this.#endStream(streamId);
      return yield* new VoiceOperationError({ cause: new Error(sourceText("error.voice.cloud.tooLong")) });
    }
    // A failed session stays until finish or cancel, so that both report its failure, not "ended".
    yield* Effect.try({ try: () => stream.session.append(pcm), catch: streamError });
  }).bind(this);

  /** Ends the audio of a stream and answers its whole text. */
  readonly finishStream = Effect.fn("VoiceTranscription.finishStream")(function* (
    this: VoiceTranscriptionService,
    { streamId }: VoiceStream,
  ) {
    const stream = yield* this.#activeStream(streamId);
    const text = yield* Effect.tryPromise({ try: () => stream.session.finish(), catch: streamError }).pipe(
      Effect.ensuring(Effect.sync(() => this.#endStream(streamId))),
    );
    if (text.length > INPUT_LIMITS.messageText)
      return yield* new VoiceOperationError({ cause: new Error("The voice transcript is too long.") });
    return { text } satisfies VoiceTranscriptionResult;
  }).bind(this);

  cancelStream({ streamId }: VoiceStream): void {
    this.#endStream(streamId);
  }

  readonly shutdown = Effect.fn("VoiceTranscription.shutdown")(function* (this: VoiceTranscriptionService) {
    this.#endStream();
    this.#stopHost();
    for (const modelId of LOCAL_VOICE_MODEL_IDS) yield* this.#models[modelId].shutdown();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  #status(modelId: VoiceModelId): Effect.Effect<VoiceModelStatus, VoiceOperationError> {
    if (!isLocalVoiceModelId(modelId)) return Effect.succeed(this.#cloudStatus(modelId));
    const missing = this.#runtimeMissing(modelId);
    return missing ? Effect.succeed(missing) : this.#models[modelId].getStatus();
  }

  /** A cloud model is ready when the key of its provider is saved. */
  #cloudStatus(modelId: CloudVoiceModelId): VoiceModelStatus {
    const provider = cloudProvider(modelId);
    return this.#apiKeys[provider].get()
      ? { modelId, phase: "ready", progress: null, message: null }
      : {
          modelId,
          phase: "missing",
          progress: null,
          message: sourceText("error.voice.cloud.keyRequired", { provider: VOICE_KEY_PROVIDER_NAMES[provider] }),
        };
  }

  /** Sends the whole recording to Groq after Stop. Groq has no stream for Whisper. */
  #transcribeAtGroq(
    audio: Uint8Array,
    modelId: GroqVoiceModelId,
    language: VoiceSettings["language"],
  ): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError> {
    const apiKey = this.#apiKeys.groq.get();
    if (!apiKey)
      return Effect.fail(
        new VoiceOperationError({
          cause: new Error(sourceText("error.voice.cloud.keyRequired", { provider: VOICE_KEY_PROVIDER_NAMES.groq })),
        }),
      );
    const startedAt = Date.now();
    const audioSeconds = (Math.max(0, audio.byteLength - WAV_HEADER_BYTES) / BYTES_PER_SECOND).toFixed(1);
    return transcribeRecording(
      this.#fetch,
      { address: GROQ_API_ADDRESS, apiKey },
      GROQ_MODELS[modelId],
      audio,
      language,
      { label: "Groq", refused: groqRefusal },
    ).pipe(
      Effect.flatMap((result) =>
        result.text.length > INPUT_LIMITS.messageText
          ? Effect.fail(new VoiceOperationError({ cause: new Error("The voice transcript is too long.") }))
          : Effect.succeed(result),
      ),
      Effect.tap(() =>
        Effect.sync(() =>
          logger.info(`Groq transcription of ${audioSeconds}s completed in ${Date.now() - startedAt}ms.`),
        ),
      ),
    );
  }

  #activeStream(streamId: string): Effect.Effect<ActiveStream, VoiceOperationError> {
    const stream = this.#stream;
    if (stream?.id === streamId) return Effect.succeed(stream);
    return Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.cloud.streamEnded")) }));
  }

  /** Ends the open stream, or only the named one. Its text is dropped. */
  #endStream(streamId?: string): void {
    const stream = this.#stream;
    if (!stream || (streamId !== undefined && stream.id !== streamId)) return;
    this.#stream = null;
    stream.session.cancel();
  }

  /** Reports a build with no bundled speech recognition runtime. */
  #runtimeMissing(modelId: LocalVoiceModelId): VoiceModelStatus | null {
    if (existsSync(this.#addonPath)) return null;
    const status: VoiceModelStatus = { modelId, phase: "error", progress: null, message: RUNTIME_UNAVAILABLE_MESSAGE };
    this.emit("modelStatus", status);
    return status;
  }

  /** Sends one request to the host, starting it if needed, and keeps it loaded until it is idle. */
  #request(
    pcm: Uint8Array,
    modelId: LocalVoiceModelId,
    language: VoiceSettings["language"],
  ): Effect.Effect<string, VoiceOperationError> {
    return Effect.callback<string, VoiceOperationError>((resume) => {
      this.#cancelIdleStop();
      if (this.#hostModelId !== modelId) this.#stopHost();
      const host = this.#ensureHost();
      this.#hostModelId = modelId;
      const id = this.#nextRequestId++;
      let settled = false;
      this.#pending = {
        id,
        settle: (result) => {
          settled = true;
          resume(result);
        },
      };
      const engine = MODEL_ENGINES[modelId];
      host.send({
        id,
        addonPath: this.#addonPath,
        modelDirectory: this.#models[modelId].directory,
        engine,
        language: hostLanguage(modelId, language),
        leadingSilenceSamples: LEADING_SILENCE_SAMPLES[modelId],
        numThreads: HOST_THREADS,
        sessionConfig: TRANSCRIPTION_SESSION_CONFIGS[modelId],
        pcm,
      });
      return Effect.sync(() => {
        if (this.#pending?.id === id) this.#pending = null;
        // A decode cannot be cancelled, and a host that still works on it would answer late.
        if (!settled) this.#stopHost();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: TRANSCRIPTION_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.transcriptionTimedOut")) })),
      }),
      Effect.ensuring(Effect.sync(() => this.#scheduleIdleStop())),
    );
  }

  #ensureHost(): VoiceTranscriptionHostProcess {
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
      this.#hostModelId = null;
      this.#cancelIdleStop();
      const pending = this.#pending;
      if (pending)
        this.#settle(pending.id, Effect.fail(new VoiceOperationError({ cause: new HostFailure("host-exited") })));
    });
    return host;
  }

  #settle(id: number, result: Effect.Effect<string, VoiceOperationError>): void {
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
    this.#hostModelId = null;
    host?.kill();
  }
}

/** The text for a Groq answer that is not about the recording: a refused key or a rate limit. */
function groqRefusal(status: number): string | null {
  const provider = VOICE_KEY_PROVIDER_NAMES.groq;
  if (status === 401 || status === 403) return sourceText("error.voice.cloud.keyRejected", { provider });
  if (status === 429) return sourceText("error.voice.cloud.rateLimited", { provider });
  return null;
}

function cloudProvider(modelId: CloudVoiceModelId): DictationKeyProvider {
  return CLOUD_MODELS.find((model) => model.id === modelId)?.provider ?? "elevenlabs";
}

function responseResult(response: VoiceTranscriptionResponse): Effect.Effect<string, VoiceOperationError> {
  if ("text" in response) return Effect.succeed(response.text);
  return Effect.fail(new VoiceOperationError({ cause: new HostFailure(response.error) }));
}

/** A stream failure carries localized text; anything else is reported as a failed transcription. */
function streamError(cause: unknown): VoiceOperationError {
  return new VoiceOperationError({
    cause:
      cause instanceof VoiceStreamFailure
        ? new Error(cause.message)
        : new Error(sourceText("error.voice.transcriptionFailed")),
  });
}

/** The cipher's message for a computer with no secret storage; any other failure is generic. */
function errorCategory(
  error: unknown,
): "unknown" | "timeout" | "runtime-unavailable" | "model-load-failed" | "inference-failed" | "host-exited" {
  if (error instanceof HostFailure) return error.category;
  if (!(error instanceof Error)) return "unknown";
  if (error.message === sourceText("error.voice.transcriptionTimedOut")) return "timeout";
  return "inference-failed";
}

function userFacingError(error: unknown): Error {
  if (error instanceof Error && error.message === sourceText("error.voice.transcriptionTimedOut")) return error;
  if (error instanceof HostFailure && error.category === "runtime-unavailable") {
    return new Error(sourceText("error.voice.prepareRequired"));
  }
  return new Error(sourceText("error.voice.transcriptionFailed"));
}
