import type { BrowserDiagnosticEntry, BrowserSnapshot, BrowserTarget } from "@openbot/contracts/ipc";
import { Context, Deferred, Effect, Fiber } from "effect";
import type { BrowserPageStatus, SnapshotReadResult } from "./browser-cdp";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";
import {
  BrowserFillFieldsFailure,
  type BrowserFillFieldsProgress,
  type BrowserFillFieldsReason,
  fillFieldsFailure,
} from "./browser-fill-fields";
import type { BrowserHostTab, KeepQueueBlocked } from "./browser-host-tab";
import { describeBrowserTarget } from "./browser-navigation";
import { TimeoutError, withTimeout } from "./with-timeout";

const ACTION_POST_DISPATCH_TIMEOUT_MS = 10_000;
const OPERATION_UNWIND_GRACE_MS = 1_000;
// Let an operation report its own deadline before the transport backstop wins.
const OPERATION_DEADLINE_BACKSTOP_MS = 250;

/**
 * Whether a person controls a tab. Only the agent tool paths provide it, so a person's own actions and
 * the host's internal work still run while the person holds the tab.
 */
export const BrowserToolHold = Context.Reference<(tabId: string) => boolean>("openbot/BrowserToolHold", {
  defaultValue: () => () => false,
});

/** An agent tool operation reached a tab that a person controls. The caller waits for the release. */
export class BrowserUserControlHeld extends Error {
  readonly tabId: string;
  constructor(tabId: string) {
    super("A person controls this browser tab. Wait for the release, then take a fresh snapshot.");
    this.name = "BrowserUserControlHeld";
    this.tabId = tabId;
  }
}

