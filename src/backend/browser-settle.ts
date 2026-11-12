import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { automationContextId, type SendCommand } from "./browser-cdp-values";

/**
 * Markers of content that is still loading. A visible skeleton or `aria-busy` region means that the
 * snapshot would show placeholders that the page replaces soon.
 */
const BUSY_SELECTOR = `[aria-busy="true"], [class*="skeleton" i], [class*="shimmer" i]`;

/** The longest wait for a loading marker to go. A page that keeps its marker waits once per document. */
export const SETTLE_BUSY_WAIT_MS = 2_000;

/** The longest wait for a new document without controls to put content on the page. */
const SETTLE_EMPTY_WAIT_MS = 1_000;

/** The time that a settle wait leaves before the read's deadline for the second collect. */
export const SETTLE_RESERVE_MS = 1_000;

/** A document younger than this, with no controls, is probably still rendering. */
const SETTLE_YOUNG_DOCUMENT_MS = 2_500;

/**
 * A loaded document with no controls waits only this long after its load event. A script page shows its
 * first content soon after load, and a static page without controls must not wait at all. A stopped
 * document is complete with no load event, and does not wait.
 */
const SETTLE_AFTER_LOAD_MS = 500;

/** The page must stay unchanged this long after the marker goes. */
const SETTLE_QUIET_MS = 150;

const BUSY_FUNCTION = `() => [...document.querySelectorAll(${JSON.stringify(BUSY_SELECTOR)})].some((element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})`;

interface SettleProbe {
  busy: boolean;
  /** How long a page without controls can wait for its first content. 0 means no wait. */
  emptyWaitMs: number;
  /** `performance.timeOrigin`: one value per document, also when a stopped navigation kept the old one. */
  document: number;
}

const evaluateMain = Effect.fn("Browser.evaluateSettle")(function* (
  send: SendCommand,
  expression: string,
  awaitPromise: boolean,
) {
  const contextId = yield* automationContextId(send);
  const result = yield* send("Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise });
  return isDynamicRecord(result.result) ? result.result.value : undefined;
});

/** Reads the loading markers and the document age of the main frame. A failure reads as a quiet page. */
export const probeSettle = Effect.fn("Browser.probeSettle")(function* (send: SendCommand) {
  const value = yield* evaluateMain(
    send,
    `(() => {
  const now = performance.now();
  const loadEnd = performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? 0;
  const emptyWaitMs = now >= ${SETTLE_YOUNG_DOCUMENT_MS}
    ? 0
    : loadEnd > 0
      ? Math.max(0, ${SETTLE_AFTER_LOAD_MS} - (now - loadEnd))
      : document.readyState === "complete"
        ? 0
        : ${SETTLE_EMPTY_WAIT_MS};
  return { busy: (${BUSY_FUNCTION})(), emptyWaitMs: Math.round(emptyWaitMs), document: performance.timeOrigin };
})()`,
    false,
  ).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!isDynamicRecord(value) || !isBoolean(value.busy) || !isNumber(value.emptyWaitMs) || !isNumber(value.document))
    return null;
  return { busy: value.busy, emptyWaitMs: value.emptyWaitMs, document: value.document } satisfies SettleProbe;
});

/**
 * Waits in the page until the loading markers are gone and the DOM stays unchanged for a short time.
 * With `waitForChange`, it first waits for any change, for a new page that has no content yet.
 * Gives `true` when the page settled and `false` when the wait ended at its limit or failed.
 */
export const waitForSettle = Effect.fn("Browser.waitForSettle")(function* (
  send: SendCommand,
  waitForChange: boolean,
  timeoutMs: number,
) {
  const limit = Math.max(1, Math.floor(timeoutMs));
  const value = yield* evaluateMain(
    send,
    `new Promise((resolve) => {
  const busy = ${BUSY_FUNCTION};
  let quietTimer;
  let changed = false;
  const finish = (value) => {
    observer.disconnect();
    clearTimeout(quietTimer);
    clearTimeout(limitTimer);
    resolve(value);
  };
  const settle = () => {
    clearTimeout(quietTimer);
    if (busy()) return;
    quietTimer = setTimeout(() => finish(true), ${SETTLE_QUIET_MS});
  };
  const observer = new MutationObserver(() => {
    changed = true;
    settle();
  });
  const limitTimer = setTimeout(() => finish(${waitForChange ? "changed && !busy()" : "!busy()"}), ${limit});
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  if (!${waitForChange}) settle();
})`,
    true,
  ).pipe(Effect.catch(() => Effect.succeed(false)));
  return value === true;
});
