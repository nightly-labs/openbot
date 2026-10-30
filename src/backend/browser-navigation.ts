import type { BrowserTarget } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";
import { TimeoutError } from "./with-timeout";

const NAVIGATION_TIMED_OUT = "Navigation timed out.";
const TAB_CLOSED = "Browser tab was closed during navigation.";

/**
 * Starts a navigation and settles when the main frame finishes it. `initiate` returns `false` when
 * there is nowhere to go, `true` when the navigation started synchronously, or the promise of an
 * API such as `loadURL`.
 */
export function navigateAndWait(
  contents: WebContents,
  initiate: () => boolean | Promise<unknown>,
  timeoutMs = 10_000,
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
  (contents: WebContents, initiate: (() => boolean | Promise<unknown>) | undefined, timeoutMs: number) => {
    return Effect.callback<void, BrowserOperationError>((resume) => {
      let started = initiate === undefined;
      let inPlace = false;
      let settled = false;
      let timedOut = false;
      let initiationPending = false;
      let pendingAborts = 0;
      let successor = false;
      let committed = false;
      let unrelatedNavigation = false;
      let navigationUrl: string | undefined;
      let finished = false;
      let recoveredAbort: Error | undefined;
      let timer: NodeJS.Timeout;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        contents.off("did-start-navigation", didStartNavigation);
        contents.off("did-redirect-navigation", didRedirectNavigation);
        contents.off("did-navigate", didNavigate);
        contents.off("did-finish-load", didFinishLoad);
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
        if ((initiationPending || pendingAborts > 0) && !timedOut) return;
        const recoveryFailed = recoveredAbort && (!successor || unrelatedNavigation || !finished);
        finish(timedOut ? new TimeoutError(NAVIGATION_TIMED_OUT) : recoveryFailed ? recoveredAbort : undefined);
      };
      const didStartNavigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
        url: string,
        isInPlace: boolean,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame) return;
        if (initiate && !isInPlace) {
          if (started) {
            // An API call or another tab is not evidence that this page replaced its own load.
            successor = committed && event.initiator === contents.mainFrame && event.frame === contents.mainFrame;
            unrelatedNavigation ||= !successor;
          }
          committed = false;
          navigationUrl = url;
          finished = false;
        }
        // A page that calls `pushState` while it loads must not end the wait for that load.
        inPlace = started ? inPlace && isInPlace : isInPlace;
        started = true;
      };
      const didRedirectNavigation = (_event: unknown, url: string, _isInPlace: boolean, isMainFrame: boolean) => {
        if (initiate && isMainFrame) navigationUrl = url;
      };
      const didNavigate = (_event: unknown, url: string) => {
        if (started && !inPlace && url === navigationUrl) committed = true;
      };
      const didFinishLoad = () => {
        finished = true;
      };
      const didStopLoading = () => {
        if (started && !inPlace) complete();
      };
      const didNavigateInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
        if (started && inPlace && isMainFrame) complete();
      };
      const didFailLoad = (_event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => {
        if (!started || !isMainFrame) return;
        const fail = () => {
          if (settled) return;
          if (initiate && code === -3 && successor && !unrelatedNavigation && url !== navigationUrl) {
            recoveredAbort ??= new Error(`Navigation failed (${code}): ${description}`);
            if (!contents.isLoading()) complete();
            return;
          }
          finish(
            timedOut
              ? new TimeoutError(NAVIGATION_TIMED_OUT)
              : new Error(`Navigation failed (${code}): ${description}`),
          );
        };
        if (initiate && code === -3) {
          pendingAborts += 1;
          setImmediate(() => {
            pendingAborts -= 1;
            fail();
          });
        } else fail();
      };
      const destroyed = () => {
        finish(new Error(TAB_CLOSED));
      };
      contents.on("did-start-navigation", didStartNavigation);
      if (initiate) {
        contents.on("did-redirect-navigation", didRedirectNavigation);
        contents.on("did-navigate", didNavigate);
        contents.on("did-finish-load", didFinishLoad);
      }
      contents.on("did-stop-loading", didStopLoading);
      contents.on("did-navigate-in-page", didNavigateInPage);
      contents.on("did-fail-load", didFailLoad);
      contents.once("destroyed", destroyed);
      timer = setTimeout(() => {
        timedOut = true;
        try {
          const navigationWasActive = started || contents.isLoading();
          contents.stop();
          if (initiate) setImmediate(complete);
          else if (!navigationWasActive && !initiationPending) complete();
        } catch (error) {
          finish(error);
        }
      }, timeoutMs);
      timer.unref();
      if (!initiate) return Effect.sync(cleanup);
      try {
        initiationPending = true;
        const initiation = initiate();
        if (typeof initiation === "boolean") {
          initiationPending = false;
          if (!initiation || (started && !contents.isLoading())) complete();
        } else {
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
                if (settled) return;
                if (
                  !timedOut &&
                  successor &&
                  !unrelatedNavigation &&
                  error instanceof Error &&
                  "code" in error &&
                  error.code === "ERR_ABORTED" &&
                  "errno" in error &&
                  error.errno === -3
                ) {
                  recoveredAbort = error;
                  if (!contents.isLoading()) complete();
                } else finish(timedOut ? new TimeoutError(NAVIGATION_TIMED_OUT) : error);
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
