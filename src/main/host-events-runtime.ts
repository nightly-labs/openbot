import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Scope } from "effect";
import type { WebhookDestinationStore } from "../backend/webhook-destination-store";
import type { HostEventsService } from "./host-events-service";
import type { WebhookDeliveryWorker } from "./webhook-delivery";

const logger = createOpenBotLogger("host-events");
const MAX_TIMER_DELAY = 2_147_000_000;
/** A failed local write must not cause an immediate timer loop on the same due row. */
const FAILED_DRAIN_DELAY_MS = 10_000;

export interface HostEventsRuntimeOptions {
  service: HostEventsService;
  destinations: Pick<WebhookDestinationStore, "resumeSending" | "nextDeliveryAt">;
  delivery: WebhookDeliveryWorker;
}

/** Owns one wake timer, the outbound requests and the background route syncs of this host. */
export class HostEventsRuntime {
  readonly #options: HostEventsRuntimeOptions;
  readonly #scope = Scope.makeUnsafe();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #busy = false;
  #requested = false;
  #retryNotBefore = 0;

  constructor(options: HostEventsRuntimeOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("HostEventsRuntime.start")(function* (this: HostEventsRuntime) {
    if (this.#running) return;
    yield* Effect.sync(() => {
      this.#options.destinations.resumeSending();
      this.#running = true;
      this.wake();
    });
    this.syncRoutes({ all: true });
  }).bind(this);

  /** Called after a receipt starts a run, and after a destination, delivery or routine change. */
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
        yield* this.#options.delivery.runDue();
        this.#retryNotBefore = 0;
      } while (this.#running && this.#requested);
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          this.#retryNotBefore = Date.now() + FAILED_DRAIN_DELAY_MS;
          logger.warn("A webhook delivery could not be saved. Its local state is retained.");
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
    const next = this.#options.destinations.nextDeliveryAt();
    const due = this.#retryNotBefore || (next ? Date.parse(next) : 0);
    if (!due) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.wake();
      },
      Math.max(0, Math.min(MAX_TIMER_DELAY, due - Date.now())),
    );
    this.#timer.unref();
  }
}
