import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import type { CauseCode } from "@openbot/telemetry";
import { type AcpFlavor, shownFailureDetail } from "./acp-flavor";
import { GEMINI_INVALID_ARGUMENT, GEMINI_INVALID_CREDENTIALS } from "./agent/provider-diagnostics";
import { getRecord, getString, isRecord } from "./protocol";

/**
 * Antigravity 1.3.0's `quota_exhausted_message`: a fixed header, then the reset time. The 1.5 CLI
 * can put its warning sign first (`GEMINI_WARNING_ANSWER`).
 */
const GEMINI_QUOTA_CHUNK = /^\s*(?:\u26A0 )?Usage Limit Reached\n\n([\s\S]*)$/u;
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
 * is a Google sign-in page that continues to the Gemini Code Assist success page. The Antigravity
 * CLI 1.5.4 puts the link on its own line after "Please verify your account in your browser to
 * continue:" (#6985).
 */
const GEMINI_VERIFICATION_ANSWER =
  /(?:^|\n)[^\n]*:\s+(https:\/\/accounts\.google\.com\/signin\/[^\s]*auth_success_gemini[^\s]*)\s*$/u;
/**
 * The verification link anywhere in a failure text. The text is cut for the banner, so a link that
 * is not found there lost its end and could not open (#6985).
 */
