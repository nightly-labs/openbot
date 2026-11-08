import { isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import {
  AGENT_PROVIDERS,
  AGENT_REASONING_EFFORTS,
  type AgentEvent,
  type AgentSummary,
  type CentralAuthUser,
  COMPUTER_USE_MCP_SERVER_NAME,
  type ConversationMessage,
  hostedSiteConversationEvent,
  isAgentModel,
  parseRoutineRunConversationEventItemType,
  ROUTINE_RUN_SOURCES,
  type RoutineRunConversationEventStatus,
  type UsageTokens,
  WORKFLOW_RUN_SOURCES,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isFunction, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import {
  ANALYTICS_GENERATIONS,
  type CauseCode,
  classifyFailure,
  operationForCode,
  type ReportQueue,
  safeProperties,
} from "@openbot/telemetry";
import { OpenPanelBase, type OpenPanelOptions } from "@openpanel/web";
import { Effect, Exit, Scope } from "effect";
import { parse as parseDomain } from "tldts";
import type { FailureSignal } from "../backend/agent/failure-signal";
import type { ToolUsageSignal } from "../backend/agent/thread-items";
import type { TurnTiming } from "../backend/agent/turn-lifecycle";
import type { BrowserSiteVisit } from "../backend/browser-host";
import type { TurnModelUsage } from "../backend/database/agent-usage";
import type { WorkflowRunEnd } from "../backend/workflows/workflows";
import { type AnalyticsOperationFailure, analyticsIO, analyticsSync } from "./analytics-effects";
import { PROVIDER_AUTH_KINDS, type ProviderAuthKind } from "./analytics-provider-auth";
import type { WebhookDeliveryReport } from "./host-events-service";
import { REMOTE_CONNECT_PHASES, type RemoteConnectPhase, type RemoteConnectSummary } from "./remote-connect-trace";
import { localDay, RESOURCE_ENUMS, RESOURCE_PROPERTY_NAMES, type ResourceProperties } from "./resource-summary";
import { UNCLEAN_EXIT_ENUMS, type UncleanExitProperties } from "./run-marker";
import { SERVICE_STEP_PROPERTY_NAMES, SERVICE_STEPS, START_KINDS, type StartupProperties } from "./startup-timing";

const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
// Node fetch sends no Origin, and OpenPanel answers 401 to a client with no allowed origin or
// secret. The SDK drops a 401 in silence. Send the renderer's origin, which the project allows.
const OPENPANEL_ORIGIN = "openbot-app://app";
// Provider CLI events are named `<provider>_diagnostic`, `_exited` and `_start_failed`. The list
// comes from the registry so a new provider's events keep their own name instead of collapsing to
// `unknown` the moment it ships.
const PROVIDER_EVENT_PATTERN = new RegExp(`^(?:${AGENT_PROVIDERS.join("|")})_(?:diagnostic|exited|start_failed)$`, "u");

const MAX_PENDING_EVENTS = 100;
const MAX_ACTIVE_TURNS = 1_000;
const MAX_HOSTED_SITE_OPERATIONS = 10_000;
const ACTIVE_TURN_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_TOOL_ROWS_PER_TURN = 32;
// One turn that reads a large cached context many times stays well below this.
const MAX_TURN_TOKENS = 10_000_000_000;
// Usage rows carry the time of the provider's turn start, which can precede the host event.
const TURN_USAGE_MARGIN_MS = 60 * 60 * 1_000;
/** The turn timing values and the `system_turn_completed` properties that carry them. */
const TURN_TIMING_PROPERTIES = [
  ["queueWaitMs", "queue_wait_ms"],
  ["startMs", "start_ms"],
  ["providerStartMs", "provider_start_ms"],
  ["firstOutputMs", "first_output_ms"],
] as const satisfies readonly (readonly [keyof TurnTiming, string])[];
const MAX_QUEUE_WAIT_MS = 7 * ACTIVE_TURN_TTL_MS;
/** The marks are times after the process started. A start that waits longer than a day is not one. */
const MAX_STARTUP_MS = 24 * 60 * 60_000;
/** One connection attempt has its own timeouts, so a phase that takes an hour is not one. */
const MAX_REMOTE_CONNECT_PHASE_MS = 60 * 60_000;
/** A host can stay away for a day of retries, or a hosted start can wait as long. */
const MAX_REMOTE_CONNECT_WAIT_MS = 24 * 60 * 60_000;
const REMOTE_CONNECT_PHASE_PROPERTIES = [
  ["session", "session_ms"],
  ["ticket", "ticket_ms"],
  ["bridge", "bridge_ms"],
  ["signal-socket", "signal_socket_ms"],
  ["signal", "signal_ms"],
  ["channels", "channels_ms"],
  ["auth", "auth_ms"],
  ["compatibility", "compatibility_ms"],
  ["first-request", "first_request_ms"],
] as const satisfies readonly (readonly [RemoteConnectPhase, string])[];
const REMOTE_CONNECT_ENUMS = {
  outcome: ["connected", "failed"],
  connection: ["first", "reconnect"],
  session_kind: ["new", "stored", "reused"],
  last_phase: ["start", ...REMOTE_CONNECT_PHASES],
  first_request: ["ok", "error"],
} as const;
const STARTUP_PROPERTY_NAMES = [
  "start_kind",
  "host_kind",
  "when_ready_ms",
  "window_ready_ms",
  "services_ready_ms",
  "renderer_loaded_ms",
  "workspace_ready_ms",
  "slowest_service_step",
  "slowest_service_step_ms",
  ...SERVICE_STEP_PROPERTY_NAMES,
] as const satisfies readonly (keyof StartupProperties)[];
// A turn uses its agent's model and sometimes a few more, such as a Claude subagent's model.
const MAX_TOKEN_ROWS_PER_TURN = 8;
const TOKEN_PROPERTIES = [
  ["uncachedInput", "uncached_input_tokens"],
  ["cachedInput", "cached_input_tokens"],
  ["cacheCreation", "cache_write_tokens"],
  ["output", "output_tokens"],
] as const satisfies readonly (readonly [keyof UsageTokens, string])[];
const MAX_SITE_TABS = 1_000;
const MAX_ROUTINE_RUNS = 10_000;
// A run holds at most this many nodes that run; a larger count is not sent.
const MAX_WORKFLOW_RUN_STEPS = 1_000;
/** A run can wait days for an approval, so its duration has a longer limit than a turn's. */
const MAX_WORKFLOW_RUN_MS = 30 * 24 * 60 * 60 * 1_000;
const WORKFLOW_RUN_STEP_COUNTS = [
  ["agent_step_count", ["agent"]],
  ["model_step_count", ["llm", "condition"]],
  ["approval_step_count", ["approval"]],
  ["output_step_count", ["output"]],
] as const satisfies readonly (readonly [string, readonly WorkflowRunEnd["stepKinds"][number][]])[];
const MAX_INVENTORY_ITEMS = 32;
const ANALYTICS_SCHEMA_VERSION = ANALYTICS_GENERATIONS.desktop_host;
const CURATED_AGENT_PREFIX = "openbot-curated-agent-";
const LISTING_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
/** An OpenBot version, such as `0.52.1` or `0.53.0-beta.2`. */
const APP_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.]{1,24})?$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u;
const TOOL_KINDS = [
  "command",
  "file_change",
  "file_read",
  "web_search",
  "web_fetch",
  "mcp",
  "openbot",
  "browser",
  "computer_use",
  "image_generation",
  "subagent",
  "other",
] as const;
// OpenBot's own tool servers. Every other server name is the user's, so only these and catalog
// plugins keep their tool names.
const BUILTIN_TOOL_SERVERS = new Map<string, (typeof TOOL_KINDS)[number]>([
  ["openbot", "openbot"],
  ["openbot_browser", "browser"],
  [COMPUTER_USE_MCP_SERVER_NAME, "computer_use"],
]);
const ROUTINE_TERMINAL_STATUSES = ["succeeded", "failed", "interrupted", "cancelled"] as const;
const ROUTINE_TRIGGER_TYPES = [
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
] as const;
const WEBHOOK_DELIVERY_RESULTS = [
  "started",
  "ignored",
  "duplicate",
  "gone",
  "too_large",
  "unavailable",
  "signed_out",
  "unknown_route",
  "secret_unreadable",
  "bad_signature",
  "bad_body",
  "failed",
] as const;
const WEBHOOK_IGNORED_REASONS = ["event-type", "filter", "inactive", "busy", "refused"] as const;
const WEBHOOK_DELIVERY_STATUSES = [200, 202, 400, 401, 404, 413, 429, 503] as const;
/** Signal and the host refuse larger bodies, so a larger count is not a real request. */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
/** Signal waits less than this for the host's answer. */
const MAX_WEBHOOK_HANDLE_MS = 10 * 60 * 1_000;
/** The signature check refuses a timestamp older than 5 minutes. */
const MAX_WEBHOOK_AGE_MS = 10 * 60 * 1_000;
/** A busy sender can send many requests. Analytics sends at most this many each minute. */
const MAX_WEBHOOK_DELIVERY_EVENTS_PER_MINUTE = 60;
const WEBHOOK_DELIVERY_WINDOW_MS = 60 * 1_000;

