import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { basename } from "node:path";
import { Readable, Writable } from "node:stream";
import { type Client, ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
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
/**
 * The first line of a crash report. A crash handler such as the one in Google's Gemini server ends its
 * report with `RAW: Raising signal 6`, which does not say why: the reason is in the first line.
 */
const CRASH_LINE = /^(?:F\d{4} \d\d:\d\d:\d\d|FATAL ERROR:|Fatal Python error:|\*\*\* SIG[A-Z]+ .*received)/u;
const logger = createOpenBotLogger("acp-connection");
interface ProcessEnd {
  ending: string;
  detail: string | null;
}
export interface AcpConnectionOptions {
  /** The provider id, or a custom agent id. Only the resource monitor reads it. */
  provider: string;
  cli: AgentCliInfo;
  argv: readonly string[];
  env: Record<string, string>;
  extraEnv?: (() => Record<string, string>) | undefined;
  confine?: ((target: SpawnTarget) => SpawnTarget) | undefined;
  /** A temporary folder of its own for each process, in this root (`provider-temp.ts`). */
  privateTemp?: Omit<ProviderTempOptions, "provider"> | undefined;
  label(): string;
  redact(text: string): string;
  diagnostic(message: string, origin: DiagnosticOrigin): void;
  /** A stderr line that must not become the exit detail, such as a sign-in prompt with OAuth state. */
  privateDiagnostic?: RegExp | undefined;
  exit(error: Error): void;
  client(): Client;
}

/** Owns the ACP child process, stream and exit diagnostics. It never owns agent sessions. */
export class AcpConnection {
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientSideConnection | null = null;
  #ended: Deferred.Deferred<ProcessEnd> | null = null;
  #stopping = false;
  readonly #stoppedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();
  constructor(private readonly options: AcpConnectionOptions) {}
  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null && !this.#stopping;
  }
  get ended(): Deferred.Deferred<ProcessEnd> | null {
    return this.#ended;
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
    registerProviderProcess(child, this.options.provider);
    // A start that times out says nothing of the process. These lines show whether it ran, how long
    // it took to write anything, and how it ended, such as a Windows server that unpacks itself (#2311).
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
    // The SDK holds a line until its newline with no limit. At the limit the connection closes with
    // the error, so each open request fails with it, and the process ends.
    const stdout = child.stdout.pipe(
      limitLineLength(() => {
        const error = new LineTooLongError(this.options.label());
        this.#fail(error, child);
        Effect.runFork(endProcess(child));
        return error;
      }),
    );
    const stream = ndJsonStream(
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>,
    );
    this.#connection = new ClientSideConnection(() => this.options.client(), stream);
    // One record at a time, never one chunk at a time: a chunk can end inside a JSON record, and a
    // record read in halves keeps the credential in its second half.
    let lastDiagnostic: string | null = null;
    let crashDiagnostic: string | null = null;
    const diagnostics = createDiagnosticStream({
      redact: (text) => this.options.redact(text),
      emit: (message) => {
        if (!this.options.privateDiagnostic?.test(message)) {
          lastDiagnostic = message;
          if (crashDiagnostic === null && CRASH_LINE.test(message)) crashDiagnostic = message;
        }
        this.options.diagnostic(message, { duringStop: this.#stoppedProcesses.has(child) });
      },
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    // Read at `close`, not `exit`: only then is stderr read to its end, and a CLI that fails at start
    // writes the reason as its last line.
    const ended = Deferred.makeUnsafe<ProcessEnd>();
    this.#ended = ended;
    child.once("close", (code, signal) => {
      logger.info("An ACP agent process ended.", { ...logFields, code, signal, durationMs: elapsedMs() });
      diagnostics.flush();
      Deferred.doneUnsafe(
        ended,
        Effect.succeed({
          ending: signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`,
          detail: crashDiagnostic ?? lastDiagnostic,
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
  ): Effect.fn.Return<unknown, ProviderClientOperationError> {
    if (!ended || this.#stopping) return yield* providerSync(() => error);
    const message = error instanceof Error ? error.message : "";
    if (message !== "ACP connection closed" && message !== "ACP client is not running.")
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

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;
    if (!this.#stopping) this.options.exit(error);
  }
}

/** Ends the agent process. A `.cmd` agent runs under `cmd.exe`, so Windows stops the whole tree. */
const endProcess = Effect.fn("AcpAgentClient.endProcess")(function* (child: ChildProcessWithoutNullStreams) {
  child.stdin.end();
  yield* endProcessTree(child).pipe(Effect.mapError((failure) => providerFailure(failure.cause)));
});
