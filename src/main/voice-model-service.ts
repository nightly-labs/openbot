import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { VoiceModelStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Result, Schema, Scope, Stream } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export const WHISPER_MODEL_NAME = "ggml-medium-q5_0.bin";
const WHISPER_MODEL_BYTES = 539_212_467;
const WHISPER_MODEL_SHA256 = "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f";
export const WHISPER_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium-q5_0.bin";

interface VoiceModelEvents {
  status: [status: VoiceModelStatus];
}

interface VoiceModelServiceOptions {
  modelPath: string;
  downloadUrl: string | null;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  expectedBytes?: number;
  expectedSha256?: string;
}

export class VoiceModelService extends EventEmitter<VoiceModelEvents> {
  readonly #modelPath: string;
  readonly #downloadUrl: string | null;
  readonly #fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly #expectedBytes: number;
  readonly #expectedSha256: string;
  #status: VoiceModelStatus = { phase: "missing", progress: null, message: null };
  #preparation: Fiber.Fiber<VoiceModelStatus, VoiceOperationError> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #abortController: AbortController | null = null;
  #stopping = false;

  constructor(options: VoiceModelServiceOptions) {
    super();
    this.#modelPath = options.modelPath;
    this.#downloadUrl = options.downloadUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#expectedBytes = options.expectedBytes ?? WHISPER_MODEL_BYTES;
    this.#expectedSha256 = options.expectedSha256 ?? WHISPER_MODEL_SHA256;
  }

  get modelPath(): string {
    return this.#modelPath;
  }

