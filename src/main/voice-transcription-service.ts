import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { VoiceModelStatus, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Scope } from "effect";
import { VOICE_RUNTIME_ADDON, VoiceModelService, VoiceOperationError } from "./voice-model-service";
import type {
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const logger = createOpenBotLogger("voice-transcription-service");

const TRANSCRIPTION_TIMEOUT_MS = 180_000;
/**
 * The loaded model holds about 2 GB, so the host ends after this long without a request. While
 * the user speaks, the renderer asks about once per second, so the host stays loaded until then.
 */
const HOST_IDLE_MS = 60_000;
/** `parseVoiceTranscription` accepts only the canonical 44-byte header before the PCM data. */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SECOND = 32_000;

interface VoiceTranscriptionEvents {
  modelStatus: [status: VoiceModelStatus];
}

/**
 * What the renderer is told when the build carries no speech recognition runtime at all. Linux
 * packages ship without one, so this is the whole of voice on that platform: a stated limit, not a
 * download that spends 670 MB on a model nothing can read.
 */
const RUNTIME_UNAVAILABLE_MESSAGE = sourceText("error.voice.runtimeUnavailable");

interface VoiceTranscriptionServiceOptions {
  resourcesRoot: string;
  modelDirectory: string;
  spawnHost: () => VoiceTranscriptionHostProcess;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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
  readonly #model: VoiceModelService;
  readonly #spawnHost: () => VoiceTranscriptionHostProcess;
  #host: VoiceTranscriptionHostProcess | null = null;
  #pending: PendingRequest | null = null;
  #nextRequestId = 1;
  #idleTimer: NodeJS.Timeout | null = null;
  #busy = false;

  constructor(options: VoiceTranscriptionServiceOptions) {
    super();
    this.#addonPath = join(options.resourcesRoot, "runtime", VOICE_RUNTIME_ADDON);
    this.#spawnHost = options.spawnHost;
    this.#model = new VoiceModelService({ directory: options.modelDirectory, fetch: options.fetch });
    this.#model.on("status", (status) => this.emit("modelStatus", status));
  }

  readonly getModelStatus = Effect.fn("VoiceTranscription.getModelStatus")(function* (this: VoiceTranscriptionService) {
    const missing = this.#runtimeMissing();
    return missing ?? (yield* this.#model.getStatus());
  }).bind(this);

  readonly prepareModel = Effect.fn("VoiceTranscription.prepareModel")(function* (this: VoiceTranscriptionService) {
    const missing = this.#runtimeMissing();
    return missing ?? (yield* this.#model.prepare());
  }).bind(this);

  readonly transcribe = Effect.fn("VoiceTranscription.transcribe")(
    (audio: Uint8Array): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError> =>
      Effect.gen({ self: this }, function* () {
        if (this.#busy) return yield* new VoiceOperationError({ cause: new Error(sourceText("error.voice.busy")) });
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            this.#busy = true;
          }),
          () =>
            Effect.gen({ self: this }, function* () {
              // After the first full check in this process, this is a `stat` of each model file.
              const modelStatus = yield* this.prepareModel();
              if (modelStatus.phase !== "ready")
                return yield* new VoiceOperationError({
                  cause: new Error(modelStatus.message ?? sourceText("error.voice.modelUnavailable")),
                });
              const startedAt = Date.now();
              const pcm = audio.slice(WAV_HEADER_BYTES);
              const audioSeconds = (pcm.byteLength / BYTES_PER_SECOND).toFixed(1);
              return yield* Effect.gen({ self: this }, function* () {
                const text = yield* this.#request(pcm);
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
        );
      }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }), Effect.flatMap(Fiber.join)),
  );

  readonly shutdown = Effect.fn("VoiceTranscription.shutdown")(function* (this: VoiceTranscriptionService) {
    this.#stopHost();
    yield* this.#model.shutdown();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  /** Reports a build with no bundled speech recognition runtime. */
  #runtimeMissing(): VoiceModelStatus | null {
    if (existsSync(this.#addonPath)) return null;
    const status: VoiceModelStatus = { phase: "error", progress: null, message: RUNTIME_UNAVAILABLE_MESSAGE };
    this.emit("modelStatus", status);
    return status;
  }

  /** Sends one request to the host, starting it if needed, and keeps it loaded until it is idle. */
  #request(pcm: Uint8Array): Effect.Effect<string, VoiceOperationError> {
    return Effect.callback<string, VoiceOperationError>((resume) => {
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
      host.send({ id, addonPath: this.#addonPath, modelDirectory: this.#model.directory, pcm });
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

  /** Ends the host. Its exit is not reported as a failure: nothing waits on it any more. */
  #stopHost(): void {
    this.#cancelIdleStop();
    const host = this.#host;
    this.#host = null;
    host?.kill();
  }
}

function responseResult(response: VoiceTranscriptionResponse): Effect.Effect<string, VoiceOperationError> {
  if ("text" in response) return Effect.succeed(response.text);
  return Effect.fail(new VoiceOperationError({ cause: new HostFailure(response.error) }));
}

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
