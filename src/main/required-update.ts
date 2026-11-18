// The minimum app version (plan 011, item 24). Below the minimum that the account service names, the
// renderer shows "Update required" and `RequestedUpdate` installs the next release when the agents
// are idle. A failed check never blocks: it keeps the last confirmed state.

import {
  APP_MINIMUM_VERSION_PATH,
  isBelowMinimumVersion,
  parseAppMinimumVersion,
} from "@openbot/contracts/app-minimum-version";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { Effect, Exit, Result, Schema, Scope } from "effect";

const INITIAL_DELAY_MS = 15_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

class RequiredUpdateCheckError extends Schema.TaggedError<RequiredUpdateCheckError>()("RequiredUpdateCheckError", {
  cause: Schema.Defect(),
}) {}

export type RequiredUpdateFetch = (url: URL, init: RequestInit) => Promise<Response>;

export interface RequiredUpdateOptions {
  surface: "desktop" | "host";
  currentVersion: string;
  resolveApiUrl: (path: string) => string;
  updater: { getStatus(): UpdateStatus; setRequiredVersion(version: string | null): void };
  /** Installs the next release by itself while true. */
  setRequired: (required: boolean) => void;
  /** A line for the main log. It has no account data. */
  log: (message: string) => void;
  fetch?: RequiredUpdateFetch;
}

type RequiredUpdateOutcome = "supported" | "required" | "unknown";

export class RequiredUpdate {
  readonly #options: RequiredUpdateOptions;
  readonly #fetch: RequiredUpdateFetch;
  readonly #workScope = Scope.makeUnsafe();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #required: string | null = null;
  #disposed = false;

  constructor(options: RequiredUpdateOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  start(): void {
    this.#schedule(INITIAL_DELAY_MS);
  }

  readonly check = Effect.fn("RequiredUpdate.check")(function* (this: RequiredUpdate) {
    const url = new URL(this.#options.resolveApiUrl(APP_MINIMUM_VERSION_PATH));
    url.searchParams.set("surface", this.#options.surface);
    const answer = yield* Effect.result(
      Effect.tryPromise({
        try: async (signal) => {
          const response = await this.#fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          });
          if (!response.ok) throw new Error(`The account service answered ${response.status}.`);
          return parseAppMinimumVersion(await response.json());
        },
        catch: (cause) => new RequiredUpdateCheckError({ cause }),
      }),
    );
    if (Result.isFailure(answer)) {
      const { cause } = answer.failure;
      this.#options.log(`The minimum version check failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      return "unknown" satisfies RequiredUpdateOutcome;
    }
    // A tenant whose host manages updates cannot install one; its host checks for itself.
    const required =
      !this.#options.updater.getStatus().managedByHost &&
      isBelowMinimumVersion(this.#options.currentVersion, answer.success);
    this.#apply(required ? answer.success : null);
    return (required ? "required" : "supported") satisfies RequiredUpdateOutcome;
  }).bind(this);

  readonly dispose = Effect.fn("RequiredUpdate.dispose")(function* (this: RequiredUpdate) {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    yield* Scope.close(this.#workScope, Exit.void);
  }).bind(this);

  #apply(minimumVersion: string | null): void {
    if (this.#required === minimumVersion) return;
    this.#required = minimumVersion;
    this.#options.log(
      minimumVersion
        ? `OpenBot ${this.#options.currentVersion} is below the minimum version ${minimumVersion}.`
        : "OpenBot is at or above the minimum version.",
    );
    this.#options.updater.setRequiredVersion(minimumVersion);
    this.#options.setRequired(minimumVersion !== null);
  }

  #schedule(delayMs: number): void {
    if (this.#disposed) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const next = Effect.sync(() => this.#schedule(INTERVAL_MS));
      Effect.runFork(
        Effect.forkIn(this.check().pipe(Effect.ensuring(next)), this.#workScope, { startImmediately: true }),
      );
    }, delayMs);
    this.#timer.unref?.();
  }
}
