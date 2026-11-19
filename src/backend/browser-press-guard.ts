import { Effect } from "effect";
import { recordValue, type SendCommand, stringValue } from "./browser-cdp-values";
import type { BrowserOperationError } from "./browser-effects";

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
