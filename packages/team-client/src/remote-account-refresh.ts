import { Deferred, Effect } from "effect";
import { runTeamEffect } from "./effect-boundary";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "./remote-directory";

const ACCOUNT_RETRY_INTERVAL_MS = 60_000;

/** One endpoint per account: absolute freshness, shared requests, and no background polling. */
export function createRemoteAccountRefresh<E>(load: () => Effect.Effect<void, E>, now = Date.now) {
  let active = false;
  let disposed = false;
  let pending: Deferred.Deferred<void, E> | null = null;
  let dueAt = Number.NEGATIVE_INFINITY;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancelTimer();
    if (!active || disposed || pending) return;
    timer = setTimeout(() => void runTeamEffect(refresh()).catch(() => undefined), Math.max(0, dueAt - now()));
  }

  const refresh = Effect.fn("RemoteAccountRefresh.refresh")(function* (force = false) {
    if (disposed) return;
    if (pending) return yield* Deferred.await(pending);
    if (!active || (!force && now() < dueAt)) return;
    cancelTimer();
    const startedRevision = revision;
    const operation = Deferred.makeUnsafe<void, E>();
    pending = operation;
    return yield* Effect.gen(function* () {
      // Foreground work can be cancelled by immediate background entry.
      yield* Effect.callback<void>((resume) => {
        queueMicrotask(() => resume(Effect.void));
      });
      if (!active || disposed) return;
      yield* load().pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            dueAt = now() + ACCOUNT_RETRY_INTERVAL_MS;
          }),
        ),
      );
      dueAt = revision === startedRevision ? now() + REMOTE_ACCOUNT_CHECK_INTERVAL_MS : now();
    }).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          yield* Deferred.done(operation, exit);
          pending = null;
          schedule();
        }),
      ),
    );
  });

  return {
    refresh,
    invalidate() {
      revision += 1;
      dueAt = Number.NEGATIVE_INFINITY;
      schedule();
    },
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      cancelTimer();
      if (active) {
        void runTeamEffect(refresh()).catch(() => undefined);
        schedule();
      }
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
