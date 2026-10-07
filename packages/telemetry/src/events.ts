import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Option, Schema } from "effect";

export const CauseCode = Schema.Literals([
  "invalid_upload_request",
  "authentication",
  "permission",
  "rate_limit",
  "usage_limit",
  "billing",
  "network",
  "timeout",
  "storage",
  "not_found",
  "conflict",
  "provider_unavailable",
  "attachment_type_unsupported",
  "attachment_too_large",
  "attachment_upload_failed",
  "cancelled",
  "unknown",
]);
export type CauseCode = typeof CauseCode.Type;
export const isCauseCode = Schema.is(CauseCode);
export const Operation = Schema.Literals([
  "turn",
  "provider",
  "attachment",
  "routine",
  "auth",
  "update",
  "agent",
  "queue",
  "browser",
  "settings",
  "team",
  "search",
  "marketplace",
  "memory",
  "voice",
  "maintenance",
  "other",
]);
export type Operation = typeof Operation.Type;
export const NotificationMetadata = Schema.Struct({
  operation: Operation,
  source: Schema.Literals(["action", "host", "provider", "upload", "auth", "update", "system"]),
  cause_code: CauseCode,
});
export type NotificationMetadata = typeof NotificationMetadata.Type;
const FailureProperties = Schema.Struct({
  ...NotificationMetadata.fields,
  area: Schema.optional(Schema.Literal("agent")),
  reasoning_effort: Schema.optional(
    Schema.Literals(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
  ),
  severity: Schema.Literals(["error", "warning"]),
  presentation: Schema.optional(Schema.Literals(["toast", "banner", "alert"])),
  failure_code: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.Literals(AGENT_PROVIDERS)),
  model: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literals(["user", "routine", "agent", "unknown"])),
});
export type FailureProperties = typeof FailureProperties.Type;
export const Report = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  profileId: Schema.NullOr(Schema.String),
  name: Schema.Literals(["system_operation_failed", "notification_shown", "client_operation_failed"]),
  surface: Schema.Literals(["desktop_host", "desktop", "web", "mobile"]),
  app_version: Schema.String,
  platform: Schema.Literals(["darwin", "win32", "linux", "web", "ios", "android"]),
  event_schema_version: Schema.Number,
  properties: FailureProperties,
});
export type Report = typeof Report.Type;
export type ReportContext = Pick<Report, "surface" | "app_version" | "platform" | "event_schema_version">;

const FAILURE_CODES = new Set([
  "unknown",
  "agent_event_failed",
  "context_compaction_failed",
  "delivery_start_failed",
  "delivery_turn_association_failed",
  "interrupt_failed",
  "memory_commit_failed",
  "provider_history_backfill_pending",
  "provider_metadata_refresh_failed",
  "routine_delivery_failed",
  "routine_delivery_recovery_failed",
  "routine_scheduler_failed",
  "server_request_failed",
  "operation_failed",
  ...AGENT_PROVIDERS.flatMap((provider) =>
    ["diagnostic", "exited", "start_failed"].map((kind) => `${provider}_${kind}`),
  ),
]);

/** Drop all free text and unrecognized properties before writing or sending. */
export function safeProperties(input: unknown): FailureProperties | null {
  const decoded = Schema.decodeUnknownOption(FailureProperties)(input);
  if (Option.isNone(decoded)) return null;
  const value = decoded.value;
  // Only public model families can cross this boundary. Custom endpoints can put private names in model ids.
  const model =
    value.provider !== "acp" && value.model
      ? /^(?:(?:openai|anthropic|google|opencode|codex|claude)\/)?(?:gpt-\d+(?:\.\d+)*(?:-(?:mini|nano|pro|codex|max|sol|astra|luna|terra|chat|latest|preview))*|o[134](?:-(?:mini|pro|preview))*|claude-(?:opus|sonnet|haiku|fable)(?:-\d+)*(?:\[1m\])?|gemini-\d+(?:\.\d+)*(?:-(?:pro|flash|lite|preview))*|big-pickle|auto)$/u.test(
          value.model,
        )
        ? value.model
        : "custom"
      : undefined;
  return {
    ...(value.area ? { area: value.area } : {}),
    ...(value.reasoning_effort ? { reasoning_effort: value.reasoning_effort } : {}),
    operation: value.operation,
    source: value.source,
    cause_code: value.cause_code,
    severity: value.severity,
    ...(value.presentation ? { presentation: value.presentation } : {}),
    ...(value.failure_code
      ? { failure_code: FAILURE_CODES.has(value.failure_code) ? value.failure_code : "unknown" }
      : {}),
    ...(value.provider ? { provider: value.provider } : {}),
    ...(model ? { model } : {}),
    ...(value.origin ? { origin: value.origin } : {}),
  };
}