/** Return the response when ready; retain the queue until all owned work drains. */
export const enqueueTabOperation = Effect.fn("BrowserTab.enqueue")(function* <A>(
  tab: BrowserHostTab,
  operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Effect.Effect<A, BrowserOperationError>,
  allowProtected = false,
) {
  // Read in the caller's fiber: the queued work below runs in the tab scope.
  const heldByUser = yield* BrowserToolHold;
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
          // An operation that was queued before the person took the tab must not act on it.
          if (heldByUser(tab.id)) return yield* browserFailure(new BrowserUserControlHeld(tab.id));
          if (tab.secret?.submitted && !allowProtected) {
            return yield* browserFailure(
              new Error("Browser inspection is protected during authentication. Use takeover."),
            );
          }
          tab.operations = (tab.operations ?? 0) + 1;
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

/**
 * A page also changes with no tool action: live data, timers and late content. An image older than
 * this does not count as current.
 */
const CURRENT_IMAGE_MS = 15_000;

/**
 * Call in a queued operation. True when the operation before it gave the agent a full-page image, or
 * passed one on, of the same address, and the page is not loading. No queued operation changed the page
 * since; the page itself can have.
 */
export function hasCurrentImage(tab: BrowserHostTab): boolean {
  const image = tab.image;
  return (
    image !== undefined &&
    image.operation === (tab.operations ?? 0) - 1 &&
    Date.now() - image.taken < CURRENT_IMAGE_MS &&
    !tab.contents.isLoading() &&
    tab.contents.getURL() === image.url
  );
}

/** Call in a queued operation that gave the agent a full-page image. */
export function markImageTaken(tab: BrowserHostTab): void {
  tab.image = { operation: tab.operations ?? 0, url: tab.contents.getURL(), taken: Date.now() };
}

/** Call in a queued operation that sent no image because `hasCurrentImage` was true. */
export function passImageOn(tab: BrowserHostTab): void {
  if (tab.image) tab.image.operation = tab.operations ?? 0;
}

export const readTabSnapshot = Effect.fn("BrowserTab.readTabSnapshot")(function* (
  tab: BrowserHostTab,
  revision: number,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMs = 10_000,
  timeoutMessage = "Browser snapshot timed out.",
  /**
   * The last work before the snapshot reaches the agent, such as a policy check or its image. When it
   * fails, the agent gets no snapshot, so its entries stay undelivered for the next one.
   */
  release?: (result: SnapshotReadResult) => Effect.Effect<void, BrowserOperationError>,
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
  if (release) yield* release(result);
  tab.diagnostics.delivered(history.cursor);
  return result;
});

/** Reads what an action returns once its input reached the page and the page settled. */
export type ActionResultReader<A> = (
  tab: BrowserHostTab,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMessage: string,
) => Effect.Effect<A, BrowserOperationError>;

/** A `run_script` step reads nothing: the script takes one snapshot at the end. */
export const skipActionResult: ActionResultReader<null> = () => Effect.succeed(null);

export const readActionSnapshot: ActionResultReader<BrowserSnapshot> = (tab, keepQueueBlocked, timeoutMessage) =>
  readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked, ACTION_POST_DISPATCH_TIMEOUT_MS, timeoutMessage).pipe(
    Effect.map((result) => result.snapshot),
  );

/**
 * What an input action returns unless the model asks for a snapshot. Most actions are not followed by
 * a read of their snapshot, and a full one costs the model thousands of tokens. No snapshot is read,
 * so the revision stays and the refs of the last snapshot still work.
 */
export interface BrowserActionStatus extends BrowserPageStatus {
  tabId: string;
  revision: number;
  errors?: BrowserDiagnosticEntry[];
}

export const readActionStatus: ActionResultReader<BrowserActionStatus> = Effect.fn("BrowserTab.readActionStatus")(
  function* (tab, keepQueueBlocked, timeoutMessage) {
    const page = yield* boundEngineOperation(
      tab,
      tab.engine.pageStatus(),
      ACTION_POST_DISPATCH_TIMEOUT_MS,
      timeoutMessage,
      keepQueueBlocked,
    );
    // A page can put a typed card value in an error message, as in a snapshot.
    const errors = tab.diagnostics.takeStatusErrors().map((entry) => ({
      ...entry,
      message: tab.engine.scrubText(entry.message),
      ...(entry.url === undefined ? {} : { url: tab.engine.scrubText(entry.url) }),
    }));
    return { tabId: tab.id, revision: tab.revision, ...page, ...(errors.length > 0 ? { errors } : {}) };
  },
);

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
  <A>(
    tab: BrowserHostTab,
    action: string,
    target: BrowserTarget | undefined,
    operation: (
      tab: BrowserHostTab,
      deadline: number,
      markDispatched: () => void,
    ) => Effect.Effect<void, BrowserOperationError>,
    readResult: ActionResultReader<A>,
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
          return yield* readResult(tab, keepQueueBlocked, timeoutMessage);
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
              // The input can have changed the site already. A plain timeout invites a repeat.
              // Partial typing already says how many characters reached the page.
              if (dispatched && isTimeoutError(error.cause) && !String(error.cause).includes("reached the page"))
                return yield* browserFailure(
                  new Error(
                    `Browser ${action} timed out after its input reached the page. Check the page before you repeat the action.`,
                  ),
                );
              return yield* error;
            }),
          ),
        );
      }),
    ),
);

