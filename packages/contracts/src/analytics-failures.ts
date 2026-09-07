import { AGENT_PROVIDERS, type AgentProviderId } from "./ipc-agent-status";

/**
 * The one list of failure codes the whole app agrees on.
 *
 * It replaces two lists that had drifted apart: the host process kept eleven
 * literal cases and folded everything else to `"unknown"`, and the renderer
 * kept a separate set of about sixty. A third of the codes actually in use
 * reached OpenPanel as `"unknown"`, which is the same as not reporting them.
 *
 * The point of a shared list is that `tsc` rejects an unlisted code where a
 * failure is raised, so a new code is added here first and no scan test is
 * needed to keep the two ends aligned.
 */
export const FAILURE_AREAS = [
  "agent",
  "agent-service",
  "agent-store",
  "automation",
  "browser",
  "browser-host",
  "database",
  "dynamic-island-window",
  "host-service",
  "main",
  "managed-skill-service",
  "openbot-database-schema",
  "provider",
  "renderer",
  "team",
  "team-api-server",
  "update",
  "voice-transcription-service",
  "unknown",
] as const;

export type FailureArea = (typeof FAILURE_AREAS)[number];

/** Where in a sequence a failure happened. Coarse on purpose: it groups a dashboard, it does not trace one. */
export const FAILURE_STAGES = [
  "startup",
  "provider_start",
  "provider_exit",
  "turn",
  "delivery",
  "routine",
  "persistence",
  "network",
  "update",
  "unknown",
] as const;

export type FailureStage = (typeof FAILURE_STAGES)[number];

/** The one shape a provider failure takes, generated rather than hand-listed so a fourth provider needs no edit here. */
export const PROVIDER_FAILURE_KINDS = ["start_failed", "exited", "diagnostic", "runtime_missing"] as const;

export type ProviderFailureCode = `${AgentProviderId}_${(typeof PROVIDER_FAILURE_KINDS)[number]}`;

export const PROVIDER_FAILURE_CODES: readonly ProviderFailureCode[] = AGENT_PROVIDERS.flatMap((provider) =>
  PROVIDER_FAILURE_KINDS.map((kind): ProviderFailureCode => `${provider}_${kind}`),
);

const NAMED_FAILURE_CODES = [
  // The agent service.
  "agent_event_failed",
  "agent_notification_failed",
  "context_compaction_failed",
  "context_compaction_timeout",
  "conversation_publication_failed",
  "delivery_reconciliation_pending",
  "delivery_start_failed",
  "delivery_start_unconfirmed",
  "delivery_turn_association_failed",
  "history_handoff_cleanup_failed",
  "hosted_site_marker_persistence_failed",
  "interrupt_failed",
  "mcp_safety_handoff",
  "memory_commit_failed",
  "prompt_persistence_failed",
  "provider_history_backfill_pending",
  "provider_metadata_refresh_failed",
  "routine_delivery_failed",
  "routine_delivery_recovery_failed",
  "routine_scheduler_failed",
  "server_request_failed",
  "server_response_failed",
  "turn_completion_failed",
  // Resolving and installing a provider CLI - the failures behind "OpenBot
  // could not start its included ChatGPT runtime", none of which was reported
  // anywhere before.
  "cli_candidate_discovery_failed",
  "cli_resolve_failed",
  "cli_resolved_after_failures",
  "provider_account_refresh_failed",
  "provider_connect_failed",
  "provider_message_masked",
  "provider_runtime_disk_space_failed",
  "provider_runtime_http_failed",
  "provider_runtime_integrity_failed",
  "provider_runtime_verify_failed",
  "provider_status_masked",
  // The spine reporting on itself.
  "diagnostics_throttled",
  "log_error",
  "unhandled_error",
  // The renderer.
  "auth_api_error",
  "avatar_update_failed",
  "browser_activate_failed",
  "browser_close_failed",
  "browser_open_failed",
  "browser_reload_failed",
  "cancel_failed",
  "cancelled",
  "check_failed",
  "clear_failed",
  "code_recently_sent",
  "connect_failed",
  "connection_failed",
  "create_failed",
  "delete_failed",
  "disconnect_failed",
  "display_select_failed",
  "download_failed",
  "duplicate_failed",
  "edit_failed",
  "email_delivery_failed",
  "email_delivery_not_configured",
  "email_sign_in_failed",
  "email_sign_in_start_failed",
  "hosted_site_failed",
  "identity_save_failed",
  "install_failed",
  "interrupted",
  "invalid_email",
  "invalid_sign_in_code",
  "invite_create_failed",
  "invite_revoke_failed",
  "join_failed",
  "load_failed",
  "member_remove_failed",
  "member_update_failed",
  "publish_failed",
  "rate_limited",
  "reaction_failed",
  "refresh_failed",
  "reorder_failed",
  "request_failed",
  "response_failed",
  "search_failed",
  "send_failed",
  "server_select_failed",
  "sign_in_code_expired",
  "sign_out_failed",
  "steer_failed",
  "test_failed",
  "too_many_code_attempts",
  "transcription_failed",
  "unauthorized",
  "uninstall_failed",
  "unknown",
  "unpublish_failed",
  "update_failed",
  "verification_failed",
] as const;

