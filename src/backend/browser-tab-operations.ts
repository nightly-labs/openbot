import type { BrowserDiagnosticEntry, BrowserSiteMemory, BrowserSnapshot, BrowserTarget } from "@openbot/contracts/ipc";
import { Context, Deferred, Effect, Fiber, Option, Result } from "effect";
import type { WebContents } from "electron";
import type { BrowserDialog, BrowserDialogOwner, BrowserPageStatus, SnapshotReadResult } from "./browser-cdp";
import {
  CHALLENGE_CLICK_WAIT_MS,
  CHALLENGE_POLL_MS,
  CHALLENGE_WAIT_MS,
  type DetectedChallenge,
  describeChallenge,
  httpSignInChallenge,
  TURNSTILE_SELF_PASS_MS,
} from "./browser-challenge";
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
const OPERATION_DEADLINE_BACKSTOP_MS = 250;
const PAINT_NUDGE_FIRST_MS = 250;
const PAINT_NUDGE_LONGEST_MS = 2_000;
const PAINT_NUDGES_IN_FLIGHT = 2;
const NUDGES_UNDRAWN_PAGES = process.platform === "darwin" || process.platform === "win32";
const paintNudgesInFlight = new WeakMap<WebContents, number>();
const SILENT_PAGE_ADVICE =
  "The page does not answer because a script on it keeps running. Reload the tab with navigate direction=reload, which ends the stuck page first, or close the tab.";

export const BrowserToolHold = Context.Reference<(tabId: string) => boolean>("openbot/BrowserToolHold", {
  defaultValue: () => () => false,
});

export const BrowserToolQueueWait = Context.Reference<number | undefined>("openbot/BrowserToolQueueWait", {
  defaultValue: () => undefined,
});

export const BrowserDialogTurn = Context.Reference<BrowserDialogOwner | undefined>("openbot/BrowserDialogTurn", {
  defaultValue: () => undefined,
});

export const BrowserSiteMemories = Context.Reference<
  { turnId: string; recall: (hostname: string) => BrowserSiteMemory[] } | undefined
>("openbot/BrowserSiteMemories", { defaultValue: () => undefined });

export interface DialogTabResult {
  tabId: string;
  dialog: { id?: string; type: BrowserDialog["type"]; message: string };
  note: string;
}

export function dialogTabResult(tabId: string, dialog: BrowserDialog): DialogTabResult {
  return dialog.agent
    ? {
        tabId,
        dialog: { id: dialog.id, type: dialog.type, message: dialog.message },
        note: "The page opened a dialog. Answer it with handle_dialog. Do not repeat the action: its input reached the page.",
      }
    : {
        tabId,
        dialog: { type: dialog.type, message: dialog.message },
        note: "The page opened a dialog that only a person can answer. Ask the user to answer it, then read the tab again.",
      };
}

export class BrowserUserControlHeld extends Error {
  readonly tabId: string;
  constructor(tabId: string) {
    super("A person controls this browser tab. Wait for the release, then take a fresh snapshot.");
    this.name = "BrowserUserControlHeld";
    this.tabId = tabId;
  }
}

export const enqueueTabOperation = Effect.fn("BrowserTab.enqueue")(function* <A>(
  tab: BrowserHostTab,
  operation: (tab: BrowserHostTab, keepQueueBlocked: KeepQueueBlocked) => Effect.Effect<A, BrowserOperationError>,
  allowProtected = false,
) {
  const heldByUser = yield* BrowserToolHold;
  const queueWaitMs = yield* BrowserToolQueueWait;
  const dialogTurn = yield* BrowserDialogTurn;
  const previous = tab.queue;
  const drained = Deferred.makeUnsafe<void>();
  const started = Deferred.makeUnsafe<void>();
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
          yield* Deferred.succeed(started, undefined);
          if (cancelled) return yield* Effect.interrupt;
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
  const cancel = () => {
    cancelled = true;
    if (active) active.interruptUnsafe();
  };
  return yield* Effect.gen(function* () {
    if (queueWaitMs !== undefined) {
      const reached = yield* Deferred.await(started).pipe(Effect.timeoutOption(queueWaitMs));
      if (Option.isNone(reached)) {
        cancel();
        return yield* browserFailure(new Error(queueWaitError(tab, dialogTurn)));
      }
    }
    return yield* Deferred.await(response);
  }).pipe(Effect.onInterrupt(() => Effect.sync(cancel)));
});

