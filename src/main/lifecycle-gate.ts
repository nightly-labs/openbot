import { Deferred, Effect } from "effect";

interface QueuedStart<T, E> {
  readonly kind: "start";
  readonly began: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<T, E>;
}
interface QueuedStop<E> {
  readonly kind: "stop";
  readonly done: Deferred.Deferred<void, E>;
}

/** Serialize lifecycle operations; repeated pending actions share their result. */
export class LifecycleGate<T, E> {
  #last: QueuedStart<T, E> | QueuedStop<E> | null = null;

  start(run: () => Effect.Effect<T, E>): Effect.Effect<T, E> {
    return Effect.gen({ self: this }, function* () {
      const previous = this.#last;
      if (previous?.kind === "start") return yield* Deferred.await(previous.done);
      const operation: QueuedStart<T, E> = {
        kind: "start",
        began: Deferred.makeUnsafe(),
        done: Deferred.makeUnsafe(),
      };
      this.#last = operation;
      return yield* Effect.gen(function* () {
        if (previous) yield* Effect.exit(Deferred.await(previous.done));
        yield* Deferred.succeed(operation.began, undefined);
        return yield* run();
      }).pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            yield* Deferred.done(operation.done, exit);
            if (this.#last === operation) this.#last = null;
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  stop(run: () => Effect.Effect<void, E>, interruptStart?: () => Effect.Effect<void, E>): Effect.Effect<void, E> {
    return Effect.gen({ self: this }, function* () {
      const previous = this.#last;
      if (previous?.kind === "stop") return yield* Deferred.await(previous.done);
      const operation: QueuedStop<E> = { kind: "stop", done: Deferred.makeUnsafe() };
      this.#last = operation;
      return yield* Effect.gen(function* () {
        const interrupted = yield* Effect.exit(
          Effect.gen(function* () {
            if (previous?.kind === "start" && interruptStart) {
              yield* Deferred.await(previous.began);
              yield* interruptStart();
            }
          }),
        );
        if (previous) yield* Effect.exit(Deferred.await(previous.done));
        yield* run();
        yield* interrupted;
      }).pipe(
        Effect.onExit((exit) =>
          Effect.gen({ self: this }, function* () {
            yield* Deferred.done(operation.done, exit);
            if (this.#last === operation) this.#last = null;
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }
}
