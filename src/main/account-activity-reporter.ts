import { Effect, Result } from "effect";

export const ACCOUNT_ACTIVITY_PATH = "/v1/me/activity";
const MAX_ACCOUNTS_PER_REPORT = 100;
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
}

export class AccountActivityReporter {
  readonly #send: AccountActivityReporterOptions["send"];
  readonly #now: () => number;
  #day: string | null = null;
  #reported = new Set<string>();
  #pending = new Set<string>();
  #inFlight = new Set<string>();
  #sending: Promise<void> | null = null;
  #retryAt = 0;

  constructor(options: AccountActivityReporterOptions) {
    this.#send = options.send;
    this.#now = options.now ?? Date.now;
  }

  record(accountId: string): void {
    const day = DAY_FORMAT.format(new Date(this.#now()));
    if (day !== this.#day) {
      this.#day = day;
      this.#reported = new Set();
    }
    if (this.#reported.has(accountId) || this.#inFlight.has(accountId)) return;
    this.#pending.add(accountId);
    this.#flush();
  }

  async idle(): Promise<void> {
    while (this.#sending) await this.#sending;
  }

  #flush(): void {
    if (this.#sending || this.#pending.size === 0 || this.#now() < this.#retryAt) return;
    const day = this.#day;
    const batch = [...this.#pending].slice(0, MAX_ACCOUNTS_PER_REPORT);
    for (const account of batch) {
      this.#pending.delete(account);
      this.#inFlight.add(account);
    }
    this.#sending = Effect.runPromise(Effect.result(this.#send(batch))).then((result) => {
      this.#sending = null;
      this.#inFlight.clear();
      if (Result.isFailure(result)) {
        for (const account of batch) this.#pending.add(account);
        this.#retryAt = this.#now() + RETRY_AFTER_FAILURE_MS;
        return;
      }
      if (day === this.#day) for (const account of batch) this.#reported.add(account);
      this.#flush();
    });
  }
}
