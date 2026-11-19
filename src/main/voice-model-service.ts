import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { LocalSpeechModelId, LocalVoiceModelId, VoiceModelStatus } from "@openbot/contracts/ipc";
import {
  PARAKEET_MODEL_FILES,
  PARAKEET_UNIFIED_MODEL_FILES,
  SUPERTONIC_MODEL_FILES,
} from "@openbot/contracts/speech-models";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Result, Schema, Scope, Stream } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

const logger = createOpenBotLogger("voice-model-service");

export const VOICE_RUNTIME_ADDON = "sherpa-onnx.node";

export const VOICE_SESSION_CONFIGS = {
  "no-arena.cfg": "EnableCpuMemArena=0\n",
} as const;
export type VoiceSessionConfig = keyof typeof VOICE_SESSION_CONFIGS | "";

export const TRANSCRIPTION_SESSION_CONFIGS: Readonly<Record<LocalVoiceModelId, VoiceSessionConfig>> = {
  "parakeet-tdt-0.6b-v3": "no-arena.cfg",
  "parakeet-unified-en-0.6b": "no-arena.cfg",
  "bark-3.0-plus": "no-arena.cfg",
  "whisper-turbo": "",
  "cohere-transcribe-03-2026": "",
};
export const SPEECH_SESSION_CONFIG: VoiceSessionConfig = "no-arena.cfg";

export const SPEECH_HOST_THREADS = 4;

export function transcriptionHostThreads(processors = availableParallelism()): number {
  return Math.min(6, Math.max(4, Math.floor(processors / 2)));
}

export interface VoiceModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

const BARK_PLUS_MODEL_REVISION = "5f95a80a9da9d392a38df8e9a6609e25be643d07";
const BARK_PLUS_MODEL_BASE_URL = `https://huggingface.co/velddev/Underdog-Bark-3.0-Plus-sherpa-onnx/resolve/${BARK_PLUS_MODEL_REVISION}`;

export const BARK_PLUS_MODEL_DIRECTORY = "bark-3.0-plus-int8";

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

export const WHISPER_TURBO_MODEL_DIRECTORY = "whisper-turbo-int8";

const WHISPER_TURBO_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "turbo-encoder.int8.onnx",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-encoder.int8.onnx`,
    bytes: 674_716_297,
    sha256: "b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b",
  },
  {
    name: "turbo-decoder.onnx",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-decoder.onnx`,
    bytes: 636_209_532,
    sha256: "b24db5d90fa230c5eaa6b823d74862ced9e0d1dc3e01ec46601968e8db0e09ec",
  },
  {
    name: "turbo-tokens.txt",
    url: `${WHISPER_TURBO_MODEL_BASE_URL}/turbo-tokens.txt`,
    bytes: 816_730,
    sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
  },
];

const COHERE_TRANSCRIBE_MODEL_REVISION = "156a470cf08eefe706a0004f3c52d9ee567ca7a0";
const COHERE_TRANSCRIBE_MODEL_BASE_URL = `https://huggingface.co/csukuangfj2/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01/resolve/${COHERE_TRANSCRIBE_MODEL_REVISION}`;

export const COHERE_TRANSCRIBE_MODEL_DIRECTORY = "cohere-transcribe-14-lang-int8";

