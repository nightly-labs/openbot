import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import type { CauseCode } from "@openbot/telemetry";
import { type AcpFlavor, shownFailureDetail } from "./acp-flavor";
import {
  GEMINI_INVALID_ARGUMENT,
  GEMINI_INVALID_CREDENTIALS,
  GEMINI_UNREADABLE_HISTORY,
  GOOGLE_RESET_FIELDS,
} from "./agent/provider-diagnostics";
import { getRecord, getString, isRecord } from "./protocol";

const GEMINI_QUOTA_CHUNK = /^\s*(?:\u26A0 )?Usage Limit Reached\n\n([\s\S]*)$/u;
const GEMINI_SDK_FAILURE = /\bAntigravity SDK error processing prompt for session (\S+)/u;
const GEMINI_EXECUTION_ERROR_ANSWER = /^\s*Agent execution error: /u;
const GEMINI_CONNECTION_LOST_ANSWER = /^\s*Agent connection was lost and could not be re-established: /u;
const GEMINI_VERIFICATION_ANSWER =
  /(?:^|\n)[^\n]*:\s+(https:\/\/accounts\.google\.com\/(?:v\d+\/)?signin\/[^\s]*auth_success_gemini[^\s]*)\s*$/u;
const GEMINI_ACCOUNT_LINK =
  /https:\/\/accounts\.google\.com\/(?:v\d+\/)?signin\/[^\s<>"'`)\]]*auth_success_gemini[^\s<>"'`)\]]*/u;
const GEMINI_VERIFICATION_LINK = /https:\/\/accounts\.google\.com\/(?:v\d+\/)?signin\/continue\?[^\s<>"'`)\]}\\]*/u;
const GEMINI_LOG_ACCOUNT_LINK =
  /https:\/\/accounts\.google\.com\/(?:v\d+\/)?signin\/(?:continue\?|[^\s<>"'`)\]}\\]*auth_success_gemini)[^\s<>"'`)\]}\\]*/gu;
const GEMINI_VERIFICATION_PROMPT =
  /Verification required\. Please complete verification in your browser\b|Please verify your account in your browser to continue\b|Verify your account to continue\./u;
const GEMINI_VERIFICATION_REQUIRED_ANSWER = /^\s*(?:\u26A0\uFE0F?\s*)?Verification Required\b/u;
const GEMINI_VERIFICATION_PROMPT_ANSWER = new RegExp(
  `^\\s*(?:\\u26A0\\uFE0F?\\s*)?(?:${GEMINI_VERIFICATION_PROMPT.source})`,
  "u",
);
const GEMINI_VERIFICATION_REQUIRED = new RegExp(
  `${GEMINI_VERIFICATION_REQUIRED_ANSWER.source}|${GEMINI_VERIFICATION_PROMPT.source}|\\bVALIDATION_REQUIRED\\b`,
  "u",
);
const GEMINI_WARNING_ANSWER = /^\n\u26A0 /u;
const GEMINI_RETRY_NOTICE = /^\n?⚠ API error \(attempt (\d+)\): /u;
const GEMINI_FAILURE_ANSWER = new RegExp(
  `${GEMINI_EXECUTION_ERROR_ANSWER.source}|${GEMINI_CONNECTION_LOST_ANSWER.source}|${GEMINI_VERIFICATION_ANSWER.source}|${GEMINI_WARNING_ANSWER.source}|${GEMINI_VERIFICATION_PROMPT_ANSWER.source}`,
  "u",
);

function geminiAccountLink(text: string): string | null {
  return GEMINI_ACCOUNT_LINK.exec(text)?.[0].replace(/[.,;:]+$/u, "") ?? null;
}
const GEMINI_EMPTY_OUTPUT_FAILURE =
  /\bmodel output must contain either output text or tool calls, these cannot both be empty\b|\bModel produced invalid output\b/iu;
const GEMINI_TEXT_TOOL_CALL = {
  starts: ["```tool_code", "call:default_api:", "print(default_api."],
  whole:
    /^\s*(?:```tool_code\s*)?(?:call:default_api:[\w-]+\s*\{[\s\S]*\}|print\(default_api\.[\w-]+\([\s\S]*\)\))\s*(?:```\s*)?$/u,
};

const GEMINI_MCP_LOAD_FAILURES = [
  /^\s*(?:\u26A0 )?The MCP server '([A-Za-z0-9_-]+)' failed to initialize(?:: ([\s\S]*?))?\.? Fix the MCP server\b/u,
  /\bMCP load failed for ([A-Za-z0-9_-]+): ([\s\S]*)$/u,
] as const;

function geminiMcpLoadFailure(text: string): { name: string; reason: string } | null {
  for (const pattern of GEMINI_MCP_LOAD_FAILURES) {
    const match = pattern.exec(text);
    if (match?.[1])
      return {
        name: match[1],
        reason: (match[2] || match[0].replace(/\s*Fix the MCP server\b.*$/su, "")).replace(/\s+/gu, " ").trim(),
      };
  }
  return null;
}

const GEMINI_NETWORK_FAILURE =
  /\bconnection reset by peer\b|\bunexpected EOF\b|\bforcibly closed by the remote host\b/u;

const GEMINI_REQUEST_FAILURES = [
  ["error.provider.antigravityLocationUnsupported", /\bUser location is not supported\b/iu],
  [
    "error.provider.antigravityModelAtCapacity",
    /\bMODEL_CAPACITY_EX(?:HAUSTED|CEEDED)\b|\b[Nn]o capacity available for model\b/u,
  ],
  ["error.provider.antigravityQuotaReached", /\bquota\b.{0,40}\breached\b/iu],
  ["error.provider.antigravityRateLimited", /\bRESOURCE_EXHAUSTED\b/u],
  [
    "error.provider.antigravityRateLimited",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}429\b|\bresource has been exhausted\b|\brate[ _-]?limit|\btoo many requests\b|\bquota\b.{0,40}\b(?:exceeded|exhausted)\b/iu,
  ],
  [
    "error.provider.antigravityModelUnavailable",
    /\bmodel\b.{0,60}\b(?:not found|not supported|does not exist|is unavailable|retired|is no longer (?:available|supported))\b|\bunknown model\b|\bmodels\/\S+ is not found\b|\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}410\b/iu,
  ],
  ["error.provider.antigravityServiceFailure", /\b(?:UNAVAILABLE|DEADLINE_EXCEEDED)\b/u],
  [
    "error.provider.antigravityServiceFailure",
    /\b(?:status|code|HTTP(?:\/[\d.]+)?)\W{0,4}50[0-4]\b|\bservice unavailable\b|\boverloaded\b|\bdeadline exceeded\b|\binternal server error\b/iu,
  ],
  ["error.provider.antigravitySignInRefused", GEMINI_INVALID_CREDENTIALS],
  ["error.provider.antigravityRequestRejected", GEMINI_INVALID_ARGUMENT],
  ["error.provider.antigravityNetwork", GEMINI_NETWORK_FAILURE],
] as const satisfies readonly (readonly [keyof SourceMessages, RegExp])[];

type GeminiRequestFailureKey = (typeof GEMINI_REQUEST_FAILURES)[number][0];

const GEMINI_FAILURE_CAUSES: Partial<Record<GeminiRequestFailureKey, CauseCode>> = {
  "error.provider.antigravityQuotaReached": "usage_limit",
  "error.provider.antigravityRateLimited": "rate_limit",
  "error.provider.antigravityModelUnavailable": "model_not_found",
  "error.provider.antigravityNetwork": "network",
};

function geminiRequestFailureText(key: GeminiRequestFailureKey, text: string, fullText = text): string {
  if (key === "error.provider.antigravityNetwork")
    return sourceText(key, { cause: GEMINI_NETWORK_FAILURE.exec(text)?.[0] ?? "" });
  const detail = shownFailureDetail(text);
  const resets = Array.from(fullText.matchAll(GOOGLE_RESET_FIELDS), ([field]) => field).filter(
    (field) => !detail.includes(field),
  );
  return sourceText(key, { detail: resets.length > 0 ? `${detail}\n${resets.join(" ")}` : detail });
}

function geminiAnswerFailure(answer: string): { message: string; key: GeminiRequestFailureKey | null } {
  const text = answer.replace(GEMINI_WARNING_ANSWER, "");
  if (geminiAccountLink(text) !== null || GEMINI_VERIFICATION_REQUIRED.test(text))
    return { message: sourceText("error.provider.geminiVerificationRequired"), key: null };
  if (/\bAPI key not valid\b|\bAPI_KEY_INVALID\b/u.test(text))
    return { message: sourceText("error.provider.geminiKeyRefused"), key: null };
  if (GEMINI_CONNECTION_LOST_ANSWER.test(text))
    return { message: sourceText("error.provider.antigravityConnectionLost"), key: null };
  if (GEMINI_UNREADABLE_HISTORY.test(text))
    return { message: GEMINI_API_ERROR_MESSAGE.exec(text)?.[1] ?? text, key: null };
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  const logged = GEMINI_EXECUTOR_ERROR.test(text);
  if (key) {
    const shown =
      logged && key !== "error.provider.antigravityNetwork" ? (GEMINI_API_ERROR_MESSAGE.exec(text)?.[1] ?? text) : text;
    return { message: geminiRequestFailureText(key, shown, text), key };
  }
  if (logged || GEMINI_TERMINATED_ANSWER.test(text))
    return { message: sourceText("error.provider.antigravityTurnStopped"), key: null };
  return { message: shownFailureDetail(text), key };
}

const GEMINI_NOT_FOUND = /\bError 404, Message: .+?, Status: (?:NOT_FOUND|404\b)|\bNOT_FOUND \(code 404\)/u;

function geminiTurnFailureCause(answer: string, reachedModel: boolean): CauseCode | null {
  if (geminiMcpLoadFailure(answer.replace(GEMINI_WARNING_ANSWER, "")) !== null) return null;
  const { key } = geminiAnswerFailure(answer);
  if (key) return GEMINI_FAILURE_CAUSES[key] ?? null;
  return reachedModel && GEMINI_NOT_FOUND.test(answer) ? "provider_unavailable" : null;
}

const GEMINI_INTERNAL_ERROR_PREFIX = /^(?:RequestError:\s*)?Internal error:\s*/u;
const GEMINI_ZERO_LIMIT = /\blimit:\s*0(?!\d|\.\d)/u;

export function geminiSavedKeyLimitFailure(text: string, error?: unknown): string | null {
  if (error !== undefined && !(error instanceof RequestError)) return null;
  const reason = text.replace(GEMINI_WARNING_ANSWER, "").replace(GEMINI_INTERNAL_ERROR_PREFIX, "");
  if (
    geminiAccountLink(reason) !== null ||
    GEMINI_CONNECTION_LOST_ANSWER.test(reason) ||
    GEMINI_UNREADABLE_HISTORY.test(reason)
  )
    return null;
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  if (key !== "error.provider.antigravityRateLimited") return null;
  return sourceText(
    GEMINI_ZERO_LIMIT.test(reason) ? "error.provider.geminiKeyQuotaZero" : "error.provider.geminiKeyRateLimited",
    { detail: shownFailureDetail(reason) },
  );
}

function geminiRequestFailure(error: unknown, detail: string): string {
  if (!(error instanceof RequestError)) return detail;
  const reason = detail.replace(GEMINI_INTERNAL_ERROR_PREFIX, "");
  if (GEMINI_VERIFICATION_REQUIRED.test(reason)) return sourceText("error.provider.geminiVerificationRequired");
  if (GEMINI_UNREADABLE_HISTORY.test(reason)) return detail;
  const key = GEMINI_REQUEST_FAILURES.find(([, pattern]) => pattern.test(reason))?.[0];
  return key ? geminiRequestFailureText(key, reason) : detail;
}

function geminiUnexplainedFailureVerification(error: unknown, detail: string, message: string): string | null {
  const unexplained =
    error instanceof RequestError
      ? message === detail
      : message === sourceText("error.provider.antigravityTurnStopped");
  return unexplained ? sourceText("error.provider.geminiVerificationRequired") : null;
}

export function antigravityGeminiHome(env: Readonly<Record<string, string | undefined>>): string {
  return env.GEMINI_HOME?.trim() || join(homedir(), ".gemini");
}

export const GEMINI_DIR_FLAG = "--gemini-dir=";
const APP_DATA_DIR_FLAG = "--app-data-dir=";

function flagValue(argv: readonly string[], flag: string): string | undefined {
  return argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
}

function antigravityOwnMcpServerNames(cwd: string, argv: readonly string[]): string[] {
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

const GEMINI_TERMINATED_ANSWER = /^\s*(?:\u26A0 )?Agent execution terminated due to error\.?\s*$/u;
const GEMINI_EXECUTOR_ERROR = /\bagent executor error: [^\n]+/u;
const GEMINI_API_ERROR_MESSAGE = /\bError \d{3}, Message: (.+?), Status: /u;
const GEMINI_PROMPT_LOG = "Sending user message to conversation ";
const GEMINI_REFUSED_TOOL =
  /\bbuilding toolbox: tool "(mcp_[^"]+)" advertises an invalid parameter schema\b|\bUnable to submit request because `(mcp_[^`]+)` functionDeclaration\b/gu;
const GOOGLE_REFUSED_FIELD =
  /\bGenerateContentRequest\.tools\[(\d+\]\.function_declarations\[\d+)\]\.parameters((?:\.\w+(?:\[[^\]]*\])?)*): (missing field|cannot be empty|field predicate failed: \$type == Type\.\w+)/gu;