export const runTabEvaluation = Effect.fn("BrowserTab.evaluate")(
  (
    tab: BrowserHostTab,
    requireEvaluable: () => void,
    expression: string,
    awaitPromise: boolean,
    timeoutMs: number,
    undefinedAsNull: boolean,
  ) =>
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
            undefinedAsNull,
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

export interface BrowserFillFieldsResult {
  tabId: string;
  status: "completed" | "refused" | "partial" | "snapshot_failed";
  inputCompleted: boolean;
  confirmed: number[];
  failedIndex: number | null;
  uncertainIndex: number | null;
  reason?: BrowserFillFieldsReason;
  snapshot?: BrowserSnapshot;
}

/** One queue slot owns all input, one final capture, and any work that survives its deadline. */
export const runTabFillFields = Effect.fn("BrowserTab.fillFields")(
  (
    tab: BrowserHostTab,
    revision: number,
    fields: readonly { ref: string; text: string }[],
    timeoutMs: number,
    requirePolicy: () => void,
  ) =>
    enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
      Effect.gen(function* () {
        const deadline = Date.now() + timeoutMs;
        const progress: BrowserFillFieldsProgress = {
          confirmed: [],
          failedIndex: null,
          uncertainIndex: null,
          stopped: false,
        };
        const checkPolicy = () => {
          try {
            requirePolicy();
          } catch {
            throw fillFieldsFailure("policy_changed");
          }
        };
        let inputCompleted = false;
        const result = (reason?: BrowserFillFieldsReason, snapshot?: BrowserSnapshot): BrowserFillFieldsResult => ({
          tabId: tab.id,
          status: !reason
            ? "completed"
            : inputCompleted
              ? "snapshot_failed"
              : progress.confirmed.length || progress.uncertainIndex !== null
                ? "partial"
                : "refused",
          inputCompleted,
          confirmed: [...progress.confirmed],
          failedIndex: progress.failedIndex,
          uncertainIndex: progress.uncertainIndex,
          ...(reason ? { reason } : {}),
          ...(snapshot ? { snapshot } : {}),
        });
        return yield* Effect.gen(function* () {
          yield* browserSync(checkPolicy);
          const completion = yield* Effect.forkIn(
            tab.engine.fillFields(revision, fields, deadline, progress, checkPolicy),
            tab.scope,
            { startImmediately: true },
          );
          // Always await native input cleanup, including an external debugger's unabortable
          // command. A response deadline must not release this queue slot early.
          keepQueueBlocked(Fiber.await(completion));
          yield* withTimeout(
            Fiber.join(completion),
            yield* browserSync(() => remainingTime(deadline, "Browser fill_fields timed out.")),
            "Browser fill_fields timed out.",
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                progress.stopped = true;
                if (tab.engine.cancelPendingCommands()) completion.interruptUnsafe();
              }),
            ),
            Effect.catch((error) => {
              progress.stopped = true;
              if (error instanceof TimeoutError) {
                if (tab.engine.cancelPendingCommands()) completion.interruptUnsafe();
                return Effect.fail(browserFailure(error));
              }
              return Effect.fail(error);
            }),
          );
          inputCompleted = true;
          yield* browserSync(checkPolicy);
          const settleTimeout = yield* browserSync(() => remainingTime(deadline, "Browser fill_fields timed out."));
          yield* boundEngineOperation(
            tab,
            tab.engine.settle(settleTimeout),
            settleTimeout,
            "Browser fill_fields timed out.",
            keepQueueBlocked,
          );
          yield* browserSync(checkPolicy);
          const captured = yield* readTabSnapshot(
            tab,
            tab.revision + 1,
            keepQueueBlocked,
            yield* browserSync(() => remainingTime(deadline, "Browser fill_fields timed out.")),
            "Browser fill_fields timed out.",
            // A card or takeover that appeared during capture must never release that capture.
            () => browserSync(checkPolicy),
          );
          tab.diagnostics.action({ action: "fill_fields", outcome: "success" });
          return result(undefined, captured.snapshot);
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              progress.stopped = true;
              tab.diagnostics.action({ action: "fill_fields", outcome: "error", detail: "interrupted" });
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              progress.stopped = true;
              const reason: BrowserFillFieldsReason =
                tab.closing || tab.contents.isDestroyed()
                  ? "tab_closed"
                  : error.cause instanceof BrowserFillFieldsFailure
                    ? error.cause.reason
                    : isTimeoutError(error.cause)
                      ? "deadline"
                      : inputCompleted
                        ? "snapshot_failed"
                        : "input_failed";
              tab.diagnostics.action({ action: "fill_fields", outcome: "error", detail: reason });
              return result(reason);
            }),
          ),
        );
      }),
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
