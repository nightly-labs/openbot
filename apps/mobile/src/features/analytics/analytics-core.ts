import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { type MobileEventName, type MobileEventProperties, type SafeProperties, sanitizeMobileEvent } from "./events";

export interface MobileAnalyticsClient {
  track(name: string, properties: SafeProperties): Promise<unknown> | undefined;
  identify(user: { profileId: string; email: string }): Promise<unknown> | undefined;
  clear(): undefined;
}
export interface MobileAnalyticsScope {
  track<N extends MobileEventName>(name: N, properties: MobileEventProperties<N>): void;
}

/** A scope belongs to the account and consent state that started an operation. */
export class MobileAnalytics {
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
    if (!enabled) this.client?.clear();
    else this.identify();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setUser(user: Pick<CentralAuthUser, "id" | "email"> | null): void {
    const email = user ? normalizeEmailAddress(user.email) : null;
    const next = user && email ? { id: user.id, email } : null;
    if (this.user?.id === next?.id && this.user?.email === next?.email) return;
    this.generation += 1;
    this.user = next;
    this.enqueue(() => this.client?.clear());
    this.identify();
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
    const generation = this.generation;
    const enabled = this.enabled;
    return {
      track: (name, properties) => {
        if (!enabled || generation !== this.generation) return;
        this.track(name, properties);
      },
    };
  }

  track<N extends MobileEventName>(name: N, properties: MobileEventProperties<N>): void {
    if (this.pending >= 100) return;
    const safe = sanitizeMobileEvent(name, properties);
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
