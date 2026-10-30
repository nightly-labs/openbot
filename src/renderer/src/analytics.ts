import { isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
} from "@openbot/contracts/billing";
import { HOSTED_SERVER_ENTRY_POINTS, type HostedServerEntryPoint } from "@openbot/contracts/hosted-servers";
import {
  AGENT_PROVIDERS,
  AGENT_REASONING_EFFORTS,
  type AgentModelId,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AppInfo,
  type CentralAuthUser,
  isAgentModel,
  SPEECH_VOICES,
  type SpeechVoice,
  WORKFLOW_NODE_KINDS,
  type WorkflowNodeKind,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isFunction, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import { OpenPanelBase, type OpenPanelOptions } from "@openpanel/web";
import { ANALYTICS_SCHEMA_VERSION, configureDesktopReports, configureErrorReports } from "./error-reports";
import { MARKETPLACE_PLUGINS } from "./features/settings/marketplace-plugin-catalog";

const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
const MAX_PENDING_EVENTS = 100;
const CURATED_LISTING_PATTERN = /^openbot-curated-(?:skill|agent)-([a-z0-9][a-z0-9-]{0,63})$/u;
const PLUGIN_SLUGS = new Set(MARKETPLACE_PLUGINS.map((plugin) => plugin.slug));

type ServerKind = "local" | "remote" | "unknown";
type AnalyticsResult = "succeeded" | "failed";
/** For a step that the user can stop before it ends. */
type AnalyticsOutcome = AnalyticsResult | "cancelled";
/** Where the words are heard: a model on this computer, or a cloud model. */
type TranscriptionKind = "local" | "cloud" | "server";

interface AgentAnalyticsProperties {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoning_effort: AgentReasoningEffort;
  server_kind: ServerKind;
}

const WORKFLOW_ACTIONS = [
  "create",
  "rename",
  "delete",
  "run",
  "run_step",
  "stop_step",
  "stop_run",
  "retry_step",
  "approve",
  "reject",
  "restore_version",
  "rotate_webhook_secret",
] as const;
export type WorkflowAnalyticsAction = (typeof WORKFLOW_ACTIONS)[number];

interface DesktopAnalyticsEvents {
  desktop_app_opened: { setup_completed: boolean; signed_in: boolean };
  app_updated: { from_version: string; to_version: string };
  account_sign_in_started: { result: "code_sent" | "failed"; failure_code?: string };
  account_sign_in_completed: { result: AnalyticsResult; failure_code?: string };
  account_sign_out: { result: AnalyticsResult; failure_code?: string };
  onboarding_completed: { preferred_provider: AgentProviderId; path?: OnboardingPath; skipped?: boolean };
  onboarding_step: { step: OnboardingStep; action: "viewed" | "next" | "back" | "skipped"; path?: OnboardingPath };
  agent_action:
    | ({ action: "create" } & Partial<AgentAnalyticsProperties> & {
          result: AnalyticsResult;
          failure_code?: string;
        })
    | (Partial<AgentAnalyticsProperties> & {
        action: "update";
        changed_fields: string[];
        result: AnalyticsResult;
        failure_code?: string;
      })
    | (Partial<AgentAnalyticsProperties> & {
        action: "delete" | "duplicate";
        result: AnalyticsResult;
        failure_code?: string;
      });
  message_send: Partial<AgentAnalyticsProperties> & {
    channel: "agent" | "direct";
    attachment_count: number;
    attachment_kinds?: AttachmentKind[];
    is_reply: boolean;
    result: AnalyticsResult;
    delivery_count?: number;
    failure_code?: string;
  };
  agent_input_action: {
    kind: "prompt" | "approval";
    decision: "answered" | "accept" | "decline";
    result: AnalyticsResult;
    failure_code?: string;
  };
  queue_action: {
    action: "cancel" | "steer" | "edit" | "reorder" | "interrupt";
    result: AnalyticsResult;
    failure_code?: string;
  };
  routine_action: {
    action: "create" | "update" | "delete" | "test";
    trigger_type: string;
    duration_ms: number;
    result: AnalyticsResult;
    failure_code?: string;
  };
  workflow_action: {
    action: WorkflowAnalyticsAction;
    /** Only on `run_step`: the kind of the node that runs alone. */
    node_kind?: WorkflowNodeKind;
    duration_ms: number;
    result: AnalyticsResult;
    failure_code?: string;
  };
  team_action: {
    action:
      | "server_selected"
      | "server_joined"
      | "server_left"
      | "server_removed"
      | "identity_saved"
      | "published"
      | "unpublished"
      | "invite_created"
      | "member_updated"
      | "member_removed"
      | "invite_revoked"
      | "mcp_server_saved"
      | "mcp_server_removed"
      | "mcp_server_toggled"
      | "mcp_server_tested"
      | "invite_link_copied"
      | "invite_qr_shown";
    result: AnalyticsResult;
    server_kind?: ServerKind;
    role?: "admin" | "member";
    email_bound?: boolean;
    entry_point?: "in_app" | "invite_deep_link";
    failure_code?: string;
  };
  browser_action: {
    action: "open" | "activate" | "reload" | "close";
    result: AnalyticsResult;
    failure_code?: string;
  };
  search_action: {
    scope: "global" | "agent";
    result: AnalyticsResult;
    result_count?: number;
    failure_code?: string;
  };
  remote_desktop_action: {
    action: "connect" | "disconnect" | "select_display";
    result: AnalyticsResult;
    transport?: "unknown" | "p2p" | "relay";
    failure_code?: string;
  };
  update_action: {
    action: "check" | "download" | "install";
    result: AnalyticsResult;
    phase?: string;
    failure_code?: string;
  };
  marketplace_action: {
    entity: "skill" | "agent" | "plugin";
    action: "view" | "install" | "update" | "uninstall" | "publish" | "enable" | "disable";
    result: AnalyticsResult;
    failure_code?: string;
    /** A listing id or plugin slug. Only OpenBot's own curated listings and plugins are sent. */
    listing_slug?: string;
  };
  memory_action: {
    action: "create" | "update" | "delete" | "clear";
    result: AnalyticsResult;
    failure_code?: string;
  };
  provider_action: {
    provider?: AgentProviderId;
    action:
      | "connect_started"
      | "connect_completed"
      | "refresh"
      | "download_started"
      | "download_completed"
      | "download_cancelled"
      | "cli_update_started"
      | "cli_update_completed"
      | "sign_in_cancelled"
      | "api_key_saved"
      | "custom_provider_saved"
      | "custom_provider_removed";
    result: AnalyticsOutcome;
    method?: "browser" | "code" | "api_key";
    failure_code?: string;
  };
  voice_transcription: {
    result: AnalyticsResult;
    audio_duration_seconds: number;
    duration_ms: number;
    failure_code?: string;
  };
  voice_conversation_action: {
    action: "start" | "end" | "interrupt" | "mute" | "unmute";
    server_kind: ServerKind;
    result: AnalyticsResult;
    /** For `interrupt`: the Stop button, or the user's voice over the agent. */
    trigger?: "button" | "voice";
    transcription?: TranscriptionKind;
    /** For `start`: until the first listen, with the speech model download. For `end`: the whole conversation. */
    duration_ms?: number;
    turn_count?: number;
    failure_code?: string;
  };
  voice_turn: {
    server_kind: ServerKind;
    transcription: TranscriptionKind;
    result: AnalyticsResult;
    audio_duration_seconds: number;
    /** The time to transcribe the turn. */
    duration_ms?: number;
    recording_kept?: boolean;
    failure_code?: string;
  };
  speech_reply: {
    trigger: "voice_conversation" | "dictation" | "read_aloud";
    result: AnalyticsResult;
    /** False when the user or a new turn stopped the reading. */
    completed?: boolean;
    first_audio_ms?: number;
    audio_duration_seconds?: number;
    failure_code?: string;
  };
  speech_model_action: {
    action: "download";
    entry_point: "settings" | "voice_conversation";
    result: AnalyticsResult;
    duration_ms: number;
    failure_code?: string;
  };
  speech_settings_action: {
    action: "read_replies_on" | "read_replies_off" | "voice_changed";
    result: AnalyticsResult;
    voice?: SpeechVoice;
    failure_code?: string;
  };
  reaction_action: {
    action: "add" | "remove";
    result: AnalyticsResult;
    failure_code?: string;
  };
  hosted_site_action: {
    action: "publish" | "replace" | "delete";
    entry_point: "agent" | "settings";
    result: AnalyticsResult;
    failure_code?: string;
  };
  hosted_server_upsell: {
    action: "shown" | "see_plans" | "dismissed";
    entry_point: "routine_created" | "routines_list" | "server_offline";
  };
  hosted_server_plans_action: {
    action:
      | "viewed"
      | "currency_changed"
      | "interval_changed"
      | "plan_selected"
      | "create_failed"
      | "payment_open_failed"
      | "retried"
      | "closed"
      | "join_opened";
    entry_point?: HostedServerEntryPoint;
    plan?: BillingPlanId;
    interval?: BillingInterval;
    currency?: BillingCurrency;
    failure_code?: string;
  };
  limit_reached: {
    kind: "servers" | "members" | "license_users";
    action: "shown" | "manage_clicked" | "confirmed" | "dismissed" | "contact_clicked";
    role?: "admin" | "member";
  };
  license_action: {
    action:
      | "buy_opened"
      | "checkout_opened"
      | "users_change_requested"
      | "plan_change_requested"
      | "cancel_requested"
      | "cancel_kept"
      | "renewal_resumed"
      | "over_limit_shown";
    result?: AnalyticsOutcome;
    direction?: "up" | "down";
    failure_code?: string;
  };
  sales_contact_clicked: { entry_point: "add_server" | "license" | "members" };
  billing_return_viewed: { outcome: "completed" | "cancelled"; kind?: "plan" | "license" | "portal" };
  usage_limit_action: {
    action: "shown" | "model_switched" | "waited";
    from_provider?: AgentProviderId;
    to_provider?: AgentProviderId;
    to_model?: AgentModelId;
  };
  agent_template_action: {
    action: "published" | "updated" | "unpublished" | "link_copied" | "installed";
    result: AnalyticsResult;
    entry_point?: "deep_link" | "in_app";
    failure_code?: string;
  };
  mobile_connect_action: {
    action: "code_shown" | "link_created" | "connected" | "cancelled" | "revoked" | "link_revoked";
    result: AnalyticsResult;
    failure_code?: string;
  };
  connector_action: {
    connector: "slack" | "discord" | "telegram" | "github" | "onepassword" | "bitwarden";
    action: "connect_started" | "connected" | "disconnected" | "enabled" | "disabled";
    result: AnalyticsResult;
    failure_code?: string;
  };
  computer_use_action: { action: "permission_opened"; permission: "screen-recording" | "accessibility" };
  help_link_opened: { destination: "discord" | "feedback" | "guides" | "changelog" };
  channel_action: {
    action: "created" | "archived" | "member_added";
    result: AnalyticsResult;
    failure_code?: string;
  };
  server_transfer_action: {
    action: "export" | "import";
    result: AnalyticsOutcome;
    failure_code?: string;
  };
  usage_viewed: { scope: "agent" | "server"; range?: "7d" | "30d" | "90d" | "1y"; filtered?: boolean };
  /** Sent once, before tracking stops. A user who turns analytics on again sends nothing for it. */
  analytics_preference_changed: { enabled: false };
}

type OnboardingStep = "choose" | "plan" | "computer" | "language";
type OnboardingPath = "free" | "plan";
type AttachmentKind = "image" | "document" | "spreadsheet" | "zip" | "other";
const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["image", "document", "spreadsheet", "zip", "other"];

type AnalyticsEventName = keyof DesktopAnalyticsEvents;
export type DesktopAnalyticsProperties<Name extends AnalyticsEventName> = DesktopAnalyticsEvents[Name];
type OpenPanelClient = Pick<OpenPanelBase, "setGlobalProperties" | "track" | "identify" | "clear">;

type ClientFactory = (options: OpenPanelOptions) => OpenPanelClient;
type AnalyticsIdentity = Pick<CentralAuthUser, "id" | "email">;
type AnalyticsOperationKind = "clear" | "identify" | "track";
type AnalyticsOperation = { kind: AnalyticsOperationKind; run: () => unknown };
type AnalyticsOperationQueue = { active: boolean; operations: AnalyticsOperation[] };
export interface DesktopAnalyticsScope {
  track<Name extends AnalyticsEventName>(name: Name, properties: DesktopAnalyticsEvents[Name]): void;
}

const EVENT_PROPERTY_ALLOWLIST = {
  desktop_app_opened: ["setup_completed", "signed_in"],
  app_updated: ["from_version", "to_version"],
  account_sign_in_started: ["result", "failure_code"],
  account_sign_in_completed: ["result", "failure_code"],
  account_sign_out: ["result", "failure_code"],
  onboarding_completed: ["preferred_provider", "path", "skipped"],
  onboarding_step: ["step", "action", "path"],
  agent_action: [
    "action",
    "provider",
    "model",
    "reasoning_effort",
    "server_kind",
    "changed_fields",
    "result",
    "failure_code",
  ],
  message_send: [
    "provider",
    "model",
    "reasoning_effort",
    "server_kind",
    "channel",
    "attachment_count",
    "attachment_kinds",
    "is_reply",
    "result",
    "delivery_count",
    "failure_code",
  ],
  agent_input_action: ["kind", "decision", "result", "failure_code"],
  queue_action: ["action", "result", "failure_code"],
  routine_action: ["action", "trigger_type", "duration_ms", "result", "failure_code"],
  workflow_action: ["action", "node_kind", "duration_ms", "result", "failure_code"],
  team_action: ["action", "result", "server_kind", "role", "email_bound", "entry_point", "failure_code"],
  browser_action: ["action", "result", "failure_code"],
  search_action: ["scope", "result", "result_count", "failure_code"],
  remote_desktop_action: ["action", "result", "transport", "failure_code"],
  update_action: ["action", "result", "phase", "failure_code"],
  marketplace_action: ["entity", "action", "result", "failure_code", "listing_slug"],
  memory_action: ["action", "result", "failure_code"],
  provider_action: ["provider", "action", "result", "method", "failure_code"],
  voice_transcription: ["result", "audio_duration_seconds", "duration_ms", "failure_code"],
  voice_conversation_action: [
    "action",
    "server_kind",
    "result",
    "trigger",
    "transcription",
    "duration_ms",
    "turn_count",
    "failure_code",
  ],
  voice_turn: [
    "server_kind",
    "transcription",
    "result",
    "audio_duration_seconds",
    "duration_ms",
    "recording_kept",
    "failure_code",
  ],
  speech_reply: ["trigger", "result", "completed", "first_audio_ms", "audio_duration_seconds", "failure_code"],
  speech_model_action: ["action", "entry_point", "result", "duration_ms", "failure_code"],
  speech_settings_action: ["action", "result", "voice", "failure_code"],
  reaction_action: ["action", "result", "failure_code"],
  hosted_site_action: ["action", "entry_point", "result", "failure_code"],
  hosted_server_upsell: ["action", "entry_point"],
  hosted_server_plans_action: ["action", "entry_point", "plan", "interval", "currency", "failure_code"],
  limit_reached: ["kind", "action", "role"],
  license_action: ["action", "result", "direction", "failure_code"],
  sales_contact_clicked: ["entry_point"],
  billing_return_viewed: ["outcome", "kind"],
  usage_limit_action: ["action", "from_provider", "to_provider", "to_model"],
  agent_template_action: ["action", "result", "entry_point", "failure_code"],
  mobile_connect_action: ["action", "result", "failure_code"],
  connector_action: ["connector", "action", "result", "failure_code"],
  computer_use_action: ["action", "permission"],
  help_link_opened: ["destination"],
  channel_action: ["action", "result", "failure_code"],
  server_transfer_action: ["action", "result", "failure_code"],
  usage_viewed: ["scope", "range", "filtered"],
  analytics_preference_changed: ["enabled"],
} as const satisfies Record<AnalyticsEventName, readonly string[]>;

type AnalyticsPropertyName = (typeof EVENT_PROPERTY_ALLOWLIST)[AnalyticsEventName][number];
type AnalyticsPropertyValue = string | number | boolean | readonly string[];
type SanitizedAnalyticsProperties = Partial<Record<AnalyticsPropertyName, AnalyticsPropertyValue>>;
type PendingEvent = {
  name: AnalyticsEventName;
  properties: SanitizedAnalyticsProperties;
  profileId: string | null;
  timestamp: string;
};

const SAFE_FAILURE_CODES = new Set([
  "auth_api_error",
  "avatar_update_failed",
  "browser_activate_failed",
  "browser_close_failed",
  "browser_open_failed",
  "browser_reload_failed",
  "cancel_failed",
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
  "email_delivery_rate_limited",
  "email_sign_in_failed",
  "email_sign_in_start_failed",
  "identity_save_failed",
  "install_failed",
  "interrupt_failed",
  "invalid_email",
  "invalid_sign_in_code",
  "invite_create_failed",
  "invite_revoke_failed",
  "join_failed",
  "load_failed",
  "member_remove_failed",
  "microphone_failed",
  "no_speech",
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
  "speech_failed",
  "steer_failed",
  "too_many_code_attempts",
  "transcription_failed",
  "test_failed",
  "unauthorized",
  "uninstall_failed",
  "unknown",
  "unpublish_failed",
  "update_failed",
  "verification_failed",
  "hosted_site_failed",
  "cancelled",
  "interrupted",
  "mcp_server_test_failed",
  "mcp_server_save_failed",
  "mcp_server_remove_failed",
  "mcp_server_toggle_failed",
  "member_limit_reached",
  "license_users_full",
  "payment_open_failed",
  "checkout_failed",
  "export_failed",
  "import_failed",
  "copy_failed",
  "revoke_failed",
  "runtime_download_failed",
  "disk_space",
  "download_http",
  "download_integrity",
  "download_size",
  "archive_invalid",
  "checksum_failed",
  "version_mismatch",
  "cli_update_failed",
  "cli_activate_failed",
  "cli_select_failed",
  "cli_signing_in",
  "provider_off",
  "download_stopped",
]);

const EVENT_ACTIONS: Partial<Record<AnalyticsEventName, readonly string[]>> = {
  agent_action: ["create", "update", "delete", "duplicate"],
  agent_input_action: ["prompt", "approval"],
  queue_action: ["cancel", "steer", "edit", "reorder", "interrupt"],
  routine_action: ["create", "update", "delete", "test"],
  workflow_action: WORKFLOW_ACTIONS,
  team_action: [
    "server_selected",
    "server_joined",
    "server_left",
    "server_removed",
    "identity_saved",
    "published",
    "unpublished",
    "invite_created",
    "member_updated",
    "member_removed",
    "invite_revoked",
    "mcp_server_saved",
    "mcp_server_removed",
    "mcp_server_toggled",
    "mcp_server_tested",
    "invite_link_copied",
    "invite_qr_shown",
  ],
  browser_action: ["open", "activate", "reload", "close"],
  remote_desktop_action: ["connect", "disconnect", "select_display"],
  update_action: ["check", "download", "install"],
  marketplace_action: ["view", "install", "update", "uninstall", "publish", "enable", "disable"],
  memory_action: ["create", "update", "delete", "clear"],
  provider_action: [
    "connect_started",
    "connect_completed",
    "refresh",
    "download_started",
    "download_completed",
    "download_cancelled",
    "cli_update_started",
    "cli_update_completed",
    "sign_in_cancelled",
    "api_key_saved",
    "custom_provider_saved",
    "custom_provider_removed",
  ],
  voice_conversation_action: ["start", "end", "interrupt", "mute", "unmute"],
  speech_model_action: ["download"],
  speech_settings_action: ["read_replies_on", "read_replies_off", "voice_changed"],
  reaction_action: ["add", "remove"],
  hosted_site_action: ["publish", "replace", "delete"],
  hosted_server_upsell: ["shown", "see_plans", "dismissed"],
  hosted_server_plans_action: [
    "viewed",
    "currency_changed",
    "interval_changed",
    "plan_selected",
    "create_failed",
    "payment_open_failed",
    "retried",
    "closed",
    "join_opened",
  ],
  limit_reached: ["shown", "manage_clicked", "confirmed", "dismissed", "contact_clicked"],
  license_action: [
    "buy_opened",
    "checkout_opened",
    "users_change_requested",
    "plan_change_requested",
    "cancel_requested",
    "cancel_kept",
    "renewal_resumed",
    "over_limit_shown",
  ],
  onboarding_step: ["viewed", "next", "back", "skipped"],
  usage_limit_action: ["shown", "model_switched", "waited"],
  agent_template_action: ["published", "updated", "unpublished", "link_copied", "installed"],
  mobile_connect_action: ["code_shown", "link_created", "connected", "cancelled", "revoked", "link_revoked"],
  connector_action: ["connect_started", "connected", "disconnected", "enabled", "disabled"],
  computer_use_action: ["permission_opened"],
  channel_action: ["created", "archived", "member_added"],
  server_transfer_action: ["export", "import"],
};

/** Enum values that differ by event. A key that is not here uses PROPERTY_ENUMS. */
const EVENT_ENUMS: Partial<Record<AnalyticsEventName, Readonly<Record<string, readonly string[]>>>> = {
  account_sign_in_started: { result: ["code_sent", "failed"] },
  agent_input_action: { kind: ["prompt", "approval"] },
  search_action: { scope: ["global", "agent"] },
  team_action: { entry_point: ["in_app", "invite_deep_link"] },
  hosted_site_action: { entry_point: ["agent", "settings"] },
  hosted_server_upsell: { entry_point: ["routine_created", "routines_list", "server_offline"] },
  speech_model_action: { entry_point: ["settings", "voice_conversation"] },
  voice_conversation_action: { trigger: ["button", "voice"] },
  hosted_server_plans_action: { entry_point: HOSTED_SERVER_ENTRY_POINTS },
  limit_reached: { kind: ["servers", "members", "license_users"] },
  sales_contact_clicked: { entry_point: ["add_server", "license", "members"] },
  billing_return_viewed: { kind: ["plan", "license", "portal"] },
  agent_template_action: { entry_point: ["deep_link", "in_app"] },
  usage_viewed: { scope: ["agent", "server"] },
  workflow_action: { node_kind: WORKFLOW_NODE_KINDS },
};

const PROPERTY_ENUMS: Readonly<Record<string, readonly string[]>> = {
  result: ["succeeded", "failed", "cancelled"],
  channel: ["agent", "direct"],
  decision: ["answered", "accept", "decline"],
  entity: ["skill", "agent", "plugin"],
  role: ["admin", "member"],
  server_kind: ["local", "remote", "unknown"],
  transport: ["unknown", "p2p", "relay"],
  transcription: ["local", "cloud", "server"],
  trigger: ["voice_conversation", "dictation", "read_aloud"],
  voice: SPEECH_VOICES,
  plan: BILLING_PLAN_IDS,
  interval: BILLING_INTERVALS,
  currency: BILLING_CURRENCIES,
  direction: ["up", "down"],
  outcome: ["completed", "cancelled"],
  step: ["choose", "plan", "computer", "language"],
  path: ["free", "plan"],
  connector: ["slack", "discord", "telegram", "github", "onepassword", "bitwarden"],
  permission: ["screen-recording", "accessibility"],
  method: ["browser", "code", "api_key"],
  destination: ["discord", "feedback", "guides", "changelog"],
  range: ["7d", "30d", "90d", "1y"],
  from_provider: AGENT_PROVIDERS,
  to_provider: AGENT_PROVIDERS,
};

const CHANGED_FIELDS = new Map<string, string>([
  ["avatar", "avatar"],
  ["avatarHue", "avatar_hue"],
  ["avatarSeed", "avatar_seed"],
  ["description", "description"],
  ["model", "model"],
  ["name", "name"],
  ["notifications", "notifications"],
  ["provider", "provider"],
  ["providerAccountId", "provider_account"],
  ["backupModels", "backup_models"],
  ["reasoningEffort", "reasoning_effort"],
  ["title", "title"],
]);

const ROUTINE_TRIGGER_TYPES = new Set([
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "interval",
  "advanced",
  "custom",
  "once",
  "webhook",
]);

const UPDATE_PHASES = new Set([
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "installing",
  "up-to-date",
  "error",
  "unsupported",
]);

function shouldEnableDesktopAnalytics(appInfo: AppInfo, productionBuild: boolean): boolean {
  return appInfo.analyticsCaptureUrl !== undefined || (productionBuild && appInfo.variant === "production");
}

function sanitizeDesktopAnalyticsEvent(
  name: AnalyticsEventName,
  properties: DesktopAnalyticsEvents[AnalyticsEventName],
): SanitizedAnalyticsProperties {
  const allowed = EVENT_PROPERTY_ALLOWLIST[name];
  // A custom agent's model id starts with the id the user gave it, so only the kind is sent.
  const customAgent = "provider" in properties && properties.provider === "acp";
  const customTarget = "to_provider" in properties && properties.to_provider === "acp";
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (value === undefined || !allowed.some((item) => item === key)) return [];
      const safeValue =
        (customAgent && key === "model") || (customTarget && key === "to_model")
          ? "custom"
          : sanitizeDesktopProperty(name, key, value);
      return safeValue === undefined ? [] : [[key, safeValue]];
    }),
  );
}

