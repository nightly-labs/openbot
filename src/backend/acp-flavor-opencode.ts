import { RequestError, type SessionUpdate } from "@agentclientprotocol/sdk";
import { isFreeOpencodeModel } from "@openbot/contracts/ipc";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import type { CauseCode } from "@openbot/telemetry";
import { type AcpCustomEndpoint, type AcpFlavor, type AcpRetryCause, shownFailureDetail } from "./acp-flavor";
import {
  isImageCountDiagnostic,
  isImageTooLargeDiagnostic,
  isImageTooSmallDiagnostic,
  isUnreadableContentDiagnostic,
  isUsageLimitDiagnostic,
} from "./agent/provider-diagnostics";
import { isRecord } from "./protocol";

const logger = createOpenBotLogger("acp-client");

function isOpenCodeTimeoutRetry(update: SessionUpdate): boolean {
  if (update.sessionUpdate !== "session_info_update" || !isRecord(update._meta)) return false;
  if (!("opencode/retry" in update._meta)) return false;
  const retry = update._meta["opencode/retry"];
  if (retry === null) return true;
  return isRecord(retry) && isRecord(retry.error) && /\btimed out\b/iu.test(String(retry.error.message ?? ""));
}

const OPENCODE_RETRY_TYPES: ReadonlyMap<string, boolean> = new Map([
  ["provider.internal", false],
  ["provider.timeout", false],
  ["provider.transport", true],
]);

const OPENCODE_OUT_OF_MEMORY = /\bout of memory\b|\binsufficient memory\b|\bmemory limit exceeded\b/iu;

function openCodeRetryUpdate(update: SessionUpdate): { attempt: number; cause: AcpRetryCause } | null {
  if (update.sessionUpdate !== "session_info_update" || !isRecord(update._meta)) return null;
  const retry = update._meta["opencode/retry"];
  if (!isRecord(retry) || !isRecord(retry.error) || typeof retry.attempt !== "number") return null;
  const type = retry.error.type;
  const unreachable = typeof type === "string" ? OPENCODE_RETRY_TYPES.get(type) : undefined;
  if (unreachable === undefined) return null;
  const cause = unreachable
    ? "unreachable"
    : OPENCODE_OUT_OF_MEMORY.test(String(retry.error.message ?? ""))
      ? "outOfMemory"
      : "serverError";
  return { attempt: Math.max(1, retry.attempt - 1), cause };
}

function isOpenCodeStarting(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.errorName === "ServiceUnavailableError"
  );
}

function isOpenCodeServiceFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32603 && /\bOpenCode service failure\b/.test(error.message);
}

export const OPENCODE_INTERNAL_FAILURE = "Internal error: Internal service failure";

export function isOpenCodeInternalFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32603 && error.message === OPENCODE_INTERNAL_FAILURE;
}

function isOpenCodeServerLost(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.errorName === "ServerUnavailable"
  );
}

function openCodeAuthRequired(
  error: unknown,
  model: string | null,
  endpoint: AcpCustomEndpoint | null,
  savedKey: boolean,
  providerKeyStored: (provider: string) => boolean,
  refusalStatus: () => number | null,
): string | null {
  if (!(error instanceof RequestError) || error.code !== -32000) return null;
  if (endpoint)
    return sourceText(
      endpoint.hasCredentials
        ? "error.provider.customEndpointAccessRefused"
        : "error.provider.customEndpointKeyMissing",
      { provider: endpoint.name },
    );
  if (model?.toLowerCase().startsWith("opencode/") && isFreeOpencodeModel(model, model))
    return sourceText("error.provider.opencodeFreeModelRefused");
  if (savedKey)
    return sourceText(
      refusalStatus() === 403 ? "error.provider.opencodeGoRequestRefused" : "error.provider.opencodeKeyRefused",
    );
  const provider = model?.includes("/") ? model.slice(0, model.indexOf("/")) : "";
  if (!provider) return sourceText("error.provider.opencodeAuthRequiredUnknown");
  return provider.toLowerCase() !== "opencode-go" && providerKeyStored(provider)
    ? sourceText("error.provider.opencodeProviderRefused", { provider })
    : sourceText("error.provider.opencodeAuthRequired", { provider });
}

const OPENCODE_CONTEXT_TOO_SMALL =
  /\bcannot be reduced further without losing the latest exchange\b|\bnothing to compact yet\b|\bgreater than the context length\b|\bexceeds the available context size\b|\bexceed_context_size_error\b|\bcontext_length_exceeded\b/iu;