type AnalyticsIdentity = Pick<CentralAuthUser, "id" | "email">;
/**
 * Who an event is about: the signed-in account (with its email) when the user shares analytics,
 * else the install ID (with no email).
 */
type AnalyticsSubject = { id: string; email: string | null };
type AnalyticsOperationKind = "clear" | "identify" | "track";
type AnalyticsOperation = { kind: AnalyticsOperationKind; run: () => unknown };
type AnalyticsOperationQueue = { active: boolean; operations: AnalyticsOperation[] };
type HostEventName =
  | "system_turn_started"
  | "system_turn_completed"
  | "system_agent_input_requested"
  | "system_operation_failed"
  | "system_tool_used"
  | "system_token_usage"
  | "system_site_visited"
  | "system_routine_run"
  | "system_workflow_run"
  | "system_webhook_delivery"
  | "system_inventory"
  | "system_resources"
  | "system_startup"
  | "system_unclean_exit"
  | "system_remote_connect"
  | "hosted_site_action";
/**
 * Events that go only when the user links analytics to their account: the sites they visit, the
 * tools their agents use and their setup. Other events go also when it is off, with the install ID.
 */
const LINKED_ONLY_EVENTS: ReadonlySet<HostEventName> = new Set([
  "system_site_visited",
  "system_tool_used",
  "system_inventory",
]);
export type HostOpenPanelClient = Pick<OpenPanelBase, "setGlobalProperties" | "track" | "identify" | "clear">;
type ClientFactory = (options: OpenPanelOptions) => HostOpenPanelClient;

function createOpenPanelClient(options: OpenPanelOptions): HostOpenPanelClient {
  const client = new OpenPanelBase(options);
  client.api.addHeader("origin", OPENPANEL_ORIGIN);
  return client;
}

export interface HostAnalyticsOptions {
  reports?: ReportQueue;
  enabled: boolean;
  /** The OpenPanel API. Production when omitted; a dev capture server in `analytics-redaction-e2e`. */
  apiUrl?: string;
  /** True when the user shares analytics with their account. Off: events go with `installId`. */
  trackingEnabled?: boolean;
  /** The random install ID. Null: no saved ID, and events that have no account are not sent. */
  installId?: string | null;
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  resolveOwner: () => AnalyticsIdentity | null;
  resolveAgent: (agentId: string) => AgentSummary | null;
  /** How the agent's provider is paid for, read when a turn completes. */
  resolveProviderAuth?: (agent: AgentSummary) => ProviderAuthKind;
  /**
   * The provider-reported token counts of a turn by provider and model, from the usage records that
   * the Usage report reads. An empty list means the provider reported none.
   */
  resolveTurnUsage?: (agentId: string, turnId: string, since: string) => readonly TurnModelUsage[];
  /** Where the time of a finished turn went, in milliseconds. Each value is null when it is not known. */
  resolveTurnTiming?: (turnId: string) => TurnTiming | null;
  /**
   * The user's MCP servers that a provider reports under `name`: `null` when there is none, else the
   * catalog plugin slug they all share, or `slug: null` for the user's own server.
   */
  resolveMcpServer?: (name: string) => { slug: string | null } | null;
  resolveRoutineRun?: (agentId: string, routineId: string, runId: string) => AnalyticsRoutineRun | null;
  resolveInventory?: () => Effect.Effect<AnalyticsInventory, AnalyticsOperationFailure>;
  inventoryDay?: AnalyticsInventoryDayStore;
  resources?: AnalyticsResourceSource;
  /** How the previous run ended when it did not quit cleanly. Sent once, never saved for a later run. */
  uncleanExit?: UncleanExitProperties | null;
}

/** The resource summary of the last closed local day, which the resource monitor keeps. */
export interface AnalyticsResourceSource {
  /** `null` when no closed day waits to be sent. */
  previousDay(): { day: string; properties: ResourceProperties } | null;
  /** Removes that day and saves the file. Analytics calls it before the send, or to drop the day. */
  clearPreviousDay(day: string): Effect.Effect<void, AnalyticsOperationFailure>;
}

interface AnalyticsRoutineRun {
  runKind: "scheduled" | "manual";
  /** What started a manual run: a test, a script or a webhook request. */
  runSource: (typeof ROUTINE_RUN_SOURCES)[number] | null;
  triggerType: string;
}

/** Counts and closed-set names only: never a user-authored name, URL or command. */
interface AnalyticsInventory {
  agentCount: number;
  /** Agent routines with a schedule that are on. */
  enabledRoutineCount: number;
  enabledWebhookRoutineCount: number;
  /** Webhook addresses of agents, channels and workflows. */
  webhookRouteCount: number;
  workflowCount: number;
  customMcpServerCount: number;
  plugins: string[];
  curatedSkills: string[];
  curatedAgents: string[];
  localSkillCount: number;
  communitySkillCount: number;
  providers: string[];
  computerUseEnabled: boolean;
}

/** The local day of the last inventory event. `malformed` counts as sent today. */
export interface AnalyticsInventoryDayStore {
  read(): Effect.Effect<string | "missing" | "malformed", AnalyticsOperationFailure>;
  write(day: string): Effect.Effect<void, AnalyticsOperationFailure>;
}

const AGENT_PROPERTY_NAMES = ["provider", "model", "reasoning_effort", "agent_source", "agent_listing"] as const;

const HOST_ALLOWLIST = {
  system_turn_started: [...AGENT_PROPERTY_NAMES, "origin"],
  system_turn_completed: [
    ...AGENT_PROPERTY_NAMES,
    "origin",
    "status",
    "failure_code",
    "cause_code",
    "provider_auth",
    "duration_ms",
    ...TURN_TIMING_PROPERTIES.map(([, property]) => property),
    "token_usage",
    "uncached_input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "total_tokens",
  ],
  system_agent_input_requested: [
    ...AGENT_PROPERTY_NAMES,
    "origin",
    "kind",
    "prompt_count",
    "has_secret_prompt",
    "approval_kind",
  ],
  system_operation_failed: [
    "provider",
    "model",
    "reasoning_effort",
    "area",
    "failure_code",
    "cause_code",
    "severity",
    "operation",
  ],
  system_tool_used: [...AGENT_PROPERTY_NAMES, "origin", "tool_kind", "plugin", "tool", "call_count", "failed_count"],
  // `provider` and `model` name the model that used the tokens, which can differ from the agent's.
  system_token_usage: [
    "provider",
    "model",
    "agent_source",
    "agent_listing",
    "origin",
    "token_usage",
    "uncached_input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "total_tokens",
  ],
  system_site_visited: [...AGENT_PROPERTY_NAMES, "domain", "actor"],
  system_routine_run: [...AGENT_PROPERTY_NAMES, "status", "run_kind", "run_source", "trigger_type"],
  system_webhook_delivery: [
    "owner_kind",
    "format",
    "result",
    "ignored_reason",
    "status_code",
    "body_bytes",
    "handle_ms",
    "delivery_age_ms",
    "test",
    "skipped_count",
  ],
  system_workflow_run: [
    "status",
    "source",
    "duration_ms",
    "step_count",
    ...WORKFLOW_RUN_STEP_COUNTS.map(([property]) => property),
  ],
  system_inventory: [
    "agent_count",
    "enabled_routine_count",
    "enabled_webhook_routine_count",
    "webhook_route_count",
    "workflow_count",
    "custom_mcp_server_count",
    "plugins",
    "curated_skills",
    "curated_agents",
    "local_skill_count",
    "community_skill_count",
    "providers",
    "computer_use_enabled",
  ],
  system_resources: RESOURCE_PROPERTY_NAMES,
  system_startup: STARTUP_PROPERTY_NAMES,
  system_unclean_exit: [
    "phase",
    "previous_app_version",
    "uptime_class",
    "crash_dump_count",
    "slept",
    "ended_asleep",
    "os_restarted",
    "host_kind",
  ],
  system_remote_connect: [
    "outcome",
    "connection",
    "session_kind",
    "last_phase",
    "first_request",
    "session_ms",
    "ticket_ms",
    "bridge_ms",
    "signal_socket_ms",
    "signal_ms",
    "channels_ms",
    "auth_ms",
    "compatibility_ms",
    "first_request_ms",
    "total_ms",
    "wait_ms",
    "hosted_start_wait_ms",
    "failed_attempts",
  ],
  hosted_site_action: ["action", "entry_point", "result", "failure_code"],
} as const satisfies Record<HostEventName, readonly string[]>;