const GOOGLE_FIELD_TYPE = /^field predicate failed: \$type == Type\.(\w+)$/u;
const GOOGLE_FIELD_STEP = /\.(\w+)(?:\[([^\]]*)\])?/gu;
const GEMINI_LOG_RECENT_MS = 10 * 60_000;
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

function* antigravityRecentLogs(argv: readonly string[], since: number): Generator<string> {
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const appData = flagValue(argv, APP_DATA_DIR_FLAG);
  if (!home || !appData) return;
  const folder = join(home, appData, "log");
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
    } catch {}
  }
}

function antigravityLastPromptLog(
  argv: readonly string[],
  sessionId: string,
  since = Date.now() - GEMINI_LOG_RECENT_MS,
): string | null {
  const prompt = `${GEMINI_PROMPT_LOG}${sessionId}`;
  for (const log of antigravityRecentLogs(argv, since)) {
    const at = log.lastIndexOf(prompt);
    if (at < 0) continue;
    const otherPrompt = log.indexOf(GEMINI_PROMPT_LOG, at + prompt.length);
    return log.slice(at, otherPrompt < 0 ? undefined : otherPrompt);
  }
  return null;
}

function namedRefusedMcpTools(text: string): string[] {
  return Array.from(text.matchAll(GEMINI_REFUSED_TOOL), (match) => match[1] ?? match[2] ?? "");
}

