import { win32 } from "node:path";
import {
  type LoadSessionResponse,
  type NewSessionRequest,
  type PromptResponse,
  RequestError,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type CauseCode, classifyFailure } from "@openbot/telemetry";
import type { GeneratedMediaKind } from "./agent/image-generation";
import { PLAN_APPROVE, PLAN_STOP, PLAN_UNANSWERED, planApprovalQuestion } from "./agent/plan-approval";
import { enableCursorMcpServers } from "./cursor-mcp-disabled";
import { grokMediaItem, grokMediaKind, grokMediaToolKind } from "./grok-media";
import { grokMcpServerName } from "./mcp-provider-shapes";
import { isRecord, type ThreadItem } from "./protocol";

interface AcpRetryNotice {
  readonly sessionId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly unreachable: boolean;
}

export type AcpRetryCause = "unreachable" | "outOfMemory" | "serverError";

interface AcpRetryUpdate {
  readonly attempt: number;
  readonly cause: AcpRetryCause;
}

export interface AcpReplyEvent {
  readonly sessionId: string;
  readonly reply: string;
  readonly failure: string | null;
}

export interface AcpCustomEndpoint {
  readonly name: string;
  readonly hasCredentials: boolean;
  readonly stallMs?: number;
  readonly contextWindow?: number;
}

export interface AcpMcpServerFailure {
  readonly sessionId: string;
  readonly name: string;
  readonly reason: string;
}

interface AcpTaskTurns {
  readonly startsTask: (toolCallId: string, input: unknown) => boolean;
  readonly toolCallKey: (toolCallId: string) => string;
}

