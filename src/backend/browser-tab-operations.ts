import type { BrowserJsonValue, BrowserSnapshot, BrowserTarget } from "@openbot/contracts/ipc";
import type { WebContents } from "electron";
import type { SnapshotReadResult } from "./browser-cdp";
import { type BrowserHostTab, type KeepQueueBlocked, restoreWebContentsFocus } from "./browser-host-tab";
import { describeBrowserTarget } from "./browser-navigation";
import { TimeoutError, withTimeout } from "./with-timeout";

// The operations on one tab's queue, and the deadlines that keep one unresponsive renderer from
// holding that queue open. `BrowserHost` owns the tabs and decides which operation runs; these
// functions only order and bound the work on the tab they are given.

const ACTION_POST_DISPATCH_TIMEOUT_MS = 10_000;
/**
 * How long an operation that missed its deadline gets to unwind on its own before the debugger is
 * detached under it, and again to unwind after the detach. Long enough that a renderer which is
 * merely slower than the deadline it was given is never cancelled, short enough that the tab's queue
 * is not held by a renderer that will never answer.
 */
const OPERATION_UNWIND_GRACE_MS = 1_000;
/**
 * How long past its deadline an operation gets before the backstop timer answers for it.
 *
 * An operation carries the same deadline and reports what it managed to do with it: typing states
 * how many characters reached the page, so a caller knows what not to send twice. A backstop that
 * expires at the same millisecond as that check is a race, and the generic message wins it often
 * enough that the caller loses the count. The backstop is there for an operation that does not
 * unwind itself at all, so it starts after the operation's own last chance to answer, and the wait
 * it adds is short beside the ten seconds an action gets by default.
 */
const OPERATION_DEADLINE_BACKSTOP_MS = 250;

export function enqueueTabOperation<T>(
  tab: BrowserHostTab,
  operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Promise<T>,
  allowProtected = false,
): Promise<T> {
  const started = tab.queue.then(() => {
    if (tab.secret?.submitted && !allowProtected)
      throw new Error("Browser inspection is protected during authentication. Use takeover.");
    const drains: Promise<unknown>[] = [];
    const result = operation(tab, (promise) => drains.push(promise));
    const drained = result
      .catch(() => undefined)
      .then(() => Promise.allSettled(drains))
      .then(() => undefined);
    return { drained, result };
  });
  const result = started.then(({ result }) => result);
  tab.pendingOperations += 1;
  tab.queue = started
    .then(
      ({ drained }) => drained,
      () => undefined,
    )
    .finally(() => {
      tab.pendingOperations -= 1;
    });
  return result;
}

export async function readTabSnapshot(
  tab: BrowserHostTab,
  revision: number,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMs = 10_000,
  timeoutMessage = "Browser snapshot timed out.",
): Promise<SnapshotReadResult> {
  const history = tab.diagnostics.snapshot();
  const completion = tab.engine.snapshot({
    tabId: tab.id,
    revision,
    environment: tab.environment,
    diagnostics: history.diagnostics,
    actions: history.actions,
  });
  // A snapshot walks every frame, so it is one of the engine operations a single unresponsive
  // renderer can hold open forever.
  const result = await boundEngineOperation(tab, completion, timeoutMs, timeoutMessage, keepQueueBlocked);
  tab.revision = revision;
  return result;
}

/**
 * Bounds an engine operation in wall-clock time and unwinds what it left behind. Electron's
 * `sendCommand` carries no timeout of its own and the engine's own deadlines are checked between
 * commands, so a frame whose renderer never answers leaves the operation pending forever however
 * short a deadline it was given. Returning a timeout to the caller is not enough on its own: the
 * queue waits on every promise given to `keepQueueBlocked`, so a command left outstanding means
 * nothing on this tab ever runs again -- navigation, takeover, close and host shutdown all queue
 * behind that drain.
 */
export function boundEngineOperation<T>(
  tab: BrowserHostTab,
  completion: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  keepQueueBlocked: KeepQueueBlocked,
): Promise<T> {
  let unwound: Promise<void> | undefined;
  const bounded = withTimeout(completion, timeoutMs, timeoutMessage).catch((error) => {
    if (isTimeoutError(error)) unwound = unwindStalledOperation(tab, completion);
    throw error;
  });
  keepQueueBlocked(Promise.allSettled([bounded]).then(() => unwound));
  return bounded;
}

