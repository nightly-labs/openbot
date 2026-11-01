import { Deferred, Effect, Exit } from "effect";

export class AgentInitializationGate<E> {
  readonly #initialize: (rosterLoaded: Effect.Effect<void>) => Effect.Effect<void, E>;
  #pending: Deferred.Deferred<void, E> | null = null;
  #roster: Deferred.Deferred<void> | null = null;
  #settled = false;

  /**
   * `initialize` runs `rosterLoaded` when the agents are loaded. The steps after it, such as the
   * routine sweeps, do not change the roster, so the agent list does not wait for them.
   */
  constructor(initialize: (rosterLoaded: Effect.Effect<void>) => Effect.Effect<void, E>) {
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
    const roster = Deferred.makeUnsafe<void>();
    this.#pending = completion;
    this.#roster = roster;
    this.#settled = false;
    // Migrations must settle before shutdown can close the database.
    const exit = yield* Effect.exit(Effect.suspend(() => this.#initialize(Deferred.succeed(roster, undefined))));
    this.#settled = true;
    yield* Deferred.succeed(roster, undefined);
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

  /**
   * Waits until the initialization in progress has loaded the agents, or has ended. Starts none.
   * After a failed initialization it waits for nothing, as `awaitSettled` does.
   */
  readonly awaitRoster = Effect.fn("AgentInitializationGate.awaitRoster")(function* (this: AgentInitializationGate<E>) {
    if (this.#pending && this.#roster) yield* Deferred.await(this.#roster);
  }).bind(this);
}
