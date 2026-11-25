import { Effect, Exit } from "effect";

export const ACCOUNT_ACTIVITY_PATH = "/v1/me/activity";
const MAX_ACCOUNTS_PER_REPORT = 50;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface AccountActivityReporterOptions {
  send: (accounts: readonly string[]) => Effect.Effect<unknown, unknown>;
  now?: () => number;
  retryAfterMs?: number;
}

export class AccountActivityReporter {
  readonly #send: AccountActivityReporterOptions["send"];
  readonly #now: () => number;
  readonly #retryAfterMs: number;
  #day: string | null = null;
  #reported = new Set<string>();
  #pending = new Set<string>();
  #inFlight = new Set<string>();
  #sending: Promise<void> | null = null;
  #retryAt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AccountActivityReporterOptions) {
    this.#send = options.send;
    this.#now = options.now ?? Date.now;
    this.#retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_FAILURE_MS;
  }

  record(accountId: string): void {
    this.#rollDay();
    if (this.#reported.has(accountId) || this.#inFlight.has(accountId)) return;
    this.#pending.add(accountId);
    this.#flush();
  }

  clear(): void {
    this.#pending = new Set();
    this.#reported = new Set();
  }

  async idle(): Promise<void> {
    while (this.#sending) await this.#sending;
  }

  #rollDay(): void {
    const day = DAY_FORMAT.format(new Date(this.#now()));
    if (day === this.#day) return;
    this.#day = day;
    this.#reported = new Set();
    this.#pending = new Set();
  }

  #flush(): void {
    this.#rollDay();
    if (this.#sending || this.#pending.size === 0 || this.#now() < this.#retryAt) return;
    const day = this.#day;
    const batch = [...this.#pending].slice(0, MAX_ACCOUNTS_PER_REPORT);
    for (const account of batch) {
      this.#pending.delete(account);
      this.#inFlight.add(account);
    }
    this.#sending = Effect.runPromiseExit(this.#send(batch)).then((exit) => {
      this.#sending = null;
      this.#inFlight.clear();
      if (Exit.isFailure(exit)) {
        if (day === this.#day) for (const account of batch) this.#pending.add(account);
        this.#retryAt = this.#now() + this.#retryAfterMs;
        this.#scheduleRetry();
        return;
      }
      if (day === this.#day) for (const account of batch) this.#reported.add(account);
      this.#flush();
    });
  }

  #scheduleRetry(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#retryAt = 0;
      this.#flush();
    }, this.#retryAfterMs);
    this.#retryTimer.unref?.();
  }
}

export interface HostAccountActivityOptions extends AccountActivityReporterOptions {
  analyticsOn: boolean;
  resolveOwner: () => { id: string } | null;
  memberAccountId: (memberId: string) => string | null;
}

export class HostAccountActivity {
  readonly #reporter: AccountActivityReporter;
  readonly #resolveOwner: HostAccountActivityOptions["resolveOwner"];
  readonly #memberAccountId: HostAccountActivityOptions["memberAccountId"];
  #analyticsOn: boolean;

  constructor(options: HostAccountActivityOptions) {
    const { analyticsOn, resolveOwner, memberAccountId, send, ...reporter } = options;
    this.#analyticsOn = analyticsOn;
    this.#resolveOwner = resolveOwner;
    this.#memberAccountId = memberAccountId;
    this.#reporter = new AccountActivityReporter({
      ...reporter,
      send: (accounts) => (this.#analyticsOn ? send(accounts) : Effect.void),
    });
  }

  setAnalyticsOn(enabled: boolean): void {
    this.#analyticsOn = enabled;
    if (!enabled) this.#reporter.clear();
  }

  turnStarted(): void {
    if (!this.#analyticsOn) return;
    const owner = this.#resolveOwner();
    if (owner) this.#reporter.record(owner.id);
  }

  memberUsed(memberId: string): void {
    if (!this.#analyticsOn) return;
    const accountId = this.#memberAccountId(memberId);
    if (accountId) this.#reporter.record(accountId);
  }

  idle(): Promise<void> {
    return this.#reporter.idle();
  }
}