export interface AcpFlavor {
  mediaTools?: {
    kind(update: {
      _meta?: unknown;
      title?: string | null;
      rawInput?: unknown;
      rawOutput?: unknown;
    }): GeneratedMediaKind | null;
    item(kind: GeneratedMediaKind, call: ThreadItem, content: unknown): ThreadItem;
    permitted(request: { _meta?: unknown; title?: string | null }): GeneratedMediaKind | null;
  };
  clientInfo?: { name: string; title: string; version: string };
  sessionNotFound?(error: RequestError, sessionId: string): boolean | null;
  authRequiredSignsOut?: boolean;
  turnFailure?(
    error: unknown,
    detail: string,
    redact: (text: string) => string,
    log: (text: string) => void,
    model: string | null,
    endpoint: AcpCustomEndpoint | null,
    savedKey: boolean,
    providerKeyStored: (provider: string) => boolean,
    label: string,
    refusalStatus: () => number | null,
    savedKeyShadowed: () => boolean,
  ): string;
  failureCause?(error: unknown, answer: string): CauseCode | null;
  unexplainedFailureVerification?(error: unknown, detail: string, message: string): string | null;
  failureReport?: RegExp;
  emptyAnswerFailure?(
    turn: { reasoned: boolean; answered: boolean; showedPlanOrCompaction: boolean },
    label: string,
  ): string | null;
  emptyAnswerError?: RegExp;
  textToolCallFailure?(answer: string): string | null;
  restoreFailure?(
    error: unknown,
    method: "load" | "resume",
  ): "wait-for-start" | "list-sessions" | "confirm-missing" | null;
  stillStarting?(error: unknown): boolean;
  lostTurns?: { refusal: RegExp; unsent: RegExp; discard(sessionId: string): readonly string[] };
  refusesUntilRestart?(error: unknown): boolean;
  lostServerUntilRestart?(error: unknown): boolean;
  serverLost?(error: unknown): boolean;
  sessionBusy?(error: unknown): boolean;
  sessionStillActive?(error: unknown): boolean;
  configConflict?(error: unknown): boolean;
  staleSession?(error: unknown): boolean;
  keepModelsOnRefreshFailure?: true;
  noModelsAfterRetry?(): string;
  processWideModel?: true;
  setsConfigOnlyOnChange?: true;
  modelSetUnsaved?(error: RequestError): boolean;
  modelConfigId?: string;
  configSetUnsaved?(error: RequestError): boolean;
  closeKeepsSession?: true;
  probeCloseDelayMs?: number;
  sessionFiles?(argv: readonly string[], sessionId: string): readonly string[];
  effortCategories?: readonly string[];
  promptMediaBase64Bytes?: number;
  sessionProcesses?: true;
  modelsLoadWithSession?: true;
  sessionProcessesBefore?: string;
  sdkHarness?: {
    failedSession(stderrLine: string): string | undefined;
    answerIsFailure: RegExp;
    retryNotice?(text: string): number | null;
    emptyOutputFailure?: RegExp;
    textToolCall?: { starts: readonly string[]; whole: RegExp };
    turnFailure(text: string): string;
    fallbackCause?(text: string, reachedModel: boolean): CauseCode | null;
    accountLink?(text: string, argv: readonly string[], sessionId: string): string | null;
    accountVerification?: RegExp;
    quota(text: string): string | null;
    mcpLoadFailure(text: string): { name: string; reason: string } | null;
    refusedMcpTools?(text: string, argv: readonly string[], sessionId: string): string[];
    loggedFailure?(text: string, argv: readonly string[], sessionId: string): string | null;
    silentFailure?(argv: readonly string[], sessionId: string, since: number): string | null;
    sessionLost?: RegExp;
  };
  cancelLocallyThenResume?: true;
  steerByPromptSince?: string;
  steerByPromptCapability?: string;
  interruptToolsOnStop?: true;
  streamAnswerBeforePromptReturns?: true;
  thoughtsInsideAnswer?: true;
  resumesAnswerAfterThought?: { report: RegExp };
  promptOpenForBackgroundTasks?: true;
  silentTurnLimitMs?: number;
  unsentBackgroundTurns?: true;
  unsentTaskTurns?: AcpTaskTurns;
  wakesAfterPromptEnds?: true;
  restartNoticeOnReload?: true;
  selfWakeTools?: RegExp;
  messagePerId?: true;
  resendsAnswer?: true;
  childSessionUpdates?: true;
  retryNotice?: (method: string, params: DynamicRecord) => AcpRetryNotice | null;
  clientMeta?: DynamicRecord;
  replyEvent?: (method: string, params: DynamicRecord) => AcpReplyEvent | null;
  retryUpdate?: (update: SessionUpdate) => AcpRetryUpdate | null;
  modelRetryUpdate?: (update: SessionUpdate) => boolean;
  turnStallMs?: number;
  openToolStallMs?: number;
  subagentTools?: readonly string[];
  mcpServersPerDirectory?: true;
  mcpServersLoadWithSession?: true;
  mcpConnectLimitMs?: number;
  mcpListLimit?: { ms: number; since: string };
  relayStdioMcpServers?: true | "unconfined";
  mcpServerFailure?(method: string, params: DynamicRecord): AcpMcpServerFailure | null;
  mcpServerName?(name: string): string;
  ownMcpServerNames?(cwd: string, argv: readonly string[]): readonly string[];
  mcpServerLimit?: number;
  enableMcpServers?(cwd: string, names: readonly string[]): void;
  mcpToolCallLimitMs?: number;
  mcpToolsFixedAtStart?: true;
  catalogAsMcpTools?: true;
  contextCompaction?: "handoff";
  compactsItself?: true;
  reopenKeepsPrompts?: true;
  noiseChunk?: RegExp;
  signInLostChunk?: RegExp;
  signInUnusable?(error: RequestError): string | null;
  planUsedUpChunk?: RegExp;
  connectionLostChunk?: RegExp;
  approvedEditSweep?: RegExp;
  mcpCallInputNamesServer?: true;
  bridgeToolsWithoutCard?: true;
  sessionMeta?: NewSessionRequest["_meta"];
  workspaceAsAdditionalDirectory?: true;
  loadInsteadOfResume?: { missing(response: LoadSessionResponse): boolean };
  promptUsage?(response: PromptResponse): DynamicRecord | null;
  promptRun?(response: PromptResponse): string | undefined;
  userQuestions?: AcpUserRequest;
  planApproval?: AcpUserRequest;
}

interface AcpUserRequest {
  method: string;
  questions?(params: DynamicRecord): DynamicRecord[];
  reply(
    questions: readonly { id: string; question: string }[],
    answers: Readonly<Record<string, readonly string[]>>,
  ): DynamicRecord;
}

export const DEFAULT_ACP_FLAVOR: AcpFlavor = {};

const COPILOT_PLAN_USED_UP =
  /^\s*(?:Add a payment method to continue\.?|Error: You have exceeded your monthly quota\b[^\n]*)\s*$/u;
const COPILOT_PLAN_USED_UP_TEXT = /\bAdd a payment method to continue\b|\bexceeded your monthly quota\b/u;

export const CLINE_ACP_FLAVOR: AcpFlavor = {
  subagentTools: ["spawn_agent"],
  sessionNotFound: (error, sessionId) =>
    error.code === -32603 ? isRecord(error.data) && error.data.details === `session not found: ${sessionId}` : null,
};

