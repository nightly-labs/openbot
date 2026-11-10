import { RequestError } from "@agentclientprotocol/sdk";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { type AcpFlavor, shownFailureDetail } from "./acp-flavor";
import { isRecord } from "./protocol";

/** Antigravity 1.3.0's `quota_exhausted_message`: a fixed header, then the reset time. */
const GEMINI_QUOTA_CHUNK = /^\s*Usage Limit Reached\n\n([\s\S]*)$/u;
/** The stderr record that Antigravity 1.3.0 writes before it sends an SDK failure as answer text. */
const GEMINI_SDK_FAILURE = /\bAntigravity SDK error processing prompt for session (\S+)/u;
/** `format_execution_error` of Antigravity 1.3.0 when the failure is not a Google API error. */
const GEMINI_EXECUTION_ERROR_ANSWER = /^\s*Agent execution error: /u;
/**
 * Antigravity 1.4.5 `_send_connection_lost_message`: the connection to its harness closed, and a new
 * harness did not start. It ends the turn as a success and forgets the session, which stays on disk.
 * The turn fails, and `sessionLost` makes OpenBot open the saved session again for the next prompt
 * (#6321).
 */
const GEMINI_CONNECTION_LOST_ANSWER = /^\s*Agent connection was lost and could not be re-established: /u;
/**
 * Google refuses a request until the user verifies the account (`VALIDATION_REQUIRED`, #2419).
 * Antigravity 1.4.5 `format_execution_error` then sends Google's message, an empty line, and
 * `<link text>: <validation_url>` as the answer, with no `Agent execution error:` prefix. The link
 * is a Google sign-in page that continues to the Gemini Code Assist success page.
 */
const GEMINI_VERIFICATION_ANSWER =
  /(?:^|\n)[^\n]*: (https:\/\/accounts\.google\.com\/signin\/[^\s]*auth_success_gemini[^\s]*)\s*$/u;
/** The answers that are the server's failure text, not a reply of the model. */
const GEMINI_FAILURE_ANSWER = new RegExp(
  `${GEMINI_EXECUTION_ERROR_ANSWER.source}|${GEMINI_CONNECTION_LOST_ANSWER.source}|${GEMINI_VERIFICATION_ANSWER.source}`,
  "u",
);

function geminiAccountLink(text: string): string | null {
  return GEMINI_VERIFICATION_ANSWER.exec(text)?.[1] ?? null;
}
/**
 * Antigravity's SDK error when a model step returns neither text nor a tool call, as when an agent
 * ends its turn silently after a tool call or on a message that asks for no reply (#4505).
 */
const GEMINI_EMPTY_OUTPUT_FAILURE =
  /\bmodel output must contain either output text or tool calls, these cannot both be empty\b/iu;

/**
 * A failed MCP server start, which ends the turn. Antigravity 1.4.4 writes `mcp_load_failed_message`:
 * "The MCP server '<name>' failed to initialize: <reason>. Fix the MCP server, or remove it from your
 * configuration and start a new session, to continue." Before it, the SDK text came as it is:
 * "Agent execution error: MCP load failed for <name>: <reason>". The SDK limits names to these
 * characters.
 */
const GEMINI_MCP_LOAD_FAILURES = [
  /^\s*The MCP server '([A-Za-z0-9_-]+)' failed to initialize(?:: ([\s\S]*?))?\.? Fix the MCP server\b/u,
  /\bMCP load failed for ([A-Za-z0-9_-]+): ([\s\S]*)$/u,
] as const;

function geminiMcpLoadFailure(text: string): { name: string; reason: string } | null {
  for (const pattern of GEMINI_MCP_LOAD_FAILURES) {
    const match = pattern.exec(text);
    // With no reason, Antigravity's own sentence is the reason, so the report is not empty.
    if (match?.[1])
      return {
        name: match[1],
        reason: (match[2] || match[0].replace(/\s*Fix the MCP server\b.*$/su, "")).replace(/\s+/gu, " ").trim(),
      };
  }
  return null;
}

/**
 * The kind of a Gemini request failure, first match wins. Gemini reports usage only for a Google
 * sign-in on 1.4.1 or later, so a limit often has no usage notice to explain it, and the raw Google
 * status left the user unsure whether waiting or another model helps (#1676). The patterns follow
 * Google's API status names, matched in capitals, and a status number only after `status`, `code`
 * or `HTTP`: a bare 404 or "unavailable" can be an MCP server or a tool. Antigravity does not
 * document its failure texts. A proxy's answer in the stream comes as a raw status line with the
 * HTTP version, such as `HTTP/1.0 502 Bad Gateway` (#5752).
 */
const GEMINI_REQUEST_FAILURES = [
  ["error.provider.antigravityRateLimited", /\bRESOURCE_EXHAUSTED\b/u],
  [
    "error.provider.antigravityRateLimited",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}429\b|\bresource has been exhausted\b|\brate[ _-]?limit|\btoo many requests\b|\bquota\b.{0,40}\b(?:exceeded|exhausted)\b/iu,
  ],
  [
    "error.provider.antigravityModelUnavailable",
    /\bmodel\b.{0,60}\b(?:not found|not supported|does not exist|is unavailable)\b/iu,
  ],
  ["error.provider.antigravityServiceFailure", /\b(?:UNAVAILABLE|DEADLINE_EXCEEDED)\b/u],
  [
    "error.provider.antigravityServiceFailure",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}50[0-4]\b|\bservice unavailable\b|\boverloaded\b|\bdeadline exceeded\b|\binternal server error\b/iu,
  ],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