function antigravityRefusedMcpTools(text: string, argv: readonly string[], sessionId: string): string[] {
  const answered = namedRefusedMcpTools(text);
  if (answered.length > 0) return answered;
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const appData = flagValue(argv, APP_DATA_DIR_FLAG);
  if (!home || !appData) return [];
  const schemas = join(home, appData, "mcp");
  const google = googleRefusedMcpTools(text, schemas);
  if (google.length > 0 || !GEMINI_TERMINATED_ANSWER.test(text)) return google;
  const log = antigravityLastPromptLog(argv, sessionId);
  if (log === null) return [];
  const named = namedRefusedMcpTools(log);
  return named.length > 0 ? named : googleRefusedMcpTools(log, schemas);
}

function antigravityLoggedFailure(text: string, argv: readonly string[], sessionId: string): string | null {
  if (!GEMINI_TERMINATED_ANSWER.test(text)) return null;
  const causes = antigravityLastPromptLog(argv, sessionId)?.match(new RegExp(GEMINI_EXECUTOR_ERROR.source, "gu"));
  return causes?.at(-1)?.trim() ?? null;
}

const GEMINI_SILENT_FAILURE = /\bagent executor error: [^\n]+|\bError \d{3}, Message: [^\n]+/gu;

function antigravitySilentFailure(argv: readonly string[], sessionId: string, since: number): string | null {
  return antigravityLastPromptLog(argv, sessionId, since)?.match(GEMINI_SILENT_FAILURE)?.at(-1)?.trim() ?? null;
}

