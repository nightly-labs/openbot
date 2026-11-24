export function isMcpSubsystemDiagnostic(message: string): boolean {
  if (/openbot/i.test(message)) return false;
  return /\b(mcp|rmcp)\b|\bworker quit with (?:fatal|join error|reason):/i.test(message);
}

export function isMcpSignInDiagnostic(message: string): boolean {
  return /\bAuth ?Required\b|\bunauthori[sz]ed\b|\bnot (?:authenticated|logged in)\b|\b(?:HTTP|status(?:\s+code)?)\W{0,3}401\b/i.test(
    message,
  );
}

export function isMcpSessionClosingDiagnostic(message: string): boolean {
  return /\bsession is closing \(process scope already reclaimed\)/u.test(message);
}

export type McpProviderFailureKind = "sign_in" | "timeout" | "unavailable" | "unreachable" | "failed";

export function mcpProviderFailureKind(message: string): McpProviderFailureKind {
  if (isMcpSignInDiagnostic(message)) return "sign_in";
  if (isMcpTimeoutDiagnostic(message)) return "timeout";
  if (isMcpUnavailableDiagnostic(message)) return "unavailable";
  return isMcpUnreachableDiagnostic(message) ? "unreachable" : "failed";
}

export const MCP_PROVIDER_FAILURE_TEXT = {
  sign_in: "error.backend.mcpServerSignInForProvider",
  timeout: "error.backend.mcpServerTimedOutInProvider",
  unavailable: "error.backend.mcpServerUnavailableInProvider",
  unreachable: "error.backend.mcpServerUnreachableInProvider",
  failed: "error.backend.mcpServerFailedInProvider",
} as const;

function isMcpTimeoutDiagnostic(message: string): boolean {
  return /\btimed out\b|\bdeadline has elapsed\b/i.test(message);
}

function isMcpUnavailableDiagnostic(message: string): boolean {
  return (
    /\bHTTP\W{0,3}5\d\d\b/.test(message) ||
    /\bstatus(?:\s+code)?\W{0,3}5\d\d\b|\bservice unavailable\b|\bbad gateway\b|\bgateway time-?out\b/i.test(message)
  );
}

function isMcpUnreachableDiagnostic(message: string): boolean {
  return /\berror sending request\b|\bconnection (?:refused|reset)\b|\bECONNREFUSED\b|\bECONNRESET\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bEHOSTUNREACH\b|\bENETUNREACH\b|\bdns error\b|\bfailed to lookup address\b|\bno route to host\b|\bnetwork is unreachable\b/i.test(
    message,
  );
}

export function isTelemetryExportDiagnostic(message: string): boolean {
  if (/openbot/i.test(message)) return false;
  return /\b(?:batch(?:span|log|logrecord)processor|(?:span|log|logrecord|metric)exporter|opentelemetry|otlp|otel)\b/i.test(
    message,
  );
}

export interface AcpRequestEcho {
  method: string | null;
  error: string | null;
}

export function createAcpRequestEchoReader(): (record: string) => AcpRequestEcho | null | undefined {
  let open = false;
  let depth = 0;
  let method: string | null = null;
  let error: string | null = null;
  return (record) => {
    const start = /^Error handling request\b/.test(record);
    if (!open && !start) return undefined;
    if (start) {
      open = true;
      depth = 0;
      method = null;
      error = null;
    }
    const field = /^(method|message):\s*"(.*)",?$/.exec(record);
    if (field?.[1] === "method" && method === null) method = field[2] ?? null;
    if (field?.[1] === "message" && method !== null) error = field[2] ?? null;
    depth += bracketBalance(record);
    if (depth > 0) return null;
    open = false;
    return { method, error };
  };
}

function bracketBalance(line: string) {
  let balance = 0;
  let inString = false;
  let escaped = false;
  for (const char of line) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") balance += 1;
    else if (char === "}" || char === "]") balance -= 1;
  }
  return balance;
}

export function isToolCallDiagnostic(message: string): boolean {
  return (
    /\btool_error:\s*(?:tool_output_error|execution_failure|parse_failure)\b/.test(message) ||
    /\berror executing cascade step:\s*CORTEX_STEP_TYPE_MCP_TOOL:\s*(?:calling "tools\/call":\s*)?Error:/.test(
      message,
    ) ||
    /\berror executing cascade step:\s*CORTEX_STEP_TYPE_MCP_TOOL:\s*MCP tool call to server "[^"]+" timed out\b/.test(
      message,
    )
  );
}

export function isUsageReadDiagnostic(message: string): boolean {
  return /\bERROR\s+billing:\s+(?:upstream request failed|upstream error|failed to parse response)\b/.test(message);
}

export function isGitSpawnDiagnostic(message: string): boolean {
  return /\bERROR\s+git_cli:\s+(?:Command::output\(\) FAILED \(spawn error\)|spawn failed\b)/.test(message);
}

export function isAcpHandlerDiagnostic(message: string): boolean {
  return /^Error handling (?:request|notification)\b/.test(message);
}

