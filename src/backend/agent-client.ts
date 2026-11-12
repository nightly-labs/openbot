import type { AgentProviderId, AgentSessionSettingsSnapshot, AgentSessionSettingValue } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder, RpcError } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";
import type { ReadProviderHistory } from "./provider-history";

export type AgentProvider = AgentProviderId;

/** Where a diagnostic came from. See `AgentClient.on("diagnostic")`. */
export interface DiagnosticOrigin {
  readonly duringStop: boolean;
}

export interface AgentClient {
  readonly provider: AgentProvider;
  /**
   * Explicit completion contract; missing capability means unsupported. `handoff`: the provider
   * cannot compact on request, so OpenBot replaces the session with one that starts from the history
   * handoff.
   */
  readonly contextCompaction?: "events" | "request" | "native" | "handoff" | "unsupported";
  /**
   * True when a streaming answer item (`final_answer`, or `agentMessage` with no phase yet) can still
   * become a step: the provider names no phase, and the client classifies the text only at the next
   * tool call or at the end of the turn.
   */
  readonly provisionalAnswers?: boolean;
  /**
   * True when the client sends the essential memories and the section-mates with the user turns
   * (`TurnContext`), so they stay out of the developer instructions. A memory change then keeps the
   * instructions, and the provider's cached prefix with them.
   */
  readonly turnContext?: boolean;
  readonly running: boolean;
  readonly readHistory?: ReadProviderHistory;
  /**
   * True when the user's MCP tools in this thread wait for the provider's own `tool_search`. OpenBot's
   * tool search knows only the built-in tools, so it then sends the model to that tool. Optional,
   * because the other providers declare the MCP tools or load them on their own.
   */
  readonly deferredMcpTools?: (externalThreadId: string) => boolean;
  /** False when stopping this client would lose a live provider session with no recovery path. */
  readonly canReleaseProcess?: () => boolean;
  start(): void;
  stop(): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Closes the provider-side state of one thread and leaves the client running for the others.
   *
   * A refresh after an MCP change starts a replacement session for the same public thread. Without
   * this call the previous session stays open inside the client, and the MCP servers it spawned stay
   * alive with it, so each further change adds another set of processes - including the servers the
   * user turned off. Optional, because a client that keeps no per-thread state has nothing to close.
   *
   * `resumes`: the next turn resumes this same provider session, which still holds the context that
   * its turns were sent. A client keeps what it knows of that context, so the turn does not send it
   * again. Otherwise the session ends, and the client forgets it.
   */
  releaseThread?(externalThreadId: string, resumes?: boolean): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Whether the session runs work that its release would end, such as a background terminal.
   * Optional, because a client without this check must keep its idle sessions loaded.
   */
  holdsBackgroundWork?(externalThreadId: string): Effect.Effect<boolean, ProviderClientOperationError>;
  /**
   * Hides a thread that a replacement session took over, or that a deleted agent leaves, from the
   * provider's own thread list, and keeps its history readable. Optional, because only a provider
   * that shows its threads to the user in another app has a list to keep clean.
   */
  archiveThread?(externalThreadId: string): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Sets the title of a thread in the provider's own thread list. Optional, for the same reason as
   * `archiveThread`.
   */
  nameThread?(externalThreadId: string, name: string): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Closes each thread that has no turn and can open again from its session, to free its processes
   * and MCP servers when the machine is low on memory. Optional, because a client that runs all its
   * threads in one process frees nothing this way.
   */
  releaseIdleThreads?(): Effect.Effect<void, ProviderClientOperationError>;
  /**
   * Closes each thread that has no turn and stays open only for background work that sent nothing
   * for a long time. The memory guard calls it at each sample while the machine is low on memory.
   * Optional, because only a client whose background work holds a thread's process has one.
   */
  releaseQuietBackgroundThreads?(): Effect.Effect<void, ProviderClientOperationError>;
  /** Effective provider options. Saved overrides belong to the agent store. */
  readSessionSettings?(
    externalThreadId: string,
  ): Effect.Effect<AgentSessionSettingsSnapshot, ProviderClientOperationError>;
  setSessionSetting?(
    externalThreadId: string,
    configId: string,
    value: AgentSessionSettingValue,
  ): Effect.Effect<AgentSessionSettingsSnapshot, ProviderClientOperationError>;
  /**
   * Sends `prompt` in a session that no thread owns and returns the answer text, or null when the
   * agent gives none. Only the custom agents have it: the user saves the prompt, such as `/usage`.
   * `model` names the agent for the router of the provider `acp`.
   */
  readUsageText?(model: string, prompt: string): Effect.Effect<string | null, ProviderClientOperationError>;
  request<T>(
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.Effect<T, ProviderClientOperationError>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, error: RpcError): void;
  on(event: "notification", listener: (notification: AppServerNotification) => void): this;
  on(event: "request", listener: (request: AppServerRequest) => void): this;
  /**
   * `origin.duringStop` marks a stderr line of a process that `stop()` ended while it still ran: the
   * shutdown that OpenBot started, not an error for the user. A line with no `origin` is reported.
   */
  on(event: "diagnostic", listener: (message: string, origin?: DiagnosticOrigin) => void): this;
  once(event: "exit", listener: (error: Error) => void): this;
  /** Removes listeners when an owning operation completes or is interrupted. */
  off(event: "notification", listener: (notification: AppServerNotification) => void): this;
  off(event: "request", listener: (request: AppServerRequest) => void): this;
  off(event: "exit", listener: (error: Error) => void): this;
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

/**
 * The provider started a turn of its own, such as after a background task ended, before this turn
 * could start. Nothing ran, so the caller queues the message again for when that turn ends.
 */
export class ProviderTurnActiveError extends Error {
  constructor(readonly providerName: string) {
    super(`${providerName} is in a turn that it started itself.`);
  }
}

/**
 * Claude cannot resume this session ID, because another provider made it. Nothing ran, so
 * `isMissingProviderSessionError` reads it as a missing session and the caller opens a new one.
 */
export class MissingClaudeSessionError extends Error {
  constructor(threadId: string) {
    super(`Claude session not found: ${threadId}`);
    this.name = "MissingClaudeSessionError";
  }
}

/**
 * The Pi session file that the thread names is not on this computer: it was moved or deleted. Nothing
 * ran, so `isMissingProviderSessionError` reads it as a missing session and the caller opens a new one.
 */
export class MissingPiSessionError extends Error {
  constructor() {
    super(sourceText("error.provider.piSessionMissing"));
    this.name = "MissingPiSessionError";
  }
}

/**
 * The line that the Go runtime of a CLI writes before it stops with SIGILL on a processor without a
 * feature that the CLI was built for, such as "This binary was compiled with aes enabled, but this
 * feature is not available on this processor" (#7111). A SIGILL without it can have another cause,
 * such as a crash bug or the CPU list of a container (`docs/docker.md`), that a different provider
 * does not fix.
 */
export const PROCESSOR_FEATURE_MISSING = /\bcompiled with \S+ enabled, but this feature is not available\b/iu;

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

  /** The same error with another message. The stderr line stays, for `withDetail`. */
  withMessage(message: string): AgentProcessExitError {
    return new AgentProcessExitError(message, this.#detail, { cause: this.cause });
  }
}
