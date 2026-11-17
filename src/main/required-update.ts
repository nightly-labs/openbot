// The minimum app version (plan 011, item 24). The account service names the lowest version that it
// still supports for this surface: about 2 months (60 days) of releases. Below it, the renderer shows
// "Update required" and `RequestedUpdate` installs the next release at the next safe point: after the
// agent turns and the other work that `describeReadiness` lists, never mid-turn.
//
// Only a confirmed answer blocks. When the request fails, times out, or the answer cannot be read,
// the state stays as it was, so an offline app is never blocked. The request names only the surface;
// the version comparison runs here.

import {
  APP_MINIMUM_VERSION_PATH,
  isBelowMinimumVersion,
  parseAppMinimumVersion,
} from "@openbot/contracts/app-minimum-version";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { Effect, Exit, Result, Schema, Scope } from "effect";

/** The surfaces of this process. A phone asks with its own platform. */
type DesktopAppSurface = "desktop" | "host";

const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

class RequiredUpdateCheckError extends Schema.TaggedError<RequiredUpdateCheckError>()("RequiredUpdateCheckError", {
  cause: Schema.Defect(),
}) {}

/** The part of `fetch` that the check uses. */
export type RequiredUpdateFetch = (url: URL, init: RequestInit) => Promise<Response>;

interface RequiredUpdateUpdater {
  getStatus(): UpdateStatus;
  setRequiredVersion(version: string | null): void;
}

export interface RequiredUpdateOptions {
  surface: DesktopAppSurface;
  currentVersion: string;
  /** The account service address of a path, such as `centralAuth.resolveApiUrl`. */
  resolveApiUrl: (path: string) => string;
  updater: RequiredUpdateUpdater;
  /** Installs the next release by itself while true. */
  setRequired: (required: boolean) => void;
  /** A line for the main log. It has no account data. */
  log: (message: string) => void;
  fetch?: RequiredUpdateFetch;
  initialDelayMs?: number;
  intervalMs?: number;
}

export type RequiredUpdateOutcome =
  | { kind: "supported" | "required"; minimumVersion: string | null }
  | { kind: "unknown"; reason: string };

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
    this.#schedule(this.#options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
  }

  /** Asks once and applies the answer. A failure keeps the state of the last confirmed answer. */
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
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.#options.log(`The minimum version check failed; the app stays as it is: ${reason}`);
      return { kind: "unknown", reason } satisfies RequiredUpdateOutcome;
    }
    const minimumVersion = answer.success;
    // A tenant whose host manages updates cannot install one; its host asks for itself.
    const required =
      !this.#options.updater.getStatus().managedByHost &&
      isBelowMinimumVersion(this.#options.currentVersion, minimumVersion);
    this.#apply(required ? minimumVersion : null);
    return { kind: required ? "required" : "supported", minimumVersion } satisfies RequiredUpdateOutcome;
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
        ? `OpenBot ${this.#options.currentVersion} is below the minimum version ${minimumVersion}; the update is required.`
        : "OpenBot is at or above the minimum version.",
    );
    this.#options.updater.setRequiredVersion(minimumVersion);
    this.#options.setRequired(minimumVersion !== null);
  }

  #schedule(delayMs: number): void {
    if (this.#disposed) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const next = Effect.sync(() => this.#schedule(this.#options.intervalMs ?? DEFAULT_INTERVAL_MS));
      Effect.runFork(
        Effect.forkIn(this.check().pipe(Effect.ensuring(next)), this.#workScope, { startImmediately: true }),
      );
    }, delayMs);
    this.#timer.unref?.();
  }
}