function queueWaitError(tab: BrowserHostTab, turn: BrowserDialogOwner | undefined) {
  const dialog = tab.engine.dialog;
  if (dialog && turn && tab.engine.dialogOwnedBy(turn))
    return `An earlier action on this tab still waits for a page ${dialog.type} dialog. Answer it first with handle_dialog, dialogId ${dialog.id}, then try again.`;
  if (dialog)
    return `An earlier action on this tab still waits for a page ${dialog.type} dialog that only a person can answer: ${JSON.stringify(dialog.message)}. Ask the user to answer it, then read the tab again.`;
  return "An earlier action on this tab did not finish, so this call did not run. Open the page in a new tab, or try again later.";
}

const CURRENT_IMAGE_MS = 15_000;

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

export function markImageTaken(tab: BrowserHostTab): void {
  tab.image = { operation: tab.operations ?? 0, url: tab.contents.getURL(), taken: Date.now() };
}

export function passImageOn(tab: BrowserHostTab): void {
  if (tab.image) tab.image.operation = tab.operations ?? 0;
}

const SNAPSHOT_READ_TIMEOUT_MS = 10_000;

const SNAPSHOT_READ_RESERVE_MS = 2_000;

export const readTabSnapshot = Effect.fn("BrowserTab.readTabSnapshot")(function* (
  tab: BrowserHostTab,
  revision: number,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMs?: number,
  timeoutMessage = "Browser snapshot timed out.",
  release?: (result: SnapshotReadResult) => Effect.Effect<void, BrowserOperationError>,
) {
  const heldByUser = yield* BrowserToolHold;
  const siteMemories = yield* BrowserSiteMemories;
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  const read = (readRevision: number) =>
    Effect.gen(function* () {
      const history = tab.diagnostics.snapshot();
      const readTimeout = deadline === undefined ? SNAPSHOT_READ_TIMEOUT_MS : Math.max(1, deadline - Date.now());
      const result = yield* boundEngineOperation(
        tab,
        tab.engine.snapshot({
          tabId: tab.id,
          revision: readRevision,
          environment: tab.environment,
          diagnostics: history.diagnostics,
          actions: history.actions,
          deadline: Date.now() + readTimeout,
        }),
        readTimeout,
        timeoutMessage,
        keepQueueBlocked,
      );
      tab.revision = readRevision;
      return { result, cursor: history.cursor };
    });
  let current = yield* read(revision);
  const waitStarted = Date.now();
  const waitDocument = tab.documents;
  const priorWaitMs = tab.challengeWait?.document === waitDocument ? tab.challengeWait.waitedMs : 0;
  let waitedVendor: string | null = null;
  const waitWhile = (waiting: (challenge: DetectedChallenge) => boolean, budgetMs: number) =>
    Effect.gen(function* () {
      const started = Date.now();
      let lastReadFailed = false;
      while (
        current.result.challenge !== null &&
        waiting(current.result.challenge) &&
        Date.now() - started < budgetMs &&
        (deadline === undefined || deadline - Date.now() > CHALLENGE_POLL_MS + SNAPSHOT_READ_RESERVE_MS) &&
        !tab.secret &&
        !tab.closing &&
        !tab.contents.isDestroyed() &&
        !heldByUser(tab.id)
      ) {
        waitedVendor = current.result.challenge.vendor;
        yield* Effect.sleep(CHALLENGE_POLL_MS);
        if (tab.closing || tab.contents.isDestroyed()) break;
        const next = yield* Effect.result(read(tab.revision + 1));
        lastReadFailed = Result.isFailure(next);
        if (Result.isSuccess(next)) current = next.success;
      }
      if (lastReadFailed) current = yield* read(tab.revision + 1);
    });
  yield* waitWhile((challenge) => challenge.kind === "non-interactive", CHALLENGE_WAIT_MS - priorWaitMs);
  const clickOffer = tab.challengeClick?.document === tab.documents ? tab.challengeClick : undefined;
  if (clickOffer && !clickOffer.waited) {
    clickOffer.waited = true;
    yield* waitWhile((challenge) => challenge.kind !== "block" && !challenge.puzzle, CHALLENGE_CLICK_WAIT_MS);
  }
  if (!clickOffer && current.result.challenge?.vendor === "turnstile" && current.result.challenge.checkbox)
    yield* waitWhile((challenge) => challenge.vendor === "turnstile" && !challenge.puzzle, TURNSTILE_SELF_PASS_MS);
  const { result, cursor } = current;
  if (waitedVendor !== null && result.challenge?.kind === "non-interactive") {
    const waitedMs = Date.now() - waitStarted + (tab.documents === waitDocument ? priorWaitMs : 0);
    tab.challengeWait = { document: tab.documents, waitedMs };
  }
  if (!tab.secret) {
    const sharedWaitMs =
      tab.challengeWait?.document === tab.documents
        ? tab.challengeWait.waitedMs
        : tab.documents === waitDocument
          ? priorWaitMs
          : 0;
    const checking = CHALLENGE_WAIT_MS - sharedWaitMs > CHALLENGE_POLL_MS;
    const detected = result.challenge;
    const origin = URL.canParse(result.snapshot.url) ? new URL(result.snapshot.url).origin : "";
    if (detected) tab.checkOrigin = origin;
    else delete tab.checkOrigin;
    if (!detected || tab.checkAfterTakeover !== origin) delete tab.checkAfterTakeover;
    const afterTakeover = tab.checkAfterTakeover !== undefined;
    const clickOnce =
      detected?.checkbox &&
      !afterTakeover &&
      detected.kind !== "block" &&
      !(detected.kind === "non-interactive" && checking) &&
      tab.challengeClick?.document !== tab.documents
        ? detected.checkbox
        : null;
    if (clickOnce) tab.challengeClick = { document: tab.documents, waited: false };
    const challenge = describeChallenge(
      detected,
      waitedVendor,
      waitedVendor === null ? 0 : Date.now() - waitStarted,
      checking,
      clickOnce,
      afterTakeover,
    );
    if (challenge) result.snapshot.challenge = challenge;
    else if (tab.httpSignIn) result.snapshot.challenge = httpSignInChallenge();
  }
  const recalled = siteMemories && !tab.secret ? recallSiteMemories(tab, result.snapshot.url, siteMemories) : null;
  if (recalled?.memories.length) result.snapshot.siteMemories = recalled.memories;
  if (release) yield* release(result);
  if (recalled) tab.siteRecall = recalled.mark;
  tab.diagnostics.delivered(cursor);
  return result;
});