const COPILOT_SESSION_EVENT = "github.com/copilot/sessionEvent";

export const COPILOT_ACP_FLAVOR: AcpFlavor = {
  relayStdioMcpServers: true,
  turnFailure: copilotTurnFailure,
  planUsedUpChunk: COPILOT_PLAN_USED_UP,
  failureCause: (error) => (COPILOT_PLAN_USED_UP_TEXT.test(errorText(error)) ? "usage_limit" : null),
  compactsItself: true,
  clientMeta: { "github.com/copilot": { events: ["session.error", "session.info"] } },
  replyEvent: copilotReplyEvent,
};

function copilotReplyEvent(method: string, params: DynamicRecord): AcpReplyEvent | null {
  const { sessionId, type, data, agentId } = params;
  if (method.replace(/^_/u, "") !== COPILOT_SESSION_EVENT || agentId !== undefined) return null;
  if (typeof sessionId !== "string" || !isRecord(data) || typeof data.message !== "string") return null;
  if (type === "session.error") return { sessionId, reply: `Error: ${data.message}`, failure: data.message };
  if (type === "session.info" && data.infoType === "model_retry")
    return { sessionId, reply: `Info: ${data.message}`, failure: null };
  return null;
}

function copilotTurnFailure(_error: unknown, detail: string): string {
  if (COPILOT_PLAN_USED_UP_TEXT.test(detail))
    return sourceText("error.provider.acpPlanUsedUp", { provider: agentProviderName("copilot") });
  if (/\bmissing_finish_reason\b/u.test(detail)) return sourceText("error.provider.copilotAnswerIncomplete");
  return /"thinking\.type\.enabled" is not supported for this model/u.test(detail)
    ? sourceText("error.provider.copilotThinkingRejected")
    : detail;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const data = isRecord(error) && "data" in error ? JSON.stringify(error.data) : undefined;
  return data ? `${error.message} ${data}` : error.message;
}

function noAnswerUnlessPlanOrCompaction(
  { showedPlanOrCompaction }: { showedPlanOrCompaction: boolean },
  label: string,
): string | null {
  return showedPlanOrCompaction ? null : sourceText("error.provider.acpNoAnswer", { provider: label });
}

function grokMcpServerFailure(method: string, params: DynamicRecord): AcpMcpServerFailure | null {
  if (method !== "x.ai/mcp/server_status" || params.status !== "unavailable" || params.reason !== "handshake_failed")
    return null;
  if (typeof params.sessionId !== "string" || typeof params.name !== "string") return null;
  const reason = typeof params.detail === "string" && params.detail.trim() ? params.detail.trim() : params.reason;
  return { sessionId: params.sessionId, name: params.name, reason };
}

export const GROK_ACP_FLAVOR: AcpFlavor = {
  mediaTools: { kind: grokMediaKind, item: grokMediaItem, permitted: grokMediaToolKind },
  promptUsage: (response) => (isRecord(response._meta) && isRecord(response._meta.usage) ? response._meta.usage : null),
  emptyAnswerError: /\bempty response from model\b/u,
  emptyAnswerFailure: noAnswerUnlessPlanOrCompaction,
  mcpServerFailure: grokMcpServerFailure,
  mcpServerName: grokMcpServerName,
  relayStdioMcpServers: "unconfined",
  restoreFailure: (error) =>
    error instanceof RequestError && error.code === -32603 && isRecord(error.data) && error.data.code === "FS_NOT_FOUND"
      ? "confirm-missing"
      : null,
  userQuestions: {
    method: "x.ai/ask_user_question",
    reply: (questions, answers) => {
      const given = questions.flatMap((question): [string, string | readonly string[]][] => {
        const [first, ...more] = answers[question.id] ?? [];
        if (first === undefined) return [];
        return [[question.question, more.length > 0 ? [first, ...more] : first]];
      });
      return given.length > 0
        ? { outcome: "accepted", answers: Object.fromEntries(given), annotations: {} }
        : { outcome: "cancelled" };
    },
  },
  planApproval: {
    method: "x.ai/exit_plan_mode",
    questions: (params) => [planApprovalQuestion(params.planContent)],
    reply: (questions, answers) => grokPlanReply(answers[questions[0]?.id ?? ""]?.[0]?.trim()),
  },
  retryNotice: grokRetryNotice,
  turnStallMs: 12 * 60_000,
  openToolStallMs: 30 * 60_000,
  turnFailure: grokTurnFailure,
};

