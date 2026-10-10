/**
 * Whether a provider diagnostic is about an MCP server rather than about the agent's work.
 *
 * A CLI writes its MCP subsystem's failures to the same stderr as its own. OpenCode reads the user's
 * MCP list from their own files, so OpenBot neither owns those servers nor can act on them, and a
 * server that does not start leaves the turn running with fewer tools. Two of them arrive on every
 * restart, because a server spawns per session and OpenBot opens a short session to read the model
 * list. That belongs in the log, not in an error the user is asked to read.
 *
 * OpenBot's own bridge servers carry its name, and stay visible: a failure there is a failure of
 * this app. So does a server this app configured - the user asked for it here, and the reason it
 * does not start is something only they can fix. `configuredNames` is what separates the two: a
 * server the user configured in their own provider files is still nobody's failure but theirs.
 *
 * Grok's CLI also loads the servers in `~/.claude.json`, `~/.cursor/mcp.json` and `.mcp.json`. One
 * there that asks for OAuth ends its transport with the `rmcp` worker's own sentence,
 * `worker quit with fatal: Transport channel closed, when AuthRequired(…)`, which names neither MCP
 * nor the server. The session opens without that server, and the user read the line as a "Provider
 * error" toast (#1199). The worker's sentence is matched as it stands, because no other part of a
 * provider writes it.
 */
export function isMcpSubsystemDiagnostic(message: string, configuredNames: readonly string[] = []): boolean {
  if (/openbot/i.test(message)) return false;
  if (configuredNames.some((name) => name && message.includes(name))) return false;
  return /\b(mcp|rmcp)\b|\bworker quit with (?:fatal|join error|reason):/i.test(message);
}

/**
 * Whether a provider diagnostic is about the CLI's own telemetry export rather than about the
 * agent's work.
 *
 * Grok's CLI carries an OpenTelemetry exporter that reports every failed flush on the same stderr as
 * the agent, so a computer that cannot reach its collector - one offline, behind a proxy, or with
 * that host blocked - writes `BatchSpanProcessor.ExporterError` while the turn runs correctly. The
 * user met it as a "Provider error" toast on switching a chat to Grok, with nothing failing and
 * nothing to do about it. No turn, model switch, or sign-in reads that export, so it belongs in the
 * log.
 *
 * Only the exporter's own subsystem names count. A message that names OpenBot, or a network failure
 * that does not name telemetry, is the provider's work and stays visible.
 */
export function isTelemetryExportDiagnostic(message: string): boolean {
  if (/openbot/i.test(message)) return false;
  return /\b(?:batch(?:span|log|logrecord)processor|(?:span|log|logrecord|metric)exporter|opentelemetry|otlp|otel)\b/i.test(
    message,
  );
}

/** What OpenBot keeps of one echo: the method and the error text, never the request body. */
export interface AcpRequestEcho {
  method: string | null;
  error: string | null;
}

/**
 * Reads the ACP SDK's copy of an error that the agent also sent back, one stderr record at a time.
 *
 * An agent built on the TypeScript ACP SDK, such as Cline's CLI, writes `Error handling request`
 * with the request and its error to stderr each time it answers a request with an error. The same
 * error reaches OpenBot as the reply, and the call that waits for it reports it. A signed-out Cline
 * answers the model-list session with "Authentication required", and the user met the copy as a
 * "Provider error" toast just after the download. It belongs in the log.
 *
 * The SDK prints both objects over several lines, which reach OpenBot as one record each, so the
 * reader follows the brackets to the end of the error object. Call it with every record, before any
 * other filter: a line inside the echo, such as `message: "Internal error",`, reads as an error of
 * its own. It returns the echo when its last line arrives, `null` while one is still open, and
 * `undefined` for a record that is not part of one. The request body holds the MCP servers with
 * their headers and environment, redacted one line at a time without the key above each line, so
 * only the method and the error text are kept. A request with many MCP servers takes many lines, so
 * the echo has no line limit: it ends when its brackets close, or when the next echo starts. Only a
 * request counts: a notification has no reply, so `Error handling notification` stays visible.
 */
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
    // The request object comes first and holds the method; the error object follows it.
    const field = /^(method|message):\s*"(.*)",?$/.exec(record);
    if (field?.[1] === "method" && method === null) method = field[2] ?? null;
    if (field?.[1] === "message" && method !== null) error = field[2] ?? null;
    depth += bracketBalance(record);
    if (depth > 0) return null;
    open = false;
    return { method, error };
  };
}

