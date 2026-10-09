import type { BrowserTarget } from "@openbot/contracts/ipc";
import { Deferred, Effect, Fiber } from "effect";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";
import type { BrowserHostTab, KeepQueueBlocked } from "./browser-host-tab";
import { describeBrowserTarget } from "./browser-navigation";
import { TimeoutError, withTimeout } from "./with-timeout";

const ACTION_POST_DISPATCH_TIMEOUT_MS = 10_000;
const OPERATION_UNWIND_GRACE_MS = 1_000;
// Let an operation report its own deadline before the transport backstop wins.
const OPERATION_DEADLINE_BACKSTOP_MS = 250;

/** Return the response when ready; retain the queue until all owned work drains. */
export const enqueueTabOperation = Effect.fn("BrowserTab.enqueue")(function* <A>(
  tab: BrowserHostTab,
  operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Effect.Effect<A, BrowserOperationError>,
  allowProtected = false,
) {
  const previous = tab.queue;
  const drained = Deferred.makeUnsafe<void>();
  const response = Deferred.makeUnsafe<A, BrowserOperationError>();
  const drains: Effect.Effect<unknown, BrowserOperationError>[] = [];
  let cancelled = false;
  let active: Fiber.Fiber<A, BrowserOperationError> | undefined;
  tab.queue = drained;
  tab.pendingOperations += 1;
  yield* Effect.forkIn(
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Effect.gen(function* () {
          yield* Deferred.await(previous);
          if (cancelled) return yield* Effect.interrupt;
          if (tab.secret?.submitted && !allowProtected) {
            return yield* browserFailure(
              new Error("Browser inspection is protected during authentication. Use takeover."),
            );
          }
          active = yield* Effect.forkIn(
            browserSync(() => operation(tab, (work) => drains.push(work))).pipe(Effect.flatten, Effect.interruptible),
            tab.scope,
            { startImmediately: true },
          );
          return yield* Fiber.join(active);
        }),
      );
      yield* Deferred.done(response, result);
      yield* Effect.forEach(drains, Effect.exit, { concurrency: "unbounded", discard: true });
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          tab.pendingOperations -= 1;
          yield* Deferred.succeed(drained, undefined);
        }),
      ),
    ),
    tab.scope,
    { startImmediately: true, uninterruptible: true },
  );
  return yield* Deferred.await(response).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        cancelled = true;
        if (active) active.interruptUnsafe();
      }),
    ),
  );
});

export const readTabSnapshot = Effect.fn("BrowserTab.readTabSnapshot")(function* (
  tab: BrowserHostTab,
  revision: number,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMs = 10_000,
  timeoutMessage = "Browser snapshot timed out.",
) {
  const history = tab.diagnostics.snapshot();
  const result = yield* boundEngineOperation(
    tab,
    tab.engine.snapshot({
      tabId: tab.id,
      revision,
      environment: tab.environment,
      diagnostics: history.diagnostics,
      actions: history.actions,
    }),
    timeoutMs,
    timeoutMessage,
    keepQueueBlocked,
  );
  tab.revision = revision;
  return result;
});

/** A deadline ends the response; the tab queue still owns transport cleanup. */
export const boundEngineOperation = Effect.fn("BrowserTab.boundOperation")(function* <A>(
  tab: BrowserHostTab,
  operation: Effect.Effect<A, BrowserOperationError>,
  timeoutMs: number,
  timeoutMessage: string,
  keepQueueBlocked: KeepQueueBlocked,
) {
  const completion = yield* Effect.forkIn(operation, tab.scope, { startImmediately: true });
  return yield* withTimeout(Fiber.join(completion), timeoutMs, timeoutMessage).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        if (tab.engine.cancelPendingCommands()) completion.interruptUnsafe();
        // An attached external debugger may still have a command in flight.
        keepQueueBlocked(Fiber.await(completion));
      }),
    ),
    Effect.catch((error) => {
      if (isTimeoutError(error instanceof TimeoutError ? error : error.cause)) {
        keepQueueBlocked(unwindStalledOperation(tab, completion));
      }
      return Effect.fail(error instanceof TimeoutError ? browserFailure(error) : error);
    }),
  );
});

const unwindStalledOperation = Effect.fn("BrowserTab.unwind")(function* <A>(
  tab: BrowserHostTab,
  completion: Fiber.Fiber<A, BrowserOperationError>,
) {
  if (yield* finishesWithin(Fiber.await(completion), OPERATION_UNWIND_GRACE_MS)) return;
  if (!tab.engine.cancelPendingCommands()) {
    yield* Fiber.await(completion);
    return;
  }
  yield* finishesWithin(Fiber.await(completion), OPERATION_UNWIND_GRACE_MS);
});

