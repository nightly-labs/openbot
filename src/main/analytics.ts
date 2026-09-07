import {
  createFailureThrottle,
  durationBucket,
  type FailureThrottle,
  failureMessagePolicy,
  isFailureArea,
  isFailureCode,
  isFailureStage,
} from "@openbot/contracts/analytics-failures";
import {
  AGENT_PROVIDERS,
  AGENT_REASONING_EFFORTS,
  type AgentEvent,
  type AgentSummary,
  type CentralAuthUser,
  type ConversationMessage,
  hostedSiteConversationEvent,
  isAgentModel,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isFunction, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { DiagnosticRecord, LogValue } from "@openbot/logging";
import { redactedSummary } from "@openbot/logging";
import { OpenPanelBase, type OpenPanelOptions } from "@openpanel/web";

export const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
export const OPENPANEL_CLIENT_ID = "6c989975-87ef-4f0c-857e-ab449a65b5c2";
const MAX_PENDING_EVENTS = 100;
const MAX_ACTIVE_TURNS = 1_000;
const MAX_HOSTED_SITE_OPERATIONS = 10_000;
const ACTIVE_TURN_TTL_MS = 24 * 60 * 60 * 1_000;
const ANALYTICS_SCHEMA_VERSION = 5;

type AnalyticsIdentity = Pick<CentralAuthUser, "id" | "email">;
type AnalyticsOperationKind = "clear" | "identify" | "track";
type AnalyticsOperation = { kind: AnalyticsOperationKind; run: () => unknown };
type AnalyticsOperationQueue = { active: boolean; operations: AnalyticsOperation[] };
type HostEventName =
  | "system_turn_started"
  | "system_turn_completed"
  | "system_agent_input_requested"
  | "system_operation_failed"
  | "hosted_site_action";
export type HostOpenPanelClient = Pick<OpenPanelBase, "setGlobalProperties" | "track" | "identify" | "clear">;
type ClientFactory = (options: OpenPanelOptions) => HostOpenPanelClient;

export interface HostAnalyticsOptions {
  enabled: boolean;
  trackingEnabled?: boolean;
  appVersion: string;
  platform: "darwin" | "win32" | "linux";
  resolveOwner: () => AnalyticsIdentity | null;
  resolveAgent: (agentId: string) => AgentSummary | null;
}

const HOST_ALLOWLIST = {
  system_turn_started: ["provider", "model", "reasoning_effort", "origin"],
  system_turn_completed: ["provider", "model", "reasoning_effort", "origin", "status", "duration_ms"],
  system_agent_input_requested: [
    "provider",
    "model",
    "reasoning_effort",
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
    "stage",
    "message",
    "errno",
    "exit_code",
    "duration_bucket",
    "repeat_count",
  ],
  hosted_site_action: ["action", "entry_point", "result", "failure_code"],
} as const satisfies Record<HostEventName, readonly string[]>;

type HostPropertyName = (typeof HOST_ALLOWLIST)[HostEventName][number];
type HostProperties = Partial<Record<HostPropertyName, string | number | boolean>>;
type HostPendingEvent = { name: HostEventName; properties: HostProperties; timestamp: string };
type ActiveTurn = {
  startedAt: number;
  origin: string;
  owner: AnalyticsIdentity | null;
  ownerResolutionPending: boolean;
};

export class HostAnalytics {
  readonly #resolveOwner: HostAnalyticsOptions["resolveOwner"];
  readonly #resolveAgent: HostAnalyticsOptions["resolveAgent"];
  readonly #client: HostOpenPanelClient | null;
  #identifiedOwner: AnalyticsIdentity | null = null;
  #trackingEnabled: boolean;
  #bufferOwnerlessEvents = true;
  #pending: HostPendingEvent[] = [];
  readonly #activeTurns = new Map<string, ActiveTurn>();
  readonly #hostedSiteOwners = new Map<string, AnalyticsIdentity | null>();
  readonly #hostedSiteTerminalOperations = new Set<string>();
  readonly #operationQueue: AnalyticsOperationQueue = { active: false, operations: [] };
  readonly #failureThrottle: FailureThrottle = createFailureThrottle();
  readonly #createClient: ClientFactory;
  readonly #globalProperties: { appVersion: string; platform: HostAnalyticsOptions["platform"] };
  // A failure on a machine that has never signed in used to reach nobody: an
  // ownerless event waits in `#pending` for an owner that never arrives. This
  // client is never identified and carries no profile, which is what lets a
  // failed provider start be reported at all.
  #anonymousClient: HostOpenPanelClient | null = null;
  #anonymousClientTried = false;

  constructor(
    options: HostAnalyticsOptions,
    createClient: ClientFactory = (clientOptions) => new OpenPanelBase(clientOptions),
  ) {
    this.#resolveOwner = options.resolveOwner;
    this.#resolveAgent = options.resolveAgent;
    this.#trackingEnabled = options.trackingEnabled ?? true;
    this.#createClient = createClient;
    this.#globalProperties = { appVersion: options.appVersion, platform: options.platform };
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
    }
    if (!this.#client || !this.#trackingEnabled) return;
    switch (event.type) {
      case "conversation":
        return;
      case "turn-started": {
        const now = performance.now();
        this.#pruneActiveTurns(now);
        if (this.#activeTurns.has(event.turnId)) return;
        this.#makeTurnCapacity();
        const owner = normalizeAnalyticsIdentity(this.#resolveOwner());
        this.#activeTurns.set(event.turnId, {
          startedAt: now,
          origin: event.origin ?? "unknown",
          owner,
          ownerResolutionPending: owner === null && this.#bufferOwnerlessEvents,
        });
        this.#track(
          "system_turn_started",
          {
            ...this.#agentProperties(event.agentId),
            origin: event.origin ?? "unknown",
          },
          owner,
        );
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
        this.#track("system_operation_failed", {
          ...(event.agentId ? this.#agentProperties(event.agentId) : {}),
          area: "agent",
          failure_code: systemFailureCode(event.code),
          message: event.message,
        });
        return;
      default:
        return;
    }
  }

  flushPending(): void {
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
  }

  clear(): void {
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
    if (!enabled) {
      this.#hostedSiteOwners.clear();
      this.#activeTurns.clear();
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

  /**
   * One diagnostic, as one failure event. This is the other half of the local
   * trail: the same record the log file keeps, minus everything the allowlist
   * does not admit.
   */
  recordFailure(record: DiagnosticRecord): void {
    if (!this.#client || !this.#trackingEnabled) return;
    const detail = record.detail ?? {};
    const durationMs = scalar(detail.durationMs);
    this.#track("system_operation_failed", {
      area: record.area ?? "unknown",
      failure_code: record.code,
      ...optional("stage", record.stage),
      ...optional("message", record.message),
      ...optional("provider", scalar(detail.provider)),
      ...optional("errno", scalar(detail.errno)),
      ...optional("exit_code", scalar(detail.exitCode)),
      ...optional("repeat_count", scalar(detail.repeated)),
      ...(isNumber(durationMs) ? { duration_bucket: durationBucket(durationMs) } : {}),
    });
  }

  #track(name: HostEventName, properties: HostProperties, ownerOverride?: AnalyticsIdentity | null): void {
    if (!this.#trackingEnabled) return;
    let sanitized = sanitizeHostEvent(name, properties);
    if (name === "system_operation_failed") {
      // Keyed on the normalized area and code, not the raw one: a crash loop
      // that invents a new code each iteration would otherwise be 150 keys
      // rather than one.
      const repeated = this.#failureThrottle.admit(
        `${sanitized.area ?? "unknown"}:${sanitized.failure_code ?? "unknown"}`,
        Date.now(),
      );
      if (repeated === null) return;
      if (repeated > 0) sanitized = sanitizeHostEvent(name, { ...sanitized, repeat_count: repeated });
    }
    const owner = ownerOverride === undefined ? normalizeAnalyticsIdentity(this.#resolveOwner()) : ownerOverride;
    if (!owner) {
      if (name === "system_operation_failed") {
        this.#sendAnonymous(name, sanitized);
        return;
      }
      if (!this.#bufferOwnerlessEvents) return;
      this.#pending.push({ name, properties: sanitized, timestamp: new Date().toISOString() });
      if (this.#pending.length > MAX_PENDING_EVENTS) this.#pending.shift();
      return;
    }
    this.#trackForOwner(name, sanitized, owner, ownerOverride === undefined);
  }

  #sendAnonymous(name: HostEventName, properties: HostProperties): void {
    const client = this.#anonymousScope();
    if (!client) return;
    this.#enqueue("track", () => client.track(name, { ...properties }));
  }

  #anonymousScope(): HostOpenPanelClient | null {
    if (this.#anonymousClientTried) return this.#anonymousClient;
    this.#anonymousClientTried = true;
    try {
      const client = this.#createClient({ apiUrl: OPENPANEL_API_URL, clientId: OPENPANEL_CLIENT_ID });
      client.setGlobalProperties({
        surface: "desktop_host",
        environment: "production",
        event_schema_version: ANALYTICS_SCHEMA_VERSION,
        app_version: this.#globalProperties.appVersion,
        platform: this.#globalProperties.platform,
      });
      this.#anonymousClient = client;
    } catch {
      this.#anonymousClient = null;
    }
    return this.#anonymousClient;
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
    return agent ? { provider: agent.provider, model: agent.model, reasoning_effort: agent.reasoningEffort } : {};
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
    void this.#drainQueue();
  }

  async #drainQueue(): Promise<void> {
    while (this.#operationQueue.operations.length > 0) {
      const operation = this.#operationQueue.operations.shift();
      if (!operation) continue;
      try {
        const result = operation.run();
        if (isPromiseLike(result)) await result;
      } catch {
        // Analytics must never change host behavior or stop later events.
      }
    }
    this.#operationQueue.active = false;
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
  const sanitized: HostProperties = Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (value === undefined || !allowed.some((item) => item === key)) return [];
      const safeValue = sanitizeHostProperty(name, key, value);
      return safeValue === undefined ? [] : [[key, safeValue]];
    }),
  );
  // Provider output is the least controlled string in the app - a stderr line
  // can carry a repository path, a prompt fragment or a pasted token - so the
  // codes that carry it keep their text on the machine and send the code alone.
  const code = sanitized.failure_code;
  if (isFailureCode(code) && failureMessagePolicy(code) === "local_only") delete sanitized.message;
  return sanitized;
}