const GEMINI_ACCOUNT_LINK = /https:\/\/accounts\.google\.com\/signin\/[^\s<>"'`)\]]*auth_success_gemini[^\s<>"'`)\]]*/u;
/**
 * Each verification link in the CLI's log. Google's `validation_url` is a `signin/continue` page
 * (#2419), and its next page can be one other than Gemini's. A logged structure can end the link with
 * `}`. Not a sign-in link of another kind, such as `/o/oauth2/`.
 */
const GEMINI_LOG_ACCOUNT_LINK =
  /https:\/\/accounts\.google\.com\/signin\/(?:continue\?|[^\s<>"'`)\]}\\]*auth_success_gemini)[^\s<>"'`)\]}\\]*/gu;
/**
 * The answer of the Antigravity CLI 1.5.6 and later when Google refuses a request until the user
 * verifies the account: `CustomUserErrorMessageFromHTTPError` maps `VALIDATION_REQUIRED` to this fixed
 * text, with no link, after the CLI's warning sign (#9508).
 */
const GEMINI_VERIFICATION_REQUIRED_ANSWER = /^\s*(?:\u26A0\uFE0F?\s*)?Verification Required\b/u;
/**
 * The Antigravity CLI 1.5 sends a failed request as an answer that starts with a line break, a
 * warning sign and a space, such as "\n⚠ Agent Platform API has not been used in project ...", and
 * ends the turn as a success. A model's warning sign comes with the emoji selector (U+FE0F).
 */
const GEMINI_WARNING_ANSWER = /^\n\u26A0 /u;
/**
 * The Antigravity CLI 1.5.8 tries a failed model request again, 8 times in about 2 minutes. Before
 * each try it sends "\n⚠ API error (attempt 1): Error 503, Message: ..., Status: UNAVAILABLE,
 * Details: []\n" as answer text. When no try works, "⚠ Agent execution terminated due to error."
 * follows; when one works, the answer of the model follows (#8238).
 */
const GEMINI_RETRY_NOTICE = /^\n?⚠ API error \(attempt (\d+)\): /u;
/** The answers that are the server's failure text, not a reply of the model. */
const GEMINI_FAILURE_ANSWER = new RegExp(
  `${GEMINI_EXECUTION_ERROR_ANSWER.source}|${GEMINI_CONNECTION_LOST_ANSWER.source}|${GEMINI_VERIFICATION_ANSWER.source}|${GEMINI_WARNING_ANSWER.source}`,
  "u",
);

/** Only for a text that is already a failure: a model's answer can name a Google page. */
function geminiAccountLink(text: string): string | null {
  return GEMINI_ACCOUNT_LINK.exec(text)?.[0].replace(/[.,;:]+$/u, "") ?? null;
}
/**
 * Antigravity's SDK error when a model step returns neither text nor a tool call, as when an agent
 * ends its turn silently after a tool call or on a message that asks for no reply (#4505). The
 * Antigravity CLI 1.5 sends it as the answer "⚠ Model produced invalid output." (#7266).
 */
const GEMINI_EMPTY_OUTPUT_FAILURE =
  /\bmodel output must contain either output text or tool calls, these cannot both be empty\b|\bModel produced invalid output\b/iu;
/**
 * A Gemini model can write its tool call as answer text, such as
 * `call:default_api:run_command{...}`, or `print(default_api.run_command(...))` that can be in a
 * `tool_code` code block. `default_api` is the name under which Gemini sees its tools. The CLI does
 * not run such text, and the chat showed it as the agent's answer (#11087). Only an answer that is
 * wholly calls is one: an answer that explains this syntax has other text.
 */
const GEMINI_TEXT_TOOL_CALL = {
  starts: ["```tool_code", "call:default_api:", "print(default_api."],
  whole:
    /^\s*(?:```tool_code\s*)?(?:call:default_api:[\w-]+\s*\{[\s\S]*\}|print\(default_api\.[\w-]+\([\s\S]*\)\))\s*(?:```\s*)?$/u,
};

/**
 * A failed MCP server start, which ends the turn. Antigravity 1.4.4 writes `mcp_load_failed_message`:
 * "The MCP server '<name>' failed to initialize: <reason>. Fix the MCP server, or remove it from your
 * configuration and start a new session, to continue." Before it, the SDK text came as it is:
 * "Agent execution error: MCP load failed for <name>: <reason>". The SDK limits names to these
 * characters.
 */
const GEMINI_MCP_LOAD_FAILURES = [
  /^\s*(?:\u26A0 )?The MCP server '([A-Za-z0-9_-]+)' failed to initialize(?:: ([\s\S]*?))?\.? Fix the MCP server\b/u,
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

/** Go's text for a connection to Google that dropped, on Unix and on Windows (`wsarecv`). */
const GEMINI_NETWORK_FAILURE =
  /\bconnection reset by peer\b|\bunexpected EOF\b|\bforcibly closed by the remote host\b/u;

/**
 * The kind of a Gemini request failure, first match wins. Gemini reports usage only for a Google
 * sign-in on 1.4.1 or later, so a limit often has no usage notice to explain it, and the raw Google
 * status left the user unsure whether waiting or another model helps (#1676). The patterns follow
 * Google's API status names, matched in capitals, and a status number only after `status`, `code`
 * or `HTTP`: a bare 404 or "unavailable" can be an MCP server or a tool. Antigravity does not
 * document its failure texts. A proxy's answer in the stream comes as a raw status line with the
 * HTTP version, such as `HTTP/1.0 502 Bad Gateway` (#5752).
 *
 * A model at capacity comes as RESOURCE_EXHAUSTED or UNAVAILABLE with the reason
 * MODEL_CAPACITY_EXHAUSTED and "No capacity available for model …". It is not the plan's quota,
 * so it is matched before the rate limit (#8554). Not the word "capacity" alone: Google's quota
 * text "You have exhausted your capacity on this model" is a spent quota.
 *
 * Google refuses all requests from some network addresses, also server addresses in a supported
 * country, with FAILED_PRECONDITION "User location is not supported for the API use." Waiting or
 * another model does not help (#9681). Not the status name: Google also uses it for other failures.
 */
const GEMINI_REQUEST_FAILURES = [
  ["error.provider.antigravityLocationUnsupported", /\bUser location is not supported\b/iu],
  [
    "error.provider.antigravityModelAtCapacity",
    /\bMODEL_CAPACITY_EX(?:HAUSTED|CEEDED)\b|\b[Nn]o capacity available for model\b/u,
  ],
  // Google's text for a spent plan quota: "Individual quota reached. Please upgrade your subscription
  // to increase your limits. Resets in 152h1m7s." It resets in days, so "wait a few minutes" is
  // wrong for it, and before this it showed with no advice (#9675).
  ["error.provider.antigravityQuotaReached", /\bquota\b.{0,40}\breached\b/iu],
  ["error.provider.antigravityRateLimited", /\bRESOURCE_EXHAUSTED\b/u],
  [
    "error.provider.antigravityRateLimited",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}429\b|\bresource has been exhausted\b|\brate[ _-]?limit|\btoo many requests\b|\bquota\b.{0,40}\b(?:exceeded|exhausted)\b/iu,
  ],
  // The CLI refuses a model that the account cannot use now with "Unknown model ID: <id>", also for a
  // model that worked before. The raw text gave the user no next step (#11129).
  [
    "error.provider.antigravityModelUnavailable",
    /\bmodel\b.{0,60}\b(?:not found|not supported|does not exist|is unavailable)\b|\bunknown model\b/iu,
  ],
  ["error.provider.antigravityServiceFailure", /\b(?:UNAVAILABLE|DEADLINE_EXCEEDED)\b/u],
  [
    "error.provider.antigravityServiceFailure",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}50[0-4]\b|\bservice unavailable\b|\boverloaded\b|\bdeadline exceeded\b|\binternal server error\b/iu,
  ],
  // The CLI had a new token less than a second later, so a turn that did no work runs again once.
  // This text shows when that retry does not run or fails too (#10367).
  ["error.provider.antigravitySignInRefused", GEMINI_INVALID_CREDENTIALS],
  // The chat stopped with only this text, and another model let the user continue (#7116). The CLI
  // keeps the refused item in the session, so a turn that fails with it shows
  // `antigravitySessionRejected` instead, and OpenBot opens a new session (#9593). This text shows
  // only when that recovery does not run.
  ["error.provider.antigravityRequestRejected", GEMINI_INVALID_ARGUMENT],
  // Go's text when the connection to Google drops during a request, after the CLI's own retries. The
  // chat showed the Google URL and the IP addresses, and the user did not know that a new try helps
  // (#7374, #8042). Last, so that a status that Google sent keeps its own kind.
  ["error.provider.antigravityNetwork", GEMINI_NETWORK_FAILURE],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

type GeminiRequestFailureKey = (typeof GEMINI_REQUEST_FAILURES)[number][0];

/** The cause of each Gemini request failure that a backup model can pass, as the message says. */
const GEMINI_FAILURE_CAUSES: Partial<Record<GeminiRequestFailureKey, CauseCode>> = {
  "error.provider.antigravityQuotaReached": "usage_limit",
  "error.provider.antigravityRateLimited": "rate_limit",
};

/**
 * The message for a failure of `GEMINI_REQUEST_FAILURES`. A network failure names only its cause,
 * such as "connection reset by peer": the rest of Go's text is a URL and IP addresses.
 */
function geminiRequestFailureText(key: GeminiRequestFailureKey, text: string): string {
  if (key === "error.provider.antigravityNetwork")
    return sourceText(key, { cause: GEMINI_NETWORK_FAILURE.exec(text)?.[0] ?? "" });
  return sourceText(key, { detail: shownFailureDetail(text) });
}

/**
 * The message of a Gemini turn that the server failed but reported as answer text, and the request
 * failure that the message names, or `null` for a text with its own message.
 */
function geminiAnswerFailure(answer: string): { message: string; key: GeminiRequestFailureKey | null } {
  const text = answer.replace(GEMINI_WARNING_ANSWER, "");
  // The account, not the request, is the problem: no key or model change helps.
  if (geminiAccountLink(text) !== null || GEMINI_VERIFICATION_REQUIRED_ANSWER.test(text))
    return { message: sourceText("error.provider.geminiVerificationRequired"), key: null };
  // Google's API answer for a refused key. The key is the user's to fix, not the request.
  if (/\bAPI key not valid\b|\bAPI_KEY_INVALID\b/u.test(text))
    return { message: sourceText("error.provider.geminiKeyRefused"), key: null };
  // The server's text names its harness and a WebSocket close code, which the user cannot act on.
  if (GEMINI_CONNECTION_LOST_ANSWER.test(text))
    return { message: sourceText("error.provider.antigravityConnectionLost"), key: null };
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  return { message: key ? geminiRequestFailureText(key, text) : shownFailureDetail(text), key };
}

/**
 * The cause of a Gemini turn that the server failed but reported as answer text, from the same rules
 * as its message, or `null`. A rate limit that names no Google status, such as "code 429", showed
 * the rate-limit message but did not move the agent to its backup model (#11099). A failed MCP server
 * is not a request failure: another model has the same server.
 */
function geminiTurnFailureCause(answer: string): CauseCode | null {
  if (geminiMcpLoadFailure(answer.replace(GEMINI_WARNING_ANSWER, "")) !== null) return null;
  const { key } = geminiAnswerFailure(answer);
  return key ? (GEMINI_FAILURE_CAUSES[key] ?? null) : null;
}

/** The prefix that the ACP SDK puts before the server's text of a failed request. */
const GEMINI_INTERNAL_ERROR_PREFIX = /^(?:RequestError:\s*)?Internal error:\s*/u;
/**
 * Google's quota of 0 for the model, such as a free-tier key on a paid model: "Quota exceeded for
 * metric: ..._free_tier_requests, limit: 0". Waiting does not help. Not "limit: 0.5" or "limit: 05".
 */
const GEMINI_ZERO_LIMIT = /\blimit:\s*0(?!\d|\.\d)/u;

/**
 * The message of a rate limit or quota refusal while a saved Gemini API key serves the turns, or
 * `null` for another failure. The key's quota is not the Google plan's, so the plan's text misled
 * the user, and for a quota of 0 its advice to wait never helped (#9517). The same failure texts as
 * the flavor's, from the answer (`error` is absent) or from a failed request.
 */
export function geminiSavedKeyLimitFailure(text: string, error?: unknown): string | null {
  if (error !== undefined && !(error instanceof RequestError)) return null;
  const reason = text.replace(GEMINI_WARNING_ANSWER, "").replace(GEMINI_INTERNAL_ERROR_PREFIX, "");
  if (geminiAccountLink(reason) !== null || GEMINI_CONNECTION_LOST_ANSWER.test(reason)) return null;
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  if (key !== "error.provider.antigravityRateLimited") return null;
  return sourceText(
    GEMINI_ZERO_LIMIT.test(reason) ? "error.provider.geminiKeyQuotaZero" : "error.provider.geminiKeyRateLimited",
    { detail: shownFailureDetail(reason) },
  );
}

/** Only a failure the server answered with: a local failure is not Google's to explain. */
function geminiRequestFailure(error: unknown, detail: string): string {
  if (!(error instanceof RequestError)) return detail;
  const reason = detail.replace(GEMINI_INTERNAL_ERROR_PREFIX, "");
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  return key ? geminiRequestFailureText(key, reason) : detail;
}

/** The Gemini home of an Antigravity process: the account's `GEMINI_HOME`, else `~/.gemini`. */
export function antigravityGeminiHome(env: Readonly<Record<string, string | undefined>>): string {
  return env.GEMINI_HOME?.trim() || join(homedir(), ".gemini");
}

/**
 * The server names in the two `mcp_config.json` files that the Antigravity CLI 1.5.6 reads: the
 * user's, in the Gemini home, and the workspace's. A file that is missing or is not JSON gives no
 * names: the CLI starts no server from it.
 */
/** The flag that gives the CLI its Gemini home. */
export const GEMINI_DIR_FLAG = "--gemini-dir=";
/** The flag that gives the CLI its app data folder, relative to the Gemini home. */
const APP_DATA_DIR_FLAG = "--app-data-dir=";

function flagValue(argv: readonly string[], flag: string): string | undefined {
  return argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
}

function antigravityOwnMcpServerNames(cwd: string, argv: readonly string[]): string[] {
  // The account's folder travels in the flag, not in the environment of the process.
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const files = [...(home ? [join(home, "config", "mcp_config.json")] : []), join(cwd, ".agents", "mcp_config.json")];
  return files.flatMap((file) => {
    try {
      const servers = getRecord(JSON.parse(readFileSync(file, "utf8")), "mcpServers");
      return servers ? Object.keys(servers) : [];
    } catch {
      return [];
    }
  });
}

/** The CLI 1.5.6 answer for a failure of its own, such as a refused tool schema. It names no cause. */
const GEMINI_TERMINATED_ANSWER = /^\s*(?:\u26A0 )?Agent execution terminated due to error\.?\s*$/u;
/** The Antigravity CLI 1.5.6 log line of each prompt, before it builds the toolbox for the prompt. */
const GEMINI_PROMPT_LOG = "Sending user message to conversation ";
/**
 * Antigravity 1.5.6 checks the parameter schema of each MCP tool with Go's RE2 when it builds the
 * toolbox of a prompt. One `pattern` with a lookahead, such as the email of Resend's `get-contact`,
 * ends every turn with only "Agent execution terminated due to error." as the answer (#7228). Only
 * the CLI's own log names the tool, in `<Gemini home>/<app data>/log/acp-server-<time>-<pid>.log`.
 * The 1.5.9 CLI answers with this line itself, and no longer with the short answer (#9568).
 */
const GEMINI_REFUSED_TOOL = /\bbuilding toolbox: tool "(mcp_[^"]+)" advertises an invalid parameter schema\b/gu;
/**
 * Google's answer, in the CLI's log, for a tool schema that its `parameters` format refuses. It has one
 * entry for each field, such as `GenerateContentRequest.tools[20].function_declarations[0].parameters
 * .properties[tags].items: missing field` or `….properties[revisions].enum[3]: cannot be empty`. A
 * field that Google takes only in a schema of one type, such as `items` on a `string`, gives
 * `….properties[situacoes].items: field predicate failed: $type == Type.ARRAY` (#11746). It names the
 * tool only by its place in the request, which the log does not map to a name (#7482).
 */
const GOOGLE_REFUSED_FIELD =
  /\bGenerateContentRequest\.tools\[(\d+\]\.function_declarations\[\d+)\]\.parameters((?:\.\w+(?:\[[^\]]*\])?)*): (missing field|cannot be empty|field predicate failed: \$type == Type\.\w+)/gu;