const NVIDIA_MODEL_NOT_SERVED = /\bFunction '[^']*': Not found for account\b/u;
const NVIDIA_MODEL_DEGRADED = /\bDEGRADED function cannot be invoked\b/iu;
const NVIDIA_SAFETY_SCREENING = /\binput rejected by content safety screening\b/iu;

function isOpenCodeSafetyRefusal(error: unknown): boolean {
  return (
    error === "refusal" ||
    (error instanceof RequestError && error.code === -32603 && NVIDIA_SAFETY_SCREENING.test(error.message))
  );
}

function isReasoningEffortRefusal(error: unknown): boolean {
  if (!(error instanceof RequestError) || error.code !== -32603) return false;
  return (
    /\breasoning[_ .]?effort\b/iu.test(error.message) &&
    /\b(?:does not support|doesn't support|not supported|unsupported|unrecognized|unknown|invalid|not allowed|not permitted)\b/iu.test(
      error.message,
    )
  );
}

const OPENCODE_REQUEST_FAILURES = [
  [
    "error.provider.opencodeBilling",
    /\bno payment method\b|\binsufficient (?:account )?(?:funds|balance)\b|\bpayment required\b/iu,
  ],
  ["error.provider.opencodeRateLimited", /\brate[ _-]?limit|\btoo many requests\b/iu],
  ["error.provider.opencodeInvalidUpload", /\binvalid upload request\b/iu],
  ["error.provider.opencodeModelUnavailable", /\bmodel[_ ]not[_ ]found\b|\bmodel_not_supported\b|不支持模型/iu],
  [
    "error.provider.opencodeProviderFailed",
    /\binternal server error\b|\bservice unavailable\b|\bendpoint is unavailable\b|\bbad gateway\b|\bgateway time-?out\b|\boverloaded\b|\bupstream request failed\b/iu,
  ],
  [
    "error.provider.opencodeNetwork",
    /\b(?:cannot|unable to|could not) connect\b|\bfetch failed\b|\bfailed to fetch\b|\bgetaddrinfo\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b|\bsocket hang up\b/iu,
  ],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

function openCodeRequestFailure(
  error: unknown,
  detail: string,
  redact: (text: string) => string,
  log: (text: string) => void,
  endpoint: AcpCustomEndpoint | null,
): string {
  if (isOpenCodeSafetyRefusal(error)) {
    log(`The model provider's safety rules refused this turn: ${detail}`);
    return sourceText("error.provider.opencodeSafetyBlocked");
  }
  if (!(error instanceof RequestError) || error.code !== -32603) return detail;
  const reason = error.message.replace(/^Internal error:\s*/u, "");
  if (isRecord(error.data) && error.data.errorName === "provider.free-limit")
    return sourceText("error.provider.opencodeFreeLimit");
  if (/\bapi key has expired\b[\s\S]*\bopencode console\b/iu.test(detail))
    return sourceText("error.provider.opencodeKeyExpired");
  if (isUsageLimitDiagnostic(reason)) return redact(reason);
  if (isImageTooSmallDiagnostic(reason) || isImageTooLargeDiagnostic(reason) || isImageCountDiagnostic(reason))
    return redact(reason);
  if (isUnreadableContentDiagnostic(reason)) {
    log(`OpenCode model refused the chat content: ${reason}`);
    return redact(reason);
  }
  if (isRecord(error.data) && error.data.errorName === "provider.invalid-output")
    return sourceText("error.provider.opencodeIncompleteReply", { detail: shownFailureDetail(redact(reason)) });
  if (isRecord(error.data) && error.data.errorName === "output-limit")
    return sourceText(endpoint ? "error.provider.opencodeOutputLimitEndpoint" : "error.provider.opencodeOutputLimit");
  if (/\breasoning start before end\b/u.test(reason)) {
    log(`OpenCode could not read the model's reasoning stream: ${reason}`);
    return sourceText("error.provider.opencodeReasoningOverlap");
  }
  if (OPENCODE_OUT_OF_MEMORY.test(reason)) {
    logger.warn("A model server ran out of memory for an OpenCode request.", { reason: redact(reason) });
    return sourceText("error.provider.opencodeOutOfMemory");
  }
  if (OPENCODE_CONTEXT_TOO_SMALL.test(reason)) {
    log(`OpenCode request does not fit the model's context window: ${reason}`);
    return sourceText("error.provider.opencodeContextTooSmall");
  }
  if (NVIDIA_MODEL_NOT_SERVED.test(reason)) {
    log(`The model provider does not serve this model to the account: ${reason}`);
    return sourceText("error.provider.opencodeModelNotServed");
  }
  if (NVIDIA_MODEL_DEGRADED.test(reason))
    return sourceText("error.provider.opencodeProviderFailed", { detail: shownFailureDetail(redact(reason)) });
  const errorName = isRecord(error.data) ? error.data.errorName : undefined;
  const key =
    OPENCODE_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0] ??
    (errorName === "provider.internal"
      ? "error.provider.opencodeProviderFailed"
      : errorName === "provider.no-route"
        ? "error.provider.opencodeModelUnavailable"
        : undefined);
  if (!key) return detail;
  return sourceText(key, { detail: shownFailureDetail(redact(reason)) });
}

