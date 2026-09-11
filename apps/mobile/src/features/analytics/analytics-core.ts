import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { type MobileEventName, type MobileEventProperties, type SafeProperties, sanitizeMobileEvent } from "./events";

export interface MobileAnalyticsClient {
  track(name: string, properties: SafeProperties, timestamp?: string): Promise<unknown> | undefined;
  identify(user: { profileId: string; email: string }): Promise<unknown> | undefined;
  clear(): undefined;
}
export interface MobileAnalyticsScope {
  track<N extends MobileEventName>(name: N, properties: MobileEventProperties<N>): void;
}

const ANONYMOUS_TTL_MS = 30 * 60 * 1_000;
const MAX_PENDING_EVENTS = 100;
type PendingEvent = { name: MobileEventName; properties: SafeProperties; timestamp: string };

/** A scope belongs to the account and consent state that started an operation. */
export class MobileAnalytics {
  private anonymous: PendingEvent[] = [];
  private anonymousStartedAt: number | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private enabled = false;
  private generation = 0;
  private consentGeneration = 0;
  private user: Pick<CentralAuthUser, "id" | "email"> | null = null;
  private tail = Promise.resolve();
  private pending = 0;
  private client: MobileAnalyticsClient | null = null;

  constructor(private readonly createClient: () => MobileAnalyticsClient | null) {}

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
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
    if (this.user?.id === next?.id && this.user?.email === next?.email) return;
    this.expireAnonymous();
    if (this.user) {
      this.generation += 1;
      this.clearAnonymous();
    }
    this.user = next;
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
    return {
      track: (name, properties) => {
        this.expireAnonymous();
        if (!enabled || generation !== this.generation) return;
        this.track(name, properties);
      },
    };
  }

  track<N extends MobileEventName>(name: N, properties: MobileEventProperties<N>): void {
    if (!this.enabled || !this.client || this.pending >= MAX_PENDING_EVENTS) return;
    this.expireAnonymous();
    const safe = sanitizeMobileEvent(name, properties);
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
        duration_ms: performance.now() - started,
      });
      throw error;
    }
  }

  async settled(): Promise<void> {
    await this.tail;
  }
}