/**
 * Gives an operation that missed its deadline a moment to unwind, and detaches the debugger if it
 * will not. Detaching is the only cancellation primitive there is, and it is a blunt one: it takes
 * the whole session down, so a command still in flight when the next one attaches over the top of it
 * fails with `target closed while handling command` -- one operation away from the timeout that
 * caused it. Most timeouts do not need it at all, because a deadline shorter than the page is the
 * ordinary case and a live renderer answers what is outstanding in a few milliseconds. So the wait
 * comes first, the detach only if the wait expires, and a second wait after it, so the queue
 * advances into an attached debugger rather than one being torn down. When the recorder holds the
 * debugger there is nothing to detach and the wait stands, because the command really is still
 * outstanding.
 */
export async function unwindStalledOperation(tab: BrowserHostTab, completion: Promise<unknown>): Promise<void> {
  const settled = Promise.allSettled([completion]);
  if (await finishesWithin(settled, OPERATION_UNWIND_GRACE_MS)) return;
  if (!tab.engine.cancelPendingCommands()) {
    await settled;
    return;
  }
  await finishesWithin(settled, OPERATION_UNWIND_GRACE_MS);
}

/**
 * Runs one agent input action on the tab's queue, then settles the page and reads the snapshot the
 * agent acts on next. `focusedOutsideTabs` names the app contents that held focus before the action,
 * so focus goes back to it afterwards.
 */
export async function runTabAction(
  tab: BrowserHostTab,
  focusedOutsideTabs: () => WebContents | null,
  action: string,
  target: BrowserTarget | undefined,
  operation: (tab: BrowserHostTab, deadline: number, markDispatched: () => void) => Promise<void>,
  timeoutMs = 10_000,
  onOperationStarted?: (completion: Promise<void>) => void,
): Promise<BrowserSnapshot | { tabId: string; closed: true; openerTabId?: string }> {
  const started = tab.queue.then(() => {
    if (tab.secret) throw new Error("Browser inspection is protected during authentication. Use takeover.");
    const previouslyFocused = focusedOutsideTabs();
    const deadline = Date.now() + timeoutMs;
    const timeoutMessage = `Browser ${action} timed out.`;
    const snapshotDrains: Promise<unknown>[] = [];
    let stalledSettle: Promise<void> | undefined;
    let actionRecorded = false;
    let dispatched = false;
    let cancellationConfirmed = false;
    const operationCompletion = (async () => {
      let highlighted = false;
      try {
        tab.contents.focus();
        if (target && target.kind !== "point") {
          highlighted = await tab.engine.highlight(target).then(
            () => true,
            () => false,
          );
        }
        remainingTime(deadline, timeoutMessage);
        await operation(tab, deadline, () => {
          dispatched = true;
        });
      } finally {
        if (highlighted && !cancellationConfirmed) await tab.engine.hideHighlight().catch(() => undefined);
      }
    })();
    onOperationStarted?.(operationCompletion);
    const boundedOperation = withTimeout(
      operationCompletion,
      Math.max(0, deadline - Date.now()) + OPERATION_DEADLINE_BACKSTOP_MS,
      timeoutMessage,
    ).catch(async (error) => {
      // Only the backstop itself: an operation that failed on its own deadline has already
      // finished, and detaching the debugger under it would only end the live view and frames.
      if (!(error instanceof TimeoutError)) throw error;
      cancellationConfirmed = tab.engine.cancelPendingCommands();
      if (dispatched && !cancellationConfirmed) await operationCompletion;
      throw error;
    });
    const response = boundedOperation
      .then(async () => {
        const settleTimeout = Math.max(1, deadline - Date.now());
        const settleCompletion = tab.engine.settle(settleTimeout);
        try {
          // Settling bounds its own waiting with timers, but the commands it sends to each frame are
          // not bounded by them, so an unresponsive frame holds the action's response open and the
          // queue with it.
          await withTimeout(settleCompletion, settleTimeout, timeoutMessage);
        } catch (error) {
          if (!isTimeoutError(error)) throw error;
          // The settle may still be waiting on a frame that never answers, and unwinding it can go
          // as far as detaching the debugger -- which the post-dispatch snapshot below is about to
          // use. So the unwind is left to the drain, once the rest of the action has finished with
          // the session.
          stalledSettle = settleCompletion;
          if (tab.contents.isLoading()) await tab.engine.stopLoading().catch(() => undefined);
        }
        tab.diagnostics.action({
          action,
          ...(target ? { target: describeBrowserTarget(target) } : {}),
          outcome: "success",
          ...(Date.now() >= deadline
            ? { detail: "Action completed; page settling exceeded the requested timeout." }
            : {}),
        });
        actionRecorded = true;
        const snapshot = (
          await readTabSnapshot(
            tab,
            tab.revision + 1,
            (promise) => snapshotDrains.push(promise),
            ACTION_POST_DISPATCH_TIMEOUT_MS,
            timeoutMessage,
          )
        ).snapshot;
        return snapshot;
      })
      .catch((error) => {
        if (dispatched && (tab.closing || tab.contents.isDestroyed())) {
          return {
            tabId: tab.id,
            closed: true as const,
            ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
          };
        }
        if (!actionRecorded) {
          tab.diagnostics.action({
            action,
            ...(target ? { target: describeBrowserTarget(target) } : {}),
            outcome: "error",
            detail: String(error).slice(0, 2_000),
          });
        }
        throw error;
      })
      .finally(() => {
        if (!tab.closing) restoreWebContentsFocus(previouslyFocused, tab.contents);
      });
    snapshotDrains.push(
      Promise.allSettled([response]).then(() =>
        stalledSettle ? unwindStalledOperation(tab, stalledSettle) : undefined,
      ),
    );
    const drained = Promise.allSettled([response])
      .then(() => (cancellationConfirmed ? undefined : Promise.allSettled([operationCompletion]).then(() => undefined)))
      .then(() =>
        !tab.closing && !tab.contents.isDestroyed() && tab.contents.isLoading()
          ? tab.engine.stopLoading().catch(() => undefined)
          : undefined,
      )
      .then(() => Promise.allSettled(snapshotDrains))
      .then(() => undefined);
    return { drained, response };
  });
  const result = started.then(({ response }) => response);
  tab.queue = started.then(
    ({ drained }) => drained,
    () => undefined,
  );
  return result;
}