/**
 * An OpenCode custom provider puts the id the user gave it before the model, so that model is sent as
 * "custom". The main process uses the same rule.
 */
function reportedModel(value: string): string {
  const separator = value.indexOf("/");
  if (separator < 0) return value;
  // A key-only provider never puts its own id before a model id, so that prefix comes from OpenCode.
  const prefix = value.slice(0, separator);
  return isOneOf(AGENT_PROVIDERS, prefix) && !isKeyOnlyProvider(prefix) ? value : "custom";
}

function sanitizeDesktopProperty(
  name: AnalyticsEventName,
  key: string,
  value: unknown,
): AnalyticsPropertyValue | undefined {
  if (key === "failure_code") return isString(value) && SAFE_FAILURE_CODES.has(value) ? value : "unknown";
  if (key === "action") return safeEnum(value, EVENT_ACTIONS[name]);
  if (key === "provider" || key === "preferred_provider") return safeEnum(value, AGENT_PROVIDERS);
  if (key === "reasoning_effort") return safeEnum(value, AGENT_REASONING_EFFORTS);
  if (key === "model" || key === "to_model") return isAgentModel(value) ? reportedModel(value) : undefined;
  if (key === "attachment_kinds") {
    if (!Array.isArray(value)) return undefined;
    return [...new Set(value.filter((item) => safeEnum(item, ATTACHMENT_KINDS) !== undefined))];
  }
  if (key === "changed_fields") {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((item) => (isString(item) ? (CHANGED_FIELDS.get(item) ?? []) : [])).slice(0, 16);
  }
  if (key === "listing_slug") return isString(value) ? listingSlug(value) : undefined;
  if (key === "trigger_type") return isString(value) && ROUTINE_TRIGGER_TYPES.has(value) ? value : undefined;
  if (key === "phase") return isString(value) && UPDATE_PHASES.has(value) ? value : undefined;
  if (key === "from_version" || key === "to_version") {
    return isString(value) && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value) ? value : undefined;
  }
  if (key === "attachment_count") return safeInteger(value, 0, 100);
  if (key === "delivery_count") return safeInteger(value, 0, 1_000);
  if (key === "result_count") return safeInteger(value, 0, 1_000_000);
  if (key === "turn_count") return safeInteger(value, 0, 100_000);
  if (key === "first_audio_ms") return safeNumber(value, 0, 10 * 60 * 1_000);
  if (key === "duration_ms") return safeNumber(value, 0, 7 * 24 * 60 * 60 * 1_000);
  if (key === "audio_duration_seconds") return safeNumber(value, 0, 24 * 60 * 60);
  if (key === "enabled") return value === false ? value : undefined;
  if (
    [
      "setup_completed",
      "signed_in",
      "is_reply",
      "email_bound",
      "recording_kept",
      "completed",
      "skipped",
      "filtered",
    ].includes(key)
  ) {
    return isBoolean(value) ? value : undefined;
  }
  return safeEnum(value, EVENT_ENUMS[name]?.[key] ?? PROPERTY_ENUMS[key]);
}

