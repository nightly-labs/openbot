import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { basename } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import { type Client, ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import { AgentProcessExitError, type DiagnosticOrigin } from "./agent-client";
import { type AgentCliInfo, cliPathEnvironment, cliSpawnTarget } from "./cli";
import { LineTooLongError, limitLineLength } from "./jsonl";
import type { SpawnTarget } from "./process-confinement";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
} from "./provider-client-effects";
import { registerProviderProcess } from "./provider-processes";
import { type ProviderTempOptions, spawnWithProviderTemp } from "./provider-temp";
import { createDiagnosticStream } from "./stderr-diagnostics";
import { endProcessTree } from "./windows-process-tree";

const EXIT_REPORT_WAIT_MS = 2_000;
const CRASH_LINE = /^(?:F\d{4} \d\d:\d\d:\d\d|FATAL ERROR:|Fatal Python error:|\*\*\* SIG[A-Z]+ .*received)/u;
const logger = createOpenBotLogger("acp-connection");
const execFileAsync = promisify(execFile);
interface ProcessEnd {
  ending: string;
  detail: string | null;
}
export interface AcpConnectionOptions {
  provider: string;
  cli: AgentCliInfo;
  argv: readonly string[];
  env: Record<string, string>;
  extraEnv?: (() => Record<string, string>) | undefined;
  confine?: ((target: SpawnTarget) => SpawnTarget) | undefined;
  causeLine?: ((message: string) => boolean) | undefined;
  privateTemp?: Omit<ProviderTempOptions, "provider"> | undefined;
  label(): string;
  redact(text: string): string;
  peek?: ((message: unknown) => void) | undefined;
  diagnostic(message: string, origin: DiagnosticOrigin): void;
  exit(error: Error): void;
  client(): Client;
}

