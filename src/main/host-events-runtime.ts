import { Effect, Exit, Scope } from "effect";
import type { HostEventsService } from "./host-events-service";

export interface HostEventsRuntimeOptions {
  service: HostEventsService;
}

/** Owns the background route syncs of this host. */
export class HostEventsRuntime {
  readonly #options: HostEventsRuntimeOptions;
  readonly #scope = Scope.makeUnsafe();
  #running = false;

  constructor(options: HostEventsRuntimeOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("HostEventsRuntime.start")(function* (this: HostEventsRuntime) {
    if (this.#running) return;
    yield* Effect.sync(() => {
      this.#running = true;
    });
    this.syncRoutes({ all: true });
  }).bind(this);

  /**
   * Revokes deleted routes and registers new ones. `all` registers every route again, for example
   * after the account or the host ID changed.
   */
  syncRoutes(options: { all: boolean }): void {
    if (!this.#running) return;
    Effect.runFork(
      this.#options.service.syncRoutes(options).pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
    );
  }

  readonly stop = Effect.fn("HostEventsRuntime.stop")(function* (this: HostEventsRuntime) {
    this.#running = false;
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);
}
