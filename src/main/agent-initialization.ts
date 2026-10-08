import { Deferred, Effect, Exit } from "effect";

export class AgentInitializationGate<E> {
  readonly #initialize: () => Effect.Effect<void, E>;
  #pending: Deferred.Deferred<void, E> | null = null;
  #settled = false;

  constructor(initialize: () => Effect.Effect<void, E>) {
    this.#initialize = initialize;
  }

  /** Whether the first initialization — including database migrations — is still running. */
  get pending(): boolean {
    return this.#pending !== null && !this.#settled;
  }

  /** True only after initialization succeeds, never before start or after failure. */
  get succeeded(): boolean {
    return this.#settled && this.#pending !== null;
  }

  readonly start = Effect.fn("AgentInitializationGate.start")(function* (this: AgentInitializationGate<E>) {
    if (this.#pending) return yield* Deferred.await(this.#pending);
    const completion = Deferred.makeUnsafe<void, E>();
    this.#pending = completion;
    this.#settled = false;
    // Migrations must settle before shutdown can close the database.
    const exit = yield* Effect.exit(Effect.suspend(this.#initialize));
    this.#settled = true;
    if (Exit.isFailure(exit)) this.#pending = null;
    yield* Deferred.done(completion, exit);
    return yield* Deferred.await(completion);
  }, Effect.uninterruptible).bind(this);

  /** Waits for the initialization in progress to end. Starts none, and does not retry a failed one. */
  readonly awaitSettled = Effect.fn("AgentInitializationGate.awaitSettled")(function* (
    this: AgentInitializationGate<E>,
  ) {
    if (this.#pending) yield* Effect.exit(Deferred.await(this.#pending));
  }).bind(this);
}