export class AcpConnection {
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientSideConnection | null = null;
  #ended: Deferred.Deferred<ProcessEnd> | null = null;
  #stopping = false;
  #lastOutputAt = 0;
  readonly #stoppedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();
  constructor(private readonly options: AcpConnectionOptions) {}
  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null && !this.#stopping;
  }
  get ended(): Deferred.Deferred<ProcessEnd> | null {
    return this.#ended;
  }
  get lastOutputAt(): number {
    return this.#lastOutputAt;
  }
  get connection(): ClientSideConnection | null {
    return this.#connection;
  }
  requireConnection(): ClientSideConnection {
    if (!this.#connection) throw new Error("ACP connection is not running.");
    return this.#connection;
  }
  start(): void {
    if (this.running) return;
    this.#stopping = false;
    const direct = cliSpawnTarget(this.options.cli.executable, this.options.argv);
    const target = this.options.confine ? this.options.confine(direct) : direct;
    const privateTemp = this.options.privateTemp;
    const child = spawnWithProviderTemp(privateTemp && { ...privateTemp, provider: this.options.label() }, (tempEnv) =>
      spawn(target.command, target.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...cliPathEnvironment(this.options.cli),
          ...this.options.env,
          ...this.options.extraEnv?.(),
          ...tempEnv,
        },
        windowsVerbatimArguments: target.windowsVerbatimArguments,
        windowsHide: true,
      }),
    );
    this.#process = child;
    this.#lastOutputAt = Date.now();
    const wrote = () => {
      this.#lastOutputAt = Date.now();
    };
    child.stdout.on("data", wrote);
    child.stderr.on("data", wrote);
    registerProviderProcess(child, this.options.provider);
    const startedAt = performance.now();
    const elapsedMs = () => Math.round(performance.now() - startedAt);
    const logFields = {
      provider: this.options.provider,
      command: basename(this.options.cli.executable),
      pid: child.pid ?? null,
    };
    logger.info("An ACP agent process started.", logFields);
    child.stdout.once("data", () =>
      logger.info("An ACP agent process wrote its first output.", { ...logFields, durationMs: elapsedMs() }),
    );
    const stdout = child.stdout.pipe(
      limitLineLength(() => {
        const error = new LineTooLongError(this.options.label());
        this.#fail(error, child);
        Effect.runFork(endProcess(child));
        return error;
      }),
    );
    const lines = ndJsonStream(
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const peek = this.options.peek;
    const stream = peek
      ? {
          writable: lines.writable,
          readable: lines.readable.pipeThrough(
            new TransformStream({
              transform(message, controller) {
                peek(message);
                controller.enqueue(message);
              },
            }),
          ),
        }
      : lines;
    this.#connection = new ClientSideConnection(() => this.options.client(), stream);
    let lastDiagnostic: string | null = null;
    let crashDiagnostic: string | null = null;
    let causeDiagnostic: string | null = null;
    const diagnostics = createDiagnosticStream({
      redact: (text) => this.options.redact(text),
      emit: (message) => {
        lastDiagnostic = message;
        if (crashDiagnostic === null && CRASH_LINE.test(message)) crashDiagnostic = message;
        if (causeDiagnostic === null && this.options.causeLine?.(message)) causeDiagnostic = message;
        this.options.diagnostic(message, { duringStop: this.#stoppedProcesses.has(child), stderr: true });
      },
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    const ended = Deferred.makeUnsafe<ProcessEnd>();
    this.#ended = ended;
    child.once("close", (code, signal) => {
      logger.info("An ACP agent process ended.", { ...logFields, code, signal, durationMs: elapsedMs() });
      diagnostics.flush();
      Deferred.doneUnsafe(
        ended,
        Effect.succeed({
          ending: signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`,
          detail: causeDiagnostic ?? crashDiagnostic ?? lastDiagnostic,
        }),
      );
    });
    child.once("error", (error) =>
      Deferred.doneUnsafe(
        ended,
        Effect.succeed({ ending: "it could not start", detail: this.options.redact(error.message) }),
      ),
    );
    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`ACP process exited with ${suffix}.`), child);
    });
  }

  readonly run = Effect.fn("AcpConnection.run")(function* (
    this: AcpConnection,
    argv: readonly string[],
    timeoutMs: number,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    yield* Effect.tryPromise({
      try: (signal) => {
        const direct = cliSpawnTarget(this.options.cli.executable, argv);
        const target = this.options.confine ? this.options.confine(direct) : direct;
        return execFileAsync(target.command, target.args, {
          signal,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024,
          env: {
            ...process.env,
            ...cliPathEnvironment(this.options.cli),
            ...this.options.env,
            ...this.options.extraEnv?.(),
          },
          windowsVerbatimArguments: target.windowsVerbatimArguments,
          windowsHide: true,
        });
      },
      catch: providerFailure,
    });
  });

  readonly stop = Effect.fn("AcpConnection.stop")(function* (
    this: AcpConnection,
    cleanup: Effect.Effect<void, ProviderClientOperationError>,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#stopping = true;
    const child = this.#process;
    if (child && child.exitCode === null) this.#stoppedProcesses.add(child);
    this.#process = null;
    this.#connection = null;
    yield* cleanup.pipe(
      Effect.ensuring(
        Effect.suspend(() => (!child || child.exitCode !== null ? Effect.void : endProcess(child))).pipe(Effect.orDie),
      ),
    );
  }, Effect.uninterruptible);
  readonly explainEnd = Effect.fn("AcpConnection.explainEnd")(function* (
    this: AcpConnection,
    error: unknown,
    ended: Deferred.Deferred<ProcessEnd> | null,
    serverLost = false,
  ): Effect.fn.Return<unknown, ProviderClientOperationError> {
    if (!ended || this.#stopping || (!serverLost && !isClosedConnection(error)))
      return yield* providerSync(() => error);
    const ending = yield* Deferred.await(ended).pipe(
      Effect.timeoutOrElse({ duration: EXIT_REPORT_WAIT_MS, orElse: () => Effect.succeed(null) }),
    );
    if (ending === null) return yield* providerSync(() => error);
    return yield* providerCall(
      () =>
        new AgentProcessExitError(
          `${this.options.label()} stopped before it answered (${ending.ending}).`,
          ending.detail,
          {
            cause: error,
          },
        ),
    );
  });

  explainClose(error: unknown): unknown {
    if (!this.#ended || this.#stopping || !isClosedConnection(error)) return error;
    return new AgentProcessExitError(
      sourceText("error.provider.acpProcessStopped", { provider: this.options.label() }),
      null,
      { cause: error },
    );
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;
    if (!this.#stopping) this.options.exit(error);
  }
}

function isClosedConnection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message === "ACP connection closed" || message === "ACP client is not running.";
}

const endProcess = Effect.fn("AcpAgentClient.endProcess")(function* (child: ChildProcessWithoutNullStreams) {
  if (process.platform !== "win32") child.stdin.end();
  yield* endProcessTree(child).pipe(Effect.mapError((failure) => providerFailure(failure.cause)));
});