/** The message of a Gemini turn that the server failed but reported as answer text. */
function geminiTurnFailure(text: string): string {
  // The account, not the request, is the problem: no key or model change helps.
  if (geminiAccountLink(text) !== null) return sourceText("error.provider.geminiVerificationRequired");
  // Google's API answer for a refused key. The key is the user's to fix, not the request.
  if (/\bAPI key not valid\b|\bAPI_KEY_INVALID\b/u.test(text)) return sourceText("error.provider.geminiKeyRefused");
  // The server's text names its harness and a WebSocket close code, which the user cannot act on.
  if (GEMINI_CONNECTION_LOST_ANSWER.test(text)) return sourceText("error.provider.antigravityConnectionLost");
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(text))?.[0];
  return key ? sourceText(key, { detail: shownFailureDetail(text) }) : shownFailureDetail(text);
}

/** Only a failure the server answered with: a local failure is not Google's to explain. */
function geminiRequestFailure(error: unknown, detail: string): string {
  if (!(error instanceof RequestError)) return detail;
  const reason = detail.replace(/^(?:RequestError:\s*)?Internal error:\s*/u, "");
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  return key ? sourceText(key, { detail: shownFailureDetail(reason) }) : detail;
}

export const ANTIGRAVITY_ACP_FLAVOR: AcpFlavor = {
  // Antigravity 1.4.3 offers its Claude and GPT models only to a client named `zed`, `xcode`,
  // `jetbrains.*` or `android studio*` (`supports_third_party_models`). Any other client gets the
  // Gemini models only, also when the plan includes the others. The server also sends the name and
  // version to Google in its User-Agent (`_surface`), so Google sees these requests as `zed/0.1.0`.
  clientInfo: { name: "zed", title: "OpenBot", version: "0.1.0" },
  // Antigravity 1.4.5 declares these built-ins in each request, about 2.4k tokens. OpenBot has its own
  // routines, and a workflow runs agents that OpenBot does not show. Antigravity keeps the filter with
  // the session; a load or resume sends it again, so a session from an earlier release gets it too.
  sessionMeta: { antigravity: { disabledTools: ["schedule", "run_workflow"] } },
  // Antigravity 1.3.0 has three exact forms: a load or resume puts the ID in data.sessionId, a
  // configuration change uses the SDK's resource URI `session <id>`, and a prompt raises a plain
  // error that the SDK wraps as an internal error.
  sessionNotFound: (error, sessionId) => {
    if (!isRecord(error.data)) return false;
    if (error.code === -32603) return error.data.details === `Session not found: ${sessionId}`;
    return error.code === -32002 && (error.data.sessionId === sessionId || error.data.uri === `session ${sessionId}`);
  },
  turnFailure: (error, detail) => geminiRequestFailure(error, detail),
  // Antigravity 1.4.5 ends a turn whose quota is spent with the stop reason `refusal`
  // (`_to_acp_stop_reason` of QUOTA_EXHAUSTED).
  failureCause: (error) => (error === "refusal" ? "usage_limit" : null),
  sdkHarness: {
    failedSession: (stderrLine) => GEMINI_SDK_FAILURE.exec(stderrLine)?.[1],
    answerIsFailure: GEMINI_FAILURE_ANSWER,
    emptyOutputFailure: GEMINI_EMPTY_OUTPUT_FAILURE,
    turnFailure: geminiTurnFailure,
    accountLink: geminiAccountLink,
    // Antigravity reports an exhausted quota as answer text and ends the turn as a success. Google
    // sends it only for a spent quota, which resets in days, not for a request-rate limit. The
    // server names no bucket, and the usage page of the plan can still show room.
    quota: (text) => {
      const quota = GEMINI_QUOTA_CHUNK.exec(text);
      return quota
        ? sourceText("error.provider.antigravityQuotaReached", { detail: shownFailureDetail(quota[1]?.trim() ?? "") })
        : null;
    },
    mcpLoadFailure: geminiMcpLoadFailure,
    sessionLost: GEMINI_CONNECTION_LOST_ANSWER,
  },
  // Its SDK waits for FULLY_IDLE even after halt_request. Stop waiting locally, then rebuild the
  // harness through session/resume before accepting another prompt.
  cancelLocallyThenResume: true,
  // A stopped stream cannot provide another tool result. Preserve its last output without
  // reporting successful execution.
  interruptToolsOnStop: true,
  // Antigravity keeps session/prompt open while background tasks run. Its text must not wait for
  // that response.
  streamAnswerBeforePromptReturns: true,
  // A silent prompt can be a background task that still runs, so the turn is not ended as stalled.
  promptOpenForBackgroundTasks: true,
  // Antigravity 1.3.0 sends `usage_update` but has no ACP method or command that compacts.
  contextCompaction: "handoff",
  // Antigravity 1.4.4 starts a `localharness_external` of about 100 MB for each session and keeps it
  // after `session/close`, which it does not advertise, until its process ends (#3925).
  closeKeepsSession: true,
  // Also on Windows, where each process start unpacks about 310 MB (`antigravityTemp`) that a new or
  // reopened session waits for. One shared process kept a harness for each session it opened (#5497).
  sessionProcesses: true,
};
