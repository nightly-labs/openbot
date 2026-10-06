import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type AgentProvider, RequestTimeoutError } from "./agent-client";
import { cliSpawnTarget } from "./cli";
import { JsonLineDecoder, LineTooLongError } from "./jsonl";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeRecordResponse,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type RpcMessage,
} from "./protocol";
import { ProviderClientOperationError } from "./provider-client-effects";
import { createDiagnosticStream } from "./stderr-diagnostics";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerError";
  }
}

export class CodexAppServerClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "codex";
  readonly #executable: string;
  readonly #requestTimeoutMs: number;
  #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, PendingRequest>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #stopping = false;

  constructor(executable: string, requestTimeoutMs = 30_000) {
    super();
    this.#executable = executable;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  start(): void {
    if (this.running) return;

    this.#stopping = false;
    this.#decoder = new JsonLineDecoder();
    const target = cliSpawnTarget(this.#executable, ["app-server", "--listen", "stdio://"]);
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
    });
    this.#process = child;

    child.stdin.on("error", (error) => this.#fail(error, child));
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.#decoder.push(chunk)) this.#handleMessage(message);
      } catch (error) {
        // Not wrapped: the screen translates this text only when no prefix is in front of it.
        this.#fail(
          error instanceof LineTooLongError ? error : new Error(`Codex protocol error: ${String(error)}`),
          child,
        );
      }
    });

    // Whole records only. A chunk ends wherever the pipe filled up, and half a record is neither
    // readable nor reliably redactable.
    const diagnostics = createDiagnosticStream({
      redact: redactDiagnostic,
      emit: (message) => this.emit("diagnostic", message),
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    child.once("close", () => diagnostics.flush());

    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`Codex App Server exited with ${suffix}.`), child);
    });
  }

  readonly stop = Effect.fn("CodexAppServer.stop")(function* (this: CodexAppServerClient) {
    const child = this.#process;
    if (!child) return;
    this.#stopping = true;
    this.#process = null;
    for (const pending of this.#pending.values()) pending.reject(new Error("Codex App Server stopped."));
    this.#pending.clear();
    child.stdin.end();
    if (child.exitCode !== null) return;
    yield* Effect.callback<void>((resume) => {
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      const exited = () => resume(Effect.void);
      child.once("exit", exited);
      child.kill("SIGTERM");
      return Effect.sync(() => {
        clearTimeout(forceKill);
        child.off("exit", exited);
      });
    });
  }, Effect.uninterruptible);

  /**
   * Drops this connection's hold on one thread and keeps the app server for the others.
   *
   * `thread/unsubscribe` is the non-destructive end of a thread: the app server keeps the thread and
   * its history, stops the thread's MCP event streams at once, and unloads the thread - with the
   * MCP servers it started - once nothing is subscribed to it and it is idle. It does not archive
   * or delete. A refresh after an MCP change starts a replacement session for the same public
   * thread, so without this the old session stays loaded there with the servers the user turned off.
   *
   * A thread this connection never subscribed to answers `NotSubscribed`, which is not an error
   * here: either way this side has stopped using it.
   */
  readonly releaseThread = Effect.fn("CodexAppServer.releaseThread")(function* (
    this: CodexAppServerClient,
    threadId: string,
  ) {
    if (!this.running) return;
    yield* this.request("thread/unsubscribe", { threadId }, decodeRecordResponse);
  });

  readonly request = Effect.fn("CodexAppServer.request")(function* <T>(
    this: CodexAppServerClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs = this.#requestTimeoutMs,
  ) {
    const id = this.#nextId++;
    return yield* Effect.callback<T, ProviderClientOperationError>((resume) => {
      this.#pending.set(id, {
        resolve: (value) =>
          resume(
            Effect.try({
              try: () => decoder(value),
              catch: (cause) => new ProviderClientOperationError({ cause }),
            }),
          ),
        reject: (cause) => resume(Effect.fail(new ProviderClientOperationError({ cause }))),
      });
      try {
        this.#write({ method, id, params });
      } catch (cause) {
        resume(Effect.fail(new ProviderClientOperationError({ cause })));
      }
      return Effect.sync(() => this.#pending.delete(id));
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(new ProviderClientOperationError({ cause: new RequestTimeoutError("Codex", method) })),
      }),
      Effect.ensuring(Effect.sync(() => this.#pending.delete(id))),
    );
  });

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#write({ id, error });
  }

  #write(message: unknown): void {
    if (!this.running || !this.#process) {
      throw new Error("Codex App Server is not running.");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message: RpcMessage): void {
    if ("method" in message) {
      if ("id" in message) {
        this.emit("request", {
          method: message.method,
          id: message.id,
          params: message.params,
        });
      } else {
        this.emit("notification", { method: message.method, params: message.params });
      }
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    this.#pending.delete(message.id);

    if (message.error && isRecord(message.error)) {
      const code = isNumber(message.error.code) ? message.error.code : -1;
      const text = isString(message.error.message) ? message.error.message : "Unknown error";
      pending.reject(new AppServerError(text, code, message.error.data));
      return;
    }

    pending.resolve(message.result);
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;

    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();

    if (child.exitCode === null) child.kill("SIGTERM");
    if (!this.#stopping) this.emit("exit", error);
  }
}

/**
 * The record as it leaves this client. It is not shortened here: the reader redacts the MCP
 * credentials this process handed the CLI, and a value cut in half by a bound applied first is a
 * value that redactor no longer recognises. `shortenDiagnostic` is applied there instead.
 */
function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:sk|sess|Bearer|token)[-_a-zA-Z0-9.=]{8,}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

/** Kept inside the adapter; public callers still receive the native protocol error. */
