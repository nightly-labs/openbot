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
  type RoutineRunConversationEventStatus,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isFunction, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { classifyFailure, operationForCode, type ReportQueue, safeProperties } from "@openbot/telemetry";
import { OpenPanelBase, type OpenPanelOptions } from "@openpanel/web";
import { Effect, Exit, Scope } from "effect";
import { parse as parseDomain } from "tldts";
import type { FailureSignal } from "../backend/agent/failure-signal";
import type { ToolUsageSignal } from "../backend/agent/thread-items";
import type { BrowserSiteVisit } from "../backend/browser-host";
import { type AnalyticsOperationFailure, analyticsIO, analyticsSync } from "./analytics-effects";

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
const MAX_SITE_TABS = 1_000;
const MAX_ROUTINE_RUNS = 10_000;
const MAX_INVENTORY_ITEMS = 32;
const ANALYTICS_SCHEMA_VERSION = 7;
const CURATED_AGENT_PREFIX = "openbot-curated-agent-";
const LISTING_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
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
] as const;

type AnalyticsIdentity = Pick<CentralAuthUser, "id" | "email">;
type AnalyticsOperationKind = "clear" | "identify" | "track";
type AnalyticsOperation = { kind: AnalyticsOperationKind; run: () => unknown };
type AnalyticsOperationQueue = { active: boolean; operations: AnalyticsOperation[] };
type HostEventName =
  | "system_turn_started"
  | "system_turn_completed"
  | "system_agent_input_requested"
  | "system_operation_failed"
  | "system_tool_used"
  | "system_site_visited"
  | "system_routine_run"
  | "system_inventory"
  | "hosted_site_action";
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
  trackingEnabled?: boolean;
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  resolveOwner: () => AnalyticsIdentity | null;
  resolveAgent: (agentId: string) => AgentSummary | null;
  /**
   * The user's MCP servers that a provider reports under `name`: `null` when there is none, else the
   * catalog plugin slug they all share, or `slug: null` for the user's own server.
   */
  resolveMcpServer?: (name: string) => { slug: string | null } | null;
  resolveRoutineRun?: (agentId: string, routineId: string, runId: string) => AnalyticsRoutineRun | null;
  resolveInventory?: () => Effect.Effect<AnalyticsInventory, AnalyticsOperationFailure>;
  inventoryDay?: AnalyticsInventoryDayStore;
}

interface AnalyticsRoutineRun {
  runKind: "scheduled" | "manual";
  triggerType: string;
}

/** Counts and closed-set names only: never a user-authored name, URL or command. */
export interface AnalyticsInventory {
  agentCount: number;
  enabledRoutineCount: number;
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
  system_turn_completed: [...AGENT_PROPERTY_NAMES, "origin", "status", "duration_ms"],
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
  system_site_visited: [...AGENT_PROPERTY_NAMES, "domain", "actor"],
  system_routine_run: [...AGENT_PROPERTY_NAMES, "status", "run_kind", "trigger_type"],
  system_inventory: [
    "agent_count",
    "enabled_routine_count",
    "custom_mcp_server_count",
    "plugins",
    "curated_skills",
    "curated_agents",
    "local_skill_count",
    "community_skill_count",
    "providers",
    "computer_use_enabled",
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
  origin: string;
  owner: AnalyticsIdentity | null;
  ownerResolutionPending: boolean;
  tools: Map<string, ToolUseRow>;
};

export class HostAnalytics {
  readonly #reports: ReportQueue | undefined;
  readonly #resolveOwner: HostAnalyticsOptions["resolveOwner"];
  readonly #resolveAgent: HostAnalyticsOptions["resolveAgent"];
  readonly #resolveMcpServer: NonNullable<HostAnalyticsOptions["resolveMcpServer"]>;
  readonly #resolveRoutineRun: NonNullable<HostAnalyticsOptions["resolveRoutineRun"]>;
  readonly #resolveInventory: HostAnalyticsOptions["resolveInventory"];
  readonly #inventoryDayStore: HostAnalyticsOptions["inventoryDay"];
  readonly #client: HostOpenPanelClient | null;
  #identifiedOwner: AnalyticsIdentity | null = null;
  #trackingEnabled: boolean;
  #bufferOwnerlessEvents = true;
  #pending: HostPendingEvent[] = [];
  readonly #activeTurns = new Map<string, ActiveTurn>();
  readonly #hostedSiteOwners = new Map<string, AnalyticsIdentity | null>();
  readonly #hostedSiteTerminalOperations = new Set<string>();
  readonly #siteDomains = new Map<string, string>();
  readonly #routineRunOwners = new Map<string, AnalyticsIdentity | null>();
  readonly #routineRunReports = new Set<string>();
  #closed = false;
  readonly #scope = Scope.makeUnsafe();
  #inventoryDay: string | null = null;
  #inventoryCheck = false;
  readonly #operationQueue: AnalyticsOperationQueue = { active: false, operations: [] };

