import type {
  AgentProviderId,
  AgentSessionSettingsSnapshot,
  AgentSessionSettingValue,
  McpServerConfig,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import type { McpToolArguments } from "./mcp-probe";
import type { RelayedMcpToolOutcome } from "./mcp-stdio-relay";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder, RpcError } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";
import type { ReadProviderHistory } from "./provider-history";

export type AgentProvider = AgentProviderId;

export interface DiagnosticOrigin {
  readonly duringStop: boolean;
  readonly stderr?: boolean;
}

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly contextCompaction?: "events" | "request" | "native" | "handoff" | "unsupported";
  readonly compactsItself?: boolean;
  readonly provisionalAnswers?: boolean;
  readonly turnContext?: boolean;
  readonly userInputNote?: boolean;
  readonly modelAddressVariable?: string;
  readonly running: boolean;
  readonly readHistory?: ReadProviderHistory;
  readonly deferredMcpTools?: (externalThreadId: string) => boolean;
  readonly mcpToolsFixedAtStart?: (externalThreadId: string) => boolean;
  readonly catalogAsMcpTools?: (model: string) => boolean;
  readonly imageInput?: (externalThreadId: string) => boolean;
  readonly structuredOutput?: boolean;
  readonly canReleaseProcess?: () => boolean;
  readonly runsBackgroundWork?: () => boolean;
  readonly replaceForNextTurn?: (threadIds: readonly string[]) => Effect.Effect<boolean>;
  start(): void;
  stop(): Effect.Effect<void, ProviderClientOperationError>;
  markTurnsStoppedForShutdown?(): void;
  releaseThread?(externalThreadId: string, resumes?: boolean): Effect.Effect<void, ProviderClientOperationError>;
  callRelayedMcpTool?(
    externalThreadId: string,
    config: McpServerConfig,
    tool: string,
    args: McpToolArguments,
  ): Effect.Effect<RelayedMcpToolOutcome | null>;
  relaysMcpServer?(externalThreadId: string, config: McpServerConfig): boolean;
  holdsBackgroundWork?(externalThreadId: string): Effect.Effect<boolean, ProviderClientOperationError>;
  wakesAfterBackgroundWork?(externalThreadId: string): Effect.Effect<boolean, ProviderClientOperationError>;
  archiveThread?(externalThreadId: string): Effect.Effect<void, ProviderClientOperationError>;
  newestTurnId?(externalThreadId: string): Effect.Effect<string | null, ProviderClientOperationError>;
  nameThread?(externalThreadId: string, name: string): Effect.Effect<void, ProviderClientOperationError>;
  releaseIdleThreads?(): Effect.Effect<void, ProviderClientOperationError>;
  releaseFolderProcesses?(folder: string): Effect.Effect<boolean | null>;
  releaseQuietBackgroundThreads?(): Effect.Effect<void, ProviderClientOperationError>;
  readSessionSettings?(
    externalThreadId: string,
  ): Effect.Effect<AgentSessionSettingsSnapshot, ProviderClientOperationError>;
  setSessionSetting?(
    externalThreadId: string,
    configId: string,
    value: AgentSessionSettingValue,
  ): Effect.Effect<AgentSessionSettingsSnapshot, ProviderClientOperationError>;
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
  on(event: "diagnostic", listener: (message: string, origin?: DiagnosticOrigin) => void): this;
  once(event: "exit", listener: (error: Error) => void): this;
  off(event: "notification", listener: (notification: AppServerNotification) => void): this;
  off(event: "request", listener: (request: AppServerRequest) => void): this;
  off(event: "exit", listener: (error: Error) => void): this;
}

export class RequestTimeoutError extends Error {
  constructor(
    readonly providerName: string,
    readonly method: string,
  ) {
    super(`${providerName} request timed out: ${method}`);
  }
}

export class ProviderTurnActiveError extends Error {
  constructor(readonly providerName: string) {
    super(`${providerName} is in a turn that it started itself.`);
  }
}

export class ProviderSessionBusyError extends ProviderTurnActiveError {
  constructor(providerName: string) {
    super(providerName);
    this.message = sourceText("error.provider.acpSessionBusy", { provider: providerName });
  }
}

export class ProviderStoppedError extends Error {
  constructor(
    readonly providerName: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderStoppedError";
  }
}

export class ProviderModelNotOfferedError extends Error {
  constructor(providerName: string, model: string) {
    super(sourceText("error.provider.acpModelNotOffered", { provider: providerName, model }));
    this.name = "ProviderModelNotOfferedError";
  }
}

export class MissingClaudeSessionError extends Error {
  constructor(threadId: string) {
    super(`Claude session not found: ${threadId}`);
    this.name = "MissingClaudeSessionError";
  }
}

export class MissingPiSessionError extends Error {
  constructor() {
    super(sourceText("error.provider.piSessionMissing"));
    this.name = "MissingPiSessionError";
  }
}

const PROCESSOR_FEATURE_MISSING = /\bcompiled with \S+ enabled, but this feature is not available\b/iu;
const BUN_PROCESSOR_FEATURE_MISSING = /\bthis CPU is missing \S+ support,? (?:which|that) Bun requires\b/iu;

export function reportsMissingProcessorFeature(output: string, illegalInstruction: boolean): boolean {
  return BUN_PROCESSOR_FEATURE_MISSING.test(output) || (illegalInstruction && PROCESSOR_FEATURE_MISSING.test(output));
}

const EXIT_DETAIL_LIMIT = 300;

export class AgentProcessExitError extends Error {
  readonly #detail: string | null;

  constructor(message: string, detail: string | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentProcessExitError";
    this.#detail = detail;
  }

  withDetail(redact: (text: string) => string): AgentProcessExitError {
    if (!this.#detail) return this;
    return new AgentProcessExitError(`${this.message} ${redact(this.#detail).slice(0, EXIT_DETAIL_LIMIT)}`, null, {
      cause: this.cause,
    });
  }

  withMessage(message: string): AgentProcessExitError {
    return new AgentProcessExitError(message, this.#detail, { cause: this.cause });
  }
}