function antigravityAccountLink(text: string, argv: readonly string[]): string | null {
  const link = geminiAccountLink(text);
  if (link !== null || !GEMINI_VERIFICATION_REQUIRED.test(text)) return link;
  const answered = GEMINI_VERIFICATION_LINK.exec(text)?.[0].replace(/[.,;:]+$/u, "");
  if (answered) return answered;
  for (const log of antigravityRecentLogs(argv, Date.now() - GEMINI_LOG_RECENT_MS)) {
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

function hasRefusedField(parameters: unknown, path: string, reason: string): boolean {
  const steps = Array.from(path.matchAll(GOOGLE_FIELD_STEP), ([, key = "", index]) => ({
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
    return last.key !== "items" || node.type === "array" || (Array.isArray(node.type) && node.type.includes("array"));
  }
  if (type) {
    if (last.index !== undefined || !isRecord(node) || !Object.hasOwn(node, last.key)) return false;
    return node.type !== type && !(Array.isArray(node.type) && node.type.includes(type));
  }
  if (last.key === "enum" && (typeof node === "number" || typeof node === "boolean")) return true;
  return node === "" || (Array.isArray(node) && node.length === 0);
}

function googleRefusedMcpTools(log: string, folder: string): string[] {
  const refused = new Map<string, { path: string; reason: string }[]>();
  for (const [, place = "", path = "", reason = ""] of log.matchAll(GOOGLE_REFUSED_FIELD))
    refused.set(place, [...(refused.get(place) ?? []), { path, reason }]);
  if (refused.size === 0) return [];
  const tools: string[] = [];
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

const ANTIGRAVITY_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function antigravitySessionFiles(argv: readonly string[], sessionId: string): string[] {
  const home = flagValue(argv, GEMINI_DIR_FLAG);
  const appData = flagValue(argv, APP_DATA_DIR_FLAG);
  if (!home || !appData || !ANTIGRAVITY_SESSION_ID.test(sessionId)) return [];
  const root = join(home, appData);
  return [
    ...[".db", ".db-shm", ".db-wal", ".meta"].map((suffix) => join(root, "conversations", `${sessionId}${suffix}`)),
    join(root, "brain", sessionId),
    join(root, "annotations", `${sessionId}.pbtxt`),
  ];
}

export const ANTIGRAVITY_ACP_FLAVOR: AcpFlavor = {
  ownMcpServerNames: antigravityOwnMcpServerNames,
  sessionFiles: antigravitySessionFiles,
  relayStdioMcpServers: "unconfined",
  mcpToolCallLimitMs: 180_000,
  mcpListLimit: { ms: 5_000, since: "1.5.11" },
  sessionMeta: { antigravity: { disabledTools: ["schedule", "run_workflow"] } },
  approvedEditSweep: /^\s*Tool call was approved but never executed\.?\s*$/u,
  mcpCallInputNamesServer: true,
  bridgeToolsWithoutCard: true,
  sessionNotFound: (error, sessionId) => {
    if (error.code === -32603 && error.message.startsWith(`Failed to read session ${sessionId};`)) return true;
    if (error.code === -32602 && error.message === `Session not found: ${sessionId}`) return true;
    if (!isRecord(error.data)) return false;
    if (error.code === -32603) return error.data.details === `Session not found: ${sessionId}`;
    return error.code === -32002 && (error.data.sessionId === sessionId || error.data.uri === `session ${sessionId}`);
  },
  turnFailure: (error, detail) => geminiRequestFailure(error, detail),
  authRequiredSignsOut: true,
  failureCause: (error) => (error === "refusal" ? "usage_limit" : null),
  unexplainedFailureVerification: geminiUnexplainedFailureVerification,
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
    accountVerification: GEMINI_VERIFICATION_REQUIRED,
    quota: (text) => {
      const quota = GEMINI_QUOTA_CHUNK.exec(text);
      return quota
        ? sourceText("error.provider.antigravityQuotaReached", { detail: shownFailureDetail(quota[1]?.trim() ?? "") })
        : null;
    },
    mcpLoadFailure: geminiMcpLoadFailure,
    refusedMcpTools: antigravityRefusedMcpTools,
    loggedFailure: antigravityLoggedFailure,
    silentFailure: antigravitySilentFailure,
    sessionLost: GEMINI_CONNECTION_LOST_ANSWER,
  },
  cancelLocallyThenResume: true,
  steerByPromptSince: "1.5.0",
  interruptToolsOnStop: true,
  streamAnswerBeforePromptReturns: true,
  resumesAnswerAfterThought: {
    report:
      /^\s*(?:⚠️?\s*)?(?:Error: )?The stream was interrupted\. Please continue the task you were working on\.\s*$/u,
  },
  promptOpenForBackgroundTasks: true,
  silentTurnLimitMs: 15 * 60_000,
  openToolStallMs: 30 * 60_000,
  wakesAfterPromptEnds: true,
  restartNoticeOnReload: true,
  selfWakeTools: /\b(?:start|invoke)_subagent\b|^(?:Run(?:ning)? )?schedule\??$/u,
  contextCompaction: "handoff",
  closeKeepsSession: true,
  sessionProcesses: true,
  modelsLoadWithSession: true,
  keepModelsOnRefreshFailure: true,
};
