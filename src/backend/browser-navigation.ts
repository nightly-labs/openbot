import type { WebContents } from "electron";

/**
 * Owns the wait for a tab's main-frame navigation, for the browser host and the CDP engine. It
 * listens to `WebContents` events only, never to CDP, so both callers see the same settle rules and
 * the same error text. It never imports the host or the engine.
 */

const NAVIGATION_TIMED_OUT = "Navigation timed out.";
const TAB_CLOSED = "Browser tab was closed during navigation.";

function navigationFailed(code: number, description: string): Error {
  return new Error(`Navigation failed (${code}): ${description}`);
}

/**
 * Starts a navigation and waits until the main frame loads, navigates in place, or fails.
 * `initiate` answers `false` when there is nothing to navigate to, such as no history entry.
 * At the timeout the load is stopped and the wait rejects when that stop arrives.
 */
export function navigateAndWait(
  contents: WebContents,
  initiate: () => boolean | Promise<unknown>,
  timeoutMs = 10_000,
): Promise<void> {
  return waitForNavigation(contents, timeoutMs, initiate);
}

/** Waits for a load that something else started, such as `Page.navigate`. */
export function waitForLoading(contents: WebContents, timeoutMs: number): Promise<void> {
  if (!contents.isLoading()) return Promise.resolve();
  return waitForNavigation(contents, timeoutMs);
}

function waitForNavigation(
  contents: WebContents,
  timeoutMs: number,
  initiate?: () => boolean | Promise<unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // A load already in progress is a full-document load: the first main-frame stop or failure
    // settles it, whatever navigation starts after it.
    let started = initiate === undefined;
    let inPlace = false;
    let settled = false;
    let timedOut = false;
    let initiationPending = false;
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      contents.off("did-start-navigation", didStartNavigation);
      contents.off("did-stop-loading", didStopLoading);
      contents.off("did-navigate-in-page", didNavigateInPage);
      contents.off("did-fail-load", didFailLoad);
      contents.off("destroyed", destroyed);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const complete = () => {
      finish(timedOut ? new Error(NAVIGATION_TIMED_OUT) : undefined);
    };
    const didStartNavigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      started = true;
      inPlace = isInPlace;
    };
    const didStopLoading = () => {
      if (started && !inPlace) complete();
    };
    const didNavigateInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (started && inPlace && isMainFrame) complete();
    };
    const didFailLoad = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (!started || !isMainFrame) return;
      finish(timedOut ? new Error(NAVIGATION_TIMED_OUT) : navigationFailed(code, description));
    };
    const destroyed = () => {
      finish(new Error(TAB_CLOSED));
    };
    if (initiate) contents.on("did-start-navigation", didStartNavigation);
    contents.on("did-stop-loading", didStopLoading);
    contents.on("did-navigate-in-page", didNavigateInPage);
    contents.on("did-fail-load", didFailLoad);
    contents.once("destroyed", destroyed);
    timer = setTimeout(() => {
      timedOut = true;
      try {
        const navigationWasActive = started || contents.isLoading();
        contents.stop();
        if (!navigationWasActive && !initiationPending) complete();
      } catch (error) {
        finish(error);
      }
    }, timeoutMs);
    timer.unref();
    if (!initiate) return;
    try {
      const initiation = initiate();
      if (initiation === false) {
        complete();
      } else if (initiation !== true) {
        initiationPending = true;
        void initiation.then(
          () => {
            initiationPending = false;
            if (!contents.isLoading()) complete();
          },
          (error) => {
            initiationPending = false;
            finish(timedOut ? new Error(NAVIGATION_TIMED_OUT) : error);
          },
        );
      }
    } catch (error) {
      finish(error);
    }
  });
}

/** Stops the current load and waits for its stop event, so the next navigation starts clean. */
export function stopLoadingAndWait(contents: WebContents): Promise<void> {
  if (!contents.isLoading()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      contents.off("did-stop-loading", stopped);
      contents.off("destroyed", destroyed);
    };
    const stopped = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const destroyed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(TAB_CLOSED));
    };
    contents.once("did-stop-loading", stopped);
    contents.once("destroyed", destroyed);
    try {
      contents.stop();
      if (!contents.isLoading()) setImmediate(stopped);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}
