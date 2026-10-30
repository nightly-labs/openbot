import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { classifyFailure, type Operation, type ReportQueue, safeProperties } from "@openbot/telemetry";
import { Effect } from "effect";
import { type MobileEventName, type MobileEventProperties, type SafeProperties, sanitizeMobileEvent } from "./events";

export interface MobileAnalyticsClient {
  track(name: string, properties: SafeProperties, timestamp?: string): Promise<unknown> | undefined;
  identify(user: { profileId: string; email: string }): Promise<unknown> | undefined;
  clear(): undefined;
}
export interface MobileAnalyticsScope {
  track<N extends MobileEventName>(name: N, properties: MobileEventProperties<N>): void;
}

/**
 * The operation of a failed event in its failure report. Each event has one, so a new event cannot
 * report the wrong operation. Pairing, connection, input, conversation and server events keep
 * `team`, as in earlier versions.
 */
const FAILURE_OPERATIONS: Record<MobileEventName, Operation> = {
  mobile_app_opened: "other",
  usage_viewed: "other",
  mobile_pairing_action: "team",
  mobile_connection_action: "team",
  agent_input_action: "team",
  conversation_action: "team",
  team_action: "team",
  hosted_server_plans_action: "team",
  attachment_action: "attachment",
  message_send: "turn",
  conversation_opened: "turn",
  routine_action: "routine",
  agent_action: "agent",
  agent_template_action: "agent",
  marketplace_action: "marketplace",
  memory_action: "memory",
  search_action: "search",
  account_sign_out: "auth",
  account_sign_in_started: "auth",
  account_sign_in_completed: "auth",
  notification_settings_action: "settings",
  live_activity_action: "settings",
  analytics_preference_changed: "settings",
  voice_conversation_action: "voice",
  voice_turn: "voice",
  onboarding_step: "other",
  onboarding_completed: "other",
};

const ANONYMOUS_TTL_MS = 30 * 60 * 1_000;
const MAX_PENDING_EVENTS = 100;
type PendingEvent = { name: MobileEventName; properties: SafeProperties; timestamp: string };

/** A scope belongs to the account and consent state that started an operation. */
export class MobileAnalytics {
  private anonymous: PendingEvent[] = [];
  private anonymousStartedAt: number | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private enabled = false;
  /** Set while the last event before an opt-out goes out. No other event starts. */
  private closing = false;
  private consentReady = false;
  private userReady = false;
  private generation = 0;
  private consentGeneration = 0;
  private user: Pick<CentralAuthUser, "id" | "email"> | null = null;
  private tail = Promise.resolve();
  private pending = 0;
  private client: MobileAnalyticsClient | null = null;

  constructor(
    private readonly createClient: () => MobileAnalyticsClient | null,
    private readonly createReports?: () => ReportQueue | undefined,
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.consentReady && this.enabled === enabled) return;
    this.consentReady = true;
    this.enabled = enabled;
    this.closing = false;
    const reports = this.createReports?.();
    if (reports && this.userReady) Effect.runFork(reports.configure(enabled, this.user?.id ?? null));
    this.consentGeneration += 1;
    this.generation += 1;
    if (!enabled) {
      this.clearAnonymous();
      this.client?.clear();
    } else this.identify();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setUser(user: Pick<CentralAuthUser, "id" | "email"> | null): void {
    const email = user ? normalizeEmailAddress(user.email) : null;
    const next = user && email ? { id: user.id, email } : null;
    if (this.userReady && this.user?.id === next?.id && this.user?.email === next?.email) return;
    this.userReady = true;
    this.expireAnonymous();
    if (this.user) {
      this.generation += 1;
      this.clearAnonymous();
    }
    this.user = next;
    const reports = this.createReports?.();
    if (reports && this.consentReady) Effect.runFork(reports.configure(this.enabled, next?.id ?? null));
    this.enqueue(() => this.client?.clear());
    this.identify();
    if (next) {
      const events = this.anonymous;
      this.clearAnonymous();
      for (const event of events) {
        this.enqueue(() => this.client?.track(event.name, event.properties, event.timestamp));
      }
    }
  }