function grokPlanReply(answer: string | undefined): DynamicRecord {
  if (!answer) return { outcome: "abandoned", feedback: PLAN_UNANSWERED };
  if (answer === PLAN_APPROVE) return { outcome: "approved" };
  if (answer === PLAN_STOP) return { outcome: "abandoned" };
  return { outcome: "request_changes", feedback: answer };
}

function grokTurnFailure(error: unknown, detail: string): string {
  if (!(error instanceof RequestError)) return detail;
  const cause = classifyFailure(detail);
  if (cause === "network") return sourceText("error.provider.grokConnectionFailed");
  if (cause === "provider_unavailable" || cause === "timeout") return sourceText("error.provider.grokServiceFailure");
  return detail;
}

const GROK_RETRY_TYPES: ReadonlyMap<string, boolean> = new Map([
  ["api", false],
  ["idle_timeout", false],
  ["http", true],
]);

function grokRetryNotice(method: string, params: DynamicRecord): AcpRetryNotice | null {
  if (method.replace(/^_/u, "") !== "x.ai/session_notification") return null;
  const { sessionId, update } = params;
  if (!isRecord(update) || update.sessionUpdate !== "retry_state" || update.type !== "retrying") return null;
  const unreachable = typeof update.error_type === "string" ? GROK_RETRY_TYPES.get(update.error_type) : undefined;
  const { attempt, max_retries: maxAttempts } = update;
  if (unreachable === undefined || typeof sessionId !== "string") return null;
  if (typeof attempt !== "number" || typeof maxAttempts !== "number") return null;
  return { sessionId, attempt, maxAttempts, unreachable };
}

const HERMES_LOST_TURNS: NonNullable<AcpFlavor["lostTurns"]> = {
  refusal: /\bunknown_execution\b/u,
  unsent: /\(nothing was submitted\)/u,
  discard: (sessionId) => ["sessions", "discard", sessionId, "--yes"],
};

function hermesTurnFailure(error: unknown, detail: string): string {
  if (isRecord(error) && isRecord(error.data) && error.data.details === "admitted_turn_failed")
    return sourceText("error.provider.hermesTurnFailed");
  if (hermesGatewayLost(error)) return sourceText("error.provider.hermesConnectionLost");
  return hermesRefusal(error) ? sourceText("error.provider.hermesRefused") : detail;
}

function hermesGatewayLost(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    typeof error.data.details === "string" &&
    /^Gateway disconnected\b/u.test(error.data.details)
  );
}

function hermesRefusal(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.details === "invalid_params"
  );
}

function kimiStaleSession(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32600 &&
    isRecord(error.data) &&
    error.data.code === "session.stale"
  );
}

function hermesSessionBusy(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.details === "session_busy"
  );
}

function hermesRevisionConflict(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.details === "revision_conflict"
  );
}

const HERMES_FAILURE_REASONS: Readonly<Partial<Record<string, CauseCode>>> = {
  auth: "authentication",
  auth_permanent: "authentication",
  billing: "billing",
  rate_limit: "rate_limit",
  upstream_rate_limit: "rate_limit",
  overloaded: "provider_unavailable",
  server_error: "provider_unavailable",
  timeout: "timeout",
};

const HERMES_FAILURE_SUMMARY = /^\s*[^\n]+\n\nProvider said: ([^\n]+)/u;

function hermesFailureCause(error: unknown, answer: string): CauseCode | null {
  if (!isRecord(error) || !isRecord(error.data) || error.data.details !== "admitted_turn_failed") return null;
  const { failure_reason: reason, message } = error.data;
  const named = typeof reason === "string" ? HERMES_FAILURE_REASONS[reason] : undefined;
  if (named) return named;
  const said = HERMES_FAILURE_SUMMARY.exec(typeof message === "string" && message ? message : answer)?.[1];
  const cause = said ? classifyFailure(said) : "unknown";
  return cause === "unknown" ? null : cause;
}

function hermesSessionNotFound(error: RequestError): boolean | null {
  return error.code === -32603 && isRecord(error.data) && error.data.details === "not_found" ? true : null;
}

const HERMES_MCP_SERVER_LIMIT = 16;

const HERMES_SESSION_MCP_SINCE = "0.22.3";