export const runTabAction = Effect.fn("BrowserTab.action")(
  (
    tab: BrowserHostTab,
    action: string,
    target: BrowserTarget | undefined,
    operation: (
      tab: BrowserHostTab,
      deadline: number,
      markDispatched: () => void,
    ) => Effect.Effect<void, BrowserOperationError>,
    timeoutMs = 10_000,
    onOperationStarted?: (completion: Fiber.Fiber<void, BrowserOperationError>) => void,
  ) =>
    enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
      Effect.gen(function* () {
        if (tab.secret)
          return yield* browserFailure(
            new Error("Browser inspection is protected during authentication. Use takeover."),
          );
        const deadline = Date.now() + timeoutMs;
        const timeoutMessage = `Browser ${action} timed out.`;
        let actionRecorded = false;
        let dispatched = false;
        let cancellationConfirmed = false;
        let stalledSettle: Fiber.Fiber<void, BrowserOperationError> | undefined;
        const completion = yield* Effect.forkIn(
          Effect.gen(function* () {
            let highlighted = false;
            yield* Effect.gen(function* () {
              // CDP emulates page focus. Native focus would interrupt typing in another chat.
              if (target && target.kind !== "point")
                highlighted = yield* tab.engine.highlight(target).pipe(
                  Effect.as(true),
                  Effect.catch(() => Effect.succeed(false)),
                );
              yield* browserSync(() => remainingTime(deadline, timeoutMessage));
              yield* operation(tab, deadline, () => {
                dispatched = true;
              });
            }).pipe(
              Effect.ensuring(
                Effect.suspend(() =>
                  highlighted && !cancellationConfirmed ? tab.engine.hideHighlight().pipe(Effect.ignore) : Effect.void,
                ),
              ),
            );
          }),
          tab.scope,
          { startImmediately: true },
        );
        onOperationStarted?.(completion);
        // Register before waiting, so even an interrupted caller leaves the queue protected.
        keepQueueBlocked(
          Effect.gen(function* () {
            if (!cancellationConfirmed) yield* Fiber.await(completion);
            if (!tab.closing && !tab.contents.isDestroyed() && tab.contents.isLoading())
              yield* tab.engine.stopLoading().pipe(Effect.ignore);
            if (stalledSettle) yield* unwindStalledOperation(tab, stalledSettle);
          }),
        );
        return yield* Effect.gen(function* () {
          yield* withTimeout(
            Fiber.join(completion),
            Math.max(0, deadline - Date.now()) + OPERATION_DEADLINE_BACKSTOP_MS,
            timeoutMessage,
          ).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (!(error instanceof TimeoutError)) return yield* error;
                cancellationConfirmed = tab.engine.cancelPendingCommands();
                if (dispatched && !cancellationConfirmed) yield* Fiber.await(completion);
                return yield* browserFailure(error);
              }),
            ),
          );
          const settleTimeout = Math.max(1, deadline - Date.now());
          const settle = yield* Effect.forkIn(tab.engine.settle(settleTimeout), tab.scope, { startImmediately: true });
          yield* withTimeout(Fiber.join(settle), settleTimeout, timeoutMessage).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                if (tab.engine.cancelPendingCommands()) settle.interruptUnsafe();
                stalledSettle = settle;
              }),
            ),
            Effect.catch((error) =>
              Effect.gen(function* () {
                const cause = error instanceof TimeoutError ? error : error.cause;
                if (!isTimeoutError(cause)) return yield* browserFailure(cause);
                stalledSettle = settle;
                if (tab.contents.isLoading()) yield* tab.engine.stopLoading().pipe(Effect.ignore);
              }),
            ),
          );
          tab.diagnostics.action({
            action,
            ...(target ? { target: describeBrowserTarget(target) } : {}),
            outcome: "success",
            ...(Date.now() >= deadline
              ? { detail: "Action completed; page settling exceeded the requested timeout." }
              : {}),
          });
          actionRecorded = true;
          return (yield* readTabSnapshot(
            tab,
            tab.revision + 1,
            keepQueueBlocked,
            ACTION_POST_DISPATCH_TIMEOUT_MS,
            timeoutMessage,
          )).snapshot;
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              cancellationConfirmed = tab.engine.cancelPendingCommands();
              // Target resolution can issue CDP commands before input dispatch.
              if (cancellationConfirmed) completion.interruptUnsafe();
              keepQueueBlocked(Fiber.await(completion));
            }),
          ),
          Effect.catch((error) =>
            Effect.gen(function* () {
              if (dispatched && (tab.closing || tab.contents.isDestroyed()))
                return {
                  tabId: tab.id,
                  closed: true as const,
                  ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
                };
              if (!actionRecorded)
                tab.diagnostics.action({
                  action,
                  ...(target ? { target: describeBrowserTarget(target) } : {}),
                  outcome: "error",
                  detail: String(error.cause),
                });
              return yield* error;
            }),
          ),
        );
      }),
    ),
);

export const runTabEvaluation = Effect.fn("BrowserTab.evaluate")(
  (tab: BrowserHostTab, requireEvaluable: () => void, expression: string, awaitPromise: boolean, timeoutMs: number) =>
    enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
      Effect.gen(function* () {
        if (tab.secret)
          return yield* browserFailure(
            new Error("Browser inspection is protected during authentication. Use takeover."),
          );
        yield* browserSync(requireEvaluable);
        const deadline = Date.now() + timeoutMs;
        const timeoutMessage = "Browser evaluate timed out.";
        const value = yield* boundEngineOperation(
          tab,
          tab.engine.evaluate(
            expression,
            awaitPromise,
            yield* browserSync(() => remainingTime(deadline, timeoutMessage)),
          ),
          yield* browserSync(() => remainingTime(deadline, timeoutMessage)),
          timeoutMessage,
          keepQueueBlocked,
        );
        const settleTimeout = yield* browserSync(() => remainingTime(deadline, timeoutMessage));
        yield* boundEngineOperation(
          tab,
          tab.engine.settle(settleTimeout),
          settleTimeout,
          timeoutMessage,
          keepQueueBlocked,
        );
        tab.diagnostics.action({ action: "evaluate", outcome: "success" });
        return value;
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            tab.diagnostics.action({ action: "evaluate", outcome: "error", detail: String(error.cause) }),
          ),
        ),
      ),
    ),
);

const finishesWithin = <A, E>(work: Effect.Effect<A, E>, milliseconds: number) =>
  withTimeout(work, milliseconds, "Browser operation unwind timed out.").pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

export function remainingTime(deadline: number, message: string): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  return remaining;
}