/** The type that Google asks for in a `field predicate failed` reason of `GOOGLE_REFUSED_FIELD`. */
const GOOGLE_FIELD_TYPE = /^field predicate failed: \$type == Type\.(\w+)$/u;
/** One step of the field path in `GOOGLE_REFUSED_FIELD`: a key, and a property name or an index. */
const GOOGLE_FIELD_STEP = /\.(\w+)(?:\[([^\]]*)\])?/gu;
/** A log that the CLI wrote in this time can hold the failure of the prompt that just ended. */
const GEMINI_LOG_RECENT_MS = 10 * 60_000;
/** The end of a log that is read. The failure comes a few lines after the line of its prompt. */
const GEMINI_LOG_TAIL_BYTES = 256 * 1024;

function logTail(file: string, size: number): string {
  const length = Math.min(size, GEMINI_LOG_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, length, size - length)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * The ends of the CLI's own logs that changed in the last minutes, newest first. The folder is in the
 * account's Gemini home, so each log is of this account. A log is read only when the caller gets to
 * it, and a log that cannot be read is skipped.
 */
function* antigravityRecentLogs(argv: readonly string[]): Generator<string> {
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const appData = flagValue(argv, APP_DATA_DIR_FLAG);
  if (!home || !appData) return;
  const folder = join(home, appData, "log");
  const since = Date.now() - GEMINI_LOG_RECENT_MS;
  let logs: { file: string; size: number; mtimeMs: number }[];
  try {
    logs = readdirSync(folder)
      .filter((name) => name.endsWith(".log"))
      .flatMap((name) => {
        const file = join(folder, name);
        try {
          const stat = statSync(file);
          return stat.isFile() && stat.mtimeMs >= since ? [{ file, size: stat.size, mtimeMs: stat.mtimeMs }] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return;
  }
  for (const { file, size } of logs) {
    try {
      yield logTail(file, size);
    } catch {
      // The CLI can remove or lock a log while it runs.
    }
  }
}

/**
 * The CLI's own log after the last prompt of the session. Each session has a process, and so a log,
 * of its own. A session that opened again on a new process has an older log too, so only the newest
 * log with a prompt of the session counts. A log that cannot be read gives `null`: the turn then
 * fails as before.
 */
function antigravityLastPromptLog(argv: readonly string[], sessionId: string): string | null {
  const prompt = `${GEMINI_PROMPT_LOG}${sessionId}`;
  for (const log of antigravityRecentLogs(argv)) {
    const at = log.lastIndexOf(prompt);
    if (at >= 0) return log.slice(at);
  }
  return null;
}

/**
 * The tools that the CLI refused after the last prompt of the session. The 1.5.9 answer names the
 * tool. An older CLI names it only in its log. When Google refused a tool, the answer or the log names
 * only its fields, and the tools come from the schemas that the CLI saved. A log that cannot be read
 * gives no tools: the turn then fails as before.
 */
function antigravityRefusedMcpTools(text: string, argv: readonly string[], sessionId: string): string[] {
  const answered = Array.from(text.matchAll(GEMINI_REFUSED_TOOL), (match) => match[1] ?? "");
  if (answered.length > 0) return answered;
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const appData = flagValue(argv, APP_DATA_DIR_FLAG);
  if (!home || !appData) return [];
  const schemas = join(home, appData, "mcp");
  const google = googleRefusedMcpTools(text, schemas);
  if (google.length > 0 || !GEMINI_TERMINATED_ANSWER.test(text)) return google;
  const log = antigravityLastPromptLog(argv, sessionId);
  if (log === null) return [];
  const named = Array.from(log.matchAll(GEMINI_REFUSED_TOOL), (match) => match[1] ?? "");
  return named.length > 0 ? named : googleRefusedMcpTools(log, schemas);
}

/**
 * The page where the user verifies the account that failed the turn. The CLI 1.5.6 and later sends
 * only "Verification Required" as the answer, and keeps Google's 403 with its `validation_url` in its
 * own log (#9508). A JSON encoder can write the `&`, `=` and `/` of the link as `\u0026`, `\u003d` and
 * `\/`; Go's writes each `&` as `\u0026`. A body that is logged as a JSON string has one more
 * backslash for each escape, and its quotes as `\"`.
 *
 * The CLI can log Google's 403 when it opens the session or checks the sign-in, before the line of
 * the prompt, so only the text after the prompt had no link and the banner had no button (#11702).
 * The newest link in the account's recent logs is the one to open: the log folder is the account's.
 */
function antigravityAccountLink(text: string, argv: readonly string[]): string | null {
  const link = geminiAccountLink(text);
  if (link !== null || !GEMINI_VERIFICATION_REQUIRED_ANSWER.test(text)) return link;
  for (const log of antigravityRecentLogs(argv)) {
    if (!log.includes("VALIDATION_REQUIRED")) continue;
    const links = log
      .replace(/\\+u0026/gu, "&")
      .replace(/\\+u003d/gu, "=")
      .replace(/\\+\//gu, "/")
      .replace(/\\+"/gu, '"')
      .match(GEMINI_LOG_ACCOUNT_LINK);
    const newest = links?.at(-1)?.replace(/[.,;:]+$/u, "");
    if (newest) return newest;
  }
  return null;
}

function folderNames(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/**
 * Whether `parameters` has the field that Google refused at `path`: a missing key, an empty value, or
 * a key in a schema of a type other than the one that Google asks for. An index in a step reads an
 * array, and a property name reads an object.
 */
function hasRefusedField(parameters: unknown, path: string, reason: string): boolean {
  const steps = Array.from(path.matchAll(GOOGLE_FIELD_STEP), ([, key = "", index]) => ({
    // Google names the fields of its `Schema` in snake case, such as `any_of`. The CLI saves JSON Schema.
    key: key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()),
    index,
  }));
  const last = steps.pop();
  if (!last) return false;
  const missing = reason === "missing field";
  const type = GOOGLE_FIELD_TYPE.exec(reason)?.[1]?.toLowerCase();
  let node = parameters;
  for (const { key, index } of missing || type ? steps : [...steps, last]) {
    if (!isRecord(node)) return false;
    const value = Object.hasOwn(node, key) ? node[key] : undefined;
    if (index === undefined) node = value;
    else if (Array.isArray(value)) node = /^\d+$/u.test(index) ? value[Number(index)] : undefined;
    else node = isRecord(value) && Object.hasOwn(value, index) ? value[index] : undefined;
  }
  if (missing) {
    if (last.index !== undefined || !isRecord(node) || Object.hasOwn(node, last.key)) return false;
    // Google asks for `items` only in an array. A field of another type with the same name is not refused.
    return last.key !== "items" || node.type === "array" || (Array.isArray(node.type) && node.type.includes("array"));
  }
  if (type) {
    if (last.index !== undefined || !isRecord(node) || !Object.hasOwn(node, last.key)) return false;
    // The field is refused only beside another type. A schema of the asked type with the same field is accepted.
    return node.type !== type && !(Array.isArray(node.type) && node.type.includes(type));
  }
  return node === "" || (Array.isArray(node) && node.length === 0);
}

/**
 * The MCP tools that hold each field of a tool that Google refused, as `mcp_<server>_<tool>`. The CLI
 * 1.5.6 saves the schema of each tool of a server that it starts in `<app data>/mcp/<server>/<tool>.json`.
 * A tool must hold all refused fields that have the same place in the request. Such a tool fails on
 * Gemini each time, so no tool that Google accepts matches. A file that cannot be read is skipped.
 */
function googleRefusedMcpTools(log: string, folder: string): string[] {
  const refused = new Map<string, { path: string; reason: string }[]>();
  for (const [, place = "", path = "", reason = ""] of log.matchAll(GOOGLE_REFUSED_FIELD))
    refused.set(place, [...(refused.get(place) ?? []), { path, reason }]);
  if (refused.size === 0) return [];
  const tools: string[] = [];
  // In name order, so that the same files give the same server to leave out first.
  for (const server of folderNames(folder).sort()) {
    for (const file of folderNames(join(folder, server))) {
      if (!file.endsWith(".json")) continue;
      let schema: unknown;
      try {
        schema = JSON.parse(readFileSync(join(folder, server, file), "utf8"));
      } catch {
        continue;
      }
      const parameters = isRecord(schema) ? schema.parameters : undefined;
      const fails = [...refused.values()].some((fields) =>
        fields.every(({ path, reason }) => hasRefusedField(parameters, path, reason)),
      );
      if (fails) tools.push(`mcp_${server}_${getString(schema, "name") ?? file.slice(0, -".json".length)}`);
    }
  }
  return tools;
}

export const ANTIGRAVITY_ACP_FLAVOR: AcpFlavor = {
  // Antigravity 1.5.6 starts the entry of its own `mcp_config.json` in place of a session server with
  // the same name, and does not start the session server. The user's entry and its tool limits then
  // decide what the agent can call: "tool COMPOSIO_SEARCH_TOOLS is not enabled for server composio"
  // is the CLI's answer for a tool that an own entry does not turn on (#7785).
  ownMcpServerNames: antigravityOwnMcpServerNames,
  // A probe of 1.5.9 sent `notifications/cancelled` for each OpenBot tool call after exactly 180 s,
  // also with progress every 20 s, and also with `timeoutSeconds` in the session server entry. Only
  // the CLI's own `mcp_config.json` changes it, which is the user's file (#9689).
  mcpToolCallLimitMs: 180_000,
  // Antigravity 1.4 offered its Claude and GPT models only to a client named `zed`. The 1.5 CLI
  // offers the same models to every client, so OpenBot sends its own name.
  // Antigravity 1.4.5 declares these built-ins in each request, about 2.4k tokens. OpenBot has its own
  // routines, and a workflow runs agents that OpenBot does not show. Antigravity keeps the filter with
  // the session; a load or resume sends it again, so a session from an earlier release gets it too.
  sessionMeta: { antigravity: { disabledTools: ["schedule", "run_workflow"] } },
  // After an approval, Antigravity runs the edit as a new call (`<sessionId>:<n>`, "Running
  // edit_file") and then fails the approved call with this text. The chat showed a failure beside
  // each approved edit that worked (#6878).
  approvedEditSweep: /^\s*Tool call was approved but never executed\.?\s*$/u,
  // Antigravity 1.3.0 has three exact forms: a load or resume puts the ID in data.sessionId, a
  // configuration change uses the SDK's resource URI `session <id>`, and a prompt raises a plain
  // error that the SDK wraps as an internal error. The 1.5 CLI sends no data: a resume answers
  // "Failed to read session <id>; retry, or load it with session/load", and a prompt "Session not
  // found: <id>". Its `session/load` of a missing session opens an empty one, so the hint is not
  // followed: OpenBot opens a new session and gives it the chat (#8468).
  sessionNotFound: (error, sessionId) => {
    if (error.code === -32603 && error.message.startsWith(`Failed to read session ${sessionId};`)) return true;
    if (error.code === -32602 && error.message === `Session not found: ${sessionId}`) return true;
    if (!isRecord(error.data)) return false;
    if (error.code === -32603) return error.data.details === `Session not found: ${sessionId}`;
    return error.code === -32002 && (error.data.sessionId === sessionId || error.data.uri === `session ${sessionId}`);
  },
  turnFailure: (error, detail) => geminiRequestFailure(error, detail),
  // The 1.5.4 CLI refreshes the Google token when a session opens. When Google refuses it, the CLI
  // answers `authRequired` and opens no browser.
  authRequiredSignsOut: true,
  // Antigravity 1.4.5 ends a turn whose quota is spent with the stop reason `refusal`
  // (`_to_acp_stop_reason` of QUOTA_EXHAUSTED).
  failureCause: (error) => (error === "refusal" ? "usage_limit" : null),
  sdkHarness: {
    failedSession: (stderrLine) => GEMINI_SDK_FAILURE.exec(stderrLine)?.[1],
    answerIsFailure: GEMINI_FAILURE_ANSWER,
    retryNotice: (text) => {
      const attempt = GEMINI_RETRY_NOTICE.exec(text)?.[1];
      return attempt ? Number(attempt) : null;
    },
    emptyOutputFailure: GEMINI_EMPTY_OUTPUT_FAILURE,
    textToolCall: GEMINI_TEXT_TOOL_CALL,
    turnFailure: (answer) => geminiAnswerFailure(answer).message,
    fallbackCause: geminiTurnFailureCause,
    accountLink: antigravityAccountLink,
    accountVerification: GEMINI_VERIFICATION_REQUIRED_ANSWER,
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
    refusedMcpTools: antigravityRefusedMcpTools,
    sessionLost: GEMINI_CONNECTION_LOST_ANSWER,
  },
  // Its SDK waits for FULLY_IDLE even after halt_request. Stop waiting locally, then rebuild the
  // harness through session/resume before accepting another prompt.
  cancelLocallyThenResume: true,
  // `agy acp` 1.5.0 steers a running turn with another prompt. A probe of 1.5.8: the first prompt
  // answered `end_turn` at once, its shell command ran on, and the model read the new message.
  steerByPromptSince: "1.5.0",
  // A stopped stream cannot provide another tool result. Preserve its last output without
  // reporting successful execution.
  interruptToolsOnStop: true,
  // Antigravity keeps session/prompt open while background tasks run. Its text must not wait for
  // that response.
  streamAnswerBeforePromptReturns: true,
  // When the model's stream drops, the 1.5.10 CLI sends it "The stream was interrupted. Please
  // continue the task you were working on." as an error step, and the model writes the rest of the
  // answer in a new step that starts with a thought. The answer before the thought showed only in the
  // steps, and the answer only had its end (#11805). The CLI sends a failure as "\n⚠ <text>\n".
  resumesAnswerAfterThought: {
    report:
      /^\s*(?:⚠️?\s*)?(?:Error: )?The stream was interrupted\. Please continue the task you were working on\.\s*$/u,
  },
  // A silent prompt can be a background task that still runs, so the turn is not ended as stalled.
  promptOpenForBackgroundTasks: true,
  // 1.5.x ends the prompt when its model waits for a command over 10 s, and sends nothing for the
  // wake-up. The idle release then stopped the process 5 minutes later (#8660).
  wakesAfterPromptEnds: true,
  // 1.5.x starts subagents with `start_subagent` or `invoke_subagent` ("Running start_subagent",
  // "Run invoke_subagent?"), and the call completes at once. 1.5.9 also runs `schedule`, a timer,
  // although `sessionMeta` turns it off. The end of that work wakes the model with no prompt open, as
  // for a command. Its results and approvals did not show (#8993).
  selfWakeTools: /\b(?:start|invoke)_subagent\b|^(?:Run(?:ning)? )?schedule\??$/u,
  // Antigravity 1.3.0 sends `usage_update` but has no ACP method or command that compacts.
  contextCompaction: "handoff",
  // Antigravity 1.4.4 starts a `localharness_external` of about 100 MB for each session and keeps it
  // after `session/close`, which it does not advertise, until its process ends (#3925).
  closeKeepsSession: true,
  // Also on Windows, where each process start unpacks about 310 MB (`antigravityTemp`) that a new or
  // reopened session waits for. One shared process kept a harness for each session it opened (#5497).
  sessionProcesses: true,
  // `model/list` opens a second probe session after the start already listed the models. When it
  // failed, timed out or listed none, a signed-in Gemini row showed no models until a restart (#11079).
  keepModelsOnRefreshFailure: true,
};
