import { Effect } from "effect";
import { recordValue, type SendCommand, stringValue } from "./browser-cdp-values";
import type { BrowserOperationError } from "./browser-effects";

/**
 * Installs the guard on the target node in an automation world. A capture listener on the window of
 * the node's document checks the first trusted press event: the event must go to the node, to an
 * element inside it, or to a label of it. Otherwise that event and the rest of the click stop before
 * the page's listeners get them. A capture listener that the page put on its window before the click
 * runs first and still gets the event. `stop` removes the listener and returns the name of the element
 * that got the press, or null.
 *
 * Inside a closed shadow root, the window sees only the outermost closed host in the event path, so
 * the check accepts a press on that host. When the page replaced the target before the press, as a
 * re-render on hover can do, nothing is left to check against, so the press goes through.
 */
const INSTALL_PRESS_GUARD = `function() {
  const target = this;
  let anchor = target;
  for (let node = target; ; ) {
    const root = node.getRootNode();
    if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE || !root.host) break;
    if (root.mode === 'closed') anchor = root.host;
    node = root.host;
  }
  const view = target.ownerDocument.defaultView;
  const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu'];
  let checked = false;
  let missed = null;
  const listener = (event) => {
    if (!event.isTrusted) return;
    if (!checked) {
      checked = true;
      if (!target.isConnected) return;
      const path = event.composedPath();
      const reached = path.includes(anchor) || path.some((node) => node.localName === 'label' && node.control === target);
      if (!reached) missed = String(path[0]?.localName || 'another element');
    }
    if (missed === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of types) view.addEventListener(type, listener, { capture: true });
  return {
    stop() {
      for (const type of types) view.removeEventListener(type, listener, { capture: true });
      return missed;
    },
  };
}`;

/**
 * Runs `press` with a check on the first press event that the page gets. A page can move its layout
 * when the pointer comes near, for example an editor that shows a block toolbar over a paragraph.
 * Then a point that was correct before the pointer moved is on another element at the press. The
 * guard stops such a press before the page's listeners get it.
 *
 * Returns the name of the element that got the press instead of the target. Returns undefined when
 * the target got it, when no press event came (a press into a child frame, or a page handler that
 * stopped it first), when the page navigated, or when the guard could not be installed.
 */
export const guardedPress = Effect.fn("Browser.guardedPress")(function* (
  send: SendCommand,
  backendNodeId: number,
  executionContextId: number | undefined,
  sessionId: string | undefined,
  press: Effect.Effect<void, BrowserOperationError>,
): Effect.fn.Return<string | undefined, BrowserOperationError> {
  const guard =
    executionContextId === undefined
      ? undefined
      : yield* Effect.gen(function* () {
          const resolved = yield* send("DOM.resolveNode", { backendNodeId, executionContextId }, sessionId);
          const nodeObjectId = stringValue(recordValue(resolved.object)?.objectId);
          if (!nodeObjectId) return undefined;
          const installed = yield* send(
            "Runtime.callFunctionOn",
            { objectId: nodeObjectId, functionDeclaration: INSTALL_PRESS_GUARD, returnByValue: false },
            sessionId,
          ).pipe(
            Effect.ensuring(send("Runtime.releaseObject", { objectId: nodeObjectId }, sessionId).pipe(Effect.ignore)),
          );
          if (installed.exceptionDetails) return undefined;
          return stringValue(recordValue(installed.result)?.objectId) || undefined;
        }).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!guard) {
    yield* press;
    return undefined;
  }
  let stopped = false;
  // A press that navigates or removes the frame takes the guard with it; the press reached the page.
  const stop = Effect.suspend(() => {
    stopped = true;
    return send(
      "Runtime.callFunctionOn",
      { objectId: guard, functionDeclaration: "function() { return this.stop(); }", returnByValue: true },
      sessionId,
    );
  }).pipe(
    Effect.map((result) => stringValue(recordValue(result.result)?.value) || undefined),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  return yield* Effect.gen(function* () {
    yield* press;
    return yield* stop;
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (!stopped) yield* stop;
        yield* send("Runtime.releaseObject", { objectId: guard }, sessionId).pipe(Effect.ignore);
      }),
    ),
  );
});
