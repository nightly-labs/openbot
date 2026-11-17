import { Effect, Exit, Queue, Scope, Semaphore } from "effect";
import type { JevRoutingObservation } from "../backend/agent/jev-work-router";
import { type PreferenceFileFailure, writePreferenceFile } from "./preference-file";

export const CUSTOM_THREAD_ROUTING_STATUS_FILE = "custom-thread-routing-status-v1.json";
const RETAINED_OBSERVATIONS = 200;

export interface CustomThreadRoutingStatus {
  version: 1;
  events: Array<JevRoutingObservation & { recordedAt: string }>;
}

export interface CustomThreadRoutingStatusStoreOptions {
  /** The isolated fixture can hold disk I/O without holding a routing decision. */
  write?(path: string, status: CustomThreadRoutingStatus): Effect.Effect<void, PreferenceFileFailure>;
}

/**
 * Owns a bounded diagnostic buffer and one scoped writer. Recording never waits for disk.
 * A one-slot wake queue coalesces bursts; the buffer retains the latest 200 events.
 * Stop the agent service first, then dispose this store to flush and close its worker.
 */
export class CustomThreadRoutingStatusStore {
  readonly #path: string;
  readonly #options: CustomThreadRoutingStatusStoreOptions;
  readonly #writes = Semaphore.makeUnsafe(1);
  readonly #scope = Scope.makeUnsafe();
  #wake: Queue.Queue<void> | null = null;
  #events: CustomThreadRoutingStatus["events"] = [];
  #version = 0;
  #writtenVersion = 0;
  #started = false;
  #closed = false;

  constructor(path: string, options: CustomThreadRoutingStatusStoreOptions = {}) {
    this.#path = path;
    this.#options = options;
  }

  readonly start = Effect.fn("CustomThreadRoutingStatusStore.start")(function* (this: CustomThreadRoutingStatusStore) {
    if (this.#started || this.#closed) return;
    this.#started = true;
    const wake = yield* Queue.sliding<void>(1);
    this.#wake = wake;
    if (this.#version > this.#writtenVersion) Queue.offerUnsafe(wake, undefined);
    yield* Queue.take(wake).pipe(
      Effect.andThen(() => this.flush()),
      Effect.forever,
      Effect.forkIn(this.#scope, { startImmediately: true }),
    );
  });

  /** Accept exactly one event without waiting for the writer or its semaphore. */
  readonly record = Effect.fn("CustomThreadRoutingStatusStore.record")((observation: JevRoutingObservation) =>
    Effect.sync(() => {
      if (this.#closed) return;
      // Copy only the fixed fields, even if an internal caller has additional runtime properties.
      this.#events.push({
        agentId: observation.agentId,
        outcome: observation.outcome,
        reason: observation.reason,
        elapsedMs: observation.elapsedMs,
        candidateCount: observation.candidateCount,
        ...(observation.httpStatus === undefined ? {} : { httpStatus: observation.httpStatus }),
        recordedAt: new Date().toISOString(),
      });
      if (this.#events.length > RETAINED_OBSERVATIONS) this.#events.shift();
      this.#version += 1;
      if (this.#wake) Queue.offerUnsafe(this.#wake, undefined);
    }),
  );

  /** Write the latest accepted snapshot. Failures are private; the next record can try its newer view. */
  readonly flush = Effect.fn("CustomThreadRoutingStatusStore.flush")(function* (this: CustomThreadRoutingStatusStore) {
    yield* this.#writes.withPermit(
      Effect.suspend(() => {
        if (this.#version === this.#writtenVersion) return Effect.void;
        const version = this.#version;
        const status: CustomThreadRoutingStatus = { version: 1, events: [...this.#events] };
        return Effect.suspend(
          () => this.#options.write?.(this.#path, status) ?? writePreferenceFile(this.#path, status),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              this.#writtenVersion = version;
            }),
          ),
          Effect.catchCause(() => Effect.void),
        );
      }),
    );
  });

  readonly dispose = Effect.fn("CustomThreadRoutingStatusStore.dispose")(function* (
    this: CustomThreadRoutingStatusStore,
  ) {
    if (this.#closed) return;
    this.#closed = true;
    yield* this.flush();
    yield* Scope.close(this.#scope, Exit.void);
    if (this.#wake) yield* Queue.shutdown(this.#wake);
    this.#wake = null;
  }, Effect.uninterruptible);
}
