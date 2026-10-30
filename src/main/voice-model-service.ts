import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LocalVoiceModelId, SpeechModelId, VoiceModelStatus } from "@openbot/contracts/ipc";
import { PARAKEET_MODEL_FILES, SUPERTONIC_MODEL_FILES } from "@openbot/contracts/speech-models";
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

const BARK_PLUS_MODEL_REVISION = "5f95a80a9da9d392a38df8e9a6609e25be643d07";
const BARK_PLUS_MODEL_BASE_URL = `https://huggingface.co/velddev/Underdog-Bark-3.0-Plus-sherpa-onnx/resolve/${BARK_PLUS_MODEL_REVISION}`;

/** The directory name of Bark 3.0 Plus in `<userData>/runtimes`. A new pin needs a new name. */
export const BARK_PLUS_MODEL_DIRECTORY = "bark-3.0-plus-int8";

/**
 * Conway Research Underdog Bark 3.0 Plus (CC-BY-4.0), a post-trained Parakeet TDT 0.6B v3. The
 * int8 ONNX export for sherpa-onnx is unofficial; it has the file names of the Parakeet export.
 */
const BARK_PLUS_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${BARK_PLUS_MODEL_BASE_URL}/encoder.int8.onnx`,
    bytes: 630_748_318,
    sha256: "c32c6964e13877500701f1699d2fa92a7f6bc3cd700370ba884c09901c183a16",
  },
  {
    name: "decoder.int8.onnx",
    url: `${BARK_PLUS_MODEL_BASE_URL}/decoder.int8.onnx`,
    bytes: 47_658_545,
    sha256: "89a081f0cf1500ec64e8a45f24f0bc10d1224aa334191e7f7e6f3226365b06b8",
  },
  {
    name: "joiner.int8.onnx",
    url: `${BARK_PLUS_MODEL_BASE_URL}/joiner.int8.onnx`,
    bytes: 6_123_465,
    sha256: "b8fe34824c5d2ec077489e4b4f66907cb47a971e1d34fe96915e9e5427df3c89",
  },
  {
    name: "tokens.txt",
    url: `${BARK_PLUS_MODEL_BASE_URL}/tokens.txt`,
    bytes: 93_939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

const WHISPER_TURBO_MODEL_REVISION = "2ca6ff69fc878651b770880507669577ac41c2ff";
const WHISPER_TURBO_MODEL_BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo/resolve/${WHISPER_TURBO_MODEL_REVISION}`;

/**
 * The directory name of Whisper turbo in `<userData>/runtimes`. It is not `whisper`: startup
 * deletes that directory, which held the Whisper model of earlier versions.
 */
export const WHISPER_TURBO_MODEL_DIRECTORY = "whisper-turbo-int8";

