import type { BrowserTarget } from "@openbot/contracts/ipc";
import type { WebContents } from "electron";

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
): Promise<void> {
  return watchNavigation(contents, initiate, timeoutMs);
}

/** Waits for a load that already started, such as one from CDP `Page.navigate`. */
export function waitForLoading(contents: WebContents, timeoutMs: number): Promise<void> {
  if (!contents.isLoading()) return Promise.resolve();
  return watchNavigation(contents, undefined, timeoutMs);
}

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

/** Without `initiate`, the load in progress counts as a started cross-document navigation. */
function watchNavigation(
  contents: WebContents,
  initiate: (() => boolean | Promise<unknown>) | undefined,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
      // A page that calls `pushState` while it loads must not end the wait for that load.
      inPlace = started ? inPlace && isInPlace : isInPlace;
      started = true;
    };
    const didStopLoading = () => {
      if (started && !inPlace) complete();
    };
    const didNavigateInPage = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (started && inPlace && isMainFrame) complete();
    };
    const didFailLoad = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
      if (!started || !isMainFrame) return;
      finish(new Error(timedOut ? NAVIGATION_TIMED_OUT : `Navigation failed (${code}): ${description}`));
    };
    const destroyed = () => {
      finish(new Error(TAB_CLOSED));
    };
    contents.on("did-start-navigation", didStartNavigation);
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