type HostPropertyName = (typeof HOST_ALLOWLIST)[HostEventName][number];
type HostPropertyValue = string | number | boolean | readonly string[];
type HostProperties = Partial<Record<HostPropertyName, HostPropertyValue>>;
type HostPendingEvent = { name: HostEventName; properties: HostProperties; timestamp: string };
type ToolUseRow = { kind: string; plugin?: string; tool?: string; calls: number; failed: number };
type ActiveTurn = {
  failureScope?: ReturnType<ReportQueue["scope"]>;
  agentId: string;
  properties: HostProperties;
  startedAt: number;
  startedAtTime: number;
  origin: string;
  owner: AnalyticsSubject | null;
  ownerResolutionPending: boolean;
  tools: Map<string, ToolUseRow>;
  /** The error that ended the turn, as `handleFailure` classified it. A failed turn sends it. */
  failure?: { failureCode: string; causeCode: CauseCode };
};

export class HostAnalytics {
  readonly #reports: ReportQueue | undefined;
  readonly #resolveOwner: HostAnalyticsOptions["resolveOwner"];
  readonly #resolveAgent: HostAnalyticsOptions["resolveAgent"];
  readonly #resolveProviderAuth: HostAnalyticsOptions["resolveProviderAuth"];
  readonly #resolveTurnUsage: HostAnalyticsOptions["resolveTurnUsage"];
  readonly #resolveTurnTiming: HostAnalyticsOptions["resolveTurnTiming"];
  readonly #resolveMcpServer: NonNullable<HostAnalyticsOptions["resolveMcpServer"]>;
  readonly #resolveRoutineRun: NonNullable<HostAnalyticsOptions["resolveRoutineRun"]>;
  readonly #resolveInventory: HostAnalyticsOptions["resolveInventory"];
  readonly #inventoryDayStore: HostAnalyticsOptions["inventoryDay"];
  readonly #resources: HostAnalyticsOptions["resources"];
  #uncleanExit: UncleanExitProperties | null;
  readonly #client: HostOpenPanelClient | null;
  #identifiedOwner: AnalyticsIdentity | null = null;
  #trackingEnabled: boolean;
  readonly #install: AnalyticsSubject | null;
  #bufferOwnerlessEvents = true;
  #pending: HostPendingEvent[] = [];
  readonly #activeTurns = new Map<string, ActiveTurn>();
  readonly #hostedSiteOwners = new Map<string, AnalyticsSubject | null>();
  readonly #hostedSiteTerminalOperations = new Set<string>();
  readonly #siteDomains = new Map<string, string>();
  readonly #routineRunOwners = new Map<string, AnalyticsSubject | null>();
  readonly #routineRunReports = new Set<string>();
  readonly #workflowRunReports = new Set<string>();
  #webhookWindowStart = 0;
  #webhookWindowCount = 0;
  #webhookSkipped = 0;
  /** A workflow run that began before this process is a replay after a restart, and is not sent. */
  readonly #createdAt = Date.now();
  #closed = false;
  readonly #scope = Scope.makeUnsafe();
  #inventoryDay: string | null = null;
  #inventoryCheck = false;
  #resourceCheck = false;
  readonly #operationQueue: AnalyticsOperationQueue = { active: false, operations: [] };

  constructor(options: HostAnalyticsOptions, createClient: ClientFactory = createOpenPanelClient) {
    this.#reports = options.reports;
    this.#resolveOwner = options.resolveOwner;
    this.#resolveAgent = options.resolveAgent;
    this.#resolveProviderAuth = options.resolveProviderAuth;
    this.#resolveTurnUsage = options.resolveTurnUsage;
    this.#resolveTurnTiming = options.resolveTurnTiming;
    this.#resolveMcpServer = options.resolveMcpServer ?? (() => null);
    this.#resolveRoutineRun = options.resolveRoutineRun ?? (() => null);
    this.#resolveInventory = options.resolveInventory;
    this.#inventoryDayStore = options.inventoryDay;
    this.#resources = options.resources;
    this.#uncleanExit = options.uncleanExit ?? null;
    this.#trackingEnabled = options.trackingEnabled ?? true;
    this.#install = options.installId ? { id: options.installId, email: null } : null;
    if (!options.enabled) {
      this.#client = null;
      return;
    }
    try {
      const client = createClient({ apiUrl: options.apiUrl ?? OPENPANEL_API_URL, clientId: OPENPANEL_CLIENT_ID });
      client.setGlobalProperties({
        surface: "desktop_host",
        environment: "production",
        event_schema_version: ANALYTICS_SCHEMA_VERSION,
        app_version: options.appVersion,
        platform: options.platform,
      });
      this.#client = client;
    } catch {
      this.#client = null;
    }
  }

