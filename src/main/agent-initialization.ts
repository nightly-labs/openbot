import { Deferred, Effect, Exit } from "effect";

export class AgentInitializationGate<E> {
  readonly #initialize: (rosterLoaded: Effect.Effect<void>) => Effect.Effect<void, E>;
  #pending: Deferred.Deferred<void, E> | null = null;
  #roster: Deferred.Deferred<void> | null = null;
  #settled = false;

  constructor(initialize: (rosterLoaded: Effect.Effect<void>) => Effect.Effect<void, E>) {
    this.#initialize = initialize;
  }

  get pending(): boolean {
    return this.#pending !== null && !this.#settled;
  }

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
    const exit = yield* Effect.exit(Effect.suspend(() => this.#initialize(Deferred.succeed(roster, undefined))));
    this.#settled = true;
    yield* Deferred.succeed(roster, undefined);
    if (Exit.isFailure(exit)) this.#pending = null;
    yield* Deferred.done(completion, exit);
    return yield* Deferred.await(completion);
  }, Effect.uninterruptible).bind(this);

  readonly awaitSettled = Effect.fn("AgentInitializationGate.awaitSettled")(function* (
    this: AgentInitializationGate<E>,
  ) {
    if (this.#pending) yield* Effect.exit(Deferred.await(this.#pending));
  }).bind(this);

  readonly awaitRoster = Effect.fn("AgentInitializationGate.awaitRoster")(function* (this: AgentInitializationGate<E>) {
    if (this.#pending && this.#roster) yield* Deferred.await(this.#roster);
  }).bind(this);
}
