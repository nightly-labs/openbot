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
 */
export function isMcpSubsystemDiagnostic(message: string, configuredNames: readonly string[] = []): boolean {
  if (/openbot/i.test(message)) return false;
  if (configuredNames.some((name) => name && message.includes(name))) return false;
  return /\b(mcp|rmcp)\b/i.test(message);
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

/**
 * Whether a provider diagnostic reports one failed tool call rather than a failure of the provider.
 *
 * Grok's CLI logs `tool_error: tool_output_error` on stderr each time a tool returns an error, such
 * as a browser click whose target is gone. The agent already reads that error as the tool's result
 * and can try again, and the chat marks the step as failed. The user met it as a "Provider error"
 * toast during an embedded-browser click, with nothing to do about it. It belongs in the log.
 *
 * Only Grok's per-call kinds count. Any other failure, the provider's own included, stays visible.
 */
export function isToolCallDiagnostic(message: string): boolean {
  return /\btool_error:\s*(?:tool_output_error|execution_failure|parse_failure)\b/.test(message);
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
    /\bbilling hard limit (?:has been )?reached\b/iu.test(message)
  );
}