  constructor(options: HostAnalyticsOptions, createClient: ClientFactory = createOpenPanelClient) {
    this.#reports = options.reports;
    this.#resolveOwner = options.resolveOwner;
    this.#resolveAgent = options.resolveAgent;
    this.#resolveMcpServer = options.resolveMcpServer ?? (() => null);
    this.#resolveRoutineRun = options.resolveRoutineRun ?? (() => null);
    this.#resolveInventory = options.resolveInventory;
    this.#inventoryDayStore = options.inventoryDay;
    this.#trackingEnabled = options.trackingEnabled ?? true;
    if (!options.enabled) {
      this.#client = null;
      return;
    }
    try {
      const client = createClient({ apiUrl: OPENPANEL_API_URL, clientId: OPENPANEL_CLIENT_ID });
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
    if (event.type === "conversation" && this.#client && this.#trackingEnabled) {
      this.#handleHostedSiteConversation(event.snapshot.messages);
      this.#handleRoutineRunConversation(event.snapshot.agentId, event.snapshot.messages);
    }
    if ((!this.#client && !this.#reports) || !this.#trackingEnabled) return;
    switch (event.type) {
      case "conversation":
        return;
      case "turn-started": {
        this.#configureReports();
        const now = performance.now();
        this.#pruneActiveTurns(now);
        if (this.#activeTurns.has(event.turnId)) return;
        this.#makeTurnCapacity();
        const owner = normalizeAnalyticsIdentity(this.#resolveOwner());
        this.#activeTurns.set(event.turnId, {
          ...(this.#reports ? { failureScope: this.#reports.scope() } : {}),
          agentId: event.agentId,
          properties: this.#agentProperties(event.agentId),
          startedAt: now,
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
        return;
      }
      case "turn-completed": {
        const activeTurn = this.#activeTurns.get(event.turnId);
        this.#activeTurns.delete(event.turnId);
        const origin =
          event.origin && event.origin !== "unknown" ? event.origin : (activeTurn?.origin ?? event.origin ?? "unknown");
        this.#track(
          "system_turn_completed",
          {
            ...this.#agentProperties(event.agentId),
            origin,
            status: normalizedTurnStatus(event.status),
            ...(activeTurn === undefined
              ? {}
              : { duration_ms: Math.max(0, Math.round(performance.now() - activeTurn.startedAt)) }),
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

  #configureReports(): void {
    if (this.#reports) Effect.runFork(this.#reports.configure(this.#trackingEnabled, this.#resolveOwner()?.id ?? null));
  }

  /** Only the local service emits this signal. Remote clients never send host reports. */
  handleFailure(failure: FailureSignal): void {
    if (!this.#reports || !this.#trackingEnabled) return;
    this.#configureReports();
    const candidates = [...this.#activeTurns.values()].filter((turn) => turn.agentId === failure.agentId);
    const turn = failure.turnId
      ? this.#activeTurns.get(failure.turnId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (turn?.owner && turn.owner.id !== this.#resolveOwner()?.id) return;
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
    if (!this.#client || !this.#trackingEnabled) return;
    const owner = normalizeAnalyticsIdentity(this.#resolveOwner());
    if (!owner) return;
    this.#bufferOwnerlessEvents = true;
    for (const activeTurn of this.#activeTurns.values()) {
      if (!activeTurn.ownerResolutionPending) continue;
      activeTurn.owner = owner;
      activeTurn.ownerResolutionPending = false;
    }
    this.#flushPendingForOwner(owner);
    this.#checkInventory();
  }

  clear(): void {
    if (this.#reports) Effect.runFork(this.#reports.configure(this.#trackingEnabled, null));
    this.#pending = [];
    this.#bufferOwnerlessEvents = false;
    for (const activeTurn of this.#activeTurns.values()) {
      if (activeTurn.owner === null) activeTurn.ownerResolutionPending = false;
    }
    this.#identifiedOwner = null;
    if (this.#trackingEnabled) this.#enqueue("clear", () => this.#client?.clear());
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
        const owner = normalizeAnalyticsIdentity(this.#resolveOwner());
        if (!this.#hostedSiteOwners.has(event.operationId)) this.#hostedSiteOwners.set(event.operationId, owner);
        continue;
      }
      if (!observedRunningOperations.has(event.operationId)) continue;
      if (this.#hostedSiteTerminalOperations.has(event.operationId)) continue;
      this.#hostedSiteTerminalOperations.add(event.operationId);
      const owner = this.#hostedSiteOwners.get(event.operationId) ?? null;
      this.#hostedSiteOwners.delete(event.operationId);
      if (!owner || !this.#trackingEnabled) continue;
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
        this.#routineRunOwners.set(event.runId, normalizeAnalyticsIdentity(this.#resolveOwner()));
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
          ...(run ? { run_kind: run.runKind, trigger_type: run.triggerType } : {}),
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

  /** Sends the inventory at most once per local day. It needs an owner, so it waits for sign-in. */
  #checkInventory(): void {
    const today = localDay(new Date());
    if (this.#closed || this.#inventoryDay === today || this.#inventoryCheck) return;
    const resolveInventory = this.#resolveInventory;
    const store = this.#inventoryDayStore;
    if (!this.#client || !this.#trackingEnabled || !resolveInventory || !store) return;
    if (!normalizeAnalyticsIdentity(this.#resolveOwner())) return;
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
        if (this.#closed || !this.#trackingEnabled || !normalizeAnalyticsIdentity(this.#resolveOwner())) return;
        // The day is stored before the send, so a failed write sends nothing and a crash cannot send twice.
        yield* store.write(today);
        this.#inventoryDay = today;
        const owner = normalizeAnalyticsIdentity(this.#resolveOwner());
        if (!owner || !this.#trackingEnabled) return;
        this.#trackForOwner(
          "system_inventory",
          {
            agent_count: inventory.agentCount,
            enabled_routine_count: inventory.enabledRoutineCount,
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

  #trackForOwner(name: HostEventName, properties: HostProperties, owner: AnalyticsIdentity, flushPending = true): void {
    const sanitized = sanitizeHostEvent(name, properties);
    if (flushPending) this.#flushPendingForOwner(owner);
    else this.#identify(owner);
    this.#send(name, sanitized, owner.id);
    const currentOwner = normalizeAnalyticsIdentity(this.#resolveOwner());
    if (currentOwner?.id !== owner.id || currentOwner.email !== owner.email) {
      this.#identifiedOwner = null;
      this.#enqueue("clear", () => this.#client?.clear());
    }
  }

  #flushPendingForOwner(owner: AnalyticsIdentity): void {
    this.#identify(owner);
    const pending = this.#pending;
    this.#pending = [];
    for (const event of pending) this.#send(event.name, event.properties, owner.id, event.timestamp);
  }

  #track(name: HostEventName, properties: HostProperties, ownerOverride?: AnalyticsIdentity | null): void {
    if (!this.#trackingEnabled) return;
    const sanitized = sanitizeHostEvent(name, properties);
    const owner = ownerOverride === undefined ? normalizeAnalyticsIdentity(this.#resolveOwner()) : ownerOverride;
    if (!owner) {
      if (!this.#bufferOwnerlessEvents) return;
      this.#pending.push({ name, properties: sanitized, timestamp: new Date().toISOString() });
      if (this.#pending.length > MAX_PENDING_EVENTS) this.#pending.shift();
      return;
    }
    this.#trackForOwner(name, sanitized, owner, ownerOverride === undefined);
  }

  #identify(owner: AnalyticsIdentity): void {
    if (!this.#client) return;
    const previous = this.#identifiedOwner;
    if (previous?.id === owner.id && previous.email === owner.email) return;
    if (previous && previous.id !== owner.id) this.#enqueue("clear", () => this.#client?.clear());
    this.#identifiedOwner = { ...owner };
    this.#enqueue("identify", () => this.#client?.identify({ profileId: owner.id, email: owner.email }));
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

export function sanitizeHostEvent(name: HostEventName, properties: HostProperties): HostProperties {
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
    if (key === "trigger_type") return isOneOf(ROUTINE_TRIGGER_TYPES, value) ? value : undefined;
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
  if (key === "duration_ms") {
    return isNumber(value) && Number.isFinite(value) && value >= 0 && value <= ACTIVE_TURN_TTL_MS ? value : undefined;
  }
  if (key === "has_secret_prompt") return isBoolean(value) ? value : undefined;
  return undefined;
}

/**
 * The registrable domain (eTLD+1) of a page, or `undefined` for a host that must not be sent: an IP
 * address, a single-label or intranet name, or a name with no public ICANN suffix. Private suffixes
 * are ignored on purpose, so `user.github.io` reports as `github.io` and never names the user.
 */
export function analyticsDomain(hostname: string): string | undefined {
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

function slugList(value: unknown, allowed: (item: string) => boolean): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.filter((item): item is string => isString(item) && allowed(item)))];
  return items.sort().slice(0, MAX_INVENTORY_ITEMS);
}

function isRoutineRunFinished(status: RoutineRunConversationEventStatus): boolean {
  return isOneOf(ROUTINE_TERMINAL_STATUSES, status);
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A model OpenCode serves is named `<provider>/<model>`, and when the user named that provider the
 * prefix is a string they typed - a company name, a hostname, a project. Nothing in the id separates
 * one of those from OpenCode's own `anthropic/...`, so every prefixed id is reported as `custom`.
 * That costs the model breakdown for OpenCode, which is the cheaper of the two mistakes.
 */
function reportedModel(value: string): string {
  const separator = value.indexOf("/");
  if (separator < 0) return value;
  return isOneOf(AGENT_PROVIDERS, value.slice(0, separator)) ? value : "custom";
}

function hostedSiteFailureCode(value: string): string {
  return value === "hosted_site_failed" || value === "cancelled" || value === "interrupted" ? value : "unknown";
}

function normalizedTurnStatus(value: string): string {
  return ["completed", "failed", "interrupted", "cancelled"].includes(value) ? value : "other";
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