/** OpenAI Whisper large-v3 turbo (MIT), int8 ONNX export for sherpa-onnx. */
const WHISPER_TURBO_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "turbo-encoder.int8.onnx",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-encoder.int8.onnx`,
    bytes: 674_716_297,
    sha256: "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b",
  },
  {
    name: "turbo-decoder.int8.onnx",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-decoder.int8.onnx`,
    bytes: 361_080_764,
    sha256: "20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547",
  },
  {
    name: "turbo-tokens.txt",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-tokens.txt`,
    bytes: 816_730,
    sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
  },
];

/** A model that OpenBot downloads: a dictation model or the speech model. */
type DownloadedModelId = LocalVoiceModelId | SpeechModelId;

/** The directory name of Supertonic 3 in `<userData>/runtimes`. The phone uses the same name. */
export {
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_MODEL_FILES,
  SUPERTONIC_MODEL_DIRECTORY,
} from "@openbot/contracts/speech-models";

/** The files of each model. */
const VOICE_MODEL_FILES: Record<DownloadedModelId, readonly VoiceModelFile[]> = {
  "parakeet-tdt-0.6b-v3": PARAKEET_MODEL_FILES,
  "bark-3.0-plus": BARK_PLUS_MODEL_FILES,
  "whisper-turbo": WHISPER_TURBO_MODEL_FILES,
  "supertonic-3": SUPERTONIC_MODEL_FILES,
};

/** The status of one downloaded model. */
export type DownloadedModelStatus<Id extends DownloadedModelId> = Omit<VoiceModelStatus, "modelId"> & { modelId: Id };

interface VoiceModelEvents<Id extends DownloadedModelId> {
  status: [status: DownloadedModelStatus<Id>];
}

interface VoiceModelServiceOptions<Id extends DownloadedModelId> {
  modelId: Id;
  directory: string;
  files?: readonly VoiceModelFile[];
  fetch?: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined;
}

/** What a verified file looked like, so a later check can skip the hash while nothing changed. */
interface VerifiedFile {
  size: number;
  mtimeMs: number;
}

export class VoiceModelService<Id extends DownloadedModelId> extends EventEmitter<VoiceModelEvents<Id>> {
  readonly modelId: Id;
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
  #status: Omit<VoiceModelStatus, "modelId"> = { phase: "missing", progress: null, message: null };
  #preparation: Fiber.Fiber<DownloadedModelStatus<Id>, VoiceOperationError> | null = null;
  #removal: Fiber.Fiber<DownloadedModelStatus<Id>, VoiceOperationError> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #abortController: AbortController | null = null;
  #stopping = false;
  /** The user stopped the download in progress, so it ends as missing rather than failed. */
  #cancelled = false;

  constructor(options: VoiceModelServiceOptions<Id>) {
    super();
    this.modelId = options.modelId;
    this.#directory = options.directory;
    this.#files = options.files ?? VOICE_MODEL_FILES[this.modelId];
    this.#totalBytes = this.#files.reduce((total, file) => total + file.bytes, 0);
    this.#fetch = options.fetch ?? fetch;
  }

  get directory(): string {
    return this.#directory;
  }

  readonly getStatus = Effect.fn("VoiceModel.getStatus")(function* (this: VoiceModelService<Id>) {
    if (this.#status.phase === "downloading" || this.#removal) return this.#copyStatus();
    return yield* this.#readStatus();
  }).bind(this);

  readonly prepare = Effect.fn("VoiceModel.prepare")(function* (this: VoiceModelService<Id>) {
    // A download that starts while the files are deleted would write into the directory being removed.
    if (this.#removal) yield* Fiber.await(this.#removal);
    if (this.#preparation) return yield* Fiber.join(this.#preparation);
    this.#cancelled = false;
    const fiber = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (yield* this.#isComplete()) {
          // Each transcription prepares the model, so a ready model does not announce itself again.
          if (this.#status.phase !== "ready") this.#setStatus({ phase: "ready", progress: 100, message: null });
          return this.#copyStatus();
        }
        if (this.#stopping) {
          this.#setStatus({ phase: "error", progress: null, message: sourceText("error.voice.downloadStopped") });
          return this.#copyStatus();
        }
        if (this.#cancelled) {
          this.#setStatus({ phase: "missing", progress: null, message: null });
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
        if (Result.isFailure(downloaded) && this.#cancelled) {
          // Files that completed stay verified, so the next download starts at the first one missing.
          this.#setStatus({ phase: "missing", progress: null, message: null });
        } else if (Result.isFailure(downloaded)) {
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

  /** Stops the download in progress, if any, and answers the status after it ends. */
  readonly cancel = Effect.fn("VoiceModel.cancel")(function* (this: VoiceModelService<Id>) {
    const preparation = this.#preparation;
    if (!preparation) return yield* this.getStatus();
    this.#cancelled = true;
    this.#abortController?.abort();
    yield* Fiber.await(preparation);
    return this.#copyStatus();
  }).bind(this);

  /**
   * Deletes the model directory, and stops the download in progress first. `endHost` ends any host
   * that has the model loaded; a `prepare` during it waits, so no new host loads the files that go.
   * The directory is the one main gave this service, never a renderer path.
   */
  readonly remove = Effect.fn("VoiceModel.remove")(function* (
    this: VoiceModelService<Id>,
    endHost: Effect.Effect<void>,
  ) {
    if (this.#removal) return yield* Fiber.join(this.#removal);
    const fiber = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (this.#preparation) yield* this.cancel();
        yield* endHost;
        const removed = yield* Effect.result(voiceIO(() => rm(this.#directory, { recursive: true, force: true })));
        if (Result.isFailure(removed)) {
          // Some files can be gone. A file that is still there and unchanged needs only a `stat`.
          yield* this.#readStatus();
          return yield* new VoiceOperationError({ cause: new Error(sourceText("error.voice.removeFailed")) });
        }
        this.#verified.clear();
        this.#setStatus({ phase: "missing", progress: null, message: null });
        return this.#copyStatus();
      }).pipe(Effect.uninterruptible),
      this.#scope,
      { startImmediately: true },
    );
    this.#removal = fiber;
    fiber.addObserver(() => {
      if (this.#removal === fiber) this.#removal = null;
    });
    return yield* Fiber.join(fiber);
  }).bind(this);

  readonly shutdown = Effect.fn("VoiceModel.shutdown")(function* (this: VoiceModelService<Id>) {
    this.#stopping = true;
    this.#abortController?.abort();
    if (this.#preparation) yield* Fiber.await(this.#preparation);
    if (this.#removal) yield* Fiber.await(this.#removal);
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

  #readStatus(): Effect.Effect<DownloadedModelStatus<Id>, VoiceOperationError> {
    return Effect.gen({ self: this }, function* () {
      const ready = yield* this.#isComplete();
      this.#setStatus({ phase: ready ? "ready" : "missing", progress: ready ? 100 : null, message: null });
      return this.#copyStatus();
    });
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

  #setStatus(status: Omit<VoiceModelStatus, "modelId">): void {
    this.#status = status;
    this.emit("status", this.#copyStatus());
  }

  #copyStatus(): DownloadedModelStatus<Id> {
    return { modelId: this.modelId, ...this.#status };
  }
}

export class VoiceOperationError extends Schema.TaggedError<VoiceOperationError>()("VoiceOperationError", {
  cause: Schema.Defect(),
}) {}

const { io: voiceIO } = causeHelpers(VoiceOperationError);

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