export const HERMES_ACP_FLAVOR: AcpFlavor = {
  loadInsteadOfResume: { missing: (response) => response.modes == null },
  sessionNotFound: hermesSessionNotFound,
  lostTurns: HERMES_LOST_TURNS,
  refusesUntilRestart: hermesRefusal,
  lostServerUntilRestart: hermesGatewayLost,
  sessionBusy: hermesSessionBusy,
  configConflict: hermesRevisionConflict,
  mcpServerLimit: HERMES_MCP_SERVER_LIMIT,
  sessionProcessesBefore: HERMES_SESSION_MCP_SINCE,
  setsConfigOnlyOnChange: true,
  resendsAnswer: true,
  subagentTools: ["delegate_task"],
  turnFailure: hermesTurnFailure,
  failureCause: hermesFailureCause,
  failureReport: HERMES_FAILURE_SUMMARY,
  catalogAsMcpTools: true,
};

const CURSOR_STREAM_FAILURE = /\bRetriableError: \[(?:canceled|aborted|unavailable|deadline_exceeded)\] /u;

function cursorTurnFailure(error: unknown, detail: string): string {
  return CURSOR_STREAM_FAILURE.test(errorText(error))
    ? sourceText("error.provider.acpServerLost", { provider: agentProviderName("cursor") })
    : detail;
}

export const CURSOR_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error, sessionId) =>
    error.code === -32602 ? isRecord(error.data) && error.data.message === `Session "${sessionId}" not found` : null,
  noiseChunk: /^\s*Error: (?:[\w$]+: )?WritableIterable is closed\s*$/u,
  signInLostChunk:
    /^\n\n(?:Please sign in to continue|Error: \[unauthenticated\] Backend rejected authentication\.[^\n]*)$/u,
  signInUnusable: (error) =>
    error.code === -32603 && isRecord(error.data) && error.data.message === "Failed to initialize session services"
      ? sourceText("error.provider.cursorSignInUnusable")
      : null,
  noModelsAfterRetry: () => sourceText("error.provider.cursorNoModels"),
  planUsedUpChunk: /^(?:\n\nUpgrade your plan to continue|\s*Add a payment method to continue\.?\s*)$/u,
  connectionLostChunk: /^\s*Error: RetriableError: \[(?:canceled|aborted|unavailable|deadline_exceeded)\] [^\n]*\s*$/u,
  turnFailure: cursorTurnFailure,
  failureCause: (error) => (CURSOR_STREAM_FAILURE.test(errorText(error)) ? "network" : null),
  processWideModel: true,
  mcpServersLoadWithSession: true,
  enableMcpServers: enableCursorMcpServers,
};

const KIMI_CODE_TOOL_CALL_TURN = /^\d+:/u;

const KIMI_TASK_TURNS: AcpTaskTurns = {
  startsTask: (toolCallId, input) =>
    KIMI_CODE_TOOL_CALL_TURN.test(toolCallId) &&
    isRecord(input) &&
    (input.run_in_background === true || typeof input.task_id === "string"),
  toolCallKey: (toolCallId) => toolCallId.replace(KIMI_CODE_TOOL_CALL_TURN, ""),
};

export const KIMI_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error) =>
    error.code === -32602 ? isRecord(error.data) && error.data.session_id === "Session not found" : null,
  modelSetUnsaved: (error) =>
    error.code === -32603 &&
    isRecord(error.data) &&
    typeof error.data.details === "string" &&
    error.data.details.includes("config.toml"),
  subagentTools: ["Agent"],
  authRequiredSignsOut: true,
  emptyAnswerFailure: noAnswerUnlessPlanOrCompaction,
  mcpToolsFixedAtStart: true,
  turnStallMs: 12 * 60_000,
  staleSession: kimiStaleSession,
  unsentBackgroundTurns: true,
  unsentTaskTurns: KIMI_TASK_TURNS,
  messagePerId: true,
};

export const DEVIN_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error) =>
    error.code === -32016 ? isRecord(error.data) && error.data["cognition.ai/errorKind"] === "session_not_found" : null,
  steerByPromptCapability: "cognition.ai/midTurnPrompts",
  emptyAnswerError: /\bThe model ended its turn without a response\b/u,
  promptRun: (response) => {
    const run = isRecord(response._meta) ? response._meta["cognition.ai/userMessageId"] : undefined;
    return typeof run === "string" ? run : undefined;
  },
};

export const MISTRAL_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error, sessionId) =>
    error.code === -32602 ? isRecord(error.data) && error.data.session_id === sessionId : null,
  workspaceAsAdditionalDirectory: true,
  configSetUnsaved: (error) => error.code === -32602 && error.message.includes("cannot write config file"),
  effortCategories: ["thought_level", "thinking"],
  probeCloseDelayMs: 5_000,
  sessionProcesses: true,
};