  handleAgentEvent(event: AgentEvent): void {
    if (event.type === "conversation" && this.#client) {
      this.#handleHostedSiteConversation(event.snapshot.messages);
      this.#handleRoutineRunConversation(event.snapshot.agentId, event.snapshot.messages);
    }
    if (!this.#client && !this.#reports) return;
    switch (event.type) {
      case "conversation":
        return;
      case "turn-started": {
        this.#configureReports();
        const now = performance.now();
        this.#pruneActiveTurns(now);
        if (this.#activeTurns.has(event.turnId)) return;
        this.#makeTurnCapacity();
        const owner = this.#currentSubject();
        this.#activeTurns.set(event.turnId, {
          ...(this.#reports ? { failureScope: this.#reports.scope() } : {}),
          agentId: event.agentId,
          properties: this.#agentProperties(event.agentId),
          startedAt: now,
          startedAtTime: Date.now(),
          origin: event.origin ?? "unknown",
          owner,
          ownerResolutionPending: owner === null && this.#bufferOwnerlessEvents,
          tools: new Map(),
        });
        this.#track(
          "system_turn_started",
          {
            ...this.#agentProperties(event.agentId),
            origin: event.origin ?? "unknown",
          },
          owner,
        );
        this.#checkInventory();
        this.checkResources();
        return;
      }
      case "turn-completed": {
        const activeTurn = this.#activeTurns.get(event.turnId);
        this.#activeTurns.delete(event.turnId);
        const origin =
          event.origin && event.origin !== "unknown" ? event.origin : (activeTurn?.origin ?? event.origin ?? "unknown");
        const usage = activeTurn && this.#turnUsage(event.agentId, event.turnId, activeTurn.startedAtTime);
        this.#track(
          "system_turn_completed",
          {
            ...this.#agentProperties(event.agentId),
            origin,
            status: normalizedTurnStatus(event.status),
            // A failed turn with no failure signal sends neither code.
            ...(event.status === "failed" && activeTurn?.failure
              ? { failure_code: activeTurn.failure.failureCode, cause_code: activeTurn.failure.causeCode }
              : {}),
            ...this.#providerAuth(event.agentId),
            ...(activeTurn === undefined
              ? {}
              : {
                  duration_ms: Math.max(0, Math.round(performance.now() - activeTurn.startedAt)),
                  ...this.#turnTiming(event.turnId),
                  ...(usage ? tokenProperties(sumTokens(usage)) : {}),
                }),
          },
          activeTurn?.owner,
        );
        for (const row of activeTurn?.tools.values() ?? []) {
          this.#track(
            "system_tool_used",
            {
              ...this.#agentProperties(event.agentId),
              origin,
              tool_kind: row.kind,
              ...(row.plugin ? { plugin: row.plugin } : {}),
              ...(row.tool ? { tool: row.tool } : {}),
              call_count: row.calls,
              failed_count: row.failed,
            },
            activeTurn?.owner,
          );
        }
        if (usage) {
          const { agent_source, agent_listing } = this.#agentProperties(event.agentId);
          for (const row of usage
            .toSorted((a, b) => tokenTotal(b.tokens) - tokenTotal(a.tokens))
            .slice(0, MAX_TOKEN_ROWS_PER_TURN)) {
            this.#track(
              "system_token_usage",
              {
                provider: row.provider,
                model: row.model,
                ...(agent_source ? { agent_source } : {}),
                ...(agent_listing ? { agent_listing } : {}),
                origin,
                ...tokenProperties(row.tokens),
              },
              activeTurn?.owner,
            );
          }
        }
        return;
      }
      case "prompt":
        this.#track(
          "system_agent_input_requested",
          {
            ...this.#agentProperties(event.agentId),
            origin: this.#activeTurns.get(event.turnId)?.origin ?? "unknown",
            kind: "prompt",
            prompt_count: event.questions.length,
            has_secret_prompt: event.questions.some((question) => question.isSecret),
          },
          this.#activeTurns.get(event.turnId)?.owner,
        );
        return;
      case "approval":
        this.#track(
          "system_agent_input_requested",
          {
            ...this.#agentProperties(event.approval.agentId),
            origin: this.#activeTurns.get(event.approval.turnId)?.origin ?? "unknown",
            kind: "approval",
            approval_kind: event.approval.kind,
          },
          this.#activeTurns.get(event.approval.turnId)?.owner,
        );
        return;
      case "error":
        if (this.#reports) return;
        this.#track("system_operation_failed", {
          ...(event.agentId ? this.#agentProperties(event.agentId) : {}),
          area: "agent",
          failure_code: systemFailureCode(event.code),
          cause_code: classifyFailure(event.message),
          severity: "error",
          operation: operationForCode(event.code),
        });
        return;
      default:
        return;
    }
  }

  /** Reports go with the account when the user shares analytics, else with the install ID. */
  #configureReports(): void {
    if (!this.#reports) return;
    const subject = this.#trackingEnabled ? normalizeAnalyticsIdentity(this.#resolveOwner()) : this.#install;
    Effect.runFork(this.#reports.configure(this.#trackingEnabled || subject !== null, subject?.id ?? null));
  }

  /** One summary per main process. It waits for the owner like other events when there is none yet. */
  handleStartup(properties: StartupProperties): void {
    if (this.#closed) return;
    this.#track("system_startup", properties);
  }

  /** One connection to a remote host: phase times and counts, never the host. */
  handleRemoteConnect(summary: RemoteConnectSummary): void {
    if (this.#closed) return;
    const properties: HostProperties = {
      outcome: summary.outcome,
      connection: summary.connection,
      ...(summary.session ? { session_kind: summary.session } : {}),
      last_phase: summary.lastPhase,
      ...(summary.firstRequest ? { first_request: summary.firstRequest } : {}),
      total_ms: summary.totalMs,
      wait_ms: summary.waitMs,
      ...(summary.hostedStartWaitMs === undefined ? {} : { hosted_start_wait_ms: summary.hostedStartWaitMs }),
      failed_attempts: summary.failedAttempts,
    };
    for (const [phase, property] of REMOTE_CONNECT_PHASE_PROPERTIES) {
      const ms = summary.phases[phase];
      if (ms !== undefined) properties[property] = ms;
    }
    this.#track("system_remote_connect", properties);
  }

  /** Only the local service emits this signal. Remote clients never send host reports. */
  handleFailure(failure: FailureSignal): void {
    const candidates = [...this.#activeTurns.values()].filter((turn) => turn.agentId === failure.agentId);
    const turn = failure.turnId
      ? this.#activeTurns.get(failure.turnId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (turn && (failure.severity ?? "error") === "error") noteTurnFailure(turn, failure);
    if (!this.#reports) return;
    this.#configureReports();
    if (turn?.owner && turn.owner.id !== this.#currentSubject()?.id) return;
    const properties = turn?.properties ?? (failure.agentId ? this.#agentProperties(failure.agentId) : {});
    const provider =
      failure.provider ?? properties.provider ?? AGENT_PROVIDERS.find((id) => failure.code.startsWith(`${id}_`));
    const safe = safeProperties({
      ...properties,
      provider,
      ...(failure.model ? { model: failure.model } : {}),
      area: "agent",
      operation: operationForCode(failure.code),
      source: "host",
      severity: failure.severity ?? "error",
      failure_code: systemFailureCode(failure.code),
      cause_code: failure.causeCode,
      ...(turn ? { origin: turn.origin } : {}),
    });
    if (safe) Effect.runFork((turn?.failureScope ?? this.#reports).record("system_operation_failed", safe));
  }

  /** Counts one finished tool step. The turn's rows are sent when the turn completes. */
  handleToolUsage(usage: ToolUsageSignal): void {
    if (!this.#client || !this.#trackingEnabled) return;
    const turn = this.#activeTurns.get(usage.turnId);
    if (!turn) return;
    const row = this.#toolUseRow(usage);
    const key = `${row.kind}\u0000${row.plugin ?? ""}\u0000${row.tool ?? ""}`;
    const existing = turn.tools.get(key);
    if (!existing && turn.tools.size >= MAX_TOOL_ROWS_PER_TURN) return;
    const target = existing ?? row;
    target.calls += 1;
    if (usage.failed) target.failed += 1;
    if (!existing) turn.tools.set(key, target);
  }

  /**
   * Reports a workflow run's end: its outcome, how it began and how many nodes of each kind ran.
   * A retry can end the same run again; each outcome of a run is sent once.
   */
  handleWorkflowRun(end: WorkflowRunEnd): void {
    if (!this.#client) return;
    const startedAt = Date.parse(end.startedAt);
    if (!(startedAt >= this.#createdAt)) return;
    const reportKey = `${end.runId}:${end.status}`;
    if (this.#workflowRunReports.has(reportKey)) return;
    this.#workflowRunReports.add(reportKey);
    while (this.#workflowRunReports.size > MAX_ROUTINE_RUNS) {
      const oldest = this.#workflowRunReports.values().next();
      if (oldest.done) break;
      this.#workflowRunReports.delete(oldest.value);
    }
    this.#track("system_workflow_run", {
      status: end.status,
      source: end.source,
      duration_ms: Math.max(0, Date.parse(end.endedAt) - startedAt),
      step_count: end.stepKinds.length,
      ...Object.fromEntries(
        WORKFLOW_RUN_STEP_COUNTS.map(([property, kinds]) => [
          property,
          end.stepKinds.filter((kind) => kinds.some((item) => item === kind)).length,
        ]),
      ),
    });
  }

  /**
   * Reports one inbound webhook request: whose route it reached, what the host answered and how long
   * it took. At most 60 go each minute; the next event sent counts the requests that did not go.
   */
  handleWebhookDelivery(report: WebhookDeliveryReport): void {
    if (!this.#client) return;
    const now = Date.now();
    if (now - this.#webhookWindowStart >= WEBHOOK_DELIVERY_WINDOW_MS) {
      this.#webhookWindowStart = now;
      this.#webhookWindowCount = 0;
    }
    if (this.#webhookWindowCount >= MAX_WEBHOOK_DELIVERY_EVENTS_PER_MINUTE) {
      this.#webhookSkipped += 1;
      return;
    }
    this.#webhookWindowCount += 1;
    const skipped = this.#webhookSkipped;
    this.#webhookSkipped = 0;
    this.#track("system_webhook_delivery", {
      ...(report.ownerKind ? { owner_kind: report.ownerKind } : {}),
      format: report.format,
      result: report.result,
      ...(report.ignoredReason ? { ignored_reason: report.ignoredReason } : {}),
      status_code: report.status,
      body_bytes: report.bodyBytes,
      handle_ms: Math.round(report.handleMs),
      ...(report.ageMs === null ? {} : { delivery_age_ms: Math.round(report.ageMs) }),
      test: report.test,
      ...(skipped > 0 ? { skipped_count: skipped } : {}),
    });
  }

  /** Reports a tab that reached a new registrable domain. The hostname itself is never sent. */
  handleSiteVisit(visit: BrowserSiteVisit): void {
    if (!this.#client || !this.#trackingEnabled) return;
    const domain = analyticsDomain(visit.hostname);
    if (!domain || this.#siteDomains.get(visit.tabId) === domain) return;
    this.#siteDomains.delete(visit.tabId);
    this.#siteDomains.set(visit.tabId, domain);
    while (this.#siteDomains.size > MAX_SITE_TABS) {
      const oldest = this.#siteDomains.keys().next();
      if (oldest.done) break;
      this.#siteDomains.delete(oldest.value);
    }
    const agentProperties = visit.actor === "agent" && visit.agentId ? this.#agentProperties(visit.agentId) : {};
    this.#track("system_site_visited", { ...agentProperties, domain, actor: visit.actor });
  }

  flushPending(): void {
    this.#configureReports();
    if (!this.#client) return;
    const owner = this.#trackingEnabled ? normalizeAnalyticsIdentity(this.#resolveOwner()) : null;
    if (owner) {
      this.#bufferOwnerlessEvents = true;
      for (const activeTurn of this.#activeTurns.values()) {
        if (!activeTurn.ownerResolutionPending) continue;
        activeTurn.owner = owner;
        activeTurn.ownerResolutionPending = false;
      }
      this.#flushPendingForOwner(owner);
    }
    this.#checkInventory();
    this.checkResources();
    this.#checkUncleanExit();
  }

  /** The account signed out. Later events go with the install ID only when the user does not share analytics. */
  clear(): void {
    this.#pending = [];
    this.#bufferOwnerlessEvents = false;
    for (const activeTurn of this.#activeTurns.values()) {
      if (activeTurn.owner === null) activeTurn.ownerResolutionPending = false;
    }
    this.#identifiedOwner = null;
    if (this.#trackingEnabled) this.#enqueue("clear", () => this.#client?.clear());
    if (!this.#reports) return;
    const subject = this.#trackingEnabled ? null : this.#install;
    Effect.runFork(this.#reports.configure(this.#trackingEnabled || subject !== null, subject?.id ?? null));
  }

  setTrackingEnabled(enabled: boolean): void {
    if (this.#trackingEnabled === enabled) return;
    this.#trackingEnabled = enabled;
    this.#configureReports();
    if (!enabled) {
      this.#hostedSiteOwners.clear();
      this.#activeTurns.clear();
      this.#siteDomains.clear();
      this.#routineRunOwners.clear();
      this.#workflowRunReports.clear();
      this.clear();
      this.#operationQueue.operations = [];
      this.#enqueue("clear", () => this.#client?.clear());
      return;
    }
    this.flushPending();
  }

  #handleHostedSiteConversation(messages: readonly ConversationMessage[]): void {
    const events = messages.flatMap((message) => {
      const event = hostedSiteConversationEvent(message);
      return event ? [event] : [];
    });
    const terminalOperations = new Set(
      events.filter((event) => event.status !== "running").map((event) => event.operationId),
    );
    const observedRunningOperations = new Set(this.#hostedSiteOwners.keys());
    for (const event of events) {
      if (event.status === "running") {
        if (terminalOperations.has(event.operationId)) continue;
        const owner = this.#currentSubject();
        if (!this.#hostedSiteOwners.has(event.operationId)) this.#hostedSiteOwners.set(event.operationId, owner);
        continue;
      }
      if (!observedRunningOperations.has(event.operationId)) continue;
      if (this.#hostedSiteTerminalOperations.has(event.operationId)) continue;
      this.#hostedSiteTerminalOperations.add(event.operationId);
      const owner = this.#hostedSiteOwners.get(event.operationId) ?? null;
      this.#hostedSiteOwners.delete(event.operationId);
      if (!owner) continue;
      this.#trackForOwner(
        "hosted_site_action",
        {
          action: event.action,
          entry_point: "agent",
          result: event.status === "succeeded" ? "succeeded" : "failed",
          ...(event.status === "failed"
            ? { failure_code: "hosted_site_failed" }
            : event.status === "cancelled" || event.status === "interrupted"
              ? { failure_code: event.status }
              : {}),
        },
        owner,
        false,
      );
    }
    while (this.#hostedSiteOwners.size > MAX_HOSTED_SITE_OPERATIONS) {
      const oldest = this.#hostedSiteOwners.keys().next();
      if (oldest.done) break;
      this.#hostedSiteOwners.delete(oldest.value);
    }
    while (this.#hostedSiteTerminalOperations.size > MAX_HOSTED_SITE_OPERATIONS) {
      const oldest = this.#hostedSiteTerminalOperations.values().next();
      if (oldest.done) break;
      this.#hostedSiteTerminalOperations.delete(oldest.value);
    }
  }

  /**
   * Reports a routine run's outcome. Like hosted sites, only a run that this process saw running is
   * reported, so a history replay after a restart sends nothing. The message text is the routine
   * name and is never read.
   */
  #handleRoutineRunConversation(agentId: string, messages: readonly ConversationMessage[]): void {
    const events = messages.flatMap((message) => {
      if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return [];
      const event = parseRoutineRunConversationEventItemType(message.itemType);
      return event ? [event] : [];
    });
    const laterStatuses = new Set(events.filter((event) => event.status !== "running").map((event) => event.runId));
    const observedRunning = new Set(this.#routineRunOwners.keys());
    for (const event of events) {
      if (event.status === "running") {
        if (laterStatuses.has(event.runId) || this.#routineRunOwners.has(event.runId)) continue;
        this.#routineRunOwners.set(event.runId, this.#currentSubject());
        continue;
      }
      if (!observedRunning.has(event.runId)) continue;
      const reportKey = `${event.runId}:${event.status}`;
      if (this.#routineRunReports.has(reportKey)) continue;
      this.#routineRunReports.add(reportKey);
      const owner = this.#routineRunOwners.get(event.runId) ?? null;
      if (isRoutineRunFinished(event.status)) this.#routineRunOwners.delete(event.runId);
      if (!owner) continue;
      const run = safely(() => this.#resolveRoutineRun(agentId, event.routineId, event.runId));
      this.#trackForOwner(
        "system_routine_run",
        {
          ...this.#agentProperties(agentId),
          status: event.status,
          ...(run
            ? {
                run_kind: run.runKind,
                ...(run.runSource ? { run_source: run.runSource } : {}),
                trigger_type: run.triggerType,
              }
            : {}),
        },
        owner,
        false,
      );
    }
    while (this.#routineRunOwners.size > MAX_ROUTINE_RUNS) {
      const oldest = this.#routineRunOwners.keys().next();
      if (oldest.done) break;
      this.#routineRunOwners.delete(oldest.value);
    }
    while (this.#routineRunReports.size > MAX_ROUTINE_RUNS) {
      const oldest = this.#routineRunReports.values().next();
      if (oldest.done) break;
      this.#routineRunReports.delete(oldest.value);
    }
  }

  #toolUseRow(usage: ToolUsageSignal): ToolUseRow {
    const server = usage.server;
    if (usage.kind !== "mcp" || !server) return { kind: usage.kind, calls: 0, failed: 0 };
    // A user's server can report under a built-in name, such as `openbot browser` shown as
    // `openbot_browser`. It then stays custom, and a resolver that fails also gives custom.
    let configured: { slug: string | null } | null;
    try {
      configured = this.#resolveMcpServer(server);
    } catch {
      configured = { slug: null };
    }
    const builtinKind = configured ? undefined : BUILTIN_TOOL_SERVERS.get(server);
    const plugin = builtinKind ? "builtin" : (configured?.slug ?? "custom");
    const tool = plugin !== "custom" && usage.tool && TOOL_NAME_PATTERN.test(usage.tool) ? usage.tool : undefined;
    return { kind: builtinKind ?? "mcp", plugin, ...(tool ? { tool } : {}), calls: 0, failed: 0 };
  }

  /**
   * Sends the inventory at most once per local day. A user who shares analytics waits for sign-in,
   * so the inventory goes with their account.
   */
  #checkInventory(): void {
    const today = localDay(new Date());
    if (this.#closed || this.#inventoryDay === today || this.#inventoryCheck) return;
    const resolveInventory = this.#resolveInventory;
    const store = this.#inventoryDayStore;
    if (!this.#client || !this.#trackingEnabled || !resolveInventory || !store) return;
    if (!this.#currentSubject()) return;
    this.#inventoryCheck = true;
    Effect.runFork(
      Effect.gen({ self: this }, function* () {
        const stored = yield* store.read();
        if (stored === "malformed") {
          // A damaged file counts as sent today. It is written again, so the next day sends.
          yield* store.write(today);
          this.#inventoryDay = today;
          return;
        }
        if (stored === today) {
          this.#inventoryDay = today;
          return;
        }
        const inventory = yield* resolveInventory();
        if (this.#closed || !this.#trackingEnabled || !this.#currentSubject()) return;
        // The day is stored before the send, so a failed write sends nothing and a crash cannot send twice.
        yield* store.write(today);
        this.#inventoryDay = today;
        const owner = this.#currentSubject();
        if (!owner) return;
        this.#trackForOwner(
          "system_inventory",
          {
            agent_count: inventory.agentCount,
            enabled_routine_count: inventory.enabledRoutineCount,
            enabled_webhook_routine_count: inventory.enabledWebhookRoutineCount,
            webhook_route_count: inventory.webhookRouteCount,
            workflow_count: inventory.workflowCount,
            custom_mcp_server_count: inventory.customMcpServerCount,
            plugins: inventory.plugins,
            curated_skills: inventory.curatedSkills,
            curated_agents: inventory.curatedAgents,
            local_skill_count: inventory.localSkillCount,
            community_skill_count: inventory.communitySkillCount,
            providers: inventory.providers,
            computer_use_enabled: inventory.computerUseEnabled,
          },
          owner,
        );
      }).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            this.#inventoryCheck = false;
          }),
        ),
        Effect.uninterruptible,
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  /**
   * Sends the resource summary of the last closed day, once. A user who shares analytics waits for
   * sign-in, so the summary goes with their account.
   */
  checkResources(): void {
    const source = this.#resources;
    if (this.#closed || this.#resourceCheck || !source || !this.#client) return;
    const due = source.previousDay();
    if (!due) return;
    // A user who shares analytics waits for sign-in. Without an install ID, a day of a user who
    // does not share analytics is cleared with no send, so it never goes later with the account.
    if (!this.#currentSubject() && this.#trackingEnabled) return;
    this.#resourceCheck = true;
    Effect.runFork(
      Effect.gen({ self: this }, function* () {
        // Cleared before the send, so a failed write sends nothing and a crash cannot send twice.
        yield* source.clearPreviousDay(due.day);
        const owner = this.#currentSubject();
        if (this.#closed || !owner) return;
        this.#trackForOwner("system_resources", due.properties, owner);
      }).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            this.#resourceCheck = false;
          }),
        ),
        Effect.uninterruptible,
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  /**
   * Sends how the previous run ended, once. It stays in memory only: a user who shares analytics and
   * is signed out sends it at sign-in in this run, or never. With analytics disabled, or with no
   * install ID while the user does not share analytics, it is dropped.
   */
  #checkUncleanExit(): void {
    const properties = this.#uncleanExit;
    if (this.#closed || !properties) return;
    const owner = this.#client ? this.#currentSubject() : null;
    if (!owner) {
      if (!this.#client || !this.#trackingEnabled) this.#uncleanExit = null;
      return;
    }
    this.#uncleanExit = null;
    this.#trackForOwner("system_unclean_exit", { ...properties }, owner);
  }

  /**
   * The subject of a new event: the account when the user shares analytics, else the install ID.
   * Null while a user who shares analytics is signed out, so the install ID never shows next to an
   * account, and when there is no install ID.
   */
  #currentSubject(): AnalyticsSubject | null {
    if (!this.#trackingEnabled) return this.#install;
    return normalizeAnalyticsIdentity(this.#resolveOwner());
  }

  #trackForOwner(name: HostEventName, properties: HostProperties, owner: AnalyticsSubject, flushPending = true): void {
    // An account taken before the user stopped sharing analytics is never sent after it.
    if (!this.#trackingEnabled && LINKED_ONLY_EVENTS.has(name)) return;
    // An install ID taken before the user started sharing analytics is never sent after it.
    if (this.#trackingEnabled && owner.email === null) return;
    const subject = owner.email !== null && !this.#trackingEnabled ? this.#install : owner;
    if (!subject) return;
    const sanitized = sanitizeHostEvent(name, properties);
    if (flushPending) this.#flushPendingForOwner(subject);
    else this.#identify(subject);
    this.#send(name, sanitized, subject.id);
    const current = this.#currentSubject();
    if (current?.id !== subject.id || current.email !== subject.email) {
      this.#identifiedOwner = null;
      this.#enqueue("clear", () => this.#client?.clear());
    }
  }

  /** Events that waited for the account go with the account only. */
  #flushPendingForOwner(owner: AnalyticsSubject): void {
    this.#identify(owner);
    if (owner.email === null) return;
    const pending = this.#pending;
    this.#pending = [];
    for (const event of pending) this.#send(event.name, event.properties, owner.id, event.timestamp);
  }

  #track(name: HostEventName, properties: HostProperties, ownerOverride?: AnalyticsSubject | null): void {
    const sanitized = sanitizeHostEvent(name, properties);
    const owner = ownerOverride === undefined ? this.#currentSubject() : ownerOverride;
    if (!owner) {
      if (!this.#trackingEnabled || !this.#bufferOwnerlessEvents) return;
      this.#pending.push({ name, properties: sanitized, timestamp: new Date().toISOString() });
      if (this.#pending.length > MAX_PENDING_EVENTS) this.#pending.shift();
      return;
    }
    this.#trackForOwner(name, sanitized, owner, ownerOverride === undefined);
  }

  /** Puts the email on the account's profile. The install ID has no profile data. */
  #identify(owner: AnalyticsSubject): void {
    if (!this.#client) return;
    if (owner.email === null) {
      if (this.#identifiedOwner) this.#enqueue("clear", () => this.#client?.clear());
      this.#identifiedOwner = null;
      return;
    }
    const previous = this.#identifiedOwner;
    if (previous?.id === owner.id && previous.email === owner.email) return;
    if (previous && previous.id !== owner.id) this.#enqueue("clear", () => this.#client?.clear());
    const identity = { id: owner.id, email: owner.email };
    this.#identifiedOwner = identity;
    this.#enqueue("identify", () => this.#client?.identify({ profileId: identity.id, email: identity.email }));
  }

  #send(name: HostEventName, properties: HostProperties, profileId: string, timestamp?: string): void {
    this.#enqueue("track", () =>
      this.#client?.track(name, {
        ...properties,
        ...(timestamp ? { __timestamp: timestamp } : {}),
        profileId,
      }),
    );
  }

  #agentProperties(agentId: string): HostProperties {
    const agent = this.#resolveAgent(agentId);
    if (!agent) return {};
    const listingId = agent.marketplaceSource?.listingId;
    const listing = listingId?.startsWith(CURATED_AGENT_PREFIX) ? listingId.slice(CURATED_AGENT_PREFIX.length) : null;
    return {
      provider: agent.provider,
      model: agent.model,
      reasoning_effort: agent.reasoningEffort,
      agent_source: listing ? "curated" : listingId ? "community" : "custom",
      ...(listing ? { agent_listing: listing } : {}),
    };
  }

  #providerAuth(agentId: string): HostProperties {
    const agent = this.#resolveProviderAuth && this.#resolveAgent(agentId);
    if (!agent || !this.#resolveProviderAuth) return {};
    try {
      return { provider_auth: this.#resolveProviderAuth(agent) };
    } catch {
      return { provider_auth: "unknown" };
    }
  }

  /** The turn's usage rows, or `null` when they cannot be read and no token property is sent. */
  #turnUsage(agentId: string, turnId: string, startedAtTime: number): readonly TurnModelUsage[] | null {
    const resolve = this.#resolveTurnUsage;
    if (!resolve) return null;
    try {
      return resolve(agentId, turnId, new Date(startedAtTime - TURN_USAGE_MARGIN_MS).toISOString());
    } catch {
      return null;
    }
  }

  #turnTiming(turnId: string): Record<string, number> {
    let timing: TurnTiming | null = null;
    try {
      timing = this.#resolveTurnTiming?.(turnId) ?? null;
    } catch {
      return {};
    }
    const properties: Record<string, number> = {};
    for (const [key, property] of TURN_TIMING_PROPERTIES) {
      const value = timing?.[key];
      if (isNumber(value) && Number.isFinite(value)) properties[property] = Math.max(0, Math.round(value));
    }
    return properties;
  }

  #pruneActiveTurns(now: number): void {
    for (const [turnId, turn] of this.#activeTurns) {
      if (now - turn.startedAt <= ACTIVE_TURN_TTL_MS) continue;
      this.#activeTurns.delete(turnId);
    }
  }

  #makeTurnCapacity(): void {
    while (this.#activeTurns.size >= MAX_ACTIVE_TURNS) {
      const oldestTurn = this.#activeTurns.keys().next();
      if (oldestTurn.done) return;
      this.#activeTurns.delete(oldestTurn.value);
    }
  }

  #enqueue(kind: AnalyticsOperationKind, run: () => unknown): void {
    if (this.#closed) return;
    const hasPendingTrack = this.#operationQueue.operations.some((operation) => operation.kind === "track");
    if (kind === "clear" && !hasPendingTrack) {
      this.#operationQueue.operations = [];
    } else if (kind === "identify" && !hasPendingTrack) {
      this.#operationQueue.operations = this.#operationQueue.operations.filter(
        (operation) => operation.kind !== "identify",
      );
    } else if (
      this.#operationQueue.operations.filter((operation) => operation.kind === "track").length >= MAX_PENDING_EVENTS
    ) {
      const oldestTrack = this.#operationQueue.operations.findIndex((operation) => operation.kind === "track");
      if (oldestTrack >= 0) this.#operationQueue.operations.splice(oldestTrack, 1);
    }
    this.#operationQueue.operations.push({ kind, run });
    if (this.#operationQueue.active) return;
    this.#operationQueue.active = true;
    Effect.runFork(
      this.#drainQueue().pipe(Effect.uninterruptible, Effect.forkIn(this.#scope, { startImmediately: true })),
    );
  }

  #drainQueue = Effect.fn("Analytics.drainQueue")(function* (this: HostAnalytics) {
    while (this.#operationQueue.operations.length > 0) {
      const operation = this.#operationQueue.operations.shift();
      if (!operation) continue;
      yield* Effect.gen(function* () {
        const result = yield* analyticsSync(operation.run);
        if (isPromiseLike(result)) yield* analyticsIO(() => Promise.resolve(result));
      }).pipe(Effect.catch(() => Effect.void));
    }
    this.#operationQueue.active = false;
  });

  /** Stop accepting events, then finish work already owned by this service. */
  readonly close = Effect.fn("HostAnalytics.close")(function* (this: HostAnalytics) {
    this.#closed = true;
    if (this.#reports) yield* this.#reports.close();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible);
}

/** Runs a resolver whose failure must not reach the host, which has already done its work. */
function safely<T>(resolve: () => T | null): T | null {
  try {
    return resolve();
  } catch {
    return null;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isDynamicRecord(value) && isFunction(value.then);
}

function normalizeAnalyticsIdentity(user: AnalyticsIdentity | null): AnalyticsIdentity | null {
  if (!user) return null;
  const id = user.id.trim();
  const email = normalizeEmailAddress(user.email);
  return id && email ? { id, email } : null;
}

function sanitizeHostEvent(name: HostEventName, properties: HostProperties): HostProperties {
  const allowed = HOST_ALLOWLIST[name];
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (value === undefined || !allowed.some((item) => item === key)) return [];
      const safeValue = sanitizeHostProperty(name, key, value);
      return safeValue === undefined ? [] : [[key, safeValue]];
    }),
  );
}

function sanitizeHostProperty(name: HostEventName, key: string, value: unknown): HostPropertyValue | undefined {
  if (name === "system_startup") {
    if (key === "start_kind") return isOneOf(START_KINDS, value) ? value : undefined;
    if (key === "host_kind") return isOneOf(["desktop", "server"] as const, value) ? value : undefined;
    if (key === "slowest_service_step") return isOneOf(SERVICE_STEPS, value) ? value : undefined;
    return boundedCount(value, MAX_STARTUP_MS);
  }
  if (name === "system_remote_connect") {
    if (
      key === "outcome" ||
      key === "connection" ||
      key === "session_kind" ||
      key === "last_phase" ||
      key === "first_request"
    ) {
      const allowed: readonly string[] = REMOTE_CONNECT_ENUMS[key];
      return isString(value) && allowed.includes(value) ? value : undefined;
    }
    if (key === "failed_attempts") return boundedCount(value, 100_000);
    if (key === "wait_ms" || key === "hosted_start_wait_ms") return boundedCount(value, MAX_REMOTE_CONNECT_WAIT_MS);
    return boundedCount(value, MAX_REMOTE_CONNECT_PHASE_MS);
  }
  if (name === "system_resources") {
    if (
      key === "ram_class" ||
      key === "cpu_class" ||
      key === "arch" ||
      key === "host_kind" ||
      key === "main_loop_delay_max_phase"
    ) {
      const allowed: readonly string[] = RESOURCE_ENUMS[key];
      return isString(value) && allowed.includes(value) ? value : undefined;
    }
    if (key === "provider_tree_supported" || key === "main_loop_delay_max_turn_active") {
      return isBoolean(value) ? value : undefined;
    }
    return boundedCount(value, 10_000_000);
  }
  if (name === "system_unclean_exit") {
    if (key === "phase" || key === "uptime_class" || key === "host_kind") {
      const allowed: readonly string[] = UNCLEAN_EXIT_ENUMS[key];
      return isString(value) && allowed.includes(value) ? value : undefined;
    }
    if (key === "previous_app_version") return isString(value) && APP_VERSION_PATTERN.test(value) ? value : undefined;
    if (key === "crash_dump_count") return boundedCount(value, 10);
    return isBoolean(value) ? value : undefined;
  }
  if (key === "cause_code" || key === "severity" || key === "operation") {
    const safe = safeProperties({
      source: "host",
      operation: "other",
      cause_code: "unknown",
      severity: "error",
      [key]: value,
    });
    return safe?.[key];
  }
  if (key === "failure_code") {
    return isString(value)
      ? name === "hosted_site_action"
        ? hostedSiteFailureCode(value)
        : systemFailureCode(value)
      : "unknown";
  }
  if (name === "hosted_site_action") {
    if (key === "action") return isOneOf(["publish", "replace", "delete"] as const, value) ? value : undefined;
    if (key === "entry_point") return value === "agent" ? value : undefined;
    if (key === "result") return isOneOf(["succeeded", "failed"] as const, value) ? value : undefined;
  }
  if (key === "provider") return isOneOf(AGENT_PROVIDERS, value) ? value : undefined;
  if (key === "reasoning_effort") {
    return isOneOf(AGENT_REASONING_EFFORTS, value) ? value : undefined;
  }
  if (key === "model") return isAgentModel(value) ? reportedModel(value) : undefined;
  if (key === "origin") {
    return isOneOf(["user", "routine", "agent", "unknown"] as const, value) ? value : undefined;
  }
  if (name === "system_routine_run") {
    if (key === "status") {
      return isOneOf([...ROUTINE_TERMINAL_STATUSES, "needs-attention"] as const, value) ? value : undefined;
    }
    if (key === "run_kind") return isOneOf(["scheduled", "manual"] as const, value) ? value : undefined;
    if (key === "run_source") return isOneOf(ROUTINE_RUN_SOURCES, value) ? value : undefined;
    if (key === "trigger_type") return isOneOf(ROUTINE_TRIGGER_TYPES, value) ? value : undefined;
  }
  if (name === "system_webhook_delivery") {
    if (key === "owner_kind") return isOneOf(["agent", "channel", "workflow"] as const, value) ? value : undefined;
    if (key === "format") return isOneOf(["openbot", "standard"] as const, value) ? value : undefined;
    if (key === "result") return isOneOf(WEBHOOK_DELIVERY_RESULTS, value) ? value : undefined;
    if (key === "ignored_reason") return isOneOf(WEBHOOK_IGNORED_REASONS, value) ? value : undefined;
    if (key === "status_code") return isOneOf(WEBHOOK_DELIVERY_STATUSES, value) ? value : undefined;
    if (key === "body_bytes") return boundedCount(value, MAX_WEBHOOK_BODY_BYTES);
    if (key === "handle_ms") return boundedCount(value, MAX_WEBHOOK_HANDLE_MS);
    if (key === "delivery_age_ms") return boundedCount(value, MAX_WEBHOOK_AGE_MS);
    if (key === "skipped_count") return boundedCount(value, 1_000_000);
    if (key === "test") return isBoolean(value) ? value : undefined;
    return undefined;
  }
  if (name === "system_workflow_run") {
    if (key === "status") return isOneOf(["done", "failed", "stopped"] as const, value) ? value : undefined;
    if (key === "source") return isOneOf(WORKFLOW_RUN_SOURCES, value) ? value : undefined;
    if (key === "step_count" || WORKFLOW_RUN_STEP_COUNTS.some(([property]) => property === key))
      return boundedCount(value, MAX_WORKFLOW_RUN_STEPS);
    if (key === "duration_ms")
      return isNumber(value) && Number.isFinite(value) && value >= 0 && value <= MAX_WORKFLOW_RUN_MS
        ? value
        : undefined;
  }
  if (name === "system_tool_used") {
    if (key === "tool_kind") return isOneOf(TOOL_KINDS, value) ? value : undefined;
    if (key === "plugin") {
      return isString(value) && (value === "builtin" || value === "custom" || LISTING_SLUG_PATTERN.test(value))
        ? value
        : undefined;
    }
    if (key === "tool") return isString(value) && TOOL_NAME_PATTERN.test(value) ? value : undefined;
    if (key === "call_count" || key === "failed_count") return boundedCount(value, 100_000);
  }
  if (name === "system_site_visited") {
    if (key === "domain") return isString(value) ? analyticsDomain(value) : undefined;
    if (key === "actor") return isOneOf(["agent", "user"] as const, value) ? value : undefined;
  }
  if (name === "system_inventory") {
    if (key === "plugins" || key === "curated_skills" || key === "curated_agents") {
      return slugList(value, (item) => LISTING_SLUG_PATTERN.test(item));
    }
    if (key === "providers") return slugList(value, (item) => isOneOf(AGENT_PROVIDERS, item));
    if (key === "computer_use_enabled") return isBoolean(value) ? value : undefined;
    return boundedCount(value, 10_000);
  }
  if (key === "provider_auth") return isOneOf(PROVIDER_AUTH_KINDS, value) ? value : undefined;
  if (key === "agent_source") return isOneOf(["curated", "community", "custom"] as const, value) ? value : undefined;
  if (key === "agent_listing") return isString(value) && LISTING_SLUG_PATTERN.test(value) ? value : undefined;
  if (key === "status") return isString(value) ? normalizedTurnStatus(value) : undefined;
  if (key === "kind") return isOneOf(["prompt", "approval"] as const, value) ? value : undefined;
  if (key === "approval_kind") {
    return isOneOf(["command", "file-change", "permissions"] as const, value) ? value : undefined;
  }
  if (key === "area") return value === "agent" ? value : undefined;
  if (key === "prompt_count") {
    return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined;
  }
  if (name === "system_turn_completed" || name === "system_token_usage") {
    if (key === "token_usage") return isOneOf(["reported", "partial", "unknown"] as const, value) ? value : undefined;
    if (key === "total_tokens" || TOKEN_PROPERTIES.some(([, property]) => property === key))
      return boundedCount(value, MAX_TURN_TOKENS);
  }
  if (key === "duration_ms") {
    return isNumber(value) && Number.isFinite(value) && value >= 0 && value <= ACTIVE_TURN_TTL_MS ? value : undefined;
  }
  if (name === "system_turn_completed") {
    // A usage-limit hold keeps a message in the queue for hours, so its wait has a wider bound.
    if (key === "queue_wait_ms") return boundedCount(value, MAX_QUEUE_WAIT_MS);
    if (TURN_TIMING_PROPERTIES.some(([, property]) => property === key)) return boundedCount(value, ACTIVE_TURN_TTL_MS);
  }
  if (key === "has_secret_prompt") return isBoolean(value) ? value : undefined;
  return undefined;
}

/**
 * The registrable domain (eTLD+1) of a page, or `undefined` for a host that must not be sent: an IP
 * address, a single-label or intranet name, or a name with no public ICANN suffix. Private suffixes
 * are ignored on purpose, so `user.github.io` reports as `github.io` and never names the user.
 */
function analyticsDomain(hostname: string): string | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.$/u, "");
  if (!host || host.length > 253) return undefined;
  const parsed = parseDomain(host, { allowPrivateDomains: false, extractHostname: false });
  // `home.arpa` is on the ICANN list, but it names home networks (RFC 8375).
  if (parsed.isIp || !parsed.isIcann || !parsed.domain || isHomeNetwork(parsed.domain)) return undefined;
  return parsed.domain;
}

function isHomeNetwork(domain: string): boolean {
  return domain === "home.arpa" || domain.endsWith(".home.arpa");
}

function boundedCount(value: unknown, max: number): number | undefined {
  return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= max ? value : undefined;
}

/** The counts of all models of a turn. A count is `null` when one model lacks it. */
function sumTokens(rows: readonly TurnModelUsage[]): UsageTokens | null {
  if (rows.length === 0) return null;
  const sum: UsageTokens = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
  for (const row of rows) {
    for (const [key] of TOKEN_PROPERTIES) {
      const value = row.tokens[key];
      const total = sum[key];
      sum[key] = value === null || total === null ? null : total + value;
    }
  }
  return sum;
}

function tokenTotal(tokens: UsageTokens): number {
  return TOKEN_PROPERTIES.reduce((total, [key]) => total + (tokens[key] ?? 0), 0);
}

/**
 * Counts only: `token_usage` is `unknown` when the provider reported no usage, never a zero, and
 * `partial` when a count is missing. A missing count is left out rather than sent as 0.
 */
function tokenProperties(tokens: UsageTokens | null): HostProperties {
  if (!tokens) return { token_usage: "unknown" };
  const properties: HostProperties = {};
  let known = 0;
  for (const [key, name] of TOKEN_PROPERTIES) {
    const value = tokens[key];
    if (value === null) continue;
    properties[name] = value;
    known++;
  }
  if (known === 0) return { token_usage: "unknown" };
  return {
    ...properties,
    total_tokens: tokenTotal(tokens),
    token_usage: known === TOKEN_PROPERTIES.length ? "reported" : "partial",
  };
}

function slugList(value: unknown, allowed: (item: string) => boolean): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.filter((item): item is string => isString(item) && allowed(item)))];
  return items.sort().slice(0, MAX_INVENTORY_ITEMS);
}

function isRoutineRunFinished(status: RoutineRunConversationEventStatus): boolean {
  return isOneOf(ROUTINE_TERMINAL_STATUSES, status);
}

/**
 * A model OpenCode serves is named `<provider>/<model>`, and when the user named that provider the
 * prefix is a string they typed - a company name, a hostname, a project. Nothing in the id separates
 * one of those from OpenCode's own `anthropic/...`, so every prefixed id is reported as `custom`.
 * That costs the model breakdown for OpenCode, which is the cheaper of the two mistakes.
 */
function reportedModel(value: string): string {
  // Hermes names a model of the user's own endpoint `custom:<endpoint name>:<model>`.
  if (value.startsWith("custom:")) return "custom";
  const separator = value.indexOf("/");
  if (separator < 0) return value;
  // A key-only provider never puts its own id before a model id, so that prefix comes from OpenCode.
  const prefix = value.slice(0, separator);
  return isOneOf(AGENT_PROVIDERS, prefix) && !isKeyOnlyProvider(prefix) ? value : "custom";
}

function hostedSiteFailureCode(value: string): string {
  return value === "hosted_site_failed" || value === "cancelled" || value === "interrupted" ? value : "unknown";
}

function normalizedTurnStatus(value: string): string {
  return ["completed", "failed", "interrupted", "cancelled"].includes(value) ? value : "other";
}

/** Keeps the last error of a turn, but a later `unknown` does not hide a known cause. */
function noteTurnFailure(turn: ActiveTurn, failure: FailureSignal): void {
  if (failure.causeCode === "unknown" && turn.failure && turn.failure.causeCode !== "unknown") return;
  turn.failure = { failureCode: systemFailureCode(failure.code), causeCode: failure.causeCode };
}

function systemFailureCode(value: string): string {
  switch (value) {
    case "context_compaction_failed":
    case "delivery_start_failed":
    case "delivery_turn_association_failed":
    case "interrupt_failed":
    case "memory_commit_failed":
    case "provider_history_backfill_pending":
    case "provider_metadata_refresh_failed":
    case "routine_delivery_failed":
    case "routine_delivery_recovery_failed":
    case "routine_scheduler_failed":
    case "server_request_failed":
      return value;
    default:
      if (PROVIDER_EVENT_PATTERN.test(value)) return value;
      if (value.startsWith("agent_")) return "agent_event_failed";
      return "unknown";
  }
}