/** Opening minus closing brackets in one line, outside double-quoted strings. */
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

/**
 * Whether a provider diagnostic reports one failed tool call rather than a failure of the provider.
 *
 * Grok's CLI logs `tool_error: tool_output_error` on stderr each time a tool returns an error, such
 * as a browser click whose target is gone. The agent already reads that error as the tool's result
 * and can try again, and the chat marks the step as failed. The user met it as a "Provider error"
 * toast during an embedded-browser click, with nothing to do about it. It belongs in the log.
 *
 * Codex logs a cancelled dynamic tool call when a turn stops before its reply. The turn's
 * interrupted state is the user feedback; this record does not mean the provider failed.
 *
 * Antigravity logs failed MCP calls as `error executing cascade step: CORTEX_STEP_TYPE_MCP_TOOL:`,
 * followed by the tool's error (`Error: …` or `calling "tools/call": Error: …`) or its own call
 * timeout. These records describe one tool call, which the agent reads as the tool's result (#1524).
 * Other MCP step failures, such as a server that does not connect, and other cascade steps stay visible.
 */
export function isToolCallDiagnostic(message: string): boolean {
  return (
    /\bcodex_core:[^\r\n]*\brouter:\s*error=dynamic tool call was cancelled before receiving a response\s*$/.test(
      message,
    ) ||
    /\btool_error:\s*(?:tool_output_error|execution_failure|parse_failure)\b/.test(message) ||
    /\berror executing cascade step:\s*CORTEX_STEP_TYPE_MCP_TOOL:\s*(?:calling "tools\/call":\s*)?Error:/.test(
      message,
    ) ||
    /\berror executing cascade step:\s*CORTEX_STEP_TYPE_MCP_TOOL:\s*MCP tool call to server "[^"]+" timed out\b/.test(
      message,
    )
  );
}

/**
 * Whether a provider diagnostic reports a background refresh that the CLI retries by itself.
 *
 * Codex refreshes its model list and its remote settings on a timer, and logs each failed attempt
 * on stderr. A computer that wakes without internet access writes one line per attempt, and the user
 * met them as a stack of "Provider error" toasts to close one by one (#717). No turn reads either
 * refresh: OpenBot reads the model catalogue itself and reports that failure where it happens.
 *
 * Only these two refreshes count. Any other failure, a network failure included, stays visible.
 */
export function isBackgroundRefreshDiagnostic(message: string): boolean {
  if (/openbot/i.test(message)) return false;
  return /\bcodex_models_manager\b.*\bfailed to refresh available models\b|\bSettings fetch failed\b/.test(message);
}

/**
 * Whether a provider diagnostic is the ACP SDK's own copy of an error that the agent also answered.
 *
 * The TypeScript ACP SDK that a Node agent is built on writes `Error handling request`, the whole
 * request and the error to stderr each time a handler fails, and then sends the same error as the
 * JSON-RPC answer. OpenBot reports that answer where the request was made: a failed prompt in the
 * chat. The stderr copy reached the user as an `Error handling request {` toast, with nothing to act
 * on and the request's own fields in it (#1193). Newer SDKs write `Error handling notification` for a
 * notification, which has no answer and no action for the user either.
 */
export function isAcpHandlerDiagnostic(message: string): boolean {
  return /^Error handling (?:request|notification)\b/.test(message);
}

const IGNORED_CONFIG_SUMMARY = /\bCodex is ignoring (\d+) unrecognized configuration settings?\b/;

