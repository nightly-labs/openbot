import { RequestError } from "@agentclientprotocol/sdk";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { type AcpFlavor, shownFailureDetail } from "./acp-flavor";
import { isUsageLimitDiagnostic } from "./agent/provider-diagnostics";
import { isRecord } from "./protocol";

/** OpenCode 2's error for a request that its service cannot answer yet, such as at start (#57204). */
function isOpenCodeStarting(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.errorName === "ServiceUnavailableError"
  );
}

/**
 * OpenCode's wrapper error for a failed call to its internal server. It carries no cause: OpenCode
 * maps each such failure that is not an authentication error to this one.
 */
function isOpenCodeServiceFailure(error: unknown): boolean {
  return error instanceof RequestError && error.code === -32603 && /\bOpenCode service failure\b/.test(error.message);
}

/**
 * OpenCode 2.1.3's wrapper error for any failure that it has no ACP error for. Its data names only
 * the JavaScript error class, so the user read the generic text with no provider name (#2850).
 */
function isOpenCodeInternalFailure(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    error.message === "Internal error: Internal service failure"
  );
}

/**
 * OpenCode 2.1.1 answers a turn whose model provider has no credentials with the protocol's
 * `-32000` and "provider authentication required", and no provider ID. A user with no key can pick
 * a paid or third-party model, and met that text with no next step (#2746). The model ID names the
 * provider before its first `/`.
 */
function openCodeAuthRequired(error: unknown, model: string | null): string | null {
  if (!(error instanceof RequestError) || error.code !== -32000) return null;
  const provider = model?.includes("/") ? model.slice(0, model.indexOf("/")) : "";
  return provider
    ? sourceText("error.provider.opencodeAuthRequired", { provider })
    : sourceText("error.provider.opencodeAuthRequiredUnknown");
}

/**
 * A request that the model refused for a file, image or audio part in the chat. OpenCode 2.1.1
 * sends a part when the model catalog lists its kind, or when the part has a kind it does not know,
 * such as an MCP resource. Each gateway words the refusal differently; OpenCode itself refuses a
 * kind that the protocol cannot carry.
 */
const OPENCODE_UNREADABLE_CONTENT =
  /\[unsupported_content_type\]|\bcontent part type "[^"]*" is not supported\b|\bsupports text-only requests\b|\bdoes not support media type\b/iu;

/**
 * The kind of a model request that OpenCode gave up on, first match wins. A provider gateway
 * reports each kind as `Upstream request failed: <reason>`, so billing and the rate limit come
 * first. The provider's own failure comes before the network: a gateway that could not reach its
 * model was reached by this computer. Text that names no kind is shown as it is.
 */
