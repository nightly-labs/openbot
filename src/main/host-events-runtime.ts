import { Effect, Exit, Scope } from "effect";
import type { HostEventsService } from "./host-events-service";

/**
 * Owns the background route syncs of this host. One sync runs at a time. The requests that come
 * while it runs become one more sync, which registers every route when one of them asked for that.
 */
export class HostEventsRuntime {
  readonly #service: HostEventsService;
  readonly #scope = Scope.makeUnsafe();
  #running = false;
  #active = false;
  #queued: { all: boolean } | null = null;

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
      return next ? this.#service.syncRoutes(next).pipe(Effect.andThen(() => this.#drain())) : Effect.void;
    });
  }
}
