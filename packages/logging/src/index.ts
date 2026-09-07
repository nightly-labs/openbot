import { dummyLogger, type Logger } from "ts-log";
import { type DiagnosticRecord, recordDiagnostic } from "./diagnostics";
import { type LogValue, redactText, redactValue } from "./redaction";

export * from "./diagnostics";
export * from "./redaction";
export type { Logger };
export { dummyLogger };

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60 };
const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];
const MAX_PARAM_LENGTH = 2_000;
function formatParam(param: LogValue): string {
  if (typeof param === "string") {
    const redacted = redactText(param);
    return redacted.length > MAX_PARAM_LENGTH ? `${redacted.slice(0, MAX_PARAM_LENGTH)}…` : redacted;
  }
  const serialized = JSON.stringify(redactValue(param)) ?? String(param);
  return serialized.length > MAX_PARAM_LENGTH ? `${serialized.slice(0, MAX_PARAM_LENGTH)}…` : serialized;
}

function formatLine(level: string, prefix: string, message: LogValue, params: LogValue[]): string {
  const head = typeof message === "string" ? redactText(message) : formatParam(message);
  const tail = params.map((param) => formatParam(param)).join(" ");
  return `${new Date().toISOString()} ${level} [${prefix}]${head ? ` ${head}` : ""}${tail ? ` ${tail}` : ""}`;
}

// `info` by default, so a `debug` call added for one investigation does not
// keep writing on every user's machine. `OPENBOT_LOG_LEVEL` raises or lowers
// it without a rebuild; an unknown value is ignored rather than silencing the
// log.
/**
 * A `ts-log` `Logger` plus the one call that names its failure. A second method
 * rather than a wider `error`: the return type is an interface a dozen call
 * sites already hold as `Logger`, and widening `error` would change what every
 * one of them passes.
 */
export interface OpenBotLogger extends Logger {
  failure(code: string, message?: LogValue, ...params: LogValue[]): void;
}

export function resolveLogLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  for (const level of LOG_LEVELS) {
    if (level === raw) return level;
  }
  return fallback;
}

export function createOpenBotLogger(prefix: string, sink?: (line: string) => void, level?: LogLevel): OpenBotLogger {
  const threshold = LEVEL_RANK[level ?? resolveLogLevel(process.env.OPENBOT_LOG_LEVEL)];
  const out = sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const write = (
    logLevel: LogLevel,
    label: string,
    stream: (line: string) => void,
  ): ((message?: LogValue, ...params: LogValue[]) => void) => {
    if (LEVEL_RANK[logLevel] < threshold) return () => undefined;
    return (message?: LogValue, ...params: LogValue[]) => stream(formatLine(label, prefix, message, params));
  };
  const writeError = write("error", "ERROR", err);
  // `silent` is the one level that also silences the spine. Every other level
  // controls the text stream alone: a diagnostic is never printed, so lowering
  // the console to `warn` must not stop a failure from being recorded.
  const records = threshold <= LEVEL_RANK.error;
  return {
    trace: write("trace", "TRACE", out),
    debug: write("debug", "DEBUG", out),
    info: write("info", "INFO", out),
    warn: write("warn", "WARN", err),
    // Every `logger.error` in the repository reports itself, which is what
    // makes the bridge repo-wide without touching a call site. The prefix
    // becomes the area, so a dashboard can break the one code down by the part
    // of the app that produced it.
    error: (message?: LogValue, ...params: LogValue[]) => {
      writeError(message, ...params);
      if (records)
        recordDiagnostic({ code: "log_error", severity: "error", area: prefix, ...summarize(message, params) });
    },
    failure: (code: string, message?: LogValue, ...params: LogValue[]) => {
      writeError(message, ...params);
      if (records) recordDiagnostic({ code, severity: "error", area: prefix, ...summarize(message, params) });
    },
  };
}

// The line a reader would have seen, minus the timestamp and the prefix the
// record already carries as fields.
function summarize(message: LogValue | undefined, params: LogValue[]): Pick<DiagnosticRecord, "message"> {
  const parts = [message, ...params].flatMap((part) => (part === undefined ? [] : [formatParam(part)]));
  const text = parts.join(" ").trim();
  return text ? { message: text } : {};
}