function recallSiteMemories(
  tab: BrowserHostTab,
  url: string,
  source: { turnId: string; recall: (hostname: string) => BrowserSiteMemory[] },
): { memories: BrowserSiteMemory[]; mark: { turnId: string; host: string } } | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!host || (tab.siteRecall?.turnId === source.turnId && tab.siteRecall.host === host)) return null;
  return { memories: source.recall(host), mark: { turnId: source.turnId, host } };
}

export type ActionResultReader<A> = (
  tab: BrowserHostTab,
  keepQueueBlocked: KeepQueueBlocked,
  timeoutMessage: string,
) => Effect.Effect<A, BrowserOperationError>;

export const skipActionResult: ActionResultReader<null> = () => Effect.succeed(null);

export const readActionSnapshot: ActionResultReader<BrowserSnapshot> = (tab, keepQueueBlocked, timeoutMessage) =>
  readTabSnapshot(tab, tab.revision + 1, keepQueueBlocked, ACTION_POST_DISPATCH_TIMEOUT_MS, timeoutMessage).pipe(
    Effect.map((result) => result.snapshot),
  );

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
    const errors = tab.diagnostics.takeStatusErrors().map((entry) => ({
      ...entry,
      message: tab.engine.scrubText(entry.message),
      ...(entry.url === undefined ? {} : { url: tab.engine.scrubText(entry.url) }),
    }));
    return { tabId: tab.id, revision: tab.revision, ...page, ...(errors.length > 0 ? { errors } : {}) };
  },
);

function nudgePaint(tab: BrowserHostTab): void {
  const contents = tab.contents;
  if (tab.closing || contents.isDestroyed()) return;
  const inFlight = paintNudgesInFlight.get(contents) ?? 0;
  if (inFlight >= PAINT_NUDGES_IN_FLIGHT) return;
  paintNudgesInFlight.set(contents, inFlight + 1);
  const settled = () => paintNudgesInFlight.set(contents, (paintNudgesInFlight.get(contents) ?? 1) - 1);
  contents.capturePage().then(settled, settled);
}

const keepPageDrawing = (tab: BrowserHostTab, delayMs = PAINT_NUDGE_FIRST_MS): Effect.Effect<never> =>
  Effect.sleep(delayMs).pipe(
    Effect.andThen(
      Effect.suspend(() => {
        nudgePaint(tab);
        return keepPageDrawing(tab, Math.min(delayMs * 2, PAINT_NUDGE_LONGEST_MS));
      }),
    ),
  );

function keepDrawnDuring<A, E>(tab: BrowserHostTab, wait: Effect.Effect<A, E>): Effect.Effect<A, E> {
  return NUDGES_UNDRAWN_PAGES ? Effect.raceFirst(wait, keepPageDrawing(tab)) : wait;
}

