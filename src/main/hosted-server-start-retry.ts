import { Deferred, Effect } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";
/**
 * A hosted server has nobody to press Retry, so it publishes the host again after a failed start. A
 * start that could not sign in leaves the host idle or unconfigured, so those phases also start again.
 * Nothing here stops the server. The Worker stops it when it reports no use (`HostedServerActivity`).
 */

import type { HostPhase } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../backend/effect-boundary";

const CHECK_INTERVAL_MS = 60_000;
const START_RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];
const RETRY_PHASES: ReadonlySet<HostPhase> = new Set(["error", "idle", "unconfigured"]);

export interface HostedServerStartRetryOptions {
  hostPhase: () => HostPhase;
  /** Signs in again when the first start could not, then publishes the host. */
  startHost: () => Effect.Effect<unknown, RemoteWorkflowError>;
  onError: (message: string, error: unknown) => void;
  now?: () => number;
}

export class HostedServerStartRetry {
  readonly #options: HostedServerStartRetryOptions;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #startFailures = 0;
  #nextStartAt = 0;

  constructor(options: HostedServerStartRetryOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void runCauseEffect(this.tick()).catch((error) =>
        this.#options.onError("The hosted server start retry failed.", error),
      );
    }, CHECK_INTERVAL_MS);
    this.#timer.unref();
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      return this.#pending ? Deferred.await(this.#pending).pipe(Effect.catch(() => Effect.void)) : Effect.void;
    });
  }

  tick(): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.suspend(() => {
      if (this.#pending) return Deferred.await(this.#pending);
      const pending = Deferred.makeUnsafe<void, RemoteWorkflowError>();
      this.#pending = pending;
      return this.#tickEffect().pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            this.#pending = null;
            yield* Deferred.done(pending, exit);
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  readonly #tickEffect = Effect.fn("HostedServerStartRetry.tick")(function* (this: HostedServerStartRetry) {
    const now = this.#now();
    const phase = this.#options.hostPhase();
    if (phase === "online") {
      this.#startFailures = 0;
      this.#nextStartAt = 0;
      return;
    }
    if (!RETRY_PHASES.has(phase) || now < this.#nextStartAt) return;
    const delay = START_RETRY_DELAYS_MS[Math.min(this.#startFailures, START_RETRY_DELAYS_MS.length - 1)] ?? 0;
    this.#startFailures += 1;
    this.#nextStartAt = now + delay;
    yield* this.#options.startHost();
  });
}
