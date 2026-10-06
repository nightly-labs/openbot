import { type ChildProcess, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { VoiceModelStatus, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Scope } from "effect";
import { VoiceModelService, VoiceOperationError, voiceIO } from "./voice-model-service";

const logger = createOpenBotLogger("voice-transcription-service");

const TRANSCRIPTION_TIMEOUT_MS = 180_000;

interface VoiceTranscriptionEvents {
  modelStatus: [status: VoiceModelStatus];
}

/**
 * What the renderer is told when the build carries no whisper binary at all. Linux packages ship
 * without one, so this is the whole of voice on that platform: a stated limit, not a download that
 * spends half a gigabyte on a model nothing can read.
 */
const RUNTIME_UNAVAILABLE_MESSAGE = sourceText("error.voice.runtimeUnavailable");

interface VoiceTranscriptionServiceOptions {
  resourcesRoot: string;
  modelPath: string;
  modelDownloadUrl: string | null;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class VoiceTranscriptionService extends EventEmitter<VoiceTranscriptionEvents> {
  readonly #scope = Scope.makeUnsafe();
  private activeChild: ChildProcess | null = null;
  private busy = false;
  private readonly executable: string;
  private readonly model: VoiceModelService;

  constructor(options: VoiceTranscriptionServiceOptions) {
    super();
    this.executable = join(
      options.resourcesRoot,
      "bin",
      process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
    );
    this.model = new VoiceModelService({
      modelPath: options.modelPath,
      downloadUrl: options.modelDownloadUrl,
      fetch: options.fetch,
    });
    this.model.on("status", (status) => this.emit("modelStatus", status));
  }

  readonly getModelStatus = Effect.fn("VoiceTranscription.getModelStatus")(function* (this: VoiceTranscriptionService) {
    const missing = this.runtimeMissing();
    return missing ?? (yield* this.model.getStatus());
  }).bind(this);

  readonly prepareModel = Effect.fn("VoiceTranscription.prepareModel")(function* (this: VoiceTranscriptionService) {
    const missing = this.runtimeMissing();
    return missing ?? (yield* this.model.prepare());
  }).bind(this);

  readonly transcribe = Effect.fn("VoiceTranscription.transcribe")(
    (audio: Uint8Array): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError> =>
      Effect.gen({ self: this }, function* () {
        if (this.busy) return yield* new VoiceOperationError({ cause: new Error(sourceText("error.voice.busy")) });
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            this.busy = true;
          }),
          () =>
            Effect.gen({ self: this }, function* () {
              const modelStatus = yield* this.prepareModel();
              if (modelStatus.phase !== "ready")
                return yield* new VoiceOperationError({
                  cause: new Error(modelStatus.message ?? sourceText("error.voice.modelUnavailable")),
                });
              const startedAt = Date.now();
              return yield* Effect.acquireUseRelease(
                voiceIO(() => mkdtemp(join(tmpdir(), "openbot-voice-"))),
                (temporaryRoot) =>
                  Effect.gen({ self: this }, function* () {
                    const inputPath = join(temporaryRoot, "recording.wav");
                    const outputPath = join(temporaryRoot, "transcript");
                    yield* voiceIO(() => writeFile(inputPath, audio));
                    yield* this.run(this.executable, [
                      "--model",
                      this.model.modelPath,
                      "--file",
                      inputPath,
                      "--language",
                      "auto",
                      "--output-txt",
                      "--output-file",
                      outputPath,
                      "--no-timestamps",
                      "--no-gpu",
                      "--threads",
                      "4",
                    ]);
                    const text = (yield* voiceIO(() => readFile(`${outputPath}.txt`, "utf8"))).trim();
                    if (text.length > INPUT_LIMITS.messageText)
                      return yield* new VoiceOperationError({ cause: new Error("The voice transcript is too long.") });
                    logger.info(`Voice transcription completed in ${Date.now() - startedAt}ms.`);
                    return { text };
                  }),
                (temporaryRoot) =>
                  voiceIO(() => rm(temporaryRoot, { recursive: true, force: true })).pipe(Effect.orDie),
              ).pipe(
                Effect.mapError((error) => {
                  logger.error(
                    `Voice transcription failed after ${Date.now() - startedAt}ms.`,
                    errorCategory(error.cause),
                  );
                  return new VoiceOperationError({ cause: userFacingError(error.cause) });
                }),
              );
            }),
          () =>
            Effect.sync(() => {
              this.activeChild = null;
              this.busy = false;
            }),
        );
      }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }), Effect.flatMap(Fiber.join)),
  );

  readonly shutdown = Effect.fn("VoiceTranscription.shutdown")(function* (this: VoiceTranscriptionService) {
    this.activeChild?.kill();
    yield* this.model.shutdown();
    yield* Scope.close(this.#scope, Exit.void);
    this.activeChild = null;
  }, Effect.uninterruptible).bind(this);

  /** Reports a build with no bundled whisper binary. */
  private runtimeMissing(): VoiceModelStatus | null {
    if (existsSync(this.executable)) return null;
    const status: VoiceModelStatus = { phase: "error", progress: null, message: RUNTIME_UNAVAILABLE_MESSAGE };
    this.emit("modelStatus", status);
    return status;
  }

  private run(executable: string, arguments_: string[]): Effect.Effect<void, VoiceOperationError> {
    return Effect.callback<void, VoiceOperationError>((resume) => {
      const child = execFile(executable, arguments_, { windowsHide: true });
      this.activeChild = child;
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      const onData = (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4_000);
      };
      child.stderr?.on("data", onData);
      const onError = (cause: Error) => resume(Effect.fail(new VoiceOperationError({ cause })));
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) resume(Effect.void);
        else
          resume(
            Effect.fail(
              new VoiceOperationError({
                cause: new Error(`Whisper exited with ${signal ?? `code ${String(code)}`}: ${stderr.trim()}`),
              }),
            ),
          );
      };
      child.once("error", onError);
      child.once("exit", onExit);
      return Effect.sync(() => {
        child.stderr?.off("data", onData);
        child.once("close", () => {
          child.off("error", onError);
          child.off("exit", onExit);
        });
        if (child.exitCode === null && child.signalCode === null) child.kill();
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: TRANSCRIPTION_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.transcriptionTimedOut")) })),
      }),
    );
  }
}

function errorCategory(error: unknown): "unknown" | "runtime-unavailable" | "timeout" | "inference-failed" {
  if (!(error instanceof Error)) return "unknown";
  if (errorCode(error) === "ENOENT") return "runtime-unavailable";
  if (error.message === sourceText("error.voice.transcriptionTimedOut")) return "timeout";
  return "inference-failed";
}

function userFacingError(error: unknown): Error {
  if (error instanceof Error && error.message === sourceText("error.voice.transcriptionTimedOut")) return error;
  if (error instanceof Error && errorCode(error) === "ENOENT") {
    return new Error(sourceText("error.voice.prepareRequired"));
  }
  return new Error(sourceText("error.voice.transcriptionFailed"));
}

function errorCode(error: Error): string | undefined {
  const code = "code" in error ? error.code : undefined;
  return isString(code) ? code : undefined;
}