  readonly getStatus = Effect.fn("VoiceModel.getStatus")(function* (this: VoiceModelService) {
    if (this.#status.phase === "downloading") return this.#copyStatus();
    const ready = yield* isExpectedModel(this.#modelPath, this.#expectedBytes, this.#expectedSha256);
    this.#setStatus({ phase: ready ? "ready" : "missing", progress: ready ? 100 : null, message: null });
    return this.#copyStatus();
  }).bind(this);

  readonly prepare = Effect.fn("VoiceModel.prepare")(function* (this: VoiceModelService) {
    if (this.#preparation) return yield* Fiber.join(this.#preparation);
    const fiber = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (yield* isExpectedModel(this.#modelPath, this.#expectedBytes, this.#expectedSha256)) {
          this.#setStatus({ phase: "ready", progress: 100, message: null });
          return this.#copyStatus();
        }
        yield* voiceIO(() => rm(this.#modelPath, { force: true }));
        if (this.#stopping) {
          this.#setStatus({ phase: "error", progress: null, message: sourceText("error.voice.downloadStopped") });
          return this.#copyStatus();
        }
        const url = this.#downloadUrl;
        if (!url) {
          this.#setStatus({ phase: "error", progress: null, message: sourceText("error.voice.assetsUnavailable") });
          return this.#copyStatus();
        }
        const partialPath = `${this.#modelPath}.part`;
        const controller = new AbortController();
        this.#abortController = controller;
        this.#setStatus({ phase: "downloading", progress: 0, message: null });
        let committed = false;
        const downloaded = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            yield* voiceIO(() => mkdir(dirname(this.#modelPath), { recursive: true, mode: 0o700 }));
            yield* voiceIO(() => rm(partialPath, { force: true }));
            const response = yield* voiceIO(() => this.#fetch(url, { signal: controller.signal }));
            if (!response.ok || !response.body)
              return yield* new VoiceOperationError({ cause: new Error(`download-status-${response.status}`) });
            const body = response.body;
            const hash = createHash("sha256");
            let receivedBytes = 0;
            let lastProgress = -1;
            yield* Effect.acquireUseRelease(
              voiceIO(() => open(partialPath, "wx", 0o600)),
              (destination) =>
                Effect.acquireUseRelease(
                  Effect.sync(() => body.getReader()),
                  (reader) =>
                    Effect.gen({ self: this }, function* () {
                      while (true) {
                        const { done, value } = yield* voiceIO(() => reader.read());
                        if (done) break;
                        receivedBytes += value.byteLength;
                        if (receivedBytes > this.#expectedBytes)
                          return yield* new VoiceOperationError({ cause: new Error("download-too-large") });
                        hash.update(value);
                        let writtenBytes = 0;
                        while (writtenBytes < value.byteLength) {
                          const result = yield* voiceIO(() =>
                            destination.write(value, writtenBytes, value.byteLength - writtenBytes),
                          );
                          writtenBytes += result.bytesWritten;
                        }
                        const progress = Math.min(100, Math.floor((receivedBytes / this.#expectedBytes) * 100));
                        if (progress !== lastProgress) {
                          lastProgress = progress;
                          this.#setStatus({ phase: "downloading", progress, message: null });
                        }
                      }
                    }),
                  (reader) =>
                    voiceIO(() => reader.cancel()).pipe(
                      Effect.catch(() => Effect.void),
                      Effect.ensuring(Effect.sync(() => reader.releaseLock())),
                    ),
                ),
              (destination) => voiceIO(() => destination.close()).pipe(Effect.orDie),
            );
            if (receivedBytes !== this.#expectedBytes || hash.digest("hex") !== this.#expectedSha256)
              return yield* new VoiceOperationError({ cause: new Error("download-integrity-failed") });
            yield* voiceIO(() => rename(partialPath, this.#modelPath));
            committed = true;
            this.#setStatus({ phase: "ready", progress: 100, message: null });
          }).pipe(
            Effect.ensuring(Effect.sync(() => controller.abort())),
            Effect.ensuring(
              Effect.suspend(() =>
                committed ? Effect.void : voiceIO(() => rm(partialPath, { force: true })).pipe(Effect.orDie),
              ),
            ),
          ),
        );
        if (Result.isFailure(downloaded)) {
          const cause = downloaded.failure.cause;
          const stopped = cause instanceof Error && cause.name === "AbortError";
          this.#setStatus({
            phase: "error",
            progress: null,
            message: stopped ? sourceText("error.voice.downloadStopped") : sourceText("error.voice.downloadFailed"),
          });
        }
        return this.#copyStatus();
      }).pipe(Effect.uninterruptible),
      this.#scope,
      { startImmediately: true },
    );
    this.#preparation = fiber;
    fiber.addObserver(() => {
      if (this.#preparation === fiber) {
        this.#preparation = null;
        this.#abortController = null;
      }
    });
    return yield* Fiber.join(fiber);
  }).bind(this);

  readonly shutdown = Effect.fn("VoiceModel.shutdown")(function* (this: VoiceModelService) {
    this.#stopping = true;
    this.#abortController?.abort();
    if (this.#preparation) yield* Fiber.await(this.#preparation);
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  #setStatus(status: VoiceModelStatus): void {
    this.#status = status;
    this.emit("status", this.#copyStatus());
  }

  #copyStatus(): VoiceModelStatus {
    return { ...this.#status };
  }
}

export class VoiceOperationError extends Schema.TaggedError<VoiceOperationError>()("VoiceOperationError", {
  cause: Schema.Defect(),
}) {}

export const { io: voiceIO } = causeHelpers(VoiceOperationError);

const isExpectedModel = Effect.fn("VoiceModel.validate")(function* (
  path: string,
  expectedBytes: number,
  expectedSha256: string,
) {
  if (!existsSync(path) || (yield* voiceIO(() => stat(path))).size !== expectedBytes) return false;
  const hash = createHash("sha256");
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createReadStream(path)),
    (stream) =>
      Stream.fromAsyncIterable(stream, (cause) => new VoiceOperationError({ cause })).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            hash.update(chunk);
          }),
        ),
      ),
    (stream) =>
      Effect.sync(() => {
        stream.destroy();
      }),
  );
  return hash.digest("hex") === expectedSha256;
});