function optional(key: string, value: string | number | boolean | undefined): HostProperties {
  return value === undefined ? {} : { [key]: value };
}

function scalar(value: LogValue | undefined): string | number | boolean | undefined {
  return isString(value) || isNumber(value) || isBoolean(value) ? value : undefined;
}

function sanitizeHostProperty(name: HostEventName, key: string, value: unknown): string | number | boolean | undefined {
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
  if (key === "model") return isAgentModel(value) ? value : undefined;
  if (key === "origin") {
    return isOneOf(["user", "routine", "agent", "unknown"] as const, value) ? value : undefined;
  }
  if (key === "status") return isString(value) ? normalizedTurnStatus(value) : undefined;
  if (key === "kind") return isOneOf(["prompt", "approval"] as const, value) ? value : undefined;
  if (key === "approval_kind") {
    return isOneOf(["command", "file-change", "permissions"] as const, value) ? value : undefined;
  }
  // Widened from the single `"agent"` it used to admit: with the whole app
  // reporting, an area is the breakdown that keeps `log_error` from being one
  // meaningless bar.
  if (key === "area") return isFailureArea(value) ? value : "unknown";
  if (key === "stage") return isFailureStage(value) ? value : undefined;
  if (key === "message") return isString(value) ? redactedSummary(value) || undefined : undefined;
  if (key === "errno") return isOneOf(SAFE_ERRNO, value) ? value : undefined;
  if (key === "exit_code") {
    return isNumber(value) && Number.isInteger(value) && value >= -256 && value <= 256 ? value : undefined;
  }
  if (key === "duration_bucket") {
    return isOneOf(["lt_1s", "lt_10s", "lt_1m", "lt_10m", "gte_10m", "unknown"] as const, value) ? value : undefined;
  }
  if (key === "repeat_count") {
    return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : undefined;
  }
  if (key === "prompt_count") {
    return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined;
  }
  if (key === "duration_ms") {
    return isNumber(value) && Number.isFinite(value) && value >= 0 && value <= ACTIVE_TURN_TTL_MS ? value : undefined;
  }
  if (key === "has_secret_prompt") return isBoolean(value) ? value : undefined;
  return undefined;
}

function hostedSiteFailureCode(value: string): string {
  return value === "hosted_site_failed" || value === "cancelled" || value === "interrupted" ? value : "unknown";
}

function normalizedTurnStatus(value: string): string {
  return ["completed", "failed", "interrupted", "cancelled"].includes(value) ? value : "other";
}

/**
 * One shared list decides this now. The eleven literal cases this used to hold
 * folded a third of the codes actually in use to `"unknown"`.
 *
 * The `agent_` fold stays as the last resort: a remote host on an older build
 * still sends `agent_<jsonrpc method>`, and the family is better data than
 * `"unknown"`.
 */
function systemFailureCode(value: string): string {
  if (isFailureCode(value)) return value;
  return value.startsWith("agent_") ? "agent_event_failed" : "unknown";
}

/** Errors a user can act on, and nothing that could carry a path or a name. */
const SAFE_ERRNO = [
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EINVAL",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENETUNREACH",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "EPIPE",
  "ETIMEDOUT",
] as const;