function ompSessionNotFound(error: RequestError, sessionId: string): boolean | null {
  return error.code === -32603
    ? isRecord(error.data) && error.data.details === `Unsupported ACP session: ${sessionId}`
    : null;
}

function geminiCliSessionNotFound(error: RequestError, sessionId: string): true | null {
  if (error.code === -32602 && error.message === `Session not found: ${sessionId}`) return true;
  const details = error.code === -32603 && isRecord(error.data) ? error.data.details : undefined;
  return typeof details === "string" && details.startsWith(`Invalid session identifier "${sessionId}"`) ? true : null;
}

function customSessionNotFound(error: RequestError, sessionId: string): boolean | null {
  return geminiCliSessionNotFound(error, sessionId) ?? ompSessionNotFound(error, sessionId);
}

function customSessionStillActive(error: unknown): boolean {
  return (
    error instanceof RequestError && error.code === -32602 && /\bsession is already active\b/iu.test(errorText(error))
  );
}

function customEmptyAnswerFailure({ answered }: { answered: boolean }, label: string): string | null {
  return answered ? null : sourceText("error.provider.acpNoAnswer", { provider: label });
}

function customRefusal(error: unknown, detail: string, label: string): string {
  return error === "refusal" ? sourceText("error.provider.acpRefusedNoReason", { provider: label }) : detail;
}

const customTurnFailure: NonNullable<AcpFlavor["turnFailure"]> = (
  error,
  detail,
  _redact,
  _log,
  _model,
  _endpoint,
  _savedKey,
  _providerKeyStored,
  label,
) => customRefusal(error, detail, label);

function customFailureCause(error: unknown): CauseCode | null {
  return error === "refusal" ? "unknown" : null;
}

const OMP_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: ompSessionNotFound,
  emptyAnswerFailure: customEmptyAnswerFailure,
  turnFailure: customTurnFailure,
  failureCause: customFailureCause,
};

const CUSTOM_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: customSessionNotFound,
  sessionStillActive: customSessionStillActive,
  emptyAnswerFailure: customEmptyAnswerFailure,
  turnFailure: customTurnFailure,
  failureCause: customFailureCause,
};

const CUSTOM_AGENT_FLAVORS: Readonly<Partial<Record<string, AcpFlavor>>> = {
  omp: OMP_ACP_FLAVOR,
  hermes: {
    ...CUSTOM_ACP_FLAVOR,
    sessionNotFound: (error, sessionId) => hermesSessionNotFound(error) ?? ompSessionNotFound(error, sessionId),
    lostTurns: HERMES_LOST_TURNS,
    refusesUntilRestart: hermesRefusal,
    lostServerUntilRestart: hermesGatewayLost,
    sessionBusy: hermesSessionBusy,
    configConflict: hermesRevisionConflict,
    mcpServerLimit: HERMES_MCP_SERVER_LIMIT,
    sessionProcessesBefore: HERMES_SESSION_MCP_SINCE,
    setsConfigOnlyOnChange: true,
    resendsAnswer: true,
    turnFailure: (error, detail, _redact, _log, _model, _endpoint, _savedKey, _providerKeyStored, label) =>
      customRefusal(error, hermesTurnFailure(error, detail), label),
    failureCause: (error, answer) => customFailureCause(error) ?? hermesFailureCause(error, answer),
    failureReport: HERMES_FAILURE_SUMMARY,
    catalogAsMcpTools: true,
  },
  kimi: {
    ...CUSTOM_ACP_FLAVOR,
    mcpToolsFixedAtStart: true,
    staleSession: kimiStaleSession,
    unsentBackgroundTurns: true,
    unsentTaskTurns: KIMI_TASK_TURNS,
    messagePerId: true,
  },
  "kiro-cli": { ...CUSTOM_ACP_FLAVOR, mcpToolCallLimitMs: 120_000, modelConfigId: "model" },
};

export function customAgentFlavor(command: string): AcpFlavor {
  const name = win32
    .basename(command)
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/u, "");
  return CUSTOM_AGENT_FLAVORS[name] ?? CUSTOM_ACP_FLAVOR;
}

const FAILURE_DETAIL_LIMIT = 200;

export function shownFailureDetail(text: string): string {
  const characters = Array.from(text);
  return characters.length > FAILURE_DETAIL_LIMIT
    ? `${characters.slice(0, FAILURE_DETAIL_LIMIT - 1).join("")}…`
    : characters.join("");
}
