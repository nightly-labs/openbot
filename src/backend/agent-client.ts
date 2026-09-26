import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder, RpcError } from "./protocol";

export type AgentProvider = AgentProviderId;

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly running: boolean;
  start(): void;
  stop(): Promise<void>;
  /**
   * Closes the provider-side state of one thread and leaves the client running for the others.
   *
   * A refresh after an MCP change starts a replacement session for the same public thread. Without
   * this call the previous session stays open inside the client, and the MCP servers it spawned stay
   * alive with it, so each further change adds another set of processes - including the servers the
   * user turned off. Optional, because a client that keeps no per-thread state has nothing to close.
   */
  releaseThread?(externalThreadId: string): Promise<void>;
  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, error: RpcError): void;
  on(event: "notification", listener: (notification: AppServerNotification) => void): this;
  on(event: "request", listener: (request: AppServerRequest) => void): this;
  on(event: "diagnostic", listener: (message: string) => void): this;
  once(event: "exit", listener: (error: Error) => void): this;
}

/**
 * A provider request that got no answer in time. The provider can still have received it, so a
 * caller that must not repeat the work tests for this class, not for the message text.
 */
export class RequestTimeoutError extends Error {
  constructor(
    readonly providerName: string,
    readonly method: string,
  ) {
    super(`${providerName} request timed out: ${method}`);
  }
}

/** What of the CLI's last stderr line a status message carries. The full line is in the log. */
const EXIT_DETAIL_LIMIT = 300;

/**
 * The provider CLI ended while OpenBot waited for an answer. The message names how it ended.
 *
 * The last line the CLI wrote to stderr is usually the only cause a user can act on: a config the
 * CLI refuses, a CPU it cannot run on, a file it cannot open. It stays private, out of the message
 * and out of anything that logs or serializes the error, because only `redactText` has read it and
 * the line can quote an MCP secret that only the provider runtime knows. It leaves through
 * `withDetail`, which takes that redaction.
 */
export class AgentProcessExitError extends Error {
  readonly #detail: string | null;

  constructor(message: string, detail: string | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentProcessExitError";
    this.#detail = detail;
  }

  /**
   * The same error with the stderr line in its message, redacted and then shortened. The order
   * matters: a redactor matches a whole value, and a value the shortening cut is no longer one.
   */
  withDetail(redact: (text: string) => string): AgentProcessExitError {
    if (!this.#detail) return this;
    return new AgentProcessExitError(`${this.message} ${redact(this.#detail).slice(0, EXIT_DETAIL_LIMIT)}`, null, {
      cause: this.cause,
    });
  }
}