const OPENCODE_REQUEST_FAILURES = [
  [
    "error.provider.opencodeBilling",
    /\bno payment method\b|\binsufficient (?:account )?(?:funds|balance)\b|\bpayment required\b/iu,
  ],
  ["error.provider.opencodeRateLimited", /\brate[ _-]?limit|\btoo many requests\b/iu],
  ["error.provider.opencodeInvalidUpload", /\binvalid upload request\b/iu],
  [
    "error.provider.opencodeProviderFailed",
    /\binternal server error\b|\bservice unavailable\b|\bendpoint is unavailable\b|\bbad gateway\b|\bgateway time-?out\b|\boverloaded\b|\bupstream request failed\b/iu,
  ],
  [
    "error.provider.opencodeNetwork",
    /\b(?:cannot|unable to|could not) connect\b|\bfetch failed\b|\bfailed to fetch\b|\bgetaddrinfo\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b|\bsocket hang up\b/iu,
  ],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

/**
 * OpenCode retries a rate limit or a provider failure by itself. When it stops, it fails the prompt
 * with the provider's text behind `Internal error:`, so a billing refusal, a rate limit and an
 * offline computer all read as one failure of OpenBot, and the user could not tell whether
 * waiting helps (#1163). The kind comes first; the provider's own text follows it.
 */
function openCodeRequestFailure(
  error: unknown,
  detail: string,
  redact: (text: string) => string,
  log: (text: string) => void,
): string {
  if (!(error instanceof RequestError) || error.code !== -32603) return detail;
  const reason = error.message.replace(/^Internal error:\s*/u, "");
  // All free models share one limit, and the free tier has no usage reading that could explain it.
  if (isRecord(error.data) && error.data.errorName === "provider.free-limit")
    return sourceText("error.provider.opencodeFreeLimit");
  // OpenCode Console's own text says to replace the key in "your client"; here that is Settings (#2544).
  if (/\bapi key has expired\b[\s\S]*\bopencode console\b/iu.test(detail))
    return sourceText("error.provider.opencodeKeyExpired");
  // A spent usage limit shows in OpenCode's own words, which the turn also reads for a plan window.
  if (isUsageLimitDiagnostic(reason)) return redact(reason);
  // The part stays in the session, so each turn on this model fails until the user picks another.
  // The provider's text says nothing more to the user; it goes to the log.
  if (OPENCODE_UNREADABLE_CONTENT.test(reason)) {
    log(`OpenCode model refused the chat content: ${reason}`);
    return sourceText("error.provider.opencodeUnreadableContent");
  }
  const key = OPENCODE_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  if (!key) return detail;
  return sourceText(key, { detail: shownFailureDetail(redact(reason)) });
}

export const OPENCODE_ACP_FLAVOR: AcpFlavor = {
  // OpenCode 2.x has a session that 1.x wrote after the one-time `session_v2` copy. It answers with
  // invalid params and the ID in data.sessionId. The same code with another message is a session of
  // another directory, which is not missing.
  sessionNotFound: (error, sessionId) =>
    error.code === -32602
      ? isRecord(error.data) &&
        error.data.sessionId === sessionId &&
        error.message === `Invalid params: session not found: ${sessionId}`
      : null,
  turnFailure: (error, detail, redact, log, model) => {
    const authRequired = openCodeAuthRequired(error, model);
    if (authRequired) return authRequired;
    // Google answers "API key not valid" (#1388).
    if (/invalid api key|api key not valid|unauthori[sz]ed|token refresh failed|authentication failed/i.test(detail))
      return sourceText("error.provider.opencodeCredentialsRejected", {
        detail: shownFailureDetail(detail.replace(/^RequestError:\s*Internal error:\s*/u, "")),
      });
    if (isOpenCodeServiceFailure(error) || isOpenCodeInternalFailure(error))
      return sourceText("error.provider.opencodeServiceFailure");
    return openCodeRequestFailure(error, detail, redact, log);
  },
  // OpenCode reports a model reply with no text, or with reasoning only, as a successful empty
  // turn and logs no error. OpenCode 1.18.31 failed the prompt on a rate limit and on a refused
  // connection; other provider errors can still end here. Do not invent the upstream cause or
  // report that turn as a successful reply.
  emptyAnswerFailure: (reasoned) =>
    sourceText(reasoned ? "error.provider.opencodeReasoningWithoutAnswer" : "error.provider.opencodeNoAnswer"),
  restoreFailure: (error, method) => {
    if (method === "resume" && isOpenCodeStarting(error)) return "wait-for-start";
    return isOpenCodeServiceFailure(error) ? "list-sessions" : null;
  },
  // Initialization already proved that OpenCode's catalogue works. A later refresh can time out
  // while probing model options; keep the last successful list instead of making a connected
  // provider appear to have no models.
  keepModelsOnRefreshFailure: true,
  // A long answer with no tool call otherwise shows nothing until the prompt ends, and the turn
  // looks stuck (#2858).
  streamAnswerBeforePromptReturns: true,
  // OpenCode 1.18.31 and 2.1.4 pass on the reasoning that an endpoint streams between answer tokens.
  // Ending the answer at each thought cut words in two, such as "B aca" (#3351).
  thoughtsInsideAnswer: true,
  // OpenCode 2.2.0 sends updates only for the execution that a prompt starts. The turn that a
  // finished background subagent starts reaches only its store, so the chat never showed it (#3406).
  unsentBackgroundTurns: true,
  // OpenCode 2.2.0 gives each step's message its own ID. Text of two steps was joined into one line.
  messagePerId: true,
  // OpenCode 2.1.4 adds each session's MCP servers to the session's directory under their names. A
  // second chat of the agent replaced the `openbot` token, and closing it left the first refused.
  mcpServersPerDirectory: true,
};