  private clearAnonymous(): void {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.anonymous = [];
    this.anonymousStartedAt = null;
  }

  private expireAnonymous(): void {
    if (this.anonymousStartedAt === null || Date.now() - this.anonymousStartedAt < ANONYMOUS_TTL_MS) return;
    this.clearAnonymous();
    this.generation += 1;
  }

  private identify(): void {
    if (!this.enabled) return;
    try {
      this.client ??= this.createClient();
    } catch {
      return;
    }
    const user = this.user;
    if (user) this.enqueue(() => this.client?.identify({ profileId: user.id, email: user.email }));
  }

  private enqueue(send: () => Promise<unknown> | undefined): void {
    if (!this.enabled || !this.client) return;
    const generation = this.consentGeneration;
    this.pending += 1;
    this.tail = this.tail
      .then(async () => {
        if (this.enabled && generation === this.consentGeneration) await send();
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
  }

  scope(): MobileAnalyticsScope {
    this.expireAnonymous();
    const generation = this.generation;
    const enabled = this.enabled;
    const failureScope = this.createReports?.()?.scope() ?? null;
    return {
      track: (name, properties) => {
        this.expireAnonymous();
        if (!enabled || generation !== this.generation) return;
        this.track(name, properties, failureScope);
      },
    };
  }

  track<N extends MobileEventName>(
    name: N,
    properties: MobileEventProperties<N>,
    failureScope?: ReturnType<ReportQueue["scope"]> | null,
  ): void {
    if (!this.enabled || this.closing) return;
    this.expireAnonymous();
    const safe = sanitizeMobileEvent(name, properties);
    if (safe.result === "failed") {
      const reports = failureScope === undefined ? this.createReports?.() : failureScope;
      const operation = FAILURE_OPERATIONS[name];
      const failure = safeProperties({
        ...safe,
        operation,
        source: "action",
        severity: "error",
        cause_code: safe.cause_code ?? "unknown",
        failure_code: "operation_failed",
      });
      if (reports && failure) Effect.runFork(reports.record("client_operation_failed", failure));
    }
    if (!this.client || this.pending >= MAX_PENDING_EVENTS) return;
    if (!this.user) {
      if (this.anonymousStartedAt === null) {
        this.anonymousStartedAt = Date.now();
        this.expiry = setTimeout(() => this.expireAnonymous(), ANONYMOUS_TTL_MS);
      }
      if (this.anonymous.length >= MAX_PENDING_EVENTS) this.anonymous.shift();
      this.anonymous.push({ name, properties: safe, timestamp: new Date().toISOString() });
      return;
    }
    this.enqueue(() => this.client?.track(name, safe));
  }

  async operation<N extends MobileEventName, T>(
    name: N,
    properties: MobileEventProperties<N>,
    run: () => Promise<T>,
  ): Promise<T> {
    const scope = this.scope();
    const started = performance.now();
    try {
      const value = await run();
      scope.track(name, { ...properties, result: "succeeded", duration_ms: performance.now() - started });
      return value;
    } catch (error) {
      scope.track(name, {
        ...properties,
        result: "failed",
        failure_code: "operation_failed",
        cause_code: classifyFailure(error),
        duration_ms: performance.now() - started,
      });
      throw error;
    }
  }

  /**
   * Sends one last event and waits until it and the events before it are sent, for at most `limitMs`.
   * The caller then turns tracking off. Until then, no other event starts.
   */
  async sendLast<N extends MobileEventName>(
    name: N,
    properties: MobileEventProperties<N>,
    limitMs: number,
  ): Promise<void> {
    this.track(name, properties);
    this.closing = true;
    let limit: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.tail, new Promise((resolve) => (limit = setTimeout(resolve, limitMs)))]);
    clearTimeout(limit);
  }

  retryReports(): void {
    const reports = this.createReports?.();
    if (reports) Effect.runFork(reports.flush());
  }

  async settled(): Promise<void> {
    await this.tail;
  }
}
