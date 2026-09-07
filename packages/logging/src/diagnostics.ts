import { type LogValue, redactText, toLogValue } from "./redaction";

/**
 * One failure, in the shape both consumers read: the bounded local log writes
 * it whole, and analytics sends the subset its allowlist admits.
 *
 * Nothing here is redacted by the caller. `recordDiagnostic` runs redaction
 * before the sink sees a record, which is what makes the "secrets stay
 * redacted on every path that logs, exports, or sends" rule structural rather
 * than something review has to notice at each of the call sites.
 */
export interface DiagnosticRecord {
  at?: string;
  code: string;
  severity?: "warn" | "error";
  /** Which part of the app failed. The logger prefix, where a logger produced it. */
  area?: string;
  /** Where in a sequence it failed - `resolve-cli` against `initialize`. */
  stage?: string;
  message?: string;
  /**
   * `local` keeps a record out of analytics because another path already
   * reports it. The agent service is the one case: its `#emitError` publishes
   * an `AgentEvent`, which `HostAnalytics.handleAgentEvent` already turns into
   * one `system_operation_failed`, so recording the same failure again would
   * count it twice.
   */
  reach?: "local" | "analytics";
  detail?: { [key: string]: LogValue };
}

export type DiagnosticSink = (record: DiagnosticRecord) => void;

// One slot, owned by the process that has somewhere to put a record. The main
// process registers it during startup; a test registers its own and disposes
// it; everywhere else `recordDiagnostic` is a no-op, so a package that records
// a diagnostic does not acquire a dependency on the main process.
let activeSink: DiagnosticSink | null = null;

export function setDiagnosticSink(sink: DiagnosticSink | null): () => void {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    if (activeSink === sink) activeSink = previous;
  };
}

export function redactDiagnostic(record: DiagnosticRecord): DiagnosticRecord {
  return {
    at: record.at ?? new Date().toISOString(),
    code: redactText(record.code),
    ...(record.severity ? { severity: record.severity } : {}),
    ...(record.area ? { area: redactText(record.area) } : {}),
    ...(record.stage ? { stage: redactText(record.stage) } : {}),
    ...(record.message === undefined ? {} : { message: redactText(record.message) }),
    ...(record.reach ? { reach: record.reach } : {}),
    ...(record.detail ? { detail: redactDetail(record.detail) } : {}),
  };
}

export function recordDiagnostic(record: DiagnosticRecord): void {
  const sink = activeSink;
  if (!sink) return;
  try {
    sink(redactDiagnostic(record));
  } catch {
    // A diagnostic must never become the failure it was reporting.
  }
}

function redactDetail(detail: { [key: string]: LogValue }): { [key: string]: LogValue } {
  const converted = toLogValue(detail);
  return isLogRecord(converted) ? converted : { detail: converted };
}

function isLogRecord(value: LogValue): value is { [key: string]: LogValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
