import type { BrowserTarget } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";

const NAVIGATION_TIMED_OUT = "Navigation timed out.";
const TAB_CLOSED = "Browser tab was closed during navigation.";
const ERR_ABORTED = -3;
const SUCCESSOR_TIMEOUT_MS = 10_000;

/**
 * Starts a navigation and settles when the main frame finishes it. `initiate` returns `false` when
 * there is nowhere to go, `true` when the navigation started synchronously, or the promise of an
 * API such as `loadURL`. With a `null` timeout, the wait has no deadline.
 */
export function navigateAndWait(
  contents: WebContents,
  initiate: () => boolean | Promise<unknown>,
  timeoutMs: number | null = 10_000,
): Effect.Effect<void, BrowserOperationError> {
  return watchNavigation(contents, initiate, timeoutMs);
}

/** Waits for a load that already started, such as one from CDP `Page.navigate`. */
export function waitForLoading(contents: WebContents, timeoutMs: number): Effect.Effect<void, BrowserOperationError> {
  return Effect.suspend(() => (contents.isLoading() ? watchNavigation(contents, undefined, timeoutMs) : Effect.void));
}

export const stopLoadingAndWait = Effect.fn("Browser.stopLoadingAndWait")((contents: WebContents) => {
  if (!contents.isLoading()) return Effect.void;
  return Effect.callback<void, BrowserOperationError>((resume) => {
    let settled = false;
    const cleanup = () => {
      contents.off("did-stop-loading", stopped);
      contents.off("destroyed", destroyed);
    };
    const stopped = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.void);
    };
    const destroyed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.fail(browserFailure(new Error(TAB_CLOSED))));
    };
    contents.once("did-stop-loading", stopped);
    contents.once("destroyed", destroyed);
    try {
      contents.stop();
      if (!contents.isLoading()) setImmediate(stopped);
    } catch (error) {
      settled = true;
      cleanup();
      resume(Effect.fail(browserFailure(error)));
    }
    return Effect.sync(cleanup);
  });
});

/** Without `initiate`, the load in progress counts as a started cross-document navigation. */
const watchNavigation = Effect.fn("Browser.watchNavigation")(
  (contents: WebContents, initiate: (() => boolean | Promise<unknown>) | undefined, timeoutMs: number | null) => {
    return Effect.callback<void, BrowserOperationError>((resume) => {
      let started = initiate === undefined;
      let inPlace = false;
      let settled = false;
      let timedOut = false;
      let initiationPending = false;
      let committed = false;
      let successorStarted = false;
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        contents.off("did-start-navigation", didStartNavigation);
        contents.off("did-navigate", didNavigate);
        contents.off("did-stop-loading", didStopLoading);
        contents.off("did-navigate-in-page", didNavigateInPage);
        contents.off("did-fail-load", didFailLoad);
        contents.off("destroyed", destroyed);
      };
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) resume(Effect.fail(browserFailure(error)));
        else resume(Effect.void);
      };
      const complete = () => {
        finish(timedOut ? new Error(NAVIGATION_TIMED_OUT) : undefined);
      };
      // A document that commits and then starts its next page while it loads, as a sign-in redirect
      // does, aborts its own load with `ERR_ABORTED`. The main frame still loads the next page, so wait
      // for that load. A wait without a deadline gets one here, so that a redirect loop ends.
      const supersededBy = (code: unknown) => {
        if (code !== ERR_ABORTED || timedOut || !successorStarted || !contents.isLoading()) return false;
        if (timer === undefined) startDeadline(SUCCESSOR_TIMEOUT_MS);
        return true;
      };
      const didStartNavigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
        if (!isMainFrame) return;
        if (committed && !isInPlace) successorStarted = true;
        // A page that calls `pushState` while it loads must not end the wait for that load.
        inPlace = started ? inPlace && isInPlace : isInPlace;
        started = true;
      };
      const didNavigate = () => {
        if (started) committed = true;
      };
      const didStopLoading = () => {
        if (started && !inPlace) complete();
      };
      const didNavigateInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
        if (started && inPlace && isMainFrame) complete();
      };
      const didFailLoad = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
        if (!started || !isMainFrame || supersededBy(code)) return;
        finish(new Error(timedOut ? NAVIGATION_TIMED_OUT : `Navigation failed (${code}): ${description}`));
      };
      const destroyed = () => {
        finish(new Error(TAB_CLOSED));
      };
      contents.on("did-start-navigation", didStartNavigation);
      contents.on("did-navigate", didNavigate);
      contents.on("did-stop-loading", didStopLoading);
      contents.on("did-navigate-in-page", didNavigateInPage);
      contents.on("did-fail-load", didFailLoad);
      contents.once("destroyed", destroyed);
      const startDeadline = (ms: number) => {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            const navigationWasActive = started || contents.isLoading();
            contents.stop();
            if (!navigationWasActive && !initiationPending) complete();
          } catch (error) {
            finish(error);
          }
        }, ms);
        timer.unref();
      };
      if (timeoutMs !== null) startDeadline(timeoutMs);
      if (!initiate) return Effect.sync(cleanup);
      try {
        const initiation = initiate();
        if (initiation === false) {
          complete();
        } else if (initiation !== true) {
          initiationPending = true;
          // Electron rejects `loadURL` inside its `did-start-navigation` event when the page starts
          // another navigation. Code that runs from there and calls `contents.stop()` cancels a
          // navigation while Chromium starts it, and Chromium then stops the whole process. Settle
          // in a new task.
          void initiation.then(
            () =>
              setImmediate(() => {
                initiationPending = false;
                // A closed tab settled the wait already, and its contents cannot be read.
                if (!settled && !contents.isLoading()) complete();
              }),
            (error) =>
              setImmediate(() => {
                initiationPending = false;
                if (settled || supersededBy(error instanceof Error && "errno" in error ? error.errno : undefined))
                  return;
                finish(timedOut ? new Error(NAVIGATION_TIMED_OUT) : error);
              }),
          );
        }
      } catch (error) {
        finish(error);
      }
      return Effect.sync(cleanup);
    }).pipe(
      Effect.onInterrupt(() =>
        browserSync(() => {
          if (!contents.isDestroyed() && contents.isLoading()) contents.stop();
        }).pipe(Effect.ignore),
      ),
    );
  },
);

export function describeBrowserTarget(target: BrowserTarget): string {
  switch (target.kind) {
    case "ref":
      return `ref ${target.ref}@${target.revision}`;
    case "role":
      return `role ${target.role}${target.name ? ` “${target.name}”` : ""}`;
    case "text":
      return `text “${target.text}”`;
    case "css":
      return `css ${target.selector}`;
    case "point":
      return `point ${target.x},${target.y}`;
  }
}
