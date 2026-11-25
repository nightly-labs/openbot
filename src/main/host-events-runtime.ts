import { Effect, Exit, Scope } from "effect";
import type { HostEventsService } from "./host-events-service";

const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

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
            if (this.#queued) this.syncRoutes(this.#queued);
          }),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  setAccountPrincipal(principalId: string | null): void {
    this.#service.setAccountPrincipal(principalId);
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
