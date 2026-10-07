import { Effect, Exit, Scope } from "effect";
import type { HostEventsService } from "./host-events-service";

/** A failed sync runs again after this delay. The delay doubles up to the cap until a sync succeeds. */
const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

/**
 * Owns the background route syncs of this host. One sync runs at a time. The requests that come
 * while it runs become one more sync, which registers every route when one of them asked for that.
 * A sync that leaves route work (a relay outage) runs again later, so an idle host does not keep a
 * pending URL or an unsent revocation.
 */
export class HostEventsRuntime {
  readonly #service: HostEventsService;
  readonly #scope = Scope.makeUnsafe();
  #running = false;
  #active = false;
  #queued: { all: boolean } | null = null;
  #retry: { all: boolean } | null = null;
  #retryDelayMs = RETRY_FIRST_MS;

  constructor(service: HostEventsService) {
    this.#service = service;
  }

  start(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#running) return;
      this.#running = true;
      this.syncRoutes({ all: true });
    });
  }

  /**
   * Revokes deleted routes and registers new ones. `all` registers every route again, for example
   * after the account or the host ID changed.
   */
  syncRoutes(options: { all: boolean }): void {
    if (!this.#running) return;
    this.#queued = { all: options.all || this.#queued?.all === true };
    if (this.#active) return;
    this.#active = true;
    Effect.runFork(
      this.#drain().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#active = false;
            // A request that came after the last check starts its own sync.
            if (this.#queued) this.syncRoutes(this.#queued);
          }),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#running = false;
      return Scope.close(this.#scope, Exit.void);
    });
  }

  #drain(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const next = this.#queued;
      this.#queued = null;
      return next
        ? this.#service.syncRoutes(next).pipe(
            Effect.andThen((ready) => this.#settle(next, ready)),
            Effect.andThen(() => this.#drain()),
          )
        : Effect.void;
    });
  }

  #settle(options: { all: boolean }, ready: boolean): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (ready) {
        this.#retryDelayMs = RETRY_FIRST_MS;
        return Effect.void;
      }
      if (this.#retry) {
        this.#retry.all ||= options.all;
        return Effect.void;
      }
      this.#retry = { all: options.all };
      const delay = this.#retryDelayMs;
      this.#retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS);
      return Effect.sleep(delay).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const retry = this.#retry ?? { all: false };
            this.#retry = null;
            this.syncRoutes(retry);
          }),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
        Effect.asVoid,
      );
    });
  }
}