const COHERE_TRANSCRIBE_MODEL_FILES: readonly VoiceModelFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${COHERE_TRANSCRIBE_MODEL_BASE_URL}/encoder.int8.onnx`,
    bytes: 3_090_822,
    sha256: "cf704f8cfa90e3f0a76f9ffc05998bdf00ba9ae983192c14a85a3a5eb008b367",
  },
  {
    name: "encoder.int8.onnx.data",
    url: `${COHERE_TRANSCRIBE_MODEL_BASE_URL}/encoder.int8.onnx.data`,
    bytes: 2_731_503_072,
    sha256: "bcf1b7148c8518ae52df1ad2d2fc2b4e89261ea23e6c874eef1d9f55bcbaa4a3",
  },
  {
    name: "decoder.int8.onnx",
    url: `${COHERE_TRANSCRIBE_MODEL_BASE_URL}/decoder.int8.onnx`,
    bytes: 153_250_705,
    sha256: "8372ca6c8ff4db8b916ca3592f5c757a715e691b9edec751ba19b29fc854baf9",
  },
  {
    name: "tokens.txt",
    url: `${COHERE_TRANSCRIBE_MODEL_BASE_URL}/tokens.txt`,
    bytes: 207_437,
    sha256: "013ede043ae2480e3a9205cc34550d9686100cc682bacc90f702facdfbb93035",
  },
];

type DownloadedModelId = LocalVoiceModelId | LocalSpeechModelId;

export {
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_MODEL_FILES,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  SUPERTONIC_MODEL_DIRECTORY,
} from "@openbot/contracts/speech-models";

const VOICE_MODEL_FILES: Record<DownloadedModelId, readonly VoiceModelFile[]> = {
  "parakeet-tdt-0.6b-v3": PARAKEET_MODEL_FILES,
  "parakeet-unified-en-0.6b": PARAKEET_UNIFIED_MODEL_FILES,
  "bark-3.0-plus": BARK_PLUS_MODEL_FILES,
  "whisper-turbo": WHISPER_TURBO_MODEL_FILES,
  "cohere-transcribe-03-2026": COHERE_TRANSCRIBE_MODEL_FILES,
  "supertonic-3": SUPERTONIC_MODEL_FILES,
};

const RETIRED_MODEL_FILES: Partial<Record<DownloadedModelId, readonly string[]>> = {
  "whisper-turbo": ["turbo-decoder.int8.onnx"],
};

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
  readonly #verified = new Map<string, VerifiedFile>();
  #status: Omit<VoiceModelStatus, "modelId"> = { phase: "missing", progress: null, message: null };
  #preparation: Fiber.Fiber<DownloadedModelStatus<Id>, VoiceOperationError> | null = null;
  #removal: Fiber.Fiber<DownloadedModelStatus<Id>, VoiceOperationError> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #abortController: AbortController | null = null;
  #stopping = false;
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

  readonly removeRetiredFiles = Effect.fn("VoiceModel.removeRetiredFiles")(function* (this: VoiceModelService<Id>) {
    const retired = (RETIRED_MODEL_FILES[this.modelId] ?? [])
      .map((name) => join(this.#directory, name))
      .filter((path) => existsSync(path));
    if (retired.length === 0) return;
    if (this.#files.some((file) => !existsSync(join(this.#directory, file.name)))) return;
    if (!(yield* this.#isComplete())) return;
    for (const path of retired) yield* voiceIO(() => rm(path, { force: true }));
  }).bind(this);

  readonly prepare = Effect.fn("VoiceModel.prepare")(function* (this: VoiceModelService<Id>) {
    if (this.#removal) yield* Fiber.await(this.#removal);
    if (this.#preparation) return yield* Fiber.join(this.#preparation);
    this.#cancelled = false;
    const fiber = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (yield* this.#isComplete()) {
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
        if (Result.isSuccess(downloaded)) yield* this.#removeRetiredFilesOrWarn();
        if (Result.isFailure(downloaded) && this.#cancelled) {
          this.#setStatus({ phase: "missing", progress: null, message: null });
        } else if (Result.isFailure(downloaded)) {
          const cause = downloaded.failure.cause;
          const stopped = cause instanceof Error && cause.name === "AbortError";
          if (!stopped) logger.warn(`Could not download the ${this.modelId} model.`, downloadFailureReason(cause));
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

  readonly cancel = Effect.fn("VoiceModel.cancel")(function* (this: VoiceModelService<Id>) {
    const preparation = this.#preparation;
    if (!preparation) return yield* this.getStatus();
    this.#cancelled = true;
    this.#abortController?.abort();
    yield* Fiber.await(preparation);
    return this.#copyStatus();
  }).bind(this);

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

  #removeRetiredFilesOrWarn(): Effect.Effect<void> {
    return this.removeRetiredFiles().pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          logger.warn(
            `Could not remove the old files of the ${this.modelId} model.`,
            downloadFailureReason(error.cause),
          ),
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

function downloadFailureReason(cause: unknown): string {
  if (!(cause instanceof Error)) return "unknown";
  if (/^download-[a-z0-9-]+$/.test(cause.message)) return cause.message;
  const network = /net::ERR_[A-Z_]+/.exec(cause.message);
  if (network) return network[0];
  for (const error of [cause, cause.cause]) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z][A-Z0-9_]+$/.test(error.code)
    )
      return error.code;
  }
  return "unknown";
}

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