/**
 * Whether a provider diagnostic is Codex's summary of the settings it ignored in its configuration.
 *
 * Codex writes this at `ERROR` level when a configuration layer holds a key it does not know: a
 * typo, a removed setting, or a key that a newer Codex wrote into the shared `~/.codex/config.toml`.
 * The keys are on the indented lines after the summary, which reach OpenBot as records of their
 * own, so the user read only the summary as a "Provider error", once per reconnect, with no key to
 * fix (#997). Codex starts and works either way. The same text arrives as a `configWarning`
 * notification, which names the keys and is reported from there, so this copy belongs in the log.
 */
export function isIgnoredConfigDiagnostic(message: string): boolean {
  return IGNORED_CONFIG_SUMMARY.test(message);
}

/**
 * What a Codex `configWarning` summary names as ignored, or `null` for any other warning.
 *
 * `count` is the total from the first line. Codex names up to three of them, one per line, as
 * ``  user (/path/config.toml): `tools.x` is ignored.``, and adds "... and N more" for the rest.
 * Only the keys are kept: the layer label carries a path, which the renderer does not show.
 */
export function ignoredCodexSettings(summary: string): { count: number; keys: string[] } | null {
  const count = IGNORED_CONFIG_SUMMARY.exec(summary)?.[1];
  if (!count) return null;
  const keys = [...summary.matchAll(/`([^`\n]+)` is ignored\./g)].flatMap((match) => (match[1] ? [match[1]] : []));
  return { count: Number(count), keys: [...new Set(keys)] };
}

/**
 * A glog record whose own severity is info or warning, as in
 * `W0927 21:23:15.702056 14876 step_string_converters.go:923] Checkpoint summary was too long…`.
 *
 * The Antigravity ACP server relays each line of its Go harness's stderr as
 * `local_connection.py:578] harness stderr: <line>`, and the harness writes its lines with the
 * glog notice `ERROR: logging before google.Init:` in front. That notice is about glog's start, not
 * about the record, but its word `ERROR` let every info and warning line through as a "Provider
 * error" toast, one per step (#980). The severity letter of the relayed record decides instead.
 *
 * Only a record that opens with a glog header counts. An `E` or `F` record, or relayed text that is
 * not a glog record - a Go panic included - stays visible.
 */
const GLOG_RECORD =
  /^(?:.*\bharness stderr:\s*|(?!.*\bharness stderr:))(?:ERROR: logging before (?:google\.Init|flag\.Parse):\s*)?([IWEF])\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+[^\s\]]+:\d+\]/su;

export function isGlogBelowErrorDiagnostic(message: string): boolean {
  const severity = GLOG_RECORD.exec(message)?.[1];
  return severity === "I" || severity === "W";
}

/**
 * The timestamp a CLI's log formatter writes before a record, as in
 * `2026-09-23T06:57:23.278161Z ERROR …`. It is removed from what the renderer shows: it is not
 * something to act on, and it makes every repeat of one failure a new message.
 */
export const LOG_TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+/;

/**
 * Whether a provider says that the account's paid usage is exhausted.
 *
 * This is narrower than an HTTP status check. A 429 can be a short request-rate throttle, and a
 * 402 can describe a subscription problem that the usage notice cannot explain. The explicit
 * balance, credit and quota phrases below mean the provider's usage reading is the useful report.
 */
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

/**
 * Whether a provider says that a plan window is spent, a limit that resets by itself: "You've hit
 * your session limit · resets 8:40pm", "You've hit your usage limit. Try again at 10:34 AM.",
 * "You've reached your weekly usage limit for your plan. Your limit resets at …". A
 * spent credit balance or quota does not reset, so it is not one: holding work for it would wait
 * forever and hide the provider's reason. A short request-rate throttle says "rate limit".
 */
export function isPlanLimitDiagnostic(message: string): boolean {
  if (isBalanceDiagnostic(message)) return false;
  return (
    /\bhit your (?:(?:session|weekly|usage|plan|opus|sonnet) )*limit\b/iu.test(message) ||
    /\b(?:session|weekly) (?:usage )?limit\b.{0,80}\b(?:reached|resets?)\b/iu.test(message)
  );
}

/** Whether a provider's text names money or a quota, which no wait gives back. */
export function isBalanceDiagnostic(message: string): boolean {
  return /\b(?:credits?|balance|quota|billing)\b/iu.test(message);
}