const IGNORED_CONFIG_SUMMARY = /\bCodex is ignoring \d+ unrecognized configuration settings?\b/;

export function isIgnoredConfigDiagnostic(message: string): boolean {
  return IGNORED_CONFIG_SUMMARY.test(message);
}

const GLOG_RECORD =
  /^(?:.*\bharness stderr:\s*|(?!.*\bharness stderr:))(?:ERROR: logging before (?:google\.Init|flag\.Parse):\s*)?([IWEF])\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+[^\s\]]+:\d+\]/su;

export function isGlogBelowErrorDiagnostic(message: string): boolean {
  const severity = GLOG_RECORD.exec(message)?.[1];
  return severity === "I" || severity === "W";
}

const RUST_LOG_RECORD =
  /^\[?(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+)?(?:TRACE|DEBUG|INFO|WARN)\s/u;

export function isRustLogBelowErrorDiagnostic(message: string): boolean {
  return RUST_LOG_RECORD.test(message);
}

const PI_WARNING_RECORD = /^Warning: /u;

export function isPiWarningDiagnostic(message: string): boolean {
  return PI_WARNING_RECORD.test(message);
}

const PI_COMPACTION_NO_OP = /^\s*(?:nothing to compact \(session too small\)|already compacted)\s*$/iu;

export function isPiCompactionNoOp(message: string): boolean {
  return PI_COMPACTION_NO_OP.test(message);
}

const CONTEXT_TOO_SMALL =
  /\bcannot be reduced further without losing the latest exchange\b|\bnothing to compact yet\b|\bnothing to compact \(session too small\)|\bgreater than the context length\b|\blonger than the context length\b|\bexceeds the available context size\b|\bexceed_context_size_error\b|\bcontext_length_exceeded\b|\bleaves no room for generation\b/iu;

export function isContextTooSmallFailure(message: string): boolean {
  return CONTEXT_TOO_SMALL.test(message);
}

export const LOG_TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+/;

export function isUsageLimitDiagnostic(message: string): boolean {
  return (
    /\binsufficient[_ -]?(?:quota|credits?)\b/iu.test(message) ||
    /\b(?:quota|credits?|credit balance|usage balance|usage limits?)\b.{0,80}\b(?:exhausted|depleted|exceeded|insufficient|reached|too low)\b/iu.test(
      message,
    ) ||
    /\b(?:exhausted|depleted|exceeded|insufficient|reached)\b.{0,80}\b(?:quota|credits?|credit balance|usage balance|usage limits?)\b/iu.test(
      message,
    ) ||
    /\bbilling hard limit (?:has been )?reached\b/iu.test(message) ||
    isPlanLimitDiagnostic(message)
  );
}

export function isPlanLimitDiagnostic(message: string): boolean {
  if (isBalanceDiagnostic(message) && !/\b(?:try again at|limit · resets)\b/iu.test(message)) return false;
  return (
    /\bhit your (?:(?:session|weekly|usage|plan|opus|sonnet|fable|\d+-hour) )*limit\b/iu.test(message) ||
    /\b(?:hit|reached) your (?:session|weekly|\d+-hour) (?!(?:spend|rate|context|tokens?|requests?)\b)[\w-]+ limit\b/iu.test(
      message,
    ) ||
    /\b(?:session|weekly) (?:usage )?limit\b.{0,80}\b(?:reached|resets?)\b/iu.test(message) ||
    /\b(?:GoUsageLimitError|Go usage limit exceeded)\b/u.test(message) ||
    /\busage limit reached for \d+ ?hours?\b/iu.test(message) ||
    /\b(?:daily|weekly|monthly) limit exhausted\b/iu.test(message) ||
    /\bsubscription:free-usage-exhausted\b/u.test(message)
  );
}

const RESET_DELAY_UNIT = "(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])";
const RESET_DELAY = new RegExp(
  String.raw`\bresets? (?:in|after) ((?:\d+(?:\.\d+)?\s*${RESET_DELAY_UNIT}(?:,?\s*(?:and\s+)?))+)`,
  "iu",
);
const RESET_DELAY_PART = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(${RESET_DELAY_UNIT})`, "giu");
const RESET_DELAY_UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };

const GOOGLE_DURATION = String.raw`((?:\d+(?:\.\d+)?[hms])+)(?![\w.])`;
const GOOGLE_QUOTA_RESET_DELAY = new RegExp(String.raw`\bquotaResetDelay:${GOOGLE_DURATION}`, "u");
const GOOGLE_RETRY_DELAY = new RegExp(String.raw`\bretryDelay:${GOOGLE_DURATION}`, "u");
const GOOGLE_RESET_STAMP = /\bquotaResetTimeStamp:(\d{4}-\d\d-\d\dT[^\s\]]+)/u;

export const GOOGLE_RESET_FIELDS = new RegExp(
  `${GOOGLE_QUOTA_RESET_DELAY.source}|${GOOGLE_RETRY_DELAY.source}|${GOOGLE_RESET_STAMP.source}`,
  "gu",
);

function durationMs(text: string): number {
  let delay = 0;
  for (const [, amount, unit] of text.matchAll(RESET_DELAY_PART)) {
    delay += Number(amount) * (RESET_DELAY_UNIT_MS[unit?.[0]?.toLowerCase() ?? ""] ?? 0);
  }
  return delay;
}

function googleResetDelayMs(message: string): number {
  const quota = GOOGLE_QUOTA_RESET_DELAY.exec(message)?.[1];
  if (quota) return durationMs(quota);
  const stamp = Date.parse(GOOGLE_RESET_STAMP.exec(message)?.[1] ?? "");
  if (Number.isFinite(stamp)) return stamp - Date.now();
  const retry = GOOGLE_RETRY_DELAY.exec(message)?.[1];
  return retry ? durationMs(retry) : 0;
}

export function providerResetDelayMs(message: string): number | null {
  const named = RESET_DELAY.exec(message)?.[1];
  const delay = named ? durationMs(named) : googleResetDelayMs(message);
  return delay > 0 ? delay : null;
}

export function isBalanceDiagnostic(message: string): boolean {
  return /\b(?:credits?|balance|quota|billing)\b/iu.test(message);
}

export function isSpentBalanceDiagnostic(message: string): boolean {
  return isBalanceDiagnostic(message) && !isPlanLimitDiagnostic(message);
}

export function isImageTooSmallDiagnostic(message: string): boolean {
  return (
    /\bimage\b[^.\n]{0,80}\btoo small\b/iu.test(message) ||
    (/\bimage\b/iu.test(message) &&
      /\b(?:height|width)\b[^.\n]{0,60}\bmust be at least \d+ ?(?:px|pixels?)\b/iu.test(message)) ||
    /\bmust be larger than factor\b/iu.test(message) ||
    /\bimage length and width do not meet the model restrictions\b/iu.test(message)
  );
}

export function isImageTooLargeDiagnostic(message: string): boolean {
  return /\bimage\b[^.\n]{0,80}\bexceeds? (?:the )?max(?:imum)? (?:allowed size|dimensions?)\b/iu.test(message);
}

export function isImageUnreadableDiagnostic(message: string): boolean {
  return /\bUnable to process input(?: image\b|: the file or media data is empty, corrupted, or malformed)/iu.test(
    message,
  );
}

export const GEMINI_INVALID_ARGUMENT = /\bRequest contains an invalid argument\b/iu;

export const GEMINI_UNREADABLE_HISTORY = /\bcontains invalid UTF-8\b|\bdoes not match to a display_name\b/u;

export const GEMINI_INVALID_CREDENTIALS = /\bRequest had invalid authentication credentials\b/iu;

const IMAGE_COUNT_LIMIT =
  /\b(?:at most|no more than|maximum of) \d+ image(?:s|\(s\))?(?![\w-])|\bmaximum number of images\b/iu;

const IMAGE_QUOTA_PERIOD =
  /\b(?:per|a|each|every) (?:second|minute|hour|day|week|month)\b|\b(?:hourly|daily|weekly|monthly|quota)\b/iu;

export function isImageCountDiagnostic(message: string): boolean {
  return (
    /\b(?:at most|a maximum of) \d+ image(?:s|\(s\))? may be provided\b|\btoo many images in (?:the |this |one )?(?:request|prompt|message)\b|\b\d+ images\b[^.\n]{0,40}\bexceed\w* (?:the )?maximum of \d+(?! ?(?:[kmg]i?b|bytes?|px|pixels?)\b)(?: images| allowed)?\b|\b(?:request|prompt|message) (?:has|contains) more images than (?:the )?(?:limit|maximum) of \d+\b/iu.test(
      message,
    ) || message.split(/[.;\n]/u).some((clause) => IMAGE_COUNT_LIMIT.test(clause) && !IMAGE_QUOTA_PERIOD.test(clause))
  );
}

export function isRequestBodyLimitDiagnostic(message: string): boolean {
  return /\brequest body exceeds \d+ bytes\b|\bmessage size exceeds [\d.,]+ ?MB limit\b/iu.test(message);
}

export function isCodexAccountSettingsFailure(message: string): boolean {
  return /\bfailed to (?:re)?load workspace requirements\b/iu.test(message);
}

export function isUnreadableContentDiagnostic(message: string): boolean {
  return /\[unsupported_content_type\]|\bis not a multimodal model\b|\bmultimodal processing is not enabled\b|\bcontent part type "[^"]*" is not supported\b|\binvalid part type\b|\b(?:supports?|accepts?) (?:text[- ]only|only text)\b|\bdoes not support media type\b|\bimage_url is only supported by certain models\b|\b(?:does not|doesn['’]t|that) support image input\b|\bcontent\.type is invalid, allowed values: \[\\?['"]?text\\?['"]?\]/iu.test(
    message,
  );
}