export function isReportProfileId(value: string | null): boolean {
  return value === null || /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

export function safeReport(input: unknown): Report | null {
  const decoded = Schema.decodeUnknownOption(Report)(input);
  if (Option.isNone(decoded)) return null;
  const value = decoded.value;
  const properties = safeProperties(value.properties);
  if (
    !properties ||
    !/^[0-9a-f-]{36}$/u.test(value.id) ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    !/^(?:\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?|web|unknown)$/u.test(value.app_version) ||
    !isReportProfileId(value.profileId) ||
    value.event_schema_version !== (value.surface === "web" ? 1 : value.surface === "mobile" ? 2 : 7)
  )
    return null;
  return {
    id: value.id,
    timestamp: new Date(value.timestamp).toISOString(),
    profileId: value.profileId,
    name: value.name,
    surface: value.surface,
    app_version: value.app_version,
    platform: value.platform,
    event_schema_version: value.event_schema_version,
    properties,
  };
}

const STRUCTURED_CAUSES: Readonly<Record<string, CauseCode>> = {
  invalid_upload_request: "invalid_upload_request",
  usageLimitExceeded: "usage_limit",
  contextWindowExceeded: "unknown",
  unauthorized: "authentication",
  authentication_error: "authentication",
  rate_limit_exceeded: "rate_limit",
  rate_limit_error: "rate_limit",
  insufficient_quota: "billing",
  ECONNREFUSED: "network",
  ECONNRESET: "network",
  ENOTFOUND: "network",
  ETIMEDOUT: "timeout",
  ENOSPC: "storage",
  EACCES: "permission",
  ABORT_ERR: "cancelled",
};

/** Inspect locally. The result is always a fixed code, never part of the input. */
export function classifyFailure(error: unknown): CauseCode {
  const record = isDynamicRecord(error) ? error : undefined;
  for (const key of [record?.codexErrorInfo, record?.code]) {
    if (isCauseCode(key)) return key;
    if (typeof key === "string" && Object.hasOwn(STRUCTURED_CAUSES, key)) return STRUCTURED_CAUSES[key] ?? "unknown";
    if (isDynamicRecord(key) && Object.hasOwn(key, "httpConnectionFailed")) return "network";
  }
  if (isDynamicRecord(record?.error)) {
    const nested = classifyFailure(record.error);
    if (nested !== "unknown") return nested;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : record?.message;
  if (typeof message !== "string") return "unknown";
  if (/\binvalid upload request\b/iu.test(message)) return "invalid_upload_request";
  if (/\b(?:401 unauthorized|invalid_api_key|not authenticated|authentication failed)\b/iu.test(message))
    return "authentication";
  if (/\b(?:rate[ _-]?limit|too many requests)\b/iu.test(message)) return "rate_limit";
  if (/\b(?:insufficient (?:funds|balance|quota)|payment required|credits? exhausted)\b/iu.test(message))
    return "billing";
  if (/\b(?:usage limit|hit your (?:weekly |session )?limit)\b/iu.test(message)) return "usage_limit";
  if (/\b(?:timed? out|ETIMEDOUT)\b/iu.test(message)) return "timeout";
  if (/\b(?:fetch failed|failed to fetch|network request failed|ECONNRESET|ECONNREFUSED|ENOTFOUND)\b/iu.test(message))
    return "network";
  if (/\b(?:ENOSPC|SQLITE_FULL|disk full)\b/iu.test(message)) return "storage";
  if (/\b(?:EACCES|permission denied|403 forbidden)\b/iu.test(message)) return "permission";
  if (/\b(?:service unavailable|bad gateway|internal server error)\b/iu.test(message)) return "provider_unavailable";
  return "unknown";
}

export function operationForCode(code: string): Operation {
  if (/routine/u.test(code)) return "routine";
  if (/attachment|upload/u.test(code)) return "attachment";
  if (/provider|diagnostic|exited|start_failed/u.test(code)) return "provider";
  if (/turn|delivery|agent_|interrupt|compaction/u.test(code)) return "turn";
  if (/memory/u.test(code)) return "memory";
  return "other";
}
