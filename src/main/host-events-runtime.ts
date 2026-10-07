import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Scope } from "effect";
import type { EventStore } from "../backend/event-store";
import type { HostEventsService } from "./host-events-service";
import type { WebhookDeliveryWorker } from "./webhook-delivery";

const logger = createOpenBotLogger("host-events");
const MAX_TIMER_DELAY = 2_147_000_000;

export interface HostEventsRuntimeOptions {
  service: HostEventsService;
  store: EventStore;
  delivery: WebhookDeliveryWorker;
}

/** Owns one wake timer and all in-flight event dispatch and outbound requests for this host. */
export class HostEventsRuntime {
  readonly #options: HostEventsRuntimeOptions;
  readonly #scope = Scope.makeUnsafe();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #busy = false;
  #requested = false;
  #retryNotBefore = 0;
  #syncingRoutes = false;

  constructor(options: HostEventsRuntimeOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("HostEventsRuntime.start")(function* (this: HostEventsRuntime) {
    if (this.#running) return;
    yield* Effect.sync(() => {
      this.#options.store.resumeClaimedDispatches();
      this.#options.store.resumeSendingDeliveries();
      this.#running = true;
      this.wake();
    });
  }).bind(this);

  /** Called by receipt acceptance, routine changes, and destination changes. */
  wake(): void {
    if (!this.#running) return;
    this.#requested = true;
    if (this.#busy) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      Effect.runFork(this.#drain().pipe(Effect.forkIn(this.#scope, { startImmediately: true })));
    }, 0);
    this.#timer.unref();
  }

  syncRoutes(): void {
    if (!this.#running || this.#syncingRoutes) return;
    this.#syncingRoutes = true;
    Effect.runFork(
      this.#options.service.syncRoutes().pipe(
        Effect.catch(() =>
          Effect.sync(() => logger.warn("Webhook routes are not ready. Local settings were retained.")),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.#syncingRoutes = false;
          }),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  readonly stop = Effect.fn("HostEventsRuntime.stop")(function* (this: HostEventsRuntime) {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  readonly #drain = Effect.fn("HostEventsRuntime.drain")(function* (this: HostEventsRuntime) {
    if (!this.#running || this.#busy) return;
    this.#busy = true;
    yield* Effect.gen({ self: this }, function* () {
      do {
        this.#requested = false;
        const dispatch = yield* Effect.result(this.#options.service.dispatch());
        yield* this.#options.delivery.runDue();
        if (dispatch._tag === "Failure") return yield* dispatch.failure;
        this.#retryNotBefore = 0;
      } while (this.#running && this.#requested);
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          // A failed local write must not cause an immediate timer loop on the same due row.
          this.#retryNotBefore = Date.now() + 10_000;
          logger.warn("An event operation failed. Its local state is retained.");
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#busy = false;
          this.#arm();
        }),
      ),
    );
  });

  #arm(): void {
    if (!this.#running || this.#busy) return;
    const next = this.#options.store.nextDeliveryAt();
    if (!next && this.#retryNotBefore === 0) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.wake();
      },
      Math.max(
        0,
        Math.min(MAX_TIMER_DELAY, (this.#retryNotBefore || (next ? new Date(next).getTime() : 0)) - Date.now()),
      ),
    );
    this.#timer.unref();
  }
}