/**
 * Runs a page evaluation on the tab's queue. `requireEvaluable` runs when the evaluation starts, after
 * everything queued ahead of it, and throws to refuse it.
 */
export async function runTabEvaluation(
  tab: BrowserHostTab,
  requireEvaluable: () => void,
  expression: string,
  awaitPromise: boolean,
  timeoutMs: number,
): Promise<BrowserJsonValue> {
  const started = tab.queue.then(() => {
    if (tab.secret) throw new Error("Browser inspection is protected during authentication. Use takeover.");
    requireEvaluable();
    const deadline = Date.now() + timeoutMs;
    const timeoutMessage = "Browser evaluate timed out.";
    let unwound: Promise<void> | undefined;
    const operationCompletion = tab.engine.evaluate(expression, awaitPromise, remainingTime(deadline, timeoutMessage));
    // `awaitPromise` is what CDP's own execution timeout does not bound: an expression evaluating
    // to a promise the page never settles leaves the command pending forever, and `drained` waits
    // on that promise, so the tab's queue never advances -- which would also block takeover, close
    // and shutdown.
    const boundedOperation = withTimeout(
      operationCompletion,
      remainingTime(deadline, timeoutMessage),
      timeoutMessage,
    ).catch((error) => {
      if (isTimeoutError(error)) unwound = unwindStalledOperation(tab, operationCompletion);
      throw error;
    });
    const response = boundedOperation
      .then(async (value) => {
        const settleTimeout = remainingTime(deadline, timeoutMessage);
        // Same unbounded commands as the action path settles through; the evaluation itself has
        // already returned here, so unwinding this one only releases the drain sooner.
        const settleCompletion = tab.engine.settle(settleTimeout);
        await withTimeout(settleCompletion, settleTimeout, timeoutMessage).catch((error) => {
          if (isTimeoutError(error)) unwound = unwindStalledOperation(tab, settleCompletion);
          throw error;
        });
        tab.diagnostics.action({ action: "evaluate", outcome: "success" });
        return value;
      })
      .catch((error) => {
        tab.diagnostics.action({
          action: "evaluate",
          outcome: "error",
          detail: String(error).slice(0, 2_000),
        });
        throw error;
      });
    const drained = Promise.allSettled([response])
      .then(() => unwound ?? Promise.allSettled([operationCompletion]).then(() => undefined))
      .then(() => undefined);
    return { drained, response };
  });
  const result = started.then(({ response }) => response);
  tab.queue = started.then(
    ({ drained }) => drained,
    () => undefined,
  );
  return result;
}

/** Resolves to whether the work settled before the bound, rather than throwing when it did not. */
async function finishesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return await withTimeout(work, milliseconds, "Browser operation unwind timed out.").then(
    () => true,
    () => false,
  );
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

export function remainingTime(deadline: number, message: string): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(message);
  return remaining;
}