export type FailureCode = (typeof NAMED_FAILURE_CODES)[number] | ProviderFailureCode;

export const FAILURE_CODES: readonly FailureCode[] = [...NAMED_FAILURE_CODES, ...PROVIDER_FAILURE_CODES];

const FAILURE_CODE_SET: ReadonlySet<string> = new Set<string>(FAILURE_CODES);

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === "string" && FAILURE_CODE_SET.has(value);
}

export function isFailureArea(value: unknown): value is FailureArea {
  return FAILURE_AREAS.some((area) => area === value);
}

export function isFailureStage(value: unknown): value is FailureStage {
  return FAILURE_STAGES.some((stage) => stage === value);
}

/**
 * Whether the message that came with a failure may leave the machine.
 *
 * `local_only` is for text OpenBot did not write. A provider `diagnostic` is
 * any stderr line matching `error|failed|warning`, and a masked message is the
 * original the user was never shown - both can carry a repository path, a
 * prompt fragment or a pasted token. They are written whole to the local log
 * and reported to analytics as a code and a count.
 */
export function failureMessagePolicy(code: FailureCode): "send" | "local_only" {
  if (code.endsWith("_diagnostic") || code.endsWith("_exited")) return "local_only";
  return code === "provider_status_masked" || code === "provider_message_masked" ? "local_only" : "send";
}

export type DurationBucket = "unknown" | "lt_1s" | "lt_10s" | "lt_1m" | "lt_10m" | "gte_10m";

/** Coarse enough that a duration cannot identify one run of the app. */
export function durationBucket(ms: number): DurationBucket {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1_000) return "lt_1s";
  if (ms < 10_000) return "lt_10s";
  if (ms < 60_000) return "lt_1m";
  if (ms < 600_000) return "lt_10m";
  return "gte_10m";
}

export interface FailureThrottle {
  /** `null` suppresses the event. A number is how many suppressed hits it carries. */
  admit(key: string, at: number): number | null;
}

const THROTTLE_BURST = 3;
const THROTTLE_REFILL_MS = 60_000;
const THROTTLE_CEILING = 5;
const THROTTLE_MAX_KEYS = 100;
const THROTTLE_PROCESS_CAP = 200;

/**
 * A crash loop must cost one event, not one event per iteration.
 *
 * Suppressed hits ride the next admitted event as `repeat_count`, so nothing
 * needs a timer that could outlive the process, and the count is still honest.
 * The bucket is per process: an app that restarts re-arms it.
 */
export function createFailureThrottle(): FailureThrottle {
  const buckets = new Map<string, { tokens: number; at: number; suppressed: number }>();
  let admitted = 0;
  return {
    admit(key: string, at: number): number | null {
      if (admitted >= THROTTLE_PROCESS_CAP) return null;
      const bucket = buckets.get(key) ?? { tokens: THROTTLE_BURST, at, suppressed: 0 };
      buckets.delete(key);
      bucket.tokens = Math.min(THROTTLE_CEILING, bucket.tokens + (at - bucket.at) / THROTTLE_REFILL_MS);
      bucket.at = at;
      if (bucket.tokens < 1) {
        bucket.suppressed += 1;
        buckets.set(key, bucket);
        return null;
      }
      bucket.tokens -= 1;
      const repeated = bucket.suppressed;
      bucket.suppressed = 0;
      // Re-inserting last is the LRU order: the map's own insertion order is
      // what the eviction below reads.
      buckets.set(key, bucket);
      if (buckets.size > THROTTLE_MAX_KEYS) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      admitted += 1;
      return repeated;
    },
  };
}