export const boundEngineOperation = Effect.fn("BrowserTab.boundOperation")(function* <A>(
  tab: BrowserHostTab,
  operation: Effect.Effect<A, BrowserOperationError>,
  timeoutMs: number,
  timeoutMessage: string,
  keepQueueBlocked: KeepQueueBlocked,
) {
  const completion = yield* Effect.forkIn(operation, tab.scope, { startImmediately: true });
  return yield* withTimeout(keepDrawnDuring(tab, Fiber.join(completion)), timeoutMs, timeoutMessage).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        if (tab.engine.cancelPendingCommands()) completion.interruptUnsafe();
        keepQueueBlocked(Fiber.await(completion));
      }),
    ),
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (!isTimeoutError(error instanceof TimeoutError ? error : error.cause))
          return yield* Effect.fail(error instanceof TimeoutError ? browserFailure(error) : error);
        keepQueueBlocked(unwindStalledOperation(tab, completion));
        const answers = yield* tab.engine.pageAnswers().pipe(Effect.orElseSucceed(() => true));
        if (!answers) return yield* browserFailure(new Error(`${timeoutMessage} ${SILENT_PAGE_ADVICE}`));
        return yield* Effect.fail(error instanceof TimeoutError ? browserFailure(error) : error);
      }),
    ),
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
    Effect.flatMap(BrowserDialogTurn, (dialogTurn) =>
      enqueueTabOperation(tab, (_tab, keepQueueBlocked) =>
        Effect.gen(function* () {
          if (tab.secret)
            return yield* browserFailure(
              new Error("Browser inspection is protected during authentication. Use takeover."),
            );
          const openDialog = tab.engine.dialog;
          if (dialogTurn && openDialog)
            return dialogTabResult(tab.id, { ...openDialog, agent: tab.engine.dialogOwnedBy(dialogTurn) });
          const watch = dialogTurn ? tab.engine.watchDialogs(dialogTurn) : undefined;
          let watchedInput: Fiber.Fiber<void, BrowserOperationError> | undefined;
          if (watch)
            keepQueueBlocked(
              Effect.suspend(() => (watchedInput ? Fiber.await(watchedInput) : Effect.void)).pipe(
                Effect.ensuring(Effect.sync(watch.end)),
              ),
            );
          let dialogReturned = false;
          const deadline = Date.now() + timeoutMs;
          const timeoutMessage = `Browser ${action} timed out.`;
          let actionRecorded = false;
          let dispatched = false;
          let cancellationConfirmed = false;
          let stalledSettle: Fiber.Fiber<void, BrowserOperationError> | undefined;
          const completion = yield* Effect.forkIn(
            Effect.gen(function* () {
              let highlighted = false;
              if (watch) yield* tab.engine.observeDialogs().pipe(Effect.ignore);
              yield* Effect.gen(function* () {
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
                    highlighted && !cancellationConfirmed
                      ? tab.engine.hideHighlight().pipe(Effect.ignore)
                      : Effect.void,
                  ),
                ),
              );
            }),
            tab.scope,
            { startImmediately: true },
          );
          watchedInput = completion;
          onOperationStarted?.(completion);
          keepQueueBlocked(
            Effect.gen(function* () {
              if (!cancellationConfirmed) yield* Fiber.await(completion);
              if (!dialogReturned && !tab.closing && !tab.contents.isDestroyed() && tab.contents.isLoading())
                yield* tab.engine.stopLoading().pipe(Effect.ignore);
              if (stalledSettle) yield* unwindStalledOperation(tab, stalledSettle);
            }),
          );
          const result = Effect.gen(function* () {
            yield* withTimeout(
              Fiber.join(completion),
              Math.max(0, deadline - Date.now()) + OPERATION_DEADLINE_BACKSTOP_MS,
              timeoutMessage,
            ).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  if (!(error instanceof TimeoutError)) return yield* error;
                  cancellationConfirmed = tab.engine.cancelPendingCommands();
                  if (cancellationConfirmed) completion.interruptUnsafe();
                  else if (dispatched) yield* Fiber.await(completion);
                  return yield* browserFailure(error);
                }),
              ),
            );
            const settleTimeout = Math.max(1, deadline - Date.now());
            const settle = yield* Effect.forkIn(tab.engine.settle(settleTimeout), tab.scope, {
              startImmediately: true,
            });
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
          if (!watch) return yield* result;
          return yield* Effect.raceFirst(
            result,
            watch.opened.pipe(
              Effect.map((dialog) => {
                dialogReturned = true;
                if (!actionRecorded)
                  tab.diagnostics.action({
                    action,
                    ...(target ? { target: describeBrowserTarget(target) } : {}),
                    outcome: "success",
                    detail: `The page opened a ${dialog.type} dialog.`,
                  });
                return dialogTabResult(tab.id, dialog);
              }),
            ),
          );
        }),
      ),
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
    maxBytes?: number,
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
            maxBytes,
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
