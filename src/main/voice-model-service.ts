import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { VoiceModelStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Result, Schema, Scope, Stream } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** The N-API addon of sherpa-onnx. Its libraries are in the same directory. */
export const VOICE_RUNTIME_ADDON = "sherpa-onnx.node";

export interface VoiceModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

const PARAKEET_MODEL_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";
const PARAKEET_MODEL_BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${PARAKEET_MODEL_REVISION}`;

/** The directory name of the model in `<userData>/runtimes`. A new pin needs a new name. */
export const PARAKEET_MODEL_DIRECTORY = "parakeet-tdt-0.6b-v3-int8";

/** NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), int8 ONNX export for sherpa-onnx. */
export const PARAKEET_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/encoder.int8.onnx`,
    bytes: 652_184_281,
    sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
  },
  {
    name: "decoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/decoder.int8.onnx`,
    bytes: 11_845_275,
    sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
  },
  {
    name: "joiner.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/joiner.int8.onnx`,
    bytes: 6_355_277,
    sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
  },
  {
    name: "tokens.txt",
    url: `${PARAKEET_MODEL_BASE_URL}/tokens.txt`,
    bytes: 93_939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

interface VoiceModelEvents {
  status: [status: VoiceModelStatus];
}

interface VoiceModelServiceOptions {
  directory: string;
  files?: readonly VoiceModelFile[];
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** What a verified file looked like, so a later check can skip the hash while nothing changed. */
interface VerifiedFile {
  size: number;
  mtimeMs: number;
}

export class VoiceModelService extends EventEmitter<VoiceModelEvents> {
  readonly #directory: string;
  readonly #files: readonly VoiceModelFile[];
  readonly #totalBytes: number;
  readonly #fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /**
   * Files that passed the full SHA-256 check in this process. Transcription asks for the model about
   * once per second while the user speaks, and hashing 670 MB each time is not acceptable. A file
   * whose size or modification time changed is hashed again.
   */
  readonly #verified = new Map<string, VerifiedFile>();
  #status: VoiceModelStatus = { phase: "missing", progress: null, message: null };
  #preparation: Fiber.Fiber<VoiceModelStatus, VoiceOperationError> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #abortController: AbortController | null = null;
  #stopping = false;

  constructor(options: VoiceModelServiceOptions) {
    super();
    this.#directory = options.directory;
    this.#files = options.files ?? PARAKEET_MODEL_FILES;
    this.#totalBytes = this.#files.reduce((total, file) => total + file.bytes, 0);
    this.#fetch = options.fetch ?? fetch;
  }

  get directory(): string {
    return this.#directory;
  }

  readonly getStatus = Effect.fn("VoiceModel.getStatus")(function* (this: VoiceModelService) {
    if (this.#status.phase === "downloading") return this.#copyStatus();
    const ready = yield* this.#isComplete();
    this.#setStatus({ phase: ready ? "ready" : "missing", progress: ready ? 100 : null, message: null });
    return this.#copyStatus();
  }).bind(this);

  readonly prepare = Effect.fn("VoiceModel.prepare")(function* (this: VoiceModelService) {
    if (this.#preparation) return yield* Fiber.join(this.#preparation);
    const fiber = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (yield* this.#isComplete()) {
          this.#setStatus({ phase: "ready", progress: 100, message: null });
          return this.#copyStatus();
        }
        if (this.#stopping) {
          this.#setStatus({ phase: "error", progress: null, message: sourceText("error.voice.downloadStopped") });
          return this.#copyStatus();
        }
        const controller = new AbortController();
        this.#abortController = controller;
        this.#setStatus({ phase: "downloading", progress: 0, message: null });
        const downloaded = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            yield* voiceIO(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
            let completedBytes = 0;
            for (const file of this.#files) {
              const path = join(this.#directory, file.name);
              if (!(yield* this.#isVerified(file))) {
                yield* voiceIO(() => rm(path, { force: true }));
                yield* this.#download(file, path, controller.signal, completedBytes);
              }
              completedBytes += file.bytes;
            }
            this.#setStatus({ phase: "ready", progress: 100, message: null });
          }).pipe(Effect.ensuring(Effect.sync(() => controller.abort()))),
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

  /** Streams one file to `<path>.part`, checks its size and hash, and only then moves it into place. */
  #download(
    file: VoiceModelFile,
    path: string,
    signal: AbortSignal,
    completedBytes: number,
  ): Effect.Effect<void, VoiceOperationError> {
    const partialPath = `${path}.part`;
    let committed = false;
    return Effect.gen({ self: this }, function* () {
      yield* voiceIO(() => rm(partialPath, { force: true }));
      const response = yield* voiceIO(() => this.#fetch(file.url, { signal }));
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
                  if (receivedBytes > file.bytes)
                    return yield* new VoiceOperationError({ cause: new Error("download-too-large") });
                  hash.update(value);
                  let writtenBytes = 0;
                  while (writtenBytes < value.byteLength) {
                    const result = yield* voiceIO(() =>
                      destination.write(value, writtenBytes, value.byteLength - writtenBytes),
                    );
                    writtenBytes += result.bytesWritten;
                  }
                  const progress = Math.min(
                    100,
                    Math.floor(((completedBytes + receivedBytes) / this.#totalBytes) * 100),
                  );
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
      if (receivedBytes !== file.bytes || hash.digest("hex") !== file.sha256)
        return yield* new VoiceOperationError({ cause: new Error("download-integrity-failed") });
      yield* voiceIO(() => rename(partialPath, path));
      committed = true;
      const { size, mtimeMs } = yield* voiceIO(() => stat(path));
      this.#verified.set(file.name, { size, mtimeMs });
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          committed ? Effect.void : voiceIO(() => rm(partialPath, { force: true })).pipe(Effect.orDie),
        ),
      ),
    );
  }

  #isComplete(): Effect.Effect<boolean, VoiceOperationError> {
    return Effect.gen({ self: this }, function* () {
      for (const file of this.#files) if (!(yield* this.#isVerified(file))) return false;
      return true;
    });
  }

  /** A file verified earlier in this process needs only a `stat`; any other file is hashed. */
  #isVerified(file: VoiceModelFile): Effect.Effect<boolean, VoiceOperationError> {
    return Effect.gen({ self: this }, function* () {
      const path = join(this.#directory, file.name);
      if (!existsSync(path)) {
        this.#verified.delete(file.name);
        return false;
      }
      const { size, mtimeMs } = yield* voiceIO(() => stat(path));
      const known = this.#verified.get(file.name);
      if (known && known.size === size && known.mtimeMs === mtimeMs) return true;
      this.#verified.delete(file.name);
      if (size !== file.bytes || !(yield* hasSha256(path, file.sha256))) return false;
      this.#verified.set(file.name, { size, mtimeMs });
      return true;
    });
  }

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

/**
 * Deletes the Whisper model cache that earlier versions downloaded (`<userData>/runtimes/whisper`).
 * It is a 539 MB application download, not user data, and no version reads it any more.
 */
export const removeLegacyWhisperCache = Effect.fn("VoiceModel.removeLegacyWhisperCache")(function* (directory: string) {
  yield* voiceIO(() => rm(directory, { recursive: true, force: true }));
});

const hasSha256 = Effect.fn("VoiceModel.validate")(function* (path: string, expectedSha256: string) {
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