const OPENCODE_ERROR_CAUSES: Readonly<Record<string, CauseCode>> = {
  "provider.auth": "authentication",
  "provider.rate-limit": "rate_limit",
  "provider.free-limit": "usage_limit",
  "provider.go-limit": "usage_limit",
  "provider.chatgpt-limit": "usage_limit",
  "provider.quota": "usage_limit",
  "provider.budget-limit": "usage_limit",
  "provider.model-budget-limit": "usage_limit",
  "provider.transport": "network",
  "provider.timeout": "timeout",
  "provider.internal": "provider_unavailable",
  "provider.invalid-output": "provider_internal_error",
  "output-limit": "provider_internal_error",
  "provider.invalid-request": "invalid_request",
  "provider.unsupported-operation": "invalid_request",
  "provider.no-route": "model_not_found",
  "permission.rejected": "permission",
  ServiceUnavailableError: "provider_unavailable",
};

function openCodeFailureCause(error: unknown): CauseCode | null {
  if (!(error instanceof RequestError)) return null;
  if (isOpenCodeSafetyRefusal(error)) return "content_blocked";
  if (NVIDIA_MODEL_NOT_SERVED.test(error.message)) return "model_not_found";
  if (NVIDIA_MODEL_DEGRADED.test(error.message)) return "provider_unavailable";
  if (!isRecord(error.data)) return null;
  const name = error.data.errorName;
  return typeof name === "string" && Object.hasOwn(OPENCODE_ERROR_CAUSES, name)
    ? (OPENCODE_ERROR_CAUSES[name] ?? null)
    : null;
}

export const OPENCODE_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error, sessionId) =>
    error.code === -32602
      ? isRecord(error.data) &&
        error.data.sessionId === sessionId &&
        (error.message === `Invalid params: session not found: ${sessionId}` ||
          (typeof error.data.cwd === "string" &&
            error.message === `Invalid params: session ${sessionId} does not belong to cwd: ${error.data.cwd}`))
      : null,
  turnFailure: (error, detail, redact, log, model, endpoint, savedKey, providerKeyStored, _label, refusalStatus) => {
    const authRequired = openCodeAuthRequired(error, model, endpoint, savedKey, providerKeyStored, refusalStatus);
    if (authRequired) return authRequired;
    if (/invalid api key|api key not valid|unauthori[sz]ed|token refresh failed|authentication failed/i.test(detail))
      return sourceText("error.provider.opencodeCredentialsRejected", {
        detail: shownFailureDetail(detail.replace(/^RequestError:\s*Internal error:\s*/u, "")),
      });
    if (isOpenCodeServiceFailure(error) || isOpenCodeInternalFailure(error) || isOpenCodeServerLost(error))
      return sourceText("error.provider.opencodeServiceFailure");
    if (endpoint && isReasoningEffortRefusal(error)) {
      logger.warn("A custom endpoint refused the reasoning effort.", { detail });
      return sourceText("error.provider.customEndpointEffortRefused", { provider: endpoint.name });
    }
    return openCodeRequestFailure(error, detail, redact, log, endpoint);
  },
  failureCause: openCodeFailureCause,
  serverLost: isOpenCodeServerLost,
  emptyAnswerFailure: ({ reasoned }) =>
    sourceText(reasoned ? "error.provider.opencodeReasoningWithoutAnswer" : "error.provider.opencodeNoAnswer"),
  restoreFailure: (error, method) => {
    if (method === "resume" && isOpenCodeStarting(error)) return "wait-for-start";
    return isOpenCodeServiceFailure(error) ? "list-sessions" : null;
  },
  keepModelsOnRefreshFailure: true,
  streamAnswerBeforePromptReturns: true,
  thoughtsInsideAnswer: true,
  unsentBackgroundTurns: true,
  contextCompaction: "handoff",
  reopenKeepsPrompts: true,
  modelRetryUpdate: isOpenCodeTimeoutRetry,
  retryUpdate: openCodeRetryUpdate,
  messagePerId: true,
  mcpServersPerDirectory: true,
  mcpConnectLimitMs: 30_000,
  relayStdioMcpServers: true,
  childSessionUpdates: true,
};