/** The slug of a curated skill, agent or plugin. A community listing's id or slug is the author's. */
function listingSlug(value: string): string | undefined {
  if (PLUGIN_SLUGS.has(value)) return value;
  return CURATED_LISTING_PATTERN.exec(value)?.[1];
}

function safeEnum(value: unknown, allowed: readonly string[] | undefined): string | undefined {
  return isString(value) && allowed?.includes(value) ? value : undefined;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  return isNumber(value) && Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function safeNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return isNumber(value) && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

class DesktopAnalytics {
  readonly #createClient: ClientFactory;
  readonly #productionBuild: boolean;
  #client: OpenPanelClient | null = null;
  #anonymousClient: OpenPanelClient | null = null;
  #disabled = false;
  #trackingEnabled = true;
  #identity: AnalyticsIdentity | null = null;
  #pending: PendingEvent[] = [];
  readonly #clientQueue: AnalyticsOperationQueue = { active: false, operations: [] };
  readonly #anonymousQueue: AnalyticsOperationQueue = { active: false, operations: [] };

  constructor(
    createClient: ClientFactory = (options) => new OpenPanelBase(options),
    productionBuild = import.meta.env.PROD,
  ) {
    this.#createClient = createClient;
    this.#productionBuild = productionBuild;
  }

  configure(appInfo: AppInfo): boolean {
    configureDesktopReports(appInfo, this.#trackingEnabled, this.#identity);
    if (this.#client) return true;
    if (!shouldEnableDesktopAnalytics(appInfo, this.#productionBuild)) {
      this.#disabled = true;
      this.#pending = [];
      return false;
    }
    try {
      const clientOptions = {
        apiUrl: appInfo.analyticsCaptureUrl ?? OPENPANEL_API_URL,
        clientId: OPENPANEL_CLIENT_ID,
      };
      const client = this.#createClient(clientOptions);
      const anonymousClient = this.#createClient(clientOptions);
      const globalProperties = {
        __referrer: "",
        surface: "desktop",
        environment: "production",
        event_schema_version: ANALYTICS_SCHEMA_VERSION,
        app_version: appInfo.version,
        platform: appInfo.platform,
      };
      client.setGlobalProperties(globalProperties);
      anonymousClient.setGlobalProperties(globalProperties);
      this.#client = client;
      this.#anonymousClient = anonymousClient;
      if (this.#trackingEnabled && this.#identity) this.#identifyClient(this.#identity);
      if (this.#trackingEnabled) this.#flush();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Starts product analytics in the web client. It sends only from the production site, like the web
   * failure reports, and the web preference controls both.
   */
  configureWeb(options: { version: string; user: AnalyticsIdentity | null; enabled: boolean }): boolean {
    if (!this.#client && (!this.#productionBuild || window.location.origin !== "https://openbot.run")) {
      this.#disabled = true;
      this.#pending = [];
      return false;
    }
    this.setTrackingEnabled(options.enabled);
    if (!this.#client) {
      try {
        const clientOptions = { apiUrl: OPENPANEL_API_URL, clientId: OPENPANEL_CLIENT_ID };
        const client = this.#createClient(clientOptions);
        const anonymousClient = this.#createClient(clientOptions);
        const globalProperties = {
          __referrer: "",
          surface: "web",
          environment: "production",
          event_schema_version: ANALYTICS_GENERATIONS.web,
          app_version: options.version,
          platform: "web",
        };
        client.setGlobalProperties(globalProperties);
        anonymousClient.setGlobalProperties(globalProperties);
        this.#client = client;
        this.#anonymousClient = anonymousClient;
        if (this.#trackingEnabled && this.#identity) this.#identifyClient(this.#identity);
        if (this.#trackingEnabled) this.#flush();
      } catch {
        return false;
      }
    }
    this.setUser(options.user);
    return true;
  }

  setUser(user: AnalyticsIdentity | null): void {
    const previous = this.#identity;
    const normalized = user ? normalizeAnalyticsIdentity(user) : null;
    if (previous?.id === normalized?.id && previous?.email === normalized?.email) return;
    this.#identity = normalized;
    configureErrorReports(this.#trackingEnabled, normalized?.id ?? null);
    if (!this.#client || !this.#trackingEnabled) return;
    if (previous && (!normalized || previous.id !== normalized.id || previous.email !== normalized.email)) {
      if (!normalized || previous.id !== normalized.id) {
        this.#enqueue(this.#clientQueue, "clear", () => this.#client?.clear());
      }
    }
    if (normalized) this.#identifyClient(normalized);
  }

  identify(user: AnalyticsIdentity): void {
    this.setUser(user);
  }

  clear(): void {
    this.setUser(null);
  }

  /**
   * `recordOptOut` is for the user's own change from on to off: one last event records it. A value
   * loaded at start, a reverted save or another tab's change records nothing.
   */
  setTrackingEnabled(enabled: boolean, options: { recordOptOut?: boolean } = {}): void {
    if (this.#trackingEnabled === enabled) return;
    this.#trackingEnabled = enabled;
    configureErrorReports(enabled, this.#identity?.id ?? null);
    if (!enabled) {
      this.#pending = [];
      this.#clientQueue.operations = [];
      this.#anonymousQueue.operations = [];
      // The last event records the opt-out. The clear below waits for it.
      if (options.recordOptOut && !this.#disabled) {
        const profileId = this.#identity?.id ?? null;
        this.#send("analytics_preference_changed", { enabled: false }, profileId);
      }
      this.#enqueue(this.#clientQueue, "clear", () => this.#client?.clear());
      this.#enqueue(this.#anonymousQueue, "clear", () => this.#anonymousClient?.clear());
      return;
    }
    if (this.#identity) this.#identifyClient(this.#identity);
  }

  scope(): DesktopAnalyticsScope {
    const profileId = this.#identity?.id ?? null;
    return {
      track: <Name extends AnalyticsEventName>(name: Name, properties: DesktopAnalyticsEvents[Name]) => {
        this.#track(name, properties, profileId);
      },
    };
  }

  anonymousScope(): DesktopAnalyticsScope {
    return {
      track: <Name extends AnalyticsEventName>(name: Name, properties: DesktopAnalyticsEvents[Name]) => {
        this.#track(name, properties, null);
      },
    };
  }

  track<Name extends AnalyticsEventName>(name: Name, properties: DesktopAnalyticsEvents[Name]): void {
    this.#track(name, properties, this.#identity?.id ?? null);
  }

  #track<Name extends AnalyticsEventName>(
    name: Name,
    properties: DesktopAnalyticsEvents[Name],
    profileId: string | null,
  ): void {
    if (this.#disabled || !this.#trackingEnabled) return;
    const sanitized = sanitizeDesktopAnalyticsEvent(name, properties);
    if (!this.#client) {
      this.#pending.push({ name, properties: sanitized, profileId, timestamp: new Date().toISOString() });
      if (this.#pending.length > MAX_PENDING_EVENTS) this.#pending.shift();
      return;
    }
    this.#send(name, sanitized, profileId);
  }

  #send(
    name: AnalyticsEventName,
    properties: SanitizedAnalyticsProperties,
    profileId: string | null,
    timestamp?: string,
  ): void {
    const client = profileId ? this.#client : this.#anonymousClient;
    this.#enqueue(profileId ? this.#clientQueue : this.#anonymousQueue, "track", () =>
      client?.track(name, {
        ...properties,
        ...(timestamp ? { __timestamp: timestamp } : {}),
        ...(profileId ? { profileId } : {}),
      }),
    );
  }

  #flush(): void {
    const pending = this.#pending;
    this.#pending = [];
    for (const event of pending) {
      this.#send(event.name, event.properties, event.profileId, event.timestamp);
    }
  }

  #identifyClient(user: AnalyticsIdentity): void {
    this.#enqueue(this.#clientQueue, "identify", () =>
      this.#client?.identify({ profileId: user.id, email: user.email }),
    );
  }

  #enqueue(queue: AnalyticsOperationQueue, kind: AnalyticsOperationKind, run: () => unknown): void {
    const hasPendingTrack = queue.operations.some((operation) => operation.kind === "track");
    if (kind === "clear" && !hasPendingTrack) {
      queue.operations = [];
    } else if (kind === "identify" && !hasPendingTrack) {
      queue.operations = queue.operations.filter((operation) => operation.kind !== "identify");
    } else if (queue.operations.filter((operation) => operation.kind === "track").length >= MAX_PENDING_EVENTS) {
      const oldestTrack = queue.operations.findIndex((operation) => operation.kind === "track");
      if (oldestTrack >= 0) queue.operations.splice(oldestTrack, 1);
    }
    queue.operations.push({ kind, run });
    if (queue.active) return;
    queue.active = true;
    void this.#drain(queue);
  }

  async #drain(queue: AnalyticsOperationQueue): Promise<void> {
    while (queue.operations.length > 0) {
      const operation = queue.operations.shift();
      if (!operation) continue;
      try {
        const result = operation.run();
        if (isPromiseLike(result)) await result;
      } catch {
        // Analytics must never change application behavior or stop later events.
      }
    }
    queue.active = false;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isDynamicRecord(value) && isFunction(value.then);
}

function normalizeAnalyticsIdentity(user: AnalyticsIdentity): AnalyticsIdentity | null {
  const id = user.id.trim();
  const email = normalizeEmailAddress(user.email);
  return id && email ? { id, email } : null;
}

export const desktopAnalytics = new DesktopAnalytics();
