import { stat } from "node:fs/promises";
import type {
  BrowserActionHistoryEntry,
  BrowserDiagnosticEntry,
  BrowserEnvironment,
  BrowserJsonValue,
  BrowserSnapshot,
  BrowserTarget,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import type { NativeImage, WebContents } from "electron";
import {
  buttonMask,
  dispatchMouseClick,
  dispatchShortcut,
  dispatchTextKey,
  modifierMask,
  namedKey,
  SHIFT_MODIFIER,
} from "./browser-cdp-input";
import {
  boundSerializedSnapshot,
  collectBoundedSnapshot,
  collectFocus,
  cssObjectMatch,
  fallbackRole,
  MAX_SNAPSHOT_SCANNED_NODES,
  pageContainsText,
  type SemanticMatch,
  type SnapshotTarget,
  semanticAxMatches,
  type TargetRecord,
  visibleTextObjectMatches,
} from "./browser-cdp-snapshot";
import {
  assertBeforeDeadline,
  automationContextId,
  axValue,
  type CdpResult,
  clamp,
  exceptionDescription,
  isFiniteNumber,
  isRecord,
  numberValue,
  recordValue,
  type SendCommand,
  stringValue,
} from "./browser-cdp-values";
import { type BrowserOperationError, browserCall, browserFailure, browserSync } from "./browser-effects";
import { describeBrowserTarget, stopLoadingAndWait, waitForLoading } from "./browser-navigation";
import { createFramePacer } from "./browser-screencast-pacing";

const ACTION_TIMEOUT_MS = 10_000;
const WAIT_TIMEOUT_MS = 30_000;
const MAX_RESULT_BYTES = 64 * 1024;
const DOCUMENT_ID_PROPERTY = "__openbot_browser_document_id__";
const MAX_SNAPSHOT_FRAMES = 12;
const DOM_QUIET_MS = 250;

type ActionDispatch = () => void;

export interface SnapshotReadResult {
  snapshot: BrowserSnapshot;
  recommendImage: boolean;
  imageReason: string;
}

export interface BrowserUploadAssignment {
  inputId: string;
  documentId: string;
}

export interface SnapshotContext {
  tabId: string;
  revision: number;
  environment: BrowserEnvironment;
  diagnostics: BrowserDiagnosticEntry[];
  actions: BrowserActionHistoryEntry[];
}

export interface BrowserScreencastOptions {
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

export interface BrowserScreencastFrame {
  sequence: number;
  width: number;
  height: number;
  image: Uint8Array;
}

/** Pointer and key input in the page's own CSS pixels. */
export type BrowserViewportInput =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      button: "left" | "middle" | "right";
      clickCount: number;
      deltaX: number;
      deltaY: number;
      modifiers: number;
    }
  | { type: "key"; action: "down" | "up" | "char"; key: string; code: string; text: string; modifiers: number }
  | { type: "paste"; text: string };

/**
 * The page's selection, read in the automation world so the page's own scripts cannot answer for it.
 * A field's selection is not part of `getSelection()`, and a password field gives nothing, as it does
 * for a user's copy. `cut` deletes the selection only where the user could have typed over it, and
 * only when the text can go back to the member: a selection over `max` answers null and stays.
 * A field in a frame, or in an `email` or `number` input, has no selection this world can read.
 */
const SELECTION_TEXT_SCRIPT = `(cut, max) => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active instanceof HTMLInputElement && active.type === "password") return "";
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start === null || end === null) return "";
    if (end - start > max) return null;
    const text = active.value.slice(start, end);
    if (cut && text && !active.readOnly && !active.disabled) document.execCommand("delete");
    return text;
  }
  const root = active?.getRootNode();
  const selection = root instanceof ShadowRoot && root.getSelection ? root.getSelection() : window.getSelection();
  const text = selection?.toString() ?? "";
  if (text.length > max) return null;
  if (cut && text && active instanceof HTMLElement && active.isContentEditable) document.execCommand("delete");
  return text;
}`;

/**
 * A paste event on the focused element, carrying the member's text, as a real paste fires one. A page
 * that handles it - an editor that formats the text, a code form split over several fields - cancels
 * it, and the text is inserted only when nothing did.
 */
const PASTE_EVENT_SCRIPT = `(text) => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true });
  return (active ?? document.body).dispatchEvent(event);
}`;

/** The letter of a shortcut. On a layout whose letters are not Latin, it is the key's place. */
function shortcutLetter(key: string, code: string): string {
  if (/^[a-z]$/iu.test(key)) return key.toLowerCase();
  return /^Key[A-Z]$/u.test(code) ? code.slice(3).toLowerCase() : "";
}

/** Ctrl or Meta: either one is the command modifier, whichever system the client runs. */
const COMMAND_MODIFIERS = 2 | 4;

export class BrowserCdpEngine {
  readonly #contents: WebContents;
  #targets = new Map<string, TargetRecord>();
  #lastSnapshot: BrowserSnapshot | null = null;
  #environment: BrowserEnvironment | null = null;
  #navigationGeneration = 0;

  readonly prepareSecret = Effect.fn("BrowserCdp.prepareSecret")(function* (
    this: BrowserCdpEngine,
    targets: BrowserTarget[],
    origin: string,
    submission: "on_input" | "enter" | "click",
    submitTarget?: BrowserTarget,
  ): Effect.fn.Return<
    {
      enter: (secret: string) => Effect.Effect<void, BrowserOperationError>;
      clear: (secret: string) => Effect.Effect<boolean, BrowserOperationError>;
      /**
       * Which secret the fields are built for, so a fill that no user approves goes only there: every
       * field is a password field, or every field asks for a one-time code, and no native submission of
       * them or of the submit button is GET, which would put the value in a URL. The fingerprint check
       * of `enter` keeps this true until the fill.
       */
      fields: { password: boolean; oneTimeCode: boolean };
    },
    BrowserOperationError
  > {
    const generation = this.#navigationGeneration;
    // A submitter that overrides the form to GET is part of it, so a page cannot add one while the
    // vault read waits.
    const fingerprintFields = `[this.localName, this.type, this.id, this.name, this.getAttribute('autocomplete'), this.getAttribute('aria-label'), this.form?.action, this.form?.method, [...(this.form?.elements ?? [])].some((element) => element.hasAttribute('formmethod') && element.getAttribute('formmethod').trim().toLowerCase() !== 'post')]`;
    const fingerprint = `function() { return JSON.stringify(${fingerprintFields}); }`;
    const nodes = yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const inputs = [];
        for (const target of targets) inputs.push(yield* this.#resolveElementEffect(send, target, Date.now() + 10_000));
        const button = submitTarget
          ? yield* this.#resolveElementEffect(send, submitTarget, Date.now() + 10_000)
          : undefined;
        for (const node of [...inputs, ...(button ? [button] : [])]) {
          if (node.sessionId)
            return yield* browserFailure(new Error("Use takeover for authentication inside a frame."));
          const valid = yield* this.#callOnNode(
            send,
            node.backendNodeId,
            `function(origin, input) { return this.isConnected && this.ownerDocument === document && location.origin === origin && (!input || (this.localName === 'input' && !this.disabled && !this.readOnly && ['password','text','tel','number'].includes(this.type))); }`,
            [origin, inputs.includes(node)],
          );
          if (valid !== true) return yield* browserFailure(new Error("Authentication target is unavailable."));
        }
        if (new Set(inputs.map((node) => node.backendNodeId)).size !== inputs.length)
          return yield* browserFailure(new Error("Authentication fields must be distinct."));
        const fingerprints: string[] = [];
        for (const node of [...inputs, ...(button ? [button] : [])]) {
          const value = yield* this.#callOnNode(send, node.backendNodeId, fingerprint, []);
          if (!isString(value)) return yield* browserFailure(new Error("Authentication target is unavailable."));
          fingerprints.push(value);
        }
        // A native submission that could send the value in a URL: a form whose effective method is not
        // POST (a form with no method is GET), or a submitter in it that overrides to GET. A field with
        // no form is sent only by the page's own script.
        const fields = { password: inputs.length > 0, oneTimeCode: inputs.length > 0 };
        for (const node of inputs) {
          const kind = yield* this.#callOnNode(
            send,
            node.backendNodeId,
            `function() {
              const form = this.form;
              const overrides = (element) => element.hasAttribute('formmethod') && element.getAttribute('formmethod').trim().toLowerCase() !== 'post';
              const posts = !form || (form.method === 'post' && ![...form.elements].some(overrides));
              return { password: this.type === 'password', oneTimeCode: (this.getAttribute('autocomplete') ?? '').toLowerCase().split(/\\s+/).includes('one-time-code'), posts };
            }`,
            [],
          );
          const posts = isDynamicRecord(kind) && kind.posts === true;
          fields.password &&= isDynamicRecord(kind) && kind.password === true && posts;
          fields.oneTimeCode &&= isDynamicRecord(kind) && kind.oneTimeCode === true && posts;
        }
        if (button) {
          const posts = yield* this.#callOnNode(
            send,
            button.backendNodeId,
            `function() {
              if (!this.form) return true;
              if (this.hasAttribute('formmethod')) return this.getAttribute('formmethod').trim().toLowerCase() === 'post';
              return this.form.method === 'post';
            }`,
            [],
          );
          if (posts !== true) fields.password = fields.oneTimeCode = false;
        }
        return { inputs, button, fingerprints, fields };
      }),
    );
    if (generation !== this.#navigationGeneration)
      return yield* browserFailure(new Error("Authentication page changed."));
    const enter = (secret: string) =>
      Effect.gen({ self: this }, function* () {
        yield* Effect.gen({ self: this }, function* () {
          yield* this.#leaseEffect((send) =>
            Effect.gen({ self: this }, function* () {
              if (generation !== this.#navigationGeneration)
                return yield* browserFailure(new Error("Authentication page changed."));
              for (const [index, node] of [...nodes.inputs, ...(nodes.button ? [nodes.button] : [])].entries()) {
                if ((yield* this.#callOnNode(send, node.backendNodeId, fingerprint, [])) !== nodes.fingerprints[index])
                  return yield* browserFailure(new Error("Authentication target changed."));
                const valid = yield* this.#callOnNode(
                  send,
                  node.backendNodeId,
                  `function(origin, input) { return this.isConnected && this.ownerDocument === document && location.origin === origin && (!input || (!this.disabled && !this.readOnly)); }`,
                  [origin, nodes.inputs.includes(node)],
                );
                if (valid !== true) return yield* browserFailure(new Error("Authentication target changed."));
              }
              for (const [index, node] of nodes.inputs.entries()) {
                if (generation !== this.#navigationGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                yield* send("DOM.focus", { backendNodeId: node.backendNodeId });
                yield* this.#callOnNode(
                  send,
                  node.backendNodeId,
                  `function(origin) {
                if (!this.isConnected || this.ownerDocument !== document || location.origin !== origin || this.disabled || this.readOnly) throw new Error('Authentication target changed.');
                this.select();
              }`,
                  [origin],
                );
                if (generation !== this.#navigationGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                // Native entry emits trusted input events across shadow roots, as regular browser typing
                // does. Synthetic value setters can leave component forms unaware of the filled field.
                yield* send("Input.insertText", { text: nodes.inputs.length === 1 ? secret : secret[index] });
              }
              if (submission === "on_input" || generation !== this.#navigationGeneration) return;
              if (submission === "click" && nodes.button) {
                yield* this.#callOnNode(
                  send,
                  nodes.button.backendNodeId,
                  `function(origin, expected) {
                return new Promise((resolve, reject) => {
                  const finish = (error) => { observer.disconnect(); clearTimeout(timer); error ? reject(new Error(error)) : resolve(); };
                  const check = () => {
                    if (!this.isConnected || this.ownerDocument !== document || location.origin !== origin || JSON.stringify(${fingerprintFields}) !== expected) return finish('Authentication target changed.');
                    if (!this.disabled && this.getAttribute('aria-disabled') !== 'true') finish();
                  };
                  const observer = new MutationObserver(check);
                  const timer = setTimeout(() => finish('Authentication submit button is not ready.'), 2000);
                  observer.observe(this, { attributes: true });
                  observer.observe(this.getRootNode(), { childList: true, subtree: true });
                  check();
                });
              }`,
                  [origin, nodes.fingerprints.at(-1)],
                );
                const point = yield* this.#elementPointEffect(send, nodes.button.backendNodeId, true);
                if (generation !== this.#navigationGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                yield* dispatchMouseClick(send, point, "left", 1, 0);
              } else if (submission === "enter") {
                const last = nodes.inputs.at(-1);
                if (!last) return yield* browserFailure(new Error("Authentication target changed."));
                // An input handler can change the form after the fill; the click branch checks the same.
                if (
                  (yield* this.#callOnNode(send, last.backendNodeId, fingerprint, [])) !==
                  nodes.fingerprints[nodes.inputs.length - 1]
                )
                  return yield* browserFailure(new Error("Authentication target changed."));
                yield* send("DOM.focus", { backendNodeId: last.backendNodeId });
                yield* dispatchShortcut(send, "Enter");
              }
            }),
          );
        }).pipe(
          Effect.catch(() =>
            Effect.gen({ self: this }, function* () {
              return yield* browserFailure(
                new Error("Secure authentication could not be completed. Take over to check the page."),
              );
            }),
          ),
        );
      });
    /**
     * Empties the filled fields, attached or detached, and reports whether the document is now free
     * of the value: every field is empty and no title, URL, text, value or attribute contains it.
     */
    const clear = (secret: string) =>
      this.#leaseEffect((send) =>
        Effect.gen({ self: this }, function* () {
          for (const node of nodes.inputs) {
            const cleared = yield* this.#callOnNode(
              send,
              node.backendNodeId,
              `function() { this.value = ''; return this.value === ''; }`,
              [],
            ).pipe(Effect.catch(() => Effect.succeed(false)));
            if (cleared !== true) return false;
          }
          const executionContextId = yield* automationContextId(send);
          const scan = yield* send("Runtime.callFunctionOn", {
            executionContextId,
            functionDeclaration: SECRET_SCAN_FUNCTION,
            arguments: [{ value: secret }],
            returnByValue: true,
          });
          return !recordValue(scan.exceptionDetails) && recordValue(scan.result)?.value === false;
        }),
      ).pipe(Effect.catch(() => Effect.succeed(false)));
    return { enter, clear, fields: nodes.fields };
  });
  #retainDebugger = false;
  #ownsDebugger = false;
  #closing = false;
  #disposed = false;
  readonly #scope = Scope.makeUnsafe();
  /**
   * How many leases are running. A lease detaches on the way out, and until this counter existed it
   * detached whenever it was the one that had attached -- which is wrong as soon as two overlap. An
   * operation that missed its deadline goes on running while the next one starts, so the one that
   * finished first took the other's debugger down with it: `target closed while handling command` on
   * the command in flight, then `No target available` for every command after it, on a page that was
   * perfectly healthy.
   */
  #activeLeases = 0;
  #highlightSessionId: string | undefined;
  readonly #uploadDocumentIds = new Set<string>();
  readonly #targetSessions = new Map<string, { sessionId: string; url: string }>();

  constructor(contents: WebContents) {
    this.#contents = contents;
    contents.once("close", () => {
      // Native teardown can start before isDestroyed() becomes true. Detaching a debugger
      // during that interval can crash Electron; Chromium will dispose it with the page.
      this.#closing = true;
    });
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame) this.#navigationGeneration += 1;
      this.#targets.clear();
      this.#lastSnapshot = null;
    });
    contents.debugger.on("message", (_event, method, params, sessionId) => {
      if (method === "Target.attachedToTarget" && isRecord(params)) {
        const attachedSessionId = stringValue(params.sessionId) || sessionId || "";
        const targetInfo = recordValue(params.targetInfo);
        const targetId = stringValue(targetInfo?.targetId);
        if (attachedSessionId && targetId) {
          this.#targetSessions.set(targetId, { sessionId: attachedSessionId, url: stringValue(targetInfo?.url) });
        }
      }
      if (method === "Target.detachedFromTarget" && isRecord(params)) {
        const detached = stringValue(params.sessionId);
        for (const [targetId, target] of this.#targetSessions) {
          if (target.sessionId === detached) this.#targetSessions.delete(targetId);
        }
      }
    });
    contents.debugger.on("detach", () => this.#clearDebuggerSessions());
  }

  readonly snapshot = Effect.fn("BrowserCdp.snapshot")(function* (
    this: BrowserCdpEngine,
    context: SnapshotContext,
  ): Effect.fn.Return<SnapshotReadResult, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const navigationGeneration = this.#navigationGeneration;
        const [metrics, parsed, focus] = yield* Effect.all(
          [
            send("Page.getLayoutMetrics"),
            collectBoundedSnapshot(send, this.#snapshotTargets(), context.revision, true),
            collectFocus(send).pipe(Effect.catch(() => Effect.succeed(null))),
          ],
          { concurrency: "unbounded" },
        );
        if (navigationGeneration !== this.#navigationGeneration) {
          return yield* browserFailure(new Error("Page navigated during the browser snapshot. Take a fresh snapshot."));
        }
        const viewport = readViewport(metrics, context.environment);
        const snapshot: BrowserSnapshot = {
          tabId: context.tabId,
          revision: context.revision,
          title: this.#contents.getTitle().slice(0, 500),
          url: this.#contents.getURL(),
          loading: this.#contents.isLoading(),
          viewport,
          text: parsed.text,
          elements: parsed.elements,
          truncated: parsed.truncated,
          focus,
          diagnostics: context.diagnostics,
          actions: context.actions,
        };
        boundSerializedSnapshot(snapshot);
        const retainedRefs = new Set(snapshot.elements.map((element) => element.ref));
        this.#targets = new Map([...parsed.targets].filter(([ref]) => retainedRefs.has(ref)));
        this.#lastSnapshot = snapshot;
        const lowCoverage = parsed.elements.length < 3 && parsed.text.length > 200;
        const recommendImage = parsed.hasVisualSurface || parsed.hasFrame || lowCoverage;
        const imageReason = parsed.hasVisualSurface
          ? "canvas-or-video"
          : parsed.hasFrame
            ? "iframe"
            : "low-semantic-coverage";
        return { snapshot, recommendImage, imageReason };
      }),
    );
  });

  readonly click = Effect.fn("BrowserCdp.click")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    options: { button?: "left" | "middle" | "right"; clickCount?: number; modifiers?: string[] } = {},
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const point = yield* this.#targetPointEffect(send, target, true, true, deadline);
        const { sessionId, ...coordinates } = point;
        const button = options.button ?? "left";
        const totalClicks = options.clickCount ?? 1;
        const modifiers = modifierMask(options.modifiers ?? []);
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* dispatchMouseClick(send, coordinates, button, totalClicks, modifiers, sessionId);
      }),
    );
  });

  readonly hover = Effect.fn("BrowserCdp.hover")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const point = yield* this.#targetPointEffect(send, target, true, true, deadline);
        const { sessionId, ...coordinates } = point;
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* send("Input.dispatchMouseEvent", { type: "mouseMoved", ...coordinates }, sessionId);
      }),
    );
  });

  readonly type = Effect.fn("BrowserCdp.type")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget | undefined,
    text: string,
    options: { mode?: "replace" | "append"; submit?: boolean } = {},
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const mode = options.mode ?? "replace";
    if (!target) return yield* this.#typeFocusedEffect(text, options.submit === true, deadline, onDispatch);
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
        if (!resolved.backendNodeId) return yield* browserFailure(new Error("Typing requires an element target."));
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, resolved.sessionId);
        const useEndKey = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          `function(mode) {
          if (!('value' in this) && !this.isContentEditable) throw new Error('Target does not accept text.');
          if (mode === 'replace') {
            if ('select' in this && typeof this.select === 'function') this.select();
            else {
              const selection = this.ownerDocument.getSelection(); const range = this.ownerDocument.createRange();
              range.selectNodeContents(this); selection.removeAllRanges(); selection.addRange(range);
            }
          } else if ('value' in this && typeof this.setSelectionRange === 'function') {
            const tag = this.localName;
            const selectable = tag === 'textarea' ||
              (tag === 'input' && ['text', 'search', 'tel', 'url', 'password'].includes(this.type));
            if (!selectable) return true;
            const end = String(this.value).length; this.setSelectionRange(end, end);
          } else if (this.isContentEditable) {
            const selection = this.ownerDocument.getSelection(); const range = this.ownerDocument.createRange();
            range.selectNodeContents(this); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
          }
          return false;
        }`,
          [mode],
          resolved.sessionId,
        );
        if (useEndKey === true) yield* dispatchShortcut(send, "End", resolved.sessionId);
        yield* browserSync(() => assertBeforeDeadline(deadline));
        yield* send("Input.insertText", { text }, resolved.sessionId);
        // Submitting is part of typing rather than a second action, because it has to reach the node
        // this lease already resolved. Re-resolving a snapshot ref here would fingerprint the element
        // against its pre-typing text, so a contenteditable would fail with "The target changed after
        // the snapshot" and `submit: true` would insert the text without ever submitting it.
        if (options.submit === true) {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          yield* dispatchShortcut(send, "Enter", resolved.sessionId);
        }
      }),
    );
  });

  // An application that draws its own surface -- a spreadsheet grid on a canvas, a code editor, a
  // map -- has no element to focus and no value to set: it reads the keystrokes the page already
  // has focus for. So this path sends the key events a person produces rather than an insertion
  // into a node, and keeps tab and newline as the keys that move between a grid's columns and rows
  // instead of inserting them as characters. Selection has no meaning without a node, so `mode` is
  // rejected at the tool boundary rather than silently ignored here.

  readonly #typeFocusedEffect = Effect.fn("BrowserCdp.typeFocused")(function* (
    this: BrowserCdpEngine,
    text: string,
    submit: boolean,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const characters = [...text.replace(/\r\n?/g, "\n")];
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        let sent = 0;
        for (const character of characters) {
          // Each keystroke is its own event, so a deadline reached part way through leaves what the
          // page already took. Reporting only that the action timed out would let a caller repeat a
          // send that half happened, which in a spreadsheet writes the data twice.
          yield* browserSync(() => assertTypingProgressBeforeDeadline(deadline, sent, characters.length));
          if (character === "\n") yield* dispatchShortcut(send, "Enter");
          else if (character === "\t") yield* dispatchShortcut(send, "Tab");
          else yield* dispatchTextKey(send, character);
          sent += 1;
        }
        if (submit) {
          yield* browserSync(() => assertTypingProgressBeforeDeadline(deadline, sent, characters.length));
          yield* dispatchShortcut(send, "Enter");
        }
      }),
    );
  });

  readonly press = Effect.fn("BrowserCdp.press")(function* (
    this: BrowserCdpEngine,
    key: string,
    target?: BrowserTarget,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        let sessionId: string | undefined;
        if (target) {
          if (target.kind === "point")
            return yield* browserFailure(new Error("Press requires an element target, not coordinates."));
          const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
          sessionId = resolved.sessionId;
          if (resolved.backendNodeId) {
            yield* browserSync(() => assertBeforeDeadline(deadline));
            onDispatch?.();
            yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, sessionId);
          }
        }
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* dispatchShortcut(send, key, sessionId);
      }),
    );
  });

  readonly scroll = Effect.fn("BrowserCdp.scroll")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget | undefined,
    deltaX: number,
    deltaY: number,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        if (!target) {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          onDispatch?.();
          yield* send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: 1,
            y: 1,
            deltaX: clamp(deltaX, -100_000, 100_000),
            deltaY: clamp(deltaY, -100_000, 100_000),
          });
          return;
        }
        const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
        if (!resolved.backendNodeId) {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          onDispatch?.();
          yield* send(
            "Input.dispatchMouseEvent",
            {
              type: "mouseWheel",
              x: resolved.x,
              y: resolved.y,
              deltaX,
              deltaY,
            },
            resolved.sessionId,
          );
          return;
        }
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          "function(x, y) { this.scrollBy({ left: x, top: y, behavior: 'instant' }); }",
          [deltaX, deltaY],
          resolved.sessionId,
        );
      }),
    );
  });

  readonly selectOption = Effect.fn("BrowserCdp.selectOption")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    values: string[],
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    this.#contents.focus();
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveElementEffect(send, target, deadline);
        const plan = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          `function(values) {
          if (this.localName !== 'select') throw new Error('Target is not a select element.');
          if (!this.multiple && values.length > 1) throw new Error('A single-select accepts only one requested value.');
          const desiredIndices = [];
          const enabledIndices = [];
          for (let index = 0; index < this.options.length; index++) {
            const option = this.options[index];
            const disabled = option.disabled || option.parentElement?.disabled === true;
            if (!disabled) enabledIndices.push(index);
          }
          for (const value of values) {
            const valueMatches = Array.from(this.options, (option, index) => option.value === value ? index : -1)
              .filter(index => index >= 0);
            const textMatches = valueMatches.length > 0 ? [] :
              Array.from(this.options, (option, index) => option.label === value || option.text === value ? index : -1)
                .filter(index => index >= 0);
            const matches = valueMatches.length > 0 ? valueMatches : textMatches;
            if (matches.length === 0) throw new Error('One or more requested options do not exist.');
            if (matches.length > 1) throw new Error('A requested option is ambiguous. Use a unique option value.');
            const option = this.options[matches[0]];
            if (option.disabled || option.parentElement?.disabled === true) {
              throw new Error('A requested option is disabled.');
            }
            desiredIndices.push(matches[0]);
          }
          const uniqueDesiredIndices = [...new Set(desiredIndices)];
          const desiredIndex = uniqueDesiredIndices[0];
          const desiredLabel = desiredIndex === undefined ? '' : this.options[desiredIndex].label || this.options[desiredIndex].text;
          const desiredInitial = Array.from(desiredLabel)[0]?.toLocaleLowerCase() || '';
          const typeaheadCycleIndices = desiredInitial === '' ? [] : enabledIndices.filter(index =>
            (this.options[index].label || this.options[index].text).toLocaleLowerCase().startsWith(desiredInitial));
          return {
            multiple: this.multiple,
            desiredIndices: this.multiple ? uniqueDesiredIndices : uniqueDesiredIndices.slice(0, 1),
            desiredLabel,
            selectedIndex: this.selectedIndex,
            typeaheadCycleIndices,
            enabledIndices,
          };
        }`,
          [values],
          resolved.sessionId,
        );
        if (!isDynamicRecord(plan) || !isBoolean(plan.multiple)) {
          return yield* browserFailure(new Error("Select target returned an invalid option plan."));
        }
        const desiredIndices = Array.isArray(plan.desiredIndices) ? plan.desiredIndices.filter(isNumber) : [];
        if (plan.multiple) desiredIndices.sort((left, right) => left - right);
        const enabledIndices = Array.isArray(plan.enabledIndices) ? plan.enabledIndices.filter(isNumber) : [];
        const [firstDesiredIndex] = desiredIndices;
        if (firstDesiredIndex === undefined || desiredIndices.some((index) => !enabledIndices.includes(index))) {
          return yield* browserFailure(new Error("Select target returned an invalid option plan."));
        }
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, resolved.sessionId);
        if (!plan.multiple) {
          const cycleIndices = Array.isArray(plan.typeaheadCycleIndices)
            ? plan.typeaheadCycleIndices.filter(isNumber)
            : [];
          if (!isString(plan.desiredLabel) || !isNumber(plan.selectedIndex)) {
            return yield* browserFailure(new Error("Select target returned an invalid keyboard navigation plan."));
          }
          const selectedIndex = plan.selectedIndex;
          const targetRank = enabledIndices.indexOf(firstDesiredIndex);
          if (firstDesiredIndex !== selectedIndex && cycleIndices.length > 0) {
            const firstCycleRank = cycleIndices.findIndex((index) => index > selectedIndex);
            const startCycleRank = firstCycleRank < 0 ? 0 : firstCycleRank;
            const targetCycleRank = cycleIndices.indexOf(firstDesiredIndex);
            if (targetCycleRank < 0) {
              return yield* browserFailure(new Error("Select target returned an invalid typeahead navigation plan."));
            }
            const steps = ((targetCycleRank - startCycleRank + cycleIndices.length) % cycleIndices.length) + 1;
            const initial = Array.from(plan.desiredLabel)[0];
            if (!initial) return yield* browserFailure(new Error("Select target returned an empty typeahead key."));
            // Chromium keeps a typeahead buffer per select for about a second, so a second
            // `select_option` inside that window appends to the characters the first one typed: `a`
            // after `b` searches for `ba`, matches nothing, and leaves the selection where it was.
            // A focus round-trip clears the buffer. Waiting the timer out is the only alternative and
            // costs a second on every call.
            yield* this.#callOnNode(
              send,
              resolved.backendNodeId,
              "function() { this.blur(); }",
              [],
              resolved.sessionId,
            );
            yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, resolved.sessionId);
            for (let index = 0; index < steps; index++) {
              yield* dispatchTextKey(send, initial, resolved.sessionId);
            }
          } else if (firstDesiredIndex !== selectedIndex) {
            yield* dispatchShortcut(send, "Home", resolved.sessionId);
            for (let index = 0; index < targetRank; index++) {
              yield* dispatchShortcut(send, "ArrowDown", resolved.sessionId);
            }
          }
        } else {
          const additiveModifiers = process.platform === "darwin" ? ["Meta"] : ["Control"];
          for (const [index, desiredIndex] of desiredIndices.entries()) {
            const optionNodeId = yield* this.#optionBackendNodeIdEffect(
              send,
              resolved.backendNodeId,
              desiredIndex,
              resolved.sessionId,
            );
            const point = yield* this.#elementPointEffect(send, optionNodeId, false, resolved.sessionId);
            const { sessionId, ...coordinates } = point;
            const modifiers = index === 0 ? 0 : modifierMask(additiveModifiers);
            yield* send(
              "Input.dispatchMouseEvent",
              { type: "mousePressed", ...coordinates, button: "left", clickCount: 1, modifiers },
              sessionId,
            );
            yield* send(
              "Input.dispatchMouseEvent",
              { type: "mouseReleased", ...coordinates, button: "left", clickCount: 1, modifiers },
              sessionId,
            );
          }
        }
        const selected = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          "function() { return Array.from(this.options, (option, index) => option.selected ? index : -1).filter(index => index >= 0); }",
          [],
          resolved.sessionId,
        );
        const selectedIndices = Array.isArray(selected) ? selected.filter(isNumber) : [];
        if (
          selectedIndices.length !== desiredIndices.length ||
          selectedIndices.some((index, position) => index !== desiredIndices[position])
        ) {
          // An option with no label has nothing to type towards, and on macOS typeahead is the only
          // keyboard strategy a closed select honours -- ArrowDown opens the native popup instead of
          // moving the selection, and no CDP key event reaches that popup. Say so, because the indices
          // alone leave the caller with nothing to act on.
          const unreachable =
            !plan.multiple && plan.desiredLabel === ""
              ? " An option with no label can only be reached by keyboard where a closed select honours arrow keys, which macOS does not."
              : "";
          return yield* browserFailure(
            new Error(
              `Native select interaction did not produce the requested selection (expected ${desiredIndices.join(",")}, got ${selectedIndices.join(",")}).${unreachable}`,
            ),
          );
        }
      }),
    );
  });

  readonly setChecked = Effect.fn("BrowserCdp.setChecked")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    checked: boolean,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveElementEffect(send, target, deadline);
        const state = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          `function() {
          if (this.localName !== 'input' || (this.type !== 'checkbox' && this.type !== 'radio')) {
            throw new Error('Target is not checkable.');
          }
          return {
            checked: Boolean(this.checked),
            radio: this.localName === 'input' && this.type === 'radio',
          };
        }`,
          [],
          resolved.sessionId,
        );
        if (!isDynamicRecord(state) || !isBoolean(state.checked) || !isBoolean(state.radio)) {
          return yield* browserFailure(new Error("Target returned an invalid checked state."));
        }
        if (state.radio && state.checked && !checked) {
          return yield* browserFailure(
            new Error("A selected radio button cannot be cleared directly. Select another radio option instead."),
          );
        }
        if (state.checked !== checked) {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          onDispatch?.();
          const point = yield* this.#elementPointEffect(send, resolved.backendNodeId, true, resolved.sessionId);
          const { sessionId, ...coordinates } = point;
          yield* send(
            "Input.dispatchMouseEvent",
            { type: "mousePressed", ...coordinates, button: "left", clickCount: 1 },
            sessionId,
          );
          yield* send(
            "Input.dispatchMouseEvent",
            { type: "mouseReleased", ...coordinates, button: "left", clickCount: 1 },
            sessionId,
          );
        }
        const updated = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          "function() { return Boolean(this.checked); }",
          [],
          resolved.sessionId,
        );
        if (updated !== checked)
          return yield* browserFailure(new Error("Target did not reach the requested checked state."));
      }),
    );
  });

  readonly drag = Effect.fn("BrowserCdp.drag")(function* (
    this: BrowserCdpEngine,
    source: BrowserTarget,
    target: BrowserTarget,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const initialFrom = yield* this.#targetPointEffect(send, source, true, true, deadline);
        const initialTo = yield* this.#targetPointEffect(send, target, true, true, deadline);
        if (initialFrom.sessionId !== initialTo.sessionId)
          return yield* browserFailure(new Error("Cross-frame drag is not supported."));
        const from = yield* this.#targetPointEffect(send, source, true, false, deadline);
        const to = yield* this.#targetPointEffect(send, target, true, false, deadline);
        const sessionId = from.sessionId;
        const interceptedDragData = Deferred.makeUnsafe<CdpResult | null>();
        const stopWaitingForIntercept = yield* browserSync(() => {
          let stopWaitingForIntercept = () => undefined;
          const debuggerClient = this.#contents.debugger;
          const listener = (_event: Electron.Event, method: string, params: unknown, messageSessionId?: string) => {
            if (method !== "Input.dragIntercepted" || (sessionId !== undefined && messageSessionId !== sessionId)) {
              return;
            }
            stopWaitingForIntercept();
            Deferred.doneUnsafe(
              interceptedDragData,
              Effect.succeed(isRecord(params) ? (recordValue(params.data) ?? null) : null),
            );
          };
          const timeout = setTimeout(() => {
            stopWaitingForIntercept();
            Deferred.doneUnsafe(interceptedDragData, Effect.succeed(null));
          }, 2_000);
          stopWaitingForIntercept = () => {
            clearTimeout(timeout);
            debuggerClient.removeListener("message", listener);
          };
          debuggerClient.on("message", listener);
          return stopWaitingForIntercept;
        });
        let pressSent = false;
        yield* Effect.gen({ self: this }, function* () {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          onDispatch?.();
          yield* send("Input.setInterceptDrags", { enabled: true }, sessionId);
          yield* send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y }, sessionId);
          pressSent = true;
          yield* send(
            "Input.dispatchMouseEvent",
            { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 },
            sessionId,
          );
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              stopWaitingForIntercept();
              yield* send("Input.setInterceptDrags", { enabled: false }, sessionId).pipe(Effect.ignore);
              if (pressSent)
                yield* send(
                  "Input.dispatchMouseEvent",
                  {
                    type: "mouseReleased",
                    x: from.x,
                    y: from.y,
                    button: "left",
                    clickCount: 1,
                  },
                  sessionId,
                ).pipe(Effect.ignore);
            }),
          ),
          Effect.catch((operationFailure) =>
            Effect.gen({ self: this }, function* () {
              const error = operationFailure.cause;
              // The listener and the drag intercept would otherwise outlive a drag that never started.
              stopWaitingForIntercept();
              yield* send("Input.setInterceptDrags", { enabled: false }, sessionId).pipe(Effect.ignore);
              // The press can reach the page even when its reply fails, and a held button breaks later input.
              if (pressSent) {
                yield* send(
                  "Input.dispatchMouseEvent",
                  { type: "mouseReleased", x: from.x, y: from.y, button: "left", clickCount: 1 },
                  sessionId,
                ).pipe(Effect.ignore);
              }
              return yield* browserFailure(error);
            }),
          ),
        );
        let released = false;
        yield* Effect.gen({ self: this }, function* () {
          const activationX = from.x + Math.sign(to.x - from.x) * 4;
          const activationY = from.y + Math.sign(to.y - from.y) * 4;
          yield* send(
            "Input.dispatchMouseEvent",
            {
              type: "mouseMoved",
              x: activationX,
              y: activationY,
              button: "left",
              buttons: 1,
            },
            sessionId,
          );
          for (let step = 1; step <= 8; step++) {
            yield* send(
              "Input.dispatchMouseEvent",
              {
                type: "mouseMoved",
                x: activationX + ((to.x - activationX) * step) / 8,
                y: activationY + ((to.y - activationY) * step) / 8,
                button: "left",
                buttons: 1,
              },
              sessionId,
            );
          }
          const dragData = yield* Deferred.await(interceptedDragData);
          if (!dragData) return yield* browserFailure(new Error("The source did not start a native drag operation."));
          yield* send("Input.dispatchDragEvent", { type: "dragEnter", x: to.x, y: to.y, data: dragData }, sessionId);
          yield* send("Input.dispatchDragEvent", { type: "dragOver", x: to.x, y: to.y, data: dragData }, sessionId);
          yield* send("Input.dispatchDragEvent", { type: "drop", x: to.x, y: to.y, data: dragData }, sessionId);
          yield* send(
            "Input.dispatchMouseEvent",
            { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 },
            sessionId,
          );
          released = true;
        }).pipe(
          Effect.ensuring(
            Effect.gen({ self: this }, function* () {
              stopWaitingForIntercept();
              yield* send("Input.setInterceptDrags", { enabled: false }, sessionId).pipe(Effect.ignore);
              if (!released) {
                yield* send(
                  "Input.dispatchMouseEvent",
                  { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 },
                  sessionId,
                ).pipe(Effect.ignore);
              }
            }).pipe(Effect.orDie),
          ),
        );
      }),
    );
  });

  readonly resolveUploadTarget = Effect.fn("BrowserCdp.resolveUploadTarget")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
  ): Effect.fn.Return<BrowserUploadAssignment, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveElementEffect(send, target);
        return yield* this.#identifyUploadTargetEffect(send, resolved);
      }),
    );
  });

  readonly uploadFiles = Effect.fn("BrowserCdp.uploadFiles")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    paths: string[],
    onTargetResolved?: (assignment: BrowserUploadAssignment) => void,
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<BrowserUploadAssignment, BrowserOperationError> {
    if (paths.length === 0 || paths.length > 10)
      return yield* browserFailure(new Error("Upload requires between 1 and 10 files."));
    if (Buffer.byteLength(JSON.stringify(paths)) > MAX_RESULT_BYTES)
      return yield* browserFailure(new Error("Upload path arguments exceed 64 KB."));
    for (const path of paths) {
      const info = yield* browserCall(() => stat(path).catch(() => null));
      if (!info?.isFile())
        return yield* browserFailure(new Error(`Upload file does not exist or is not a regular file: ${path}`));
    }
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveElementEffect(send, target, deadline);
        const assignment = yield* this.#identifyUploadTargetEffect(send, resolved);
        onTargetResolved?.(assignment);
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* send(
          "DOM.setFileInputFiles",
          { backendNodeId: resolved.backendNodeId, files: paths },
          resolved.sessionId,
        );
        return assignment;
      }),
    );
  });

  readonly #identifyUploadTargetEffect = Effect.fn("BrowserCdp.identifyUploadTarget")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    resolved: { backendNodeId: number; sessionId?: string },
  ): Effect.fn.Return<BrowserUploadAssignment, BrowserOperationError> {
    const documentId = yield* this.#callOnNode(
      send,
      resolved.backendNodeId,
      documentIdFunctionDeclaration(),
      [],
      resolved.sessionId,
    );
    if (!isString(documentId)) return yield* browserFailure(new Error("Unable to identify the upload document."));
    this.#uploadDocumentIds.add(documentId);
    return {
      inputId: `${documentId}:${resolved.backendNodeId}`,
      documentId,
    };
  });

  readonly documentIds = Effect.fn("BrowserCdp.documentIds")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<Set<string>, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const ids = new Set<string>();
        let complete = true;
        for (const capture of this.#snapshotTargets(Number.POSITIVE_INFINITY)) {
          if (ids.size === this.#uploadDocumentIds.size) break;
          const contextId = yield* automationContextId(send, capture.sessionId);
          const result = yield* send(
            "Runtime.evaluate",
            {
              expression: documentIdsExpression([...this.#uploadDocumentIds]),
              contextId,
              returnByValue: true,
            },
            capture.sessionId,
          );
          const exception = recordValue(result.exceptionDetails);
          if (exception) return yield* browserFailure(new Error(exceptionDescription(exception)));
          const payload = recordValue(recordValue(result.result)?.value);
          const values = payload?.ids;
          if (!Array.isArray(values) || !isBoolean(payload?.complete))
            return yield* browserFailure(new Error("Browser documents returned invalid identities."));
          if (!payload.complete) complete = false;
          for (const value of values) {
            if (isString(value)) ids.add(value);
          }
        }
        // A scan that hit the node budget proves nothing about the documents it never reached, and the
        // caller frees the staged files of every id missing from this set. So an unvisited document is
        // presumed open: keeping a staging directory until the tab closes costs a temp directory, while
        // freeing one whose input is still live hands the page a path that no longer exists.
        if (!complete) return new Set(this.#uploadDocumentIds);
        for (const documentId of this.#uploadDocumentIds) {
          if (!ids.has(documentId)) this.#uploadDocumentIds.delete(documentId);
        }
        return ids;
      }),
    );
  });

  hasUploadDocuments(): boolean {
    return this.#uploadDocumentIds.size > 0;
  }

  invalidateReferences(): void {
    this.#targets.clear();
    this.#lastSnapshot = null;
  }

  cancelPendingCommands(): boolean {
    if (!this.#ownsDebugger) return false;
    this.#detachOwnedDebugger();
    return true;
  }

  readonly setEnvironment = Effect.fn("BrowserCdp.setEnvironment")(function* (
    this: BrowserCdpEngine,
    environment: BrowserEnvironment,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const previousEnvironment = this.#environment;
    const previousRetainDebugger = this.#retainDebugger;
    this.#retainDebugger = true;
    yield* Effect.gen({ self: this }, function* () {
      yield* this.#leaseEffect(
        (send) =>
          Effect.gen({ self: this }, function* () {
            yield* Effect.gen({ self: this }, function* () {
              yield* this.#applyEnvironmentEffect(send, environment);
            }).pipe(
              Effect.catch((operationFailure) =>
                Effect.gen({ self: this }, function* () {
                  const error = operationFailure.cause;
                  if (previousEnvironment) yield* this.#applyEnvironmentEffect(send, previousEnvironment);
                  else yield* this.#clearEnvironmentEffect(send);
                  return yield* browserFailure(error);
                }),
              ),
            );
          }),
        false,
      );
      this.#environment = environment;
    }).pipe(
      Effect.catch((operationFailure) =>
        Effect.gen({ self: this }, function* () {
          const error = operationFailure.cause;
          this.#retainDebugger = previousRetainDebugger;
          if (!this.#retainDebugger) this.#detachOwnedDebugger();
          return yield* browserFailure(error);
        }),
      ),
    );
  });

  readonly screenshot = Effect.fn("BrowserCdp.screenshot")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<NativeImage, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const fill = !this.#environment || this.#environment.viewport.mode === "fill";
        if (fill) {
          // Hidden views need a capture surface. Preserve the page's full viewport,
          // including scrollbars: layoutViewport.clientWidth would shrink it and
          // can dispose a responsive page's OAuth callback during preview capture.
          const contextId = yield* automationContextId(send);
          const result = yield* send("Runtime.evaluate", {
            expression: "({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })",
            contextId,
            returnByValue: true,
          });
          const viewport = recordValue(recordValue(result.result)?.value);
          yield* send("Emulation.setDeviceMetricsOverride", {
            width: numberValue(viewport?.width),
            height: numberValue(viewport?.height),
            deviceScaleFactor: numberValue(viewport?.scale),
            mobile: false,
          });
        }
        return yield* Effect.gen({ self: this }, function* () {
          return yield* browserCall(() => this.#contents.capturePage());
        }).pipe(
          Effect.ensuring(
            Effect.gen({ self: this }, function* () {
              if (fill) yield* send("Emulation.clearDeviceMetricsOverride");
            }).pipe(Effect.orDie),
          ),
        );
      }),
    );
  });

  readonly startScreencast = Effect.fn("BrowserCdp.startScreencast")(function* (
    this: BrowserCdpEngine,
    options: BrowserScreencastOptions,
    onFrame: (frame: BrowserScreencastFrame) => void,
    onEnded?: (error: unknown) => void,
  ): Effect.fn.Return<() => Effect.Effect<void>, BrowserOperationError> {
    let live = false;
    let stopRequested = false;
    const stopped = Deferred.makeUnsafe<void>();
    const stop = () => {
      stopRequested = true;
      Deferred.doneUnsafe(stopped, Effect.void);
    };
    const ready = Deferred.makeUnsafe<void, BrowserOperationError>();
    const started = () => Deferred.doneUnsafe(ready, Effect.void);
    let sequence = 0;
    // The number counts the frames the client is given, not the ones the page drew.
    const pacer = createFramePacer<Omit<BrowserScreencastFrame, "sequence">>((frame) => {
      sequence += 1;
      onFrame({ ...frame, sequence });
    });
    const listener = (_event: unknown, method: string, params?: DynamicRecord | unknown, sessionId?: string): void => {
      if (method !== "Page.screencastFrame" || !isDynamicRecord(params)) return;
      const metadata = recordValue(params.metadata);
      const data = stringValue(params.data);
      const frameSessionId = numberValue(params.sessionId);
      // The page is told it may send the next frame whether or not this one could be read, so a
      // frame the client cannot use never ends the stream.
      // The root session is reported as an empty string, which `sendCommand` refuses: sending it
      // would fail every acknowledgement, and the page stops after the few frames it may hold
      // unacknowledged.
      void this.#contents.debugger
        .sendCommand("Page.screencastFrameAck", { sessionId: frameSessionId }, sessionId || undefined)
        .catch(() => undefined);
      if (!data) return;
      pacer.offer({
        image: Buffer.from(data, "base64"),
        // The device size is the CSS viewport the fractional input coordinates are measured against.
        width: Math.max(1, Math.round(numberValue(metadata?.deviceWidth))),
        height: Math.max(1, Math.round(numberValue(metadata?.deviceHeight))),
      });
    };
    // A stalled agent operation can detach the debugger under the stream, which ends the screencast
    // without a word. The stream then starts again on a new lease, so the view does not freeze.
    const running = yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        yield* Effect.gen({ self: this }, function* () {
          while (!stopRequested) {
            const detached = Deferred.makeUnsafe<void>();
            const onDetach = () => {
              Deferred.doneUnsafe(detached, Effect.void);
            };
            yield* this.#leaseEffect(
              (send) =>
                Effect.gen({ self: this }, function* () {
                  this.#contents.debugger.on("message", listener);
                  this.#contents.debugger.on("detach", onDetach);
                  yield* Effect.gen({ self: this }, function* () {
                    yield* send("Page.startScreencast", {
                      format: "jpeg",
                      quality: options.quality,
                      maxWidth: options.maxWidth,
                      maxHeight: options.maxHeight,
                      everyNthFrame: 1,
                    });
                    live = true;
                    started();
                    yield* Effect.raceFirst(Deferred.await(stopped), Deferred.await(detached));
                  }).pipe(
                    Effect.ensuring(
                      Effect.gen({ self: this }, function* () {
                        this.#contents.debugger.off("message", listener);
                        this.#contents.debugger.off("detach", onDetach);
                        if (stopRequested) yield* send("Page.stopScreencast").pipe(Effect.ignore);
                      }).pipe(Effect.orDie),
                    ),
                  );
                }),
              false,
            );
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              pacer.stop();
            }),
          ),
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (!live) Deferred.doneUnsafe(ready, Effect.fail(error));
            else if (!stopRequested) onEnded?.(error.cause);
          }),
        ),
      ),
      this.#scope,
      { startImmediately: true },
    );
    running.addObserver(() => {
      if (!live) Deferred.doneUnsafe(ready, Effect.fail(browserFailure(new Error("Browser tab was closed."))));
    });

    yield* Deferred.await(ready).pipe(
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          stop();
          yield* Fiber.interrupt(running);
        }),
      ),
    );
    return () =>
      Effect.gen(function* () {
        stop();
        yield* Fiber.await(running);
      });
  });

  readonly dispatchViewportInput = Effect.fn("BrowserCdp.dispatchViewportInput")(function* (
    this: BrowserCdpEngine,
    input: BrowserViewportInput,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect(
      (send) =>
        Effect.gen({ self: this }, function* () {
          // The page sees a paste event first, as with a real paste. The text never touches the
          // host's clipboard.
          if (input.type === "paste") {
            const contextId = yield* automationContextId(send);
            const result = yield* send("Runtime.evaluate", {
              expression: `(${PASTE_EVENT_SCRIPT})(${JSON.stringify(input.text)})`,
              contextId,
              returnByValue: true,
            });
            if (recordValue(result.result)?.value !== false) yield* send("Input.insertText", { text: input.text });
            return;
          }
          if (input.type === "key") {
            if (input.action === "char") {
              yield* send("Input.dispatchKeyEvent", { type: "char", modifiers: input.modifiers, text: input.text });
              return;
            }
            // A client sends a character event only for a printable key, so Enter's `\r` is added here.
            // A command modifier gets none, as in `dispatchShortcut`: `Ctrl+Enter` is not a line break.
            const { text, ...keyCodes } = namedKey(input.key);
            const character = input.action === "down" && (input.modifiers & ~SHIFT_MODIFIER) === 0 ? text : undefined;
            // A letter has no key code here, so Chromium finds no editing command for Ctrl+A. The
            // command is named instead, which also reads a Mac client's Cmd+A on a Linux host.
            const selectAll =
              input.action === "down" &&
              shortcutLetter(input.key, input.code) === "a" &&
              (input.modifiers & COMMAND_MODIFIERS) !== 0 &&
              (input.modifiers & ~COMMAND_MODIFIERS) === 0;
            yield* send("Input.dispatchKeyEvent", {
              type: input.action === "up" ? "keyUp" : character === undefined ? "rawKeyDown" : "keyDown",
              modifiers: input.modifiers,
              key: input.key,
              code: input.code,
              ...keyCodes,
              ...(character === undefined ? {} : { text: character, unmodifiedText: character }),
              ...(selectAll ? { commands: ["selectAll"] } : {}),
            });
            return;
          }
          if (input.action === "wheel") {
            yield* send("Input.dispatchMouseEvent", {
              type: "mouseWheel",
              x: input.x,
              y: input.y,
              deltaX: input.deltaX,
              deltaY: input.deltaY,
              modifiers: input.modifiers,
            });
            return;
          }
          yield* send("Input.dispatchMouseEvent", {
            type: input.action === "move" ? "mouseMoved" : input.action === "down" ? "mousePressed" : "mouseReleased",
            x: input.x,
            y: input.y,
            button: input.action === "move" ? "none" : input.button,
            buttons: input.action === "down" ? buttonMask(input.button) : 0,
            clickCount: input.action === "move" ? 0 : input.clickCount,
            modifiers: input.modifiers,
          });
        }),
      false,
    );
  });

  /**
   * The text a member's copy takes from the page, or null when it is longer than `max`. It goes back
   * to the member's own clipboard; the host's clipboard belongs to whoever sits at the host, and a
   * copy must neither read nor replace it.
   */
  readonly viewportSelectionText = Effect.fn("BrowserCdp.viewportSelectionText")(function* (
    this: BrowserCdpEngine,
    cut: boolean,
    max: number,
  ): Effect.fn.Return<string | null, BrowserOperationError> {
    return yield* this.#leaseEffect(
      (send) =>
        Effect.gen(function* () {
          const contextId = yield* automationContextId(send);
          const result = yield* send("Runtime.evaluate", {
            expression: `(${SELECTION_TEXT_SCRIPT})(${cut}, ${max})`,
            contextId,
            returnByValue: true,
          });
          // Null is a selection longer than `max`, which the page kept.
          const value = recordValue(result.result)?.value;
          return value === null ? null : stringValue(value);
        }),
      false,
    );
  });

  readonly navigate = Effect.fn("BrowserCdp.navigate")(function* (
    this: BrowserCdpEngine,
    url: string,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect(
      (send) =>
        Effect.gen({ self: this }, function* () {
          yield* send("Network.enable");
          yield* send("Network.setCacheDisabled", { cacheDisabled: true });
          yield* Effect.gen({ self: this }, function* () {
            const result = yield* send("Page.navigate", { url });
            const errorText = stringValue(result.errorText);
            if (errorText) return yield* browserFailure(new Error(`Navigation failed: ${errorText}`));
            yield* waitForLoading(this.#contents, WAIT_TIMEOUT_MS);
          }).pipe(
            Effect.ensuring(
              Effect.gen({ self: this }, function* () {
                yield* send("Network.setCacheDisabled", { cacheDisabled: false }).pipe(Effect.ignore);
                yield* send("Network.disable").pipe(Effect.ignore);
              }).pipe(Effect.orDie),
            ),
          );
        }),
      false,
    );
  });

  readonly destroy = Effect.fn("BrowserCdp.destroy")(function* (this: BrowserCdpEngine) {
    this.#disposed = true;
    yield* Scope.close(this.#scope, Exit.void);
    this.#retainDebugger = false;
    this.#detachOwnedDebugger();
    this.#targetSessions.clear();
    this.#targets.clear();
    this.#lastSnapshot = null;
    this.#highlightSessionId = undefined;
    this.#uploadDocumentIds.clear();
  });

  readonly waitFor = Effect.fn("BrowserCdp.waitFor")(function* (
    this: BrowserCdpEngine,
    condition: { target?: BrowserTarget; text?: string; url?: string; state?: string },
    timeoutMs = WAIT_TIMEOUT_MS,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const deadline = Date.now() + clamp(timeoutMs, 1, WAIT_TIMEOUT_MS);
        const matches = () =>
          Effect.gen({ self: this }, function* () {
            let matched = true;
            if (condition.url) matched &&= this.#contents.getURL().includes(condition.url);
            const text = condition.text;
            if (text) {
              matched &&= yield* pageContainsText(send, this.#snapshotTargets(), text, deadline);
            }
            const target = condition.target;
            if (target) {
              yield* Effect.gen({ self: this }, function* () {
                yield* this.#resolveTargetEffect(send, target, deadline, true);
              }).pipe(
                Effect.catch(() =>
                  Effect.sync(() => {
                    matched = false;
                  }),
                ),
              );
            }
            if (condition.state === "load") matched &&= !this.#contents.isLoading();
            if (condition.state === "domcontentloaded") {
              const contextId = yield* automationContextId(send);
              const result = yield* send("Runtime.evaluate", {
                expression: "document.readyState !== 'loading'",
                contextId,
                returnByValue: true,
              });
              matched &&= recordValue(result.result)?.value === true;
            }
            return matched;
          });
        while (true) {
          if (yield* matches()) {
            if (condition.state !== "dom-quiet") return;
            yield* waitForDomQuietAcrossTargets(send, this.#snapshotTargets(), deadline - Date.now()).pipe(
              Effect.catch((failure) =>
                browserSync(() => {
                  const error = failure.cause;
                  if (error instanceof Error && error.message === "DOM did not become quiet.") {
                    throw new Error("Browser wait condition timed out.");
                  }
                  throw error;
                }),
              ),
            );
            if (yield* matches()) return;
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) return yield* browserFailure(new Error("Browser wait condition timed out."));
          yield* waitForPageSignal(this.#contents, Math.min(remaining, 500));
        }
      }),
    );
  });

  readonly evaluate = Effect.fn("BrowserCdp.evaluate")(function* (
    this: BrowserCdpEngine,
    expression: string,
    awaitPromise = true,
    timeoutMs = ACTION_TIMEOUT_MS,
  ): Effect.fn.Return<BrowserJsonValue, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        yield* send("Runtime.enable");
        const result = yield* send("Runtime.evaluate", {
          expression,
          awaitPromise,
          returnByValue: true,
          userGesture: true,
          timeout: clamp(timeoutMs, 1, WAIT_TIMEOUT_MS),
          disableBreaks: true,
        });
        const exception = recordValue(result.exceptionDetails);
        if (exception)
          return yield* browserFailure(new Error(`Browser evaluation failed: ${exceptionDescription(exception)}`));
        const remoteObject = recordValue(result.result);
        if (!remoteObject || !("value" in remoteObject) || "unserializableValue" in remoteObject) {
          return yield* browserFailure(new Error("Browser evaluation result is not JSON-serializable."));
        }
        const value = remoteObject.value;
        let serialized: string | undefined;
        try {
          serialized = JSON.stringify(value);
        } catch {
          return yield* browserFailure(new Error("Browser evaluation result is not JSON-serializable."));
        }
        if (serialized === undefined)
          return yield* browserFailure(new Error("Browser evaluation result is not JSON-serializable."));
        const bytes = Buffer.byteLength(serialized, "utf8");
        if (bytes > MAX_RESULT_BYTES) {
          return yield* browserFailure(new Error(`Browser evaluation result exceeds 64 KB (${bytes} bytes).`));
        }
        // `serialized` is the value the caller receives, so parse that rather than asserting over
        // `value`: JSON.stringify already dropped anything a JSON value cannot hold.
        const jsonValue: BrowserJsonValue = yield* browserSync(() => JSON.parse(serialized));
        return jsonValue;
      }),
    );
  });

  readonly settle = Effect.fn("BrowserCdp.settle")(function* (
    this: BrowserCdpEngine,
    timeoutMs = ACTION_TIMEOUT_MS,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        if (this.#contents.isLoading()) yield* waitForLoading(this.#contents, timeoutMs);
        yield* waitForDomQuietAcrossTargets(send, this.#snapshotTargets(), Math.min(timeoutMs, 1_500)).pipe(
          Effect.catch((failure) =>
            browserSync(() => {
              const error = failure.cause;
              if (error instanceof Error && error.message === "DOM did not become quiet.") return;
              throw error;
            }),
          ),
        );
      }),
    );
  });

  readonly stopLoading = Effect.fn("BrowserCdp.stopLoading")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* stopLoadingAndWait(this.#contents);
  });

  readonly highlight = Effect.fn("BrowserCdp.highlight")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveElementEffect(send, target);
        yield* send("Overlay.enable", {}, resolved.sessionId);
        yield* send(
          "Overlay.highlightNode",
          {
            backendNodeId: resolved.backendNodeId,
            highlightConfig: {
              showInfo: false,
              contentColor: { r: 59, g: 130, b: 246, a: 0.12 },
              borderColor: { r: 59, g: 130, b: 246, a: 0.95 },
            },
          },
          resolved.sessionId,
        );
        this.#highlightSessionId = resolved.sessionId;
      }),
    );
  });

  readonly hideHighlight = Effect.fn("BrowserCdp.hideHighlight")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const sessionId = this.#highlightSessionId;
    this.#highlightSessionId = undefined;
    yield* this.#leaseEffect((send) => send("Overlay.hideHighlight", {}, sessionId).pipe(Effect.asVoid));
  });

  readonly #resolveElementEffect = Effect.fn("BrowserCdp.resolveElement")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    target: BrowserTarget,
    deadline?: number,
  ): Effect.fn.Return<{ backendNodeId: number; sessionId?: string }, BrowserOperationError> {
    const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
    if (!resolved.backendNodeId)
      return yield* browserFailure(new Error("This operation requires an element target, not coordinates."));
    return { backendNodeId: resolved.backendNodeId, sessionId: resolved.sessionId };
  });

  readonly #resolveTargetEffect = Effect.fn("BrowserCdp.resolveTarget")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    target: BrowserTarget,
    deadline?: number,
    allowNonActionableRole = false,
  ): Effect.fn.Return<{ backendNodeId?: number; sessionId?: string; x: number; y: number }, BrowserOperationError> {
    if (target.kind === "point") {
      const metrics = yield* send("Page.getLayoutMetrics");
      const viewport = recordValue(metrics.cssLayoutViewport);
      const width = numberValue(viewport?.clientWidth);
      const height = numberValue(viewport?.clientHeight);
      if (target.x < 0 || target.y < 0 || target.x >= width || target.y >= height) {
        return yield* browserFailure(new Error(`Point target is outside the current viewport (${width}x${height}).`));
      }
      return { x: target.x, y: target.y };
    }
    if (target.kind === "ref") {
      if (!this.#lastSnapshot || target.revision !== this.#lastSnapshot.revision) {
        return yield* browserFailure(new Error("Stale browser reference. Take a fresh snapshot before acting."));
      }
      const record = this.#targets.get(target.ref);
      if (!record)
        return yield* browserFailure(new Error("Element reference is no longer available. Take a fresh snapshot."));
      const sessionId = record.targetId ? this.#targetSessions.get(record.targetId)?.sessionId : undefined;
      if (deadline !== undefined) {
        yield* browserSync(() => assertBeforeDeadline(deadline));
        const current = yield* this.#targetFingerprint(send, record.backendNodeId, sessionId).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        yield* browserSync(() => assertBeforeDeadline(deadline));
        if (!current?.visible) return yield* browserFailure(new Error("Element reference is no longer visible."));
        if (
          current.role !== record.element.role ||
          current.name !== record.element.name ||
          current.tag !== record.element.tag ||
          current.visibleText !== record.visibleText
        ) {
          return yield* browserFailure(new Error("Stale browser reference. The target changed after the snapshot."));
        }
      }
      return {
        backendNodeId: record.backendNodeId,
        sessionId,
        x: 0,
        y: 0,
      };
    }
    if (target.kind === "css") {
      const matches: Array<{ objectId: string; sessionId?: string }> = [];
      let ambiguous = false;
      yield* Effect.gen({ self: this }, function* () {
        for (const capture of this.#snapshotTargets(Number.POSITIVE_INFINITY)) {
          const match = yield* cssObjectMatch(send, target.selector, capture.sessionId);
          ambiguous ||= match.ambiguous;
          if (match.objectId) matches.push({ objectId: match.objectId, sessionId: capture.sessionId });
        }
      }).pipe(
        Effect.catch((operationFailure) =>
          Effect.gen({ self: this }, function* () {
            const error = operationFailure.cause;
            yield* Effect.all(
              matches
                .map((match) =>
                  send("Runtime.releaseObject", { objectId: match.objectId }, match.sessionId).pipe(Effect.ignore),
                )
                .map((operation) => Effect.exit(operation)),
              { concurrency: "unbounded" },
            );
            return yield* browserFailure(error);
          }),
        ),
      );
      if (ambiguous || matches.length > 1) {
        yield* Effect.all(
          matches
            .map((match) =>
              send("Runtime.releaseObject", { objectId: match.objectId }, match.sessionId).pipe(Effect.ignore),
            )
            .map((operation) => Effect.exit(operation)),
          { concurrency: "unbounded" },
        );
        return yield* browserFailure(new Error(`CSS selector is ambiguous (at least 2 matches): ${target.selector}`));
      }
      const match = matches[0];
      if (!match) return yield* browserFailure(new Error(`No element matches CSS selector: ${target.selector}`));
      return yield* Effect.gen({ self: this }, function* () {
        const described = yield* send("DOM.describeNode", { objectId: match.objectId, depth: 0 }, match.sessionId);
        const describedNode = recordValue(described.node);
        const backendNodeId = numberValue(describedNode?.backendNodeId);
        if (!backendNodeId)
          return yield* browserFailure(new Error(`Unable to resolve CSS selector: ${target.selector}`));
        return {
          backendNodeId,
          sessionId: match.sessionId,
          x: 0,
          y: 0,
        };
      }).pipe(
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            yield* send("Runtime.releaseObject", { objectId: match.objectId }, match.sessionId).pipe(Effect.ignore);
          }).pipe(Effect.orDie),
        ),
      );
    }
    const navigationGeneration = this.#navigationGeneration;
    const candidates: SemanticMatch[] = [];
    const seen = new Set<string>();
    for (const capture of this.#snapshotTargets(Number.POSITIVE_INFINITY)) {
      for (const candidate of yield* semanticAxMatches(send, capture, target, allowNonActionableRole, deadline)) {
        const key = `${capture.targetId ?? "main"}:${candidate.backendNodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
        if (candidates.length >= 2) break;
      }
      if (candidates.length >= 2) break;
      if (target.kind === "text") {
        const objectIds = yield* visibleTextObjectMatches(send, capture, target, deadline);
        yield* Effect.gen({ self: this }, function* () {
          for (const objectId of objectIds) {
            const described = yield* send("DOM.describeNode", { objectId, depth: 0 }, capture.sessionId);
            const node = recordValue(described.node);
            const backendNodeId = numberValue(node?.backendNodeId);
            if (!backendNodeId) continue;
            const key = `${capture.targetId ?? "main"}:${backendNodeId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
              backendNodeId,
              sessionId: capture.sessionId,
              targetId: capture.targetId,
              role: fallbackRole(node ?? {}),
              name: target.text,
            });
            if (candidates.length >= 2) break;
          }
        }).pipe(
          Effect.ensuring(
            Effect.gen({ self: this }, function* () {
              yield* Effect.all(
                objectIds
                  .map((objectId) => send("Runtime.releaseObject", { objectId }, capture.sessionId).pipe(Effect.ignore))
                  .map((operation) => Effect.exit(operation)),
                { concurrency: "unbounded" },
              );
            }).pipe(Effect.orDie),
          ),
        );
      }
      if (candidates.length >= 2) break;
    }
    if (navigationGeneration !== this.#navigationGeneration) {
      return yield* browserFailure(
        new Error("Page navigated during semantic target collection. Take a fresh snapshot."),
      );
    }
    const [found] = candidates;
    if (!found) return yield* browserFailure(new Error(`No element matches ${describeBrowserTarget(target)}.`));
    if (candidates.length > 1) {
      const sample = candidates
        .slice(0, 5)
        .map(
          (candidate) =>
            `${candidate.targetId ?? "main"}:${candidate.backendNodeId} ${candidate.role} “${candidate.name.slice(0, 80)}”`,
        )
        .join("; ");
      return yield* browserFailure(new Error(`Target is ambiguous (at least 2 matches). Candidates: ${sample}`));
    }
    return {
      backendNodeId: found.backendNodeId,
      sessionId: found.sessionId,
      x: 0,
      y: 0,
    };
  });

  readonly #targetFingerprint = Effect.fn("BrowserCdp.targetFingerprint")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId?: string,
  ): Effect.fn.Return<
    { role: string; name: string; tag: string; visibleText: string; visible: boolean },
    BrowserOperationError
  > {
    const [description, partialAxTree, pageState] = yield* Effect.all(
      [
        send("DOM.describeNode", { backendNodeId, depth: 0 }, sessionId),
        send("Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false }, sessionId),
        this.#callOnNode(
          send,
          backendNodeId,
          String.raw`function() {
          if (this.nodeType !== 1 || !this.isConnected || this.getClientRects().length === 0) return null;
          let element = this;
          while (element) {
            if (element.hidden || element.inert || String(element.getAttribute('aria-hidden')).toLowerCase() === 'true') return null;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return null;
            const parent = element.parentElement;
            if (parent) element = parent;
            else {
              const root = element.getRootNode();
              element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
            }
          }
          return { visibleText: String(this.innerText ?? this.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
        }`,
          [],
          sessionId,
        ),
      ],
      { concurrency: "unbounded" },
    );
    const node = recordValue(description.node);
    const axNodes = Array.isArray(partialAxTree.nodes) ? partialAxTree.nodes.filter(isRecord) : [];
    const ax = axNodes.find((candidate) => numberValue(candidate.backendDOMNodeId) === backendNodeId) ?? axNodes[0];
    const state = recordValue(pageState);
    return {
      role: ax ? axValue(ax.role).toLowerCase() || fallbackRole(node ?? {}) : fallbackRole(node ?? {}),
      name: ax ? axValue(ax.name).slice(0, 500) : "",
      tag: (stringValue(node?.localName) || stringValue(node?.nodeName)).toLowerCase(),
      visibleText: stringValue(state?.visibleText),
      visible: state !== undefined,
    };
  });

  readonly #targetPointEffect = Effect.fn("BrowserCdp.targetPoint")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    target: BrowserTarget,
    hitTest: boolean,
    scrollIntoView = true,
    deadline?: number,
  ): Effect.fn.Return<{ x: number; y: number; sessionId?: string }, BrowserOperationError> {
    const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
    yield* browserSync(() => assertBeforeDeadline(deadline));
    if (!resolved.backendNodeId) return { x: resolved.x, y: resolved.y };
    return yield* this.#elementPointEffect(send, resolved.backendNodeId, hitTest, resolved.sessionId, scrollIntoView);
  });

  readonly #elementPointEffect = Effect.fn("BrowserCdp.elementPoint")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    hitTest: boolean,
    sessionId?: string,
    scrollIntoView = true,
  ): Effect.fn.Return<{ x: number; y: number; sessionId?: string }, BrowserOperationError> {
    if (scrollIntoView) yield* send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId);
    const box = yield* send("DOM.getBoxModel", { backendNodeId }, sessionId);
    const model = recordValue(box.model);
    const quad = Array.isArray(model?.content) ? model.content.filter(isFiniteNumber) : [];
    if (quad.length < 8) return yield* browserFailure(new Error("Element has no visible clickable bounds."));
    const metrics = yield* send("Page.getLayoutMetrics", {}, sessionId);
    const viewport = recordValue(metrics.cssLayoutViewport);
    const viewportWidth = numberValue(viewport?.clientWidth);
    const viewportHeight = numberValue(viewport?.clientHeight);
    const corners = quad.slice(0, 8);
    const xs = corners.filter((_, index) => index % 2 === 0);
    const ys = corners.filter((_, index) => index % 2 === 1);
    const left = Math.max(0, Math.min(...xs));
    const right = Math.min(viewportWidth - 1, Math.max(...xs));
    const top = Math.max(0, Math.min(...ys));
    const bottom = Math.min(viewportHeight - 1, Math.max(...ys));
    if (viewportWidth <= 0 || viewportHeight <= 0 || right < left || bottom < top) {
      return yield* browserFailure(new Error("Element has no visible clickable bounds."));
    }
    const insetX = Math.min(4, Math.max(0, (right - left) / 4));
    const insetY = Math.min(4, Math.max(0, (bottom - top) / 4));
    const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
    if (!hitTest) return { ...center, sessionId };
    const points = uniquePoints([
      center,
      { x: left + insetX, y: top + insetY },
      { x: right - insetX, y: top + insetY },
      { x: left + insetX, y: bottom - insetY },
      { x: right - insetX, y: bottom - insetY },
    ]);
    let blockerId = 0;
    for (const point of points) {
      const hit = yield* send(
        "DOM.getNodeForLocation",
        { x: Math.round(point.x), y: Math.round(point.y), includeUserAgentShadowDOM: true },
        sessionId,
      );
      const hitId = numberValue(hit.backendNodeId);
      if (hitId && (yield* isNodeOrDescendant(send, hitId, backendNodeId, sessionId))) {
        return { ...point, sessionId };
      }
      blockerId ||= hitId;
    }
    if (!blockerId) return yield* browserFailure(new Error("Element has no visible clickable point."));
    const blocker = yield* send("DOM.describeNode", { backendNodeId: blockerId, depth: 0 }, sessionId);
    const node = recordValue(blocker.node);
    const name = stringValue(node?.nodeName).toLowerCase() || "element";
    return yield* browserFailure(
      new Error(
        `Target is covered by ${name} (backendNodeId ${blockerId}). Dismiss the covering layer or choose a visible point.`,
      ),
    );
  });

  readonly #callOnNode = Effect.fn("BrowserCdp.callOnNode")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    declaration: string,
    args: unknown[],
    sessionId?: string,
  ): Effect.fn.Return<unknown, BrowserOperationError> {
    const executionContextId = yield* automationContextId(send, sessionId);
    const resolved = yield* send("DOM.resolveNode", { backendNodeId, executionContextId }, sessionId);
    const objectId = stringValue(recordValue(resolved.object)?.objectId);
    if (!objectId) return yield* browserFailure(new Error("Element is no longer attached to the document."));
    return yield* Effect.gen({ self: this }, function* () {
      const result = yield* send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: declaration,
          arguments: args.map((value) => ({ value })),
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        sessionId,
      );
      const exception = recordValue(result.exceptionDetails);
      if (exception) return yield* browserFailure(new Error(exceptionDescription(exception)));
      return recordValue(result.result)?.value;
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* send("Runtime.releaseObject", { objectId }, sessionId).pipe(Effect.ignore);
        }).pipe(Effect.orDie),
      ),
    );
  });

  readonly #optionBackendNodeIdEffect = Effect.fn("BrowserCdp.optionBackendNodeId")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    selectBackendNodeId: number,
    optionIndex: number,
    sessionId?: string,
  ): Effect.fn.Return<number, BrowserOperationError> {
    const executionContextId = yield* automationContextId(send, sessionId);
    const select = yield* send(
      "DOM.resolveNode",
      { backendNodeId: selectBackendNodeId, executionContextId },
      sessionId,
    );
    const selectObjectId = stringValue(recordValue(select.object)?.objectId);
    if (!selectObjectId)
      return yield* browserFailure(new Error("Select element is no longer attached to the document."));
    let optionObjectId = "";
    return yield* Effect.gen({ self: this }, function* () {
      const option = yield* send(
        "Runtime.callFunctionOn",
        {
          objectId: selectObjectId,
          functionDeclaration: "function(index) { return this.options[index]; }",
          arguments: [{ value: optionIndex }],
          returnByValue: false,
        },
        sessionId,
      );
      optionObjectId = stringValue(recordValue(option.result)?.objectId);
      if (!optionObjectId) return yield* browserFailure(new Error("Requested select option is no longer available."));
      const described = yield* send("DOM.describeNode", { objectId: optionObjectId, depth: 0 }, sessionId);
      const backendNodeId = numberValue(recordValue(described.node)?.backendNodeId);
      if (!backendNodeId)
        return yield* browserFailure(new Error("Requested select option is no longer attached to the document."));
      return backendNodeId;
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* Effect.all(
            [
              optionObjectId ? send("Runtime.releaseObject", { objectId: optionObjectId }, sessionId) : Effect.void,
              send("Runtime.releaseObject", { objectId: selectObjectId }, sessionId),
            ].map((operation) => Effect.exit(operation)),
            { concurrency: "unbounded" },
          );
        }).pipe(Effect.orDie),
      ),
    );
  });

  #snapshotTargets(limit = MAX_SNAPSHOT_FRAMES): SnapshotTarget[] {
    return [
      {},
      ...[...this.#targetSessions.entries()]
        .slice(0, Math.max(0, limit - 1))
        .map(([targetId, target]) => ({ ...target, targetId })),
    ];
  }

  readonly #leaseEffect = Effect.fn("BrowserCdp.lease")(function* <T>(
    this: BrowserCdpEngine,
    operation: (send: SendCommand) => Effect.Effect<T, BrowserOperationError>,
    attachFrames = true,
  ): Effect.fn.Return<T, BrowserOperationError> {
    if (this.#disposed || this.#closing || this.#contents.isDestroyed())
      return yield* browserFailure(new Error("Browser tab was closed."));
    if (!this.#contents.debugger.isAttached()) {
      yield* browserSync(() => this.#contents.debugger.attach("1.3"));
      this.#ownsDebugger = true;
    }
    this.#activeLeases += 1;
    const send: SendCommand = (method, params = {}, sessionId) =>
      Effect.gen({ self: this }, function* () {
        const result = yield* browserCall(() => this.#contents.debugger.sendCommand(method, params, sessionId));
        if (!isDynamicRecord(result))
          return yield* browserFailure(new Error(`CDP ${method} returned an invalid result.`));
        return result;
      });
    return yield* Effect.gen({ self: this }, function* () {
      yield* send("Emulation.setFocusEmulationEnabled", { enabled: true });
      if (attachFrames) {
        yield* send("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }],
        }).pipe(Effect.ignore);
      }
      if (this.#environment) yield* this.#applyEnvironmentEffect(send, this.#environment);
      return yield* operation(send);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#activeLeases -= 1;
          if (this.#activeLeases === 0 && !this.#retainDebugger) this.#detachOwnedDebugger();
        }),
      ),
    );
  });

  #detachOwnedDebugger(): void {
    if (!this.#ownsDebugger) return;
    this.#ownsDebugger = false;
    this.#clearDebuggerSessions();
    if (this.#closing || this.#contents.isDestroyed() || !this.#contents.debugger.isAttached()) return;
    this.#contents.debugger.detach();
  }

  #clearDebuggerSessions(): void {
    this.#targetSessions.clear();
    this.#highlightSessionId = undefined;
  }

  readonly #applyEnvironmentEffect = Effect.fn("BrowserCdp.applyEnvironment")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    environment: BrowserEnvironment,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (environment.viewport.mode === "fill") {
      yield* send("Emulation.clearDeviceMetricsOverride");
    } else {
      yield* send("Emulation.setDeviceMetricsOverride", {
        width: environment.viewport.width,
        height: environment.viewport.height,
        deviceScaleFactor: environment.viewport.deviceScaleFactor,
        // Viewport presets deliberately do not alter browser identity or mobile page semantics.
        mobile: false,
        screenWidth: environment.viewport.width,
        screenHeight: environment.viewport.height,
      });
    }
    const features: Array<{ name: string; value: string }> = [];
    if (environment.colorScheme !== "system") {
      features.push({ name: "prefers-color-scheme", value: environment.colorScheme });
    }
    if (environment.reducedMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
    yield* send("Emulation.setEmulatedMedia", { features });
  });

  readonly #clearEnvironmentEffect = Effect.fn("BrowserCdp.clearEnvironment")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* send("Emulation.clearDeviceMetricsOverride");
    yield* send("Emulation.setEmulatedMedia", { features: [] });
  });
}

function assertTypingProgressBeforeDeadline(deadline: number | undefined, sent: number, total: number): void {
  if (deadline === undefined || Date.now() < deadline) return;
  throw new Error(
    `Browser typing timed out after ${sent} of ${total} characters reached the page. The page kept them. Read the page before sending the rest, or the repeated part is entered twice.`,
  );
}

function readViewport(metrics: CdpResult, environment: BrowserEnvironment): BrowserEnvironment["viewport"] {
  const viewport = recordValue(metrics.cssLayoutViewport);
  return {
    ...environment.viewport,
    width: Math.round(numberValue(viewport?.clientWidth) || environment.viewport.width),
    height: Math.round(numberValue(viewport?.clientHeight) || environment.viewport.height),
  };
}

function uniquePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const isNodeOrDescendant = Effect.fn("Browser.isNodeOrDescendant")(function* (
  send: SendCommand,
  candidate: number,
  target: number,
  sessionId?: string,
) {
  if (candidate === target) return true;
  const executionContextId = yield* automationContextId(send, sessionId);
  const objectIds: string[] = [];
  return yield* Effect.gen(function* () {
    // describeNode does not reliably include parentId. Resolve both nodes in
    // our isolated world so a button's own child is not treated as an overlay.
    for (const backendNodeId of [target, candidate]) {
      const resolved = yield* send("DOM.resolveNode", { backendNodeId, executionContextId }, sessionId);
      const objectId = stringValue(recordValue(resolved.object)?.objectId);
      if (!objectId) return false;
      objectIds.push(objectId);
    }
    const result = yield* send(
      "Runtime.callFunctionOn",
      {
        objectId: objectIds[0],
        functionDeclaration: `function(candidate) {
          for (let node = candidate; node; node = node.parentNode || node.host) {
            if (node === this) return true;
          }
          return false;
        }`,
        arguments: [{ objectId: objectIds[1] }],
        returnByValue: true,
      },
      sessionId,
    );
    return recordValue(result.result)?.value === true;
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.all(
          objectIds.map((objectId) => send("Runtime.releaseObject", { objectId }, sessionId).pipe(Effect.ignore)),
          { concurrency: "unbounded" },
        );
      }).pipe(Effect.orDie),
    ),
  );
});

const waitForDomQuietAcrossTargets = Effect.fn("Browser.waitForDomQuietAcrossTargets")(function* (
  send: SendCommand,
  captures: SnapshotTarget[],
  timeoutMs: number,
) {
  if (timeoutMs <= 0) return yield* browserFailure(new Error("DOM did not become quiet."));
  const deadlineMs = Math.max(1, Math.floor(timeoutMs));
  const results = yield* Effect.all(
    captures.map((capture) =>
      Effect.gen(function* () {
        const contextId = yield* automationContextId(send, capture.sessionId);
        return yield* send(
          "Runtime.evaluate",
          {
            expression: `new Promise(resolve => {
      let quietTimer;
      let deadlineTimer;
      let completed = false;
      const observers = [];
      const observedRoots = new Set();
      const done = value => {
        if (completed) return;
        completed = true;
        clearTimeout(quietTimer);
        clearTimeout(deadlineTimer);
        for (const observer of observers) observer.disconnect();
        resolve(value);
      };
      const changed = () => {
        discoverRoots();
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => done(true), ${DOM_QUIET_MS});
      };
      const discoverRoots = () => {
        const pending = [document];
        let discovered = false;
        let scanned = 0;
        while (pending.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES}) {
          const root = pending.shift();
          if (!root) continue;
          if (!observedRoots.has(root)) {
            const observer = new MutationObserver(changed);
            observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
            observedRoots.add(root);
            observers.push(observer);
            discovered = true;
          }
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          let node;
          while ((node = walker.nextNode()) && scanned < ${MAX_SNAPSHOT_SCANNED_NODES}) {
            scanned++;
            if (node.shadowRoot) pending.push(node.shadowRoot);
            if (node.localName === 'iframe' || node.localName === 'frame') {
              try { if (node.contentDocument) pending.push(node.contentDocument); } catch {}
            }
          }
        }
        if (discovered) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => done(true), ${DOM_QUIET_MS});
        }
      };
      discoverRoots();
      deadlineTimer = setTimeout(() => done(false), ${deadlineMs});
    })`,
            contextId,
            awaitPromise: true,
            returnByValue: true,
          },
          capture.sessionId,
        );
      }),
    ),
    { concurrency: "unbounded" },
  );
  if (results.some((result) => recordValue(result.result)?.value !== true)) {
    return yield* browserFailure(new Error("DOM did not become quiet."));
  }
});

/** Runs in the automation world. Returns true when the document shows the value anywhere a snapshot reads. */
const SECRET_SCAN_FUNCTION = `function(secret) {
  const found = (value) => typeof value === 'string' && value.includes(secret);
  if (found(document.title) || found(location.href)) return true;
  const walk = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (found(node.data)) return true;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if ('value' in node && found(String(node.value))) return true;
      for (const attribute of node.attributes) if (found(attribute.value)) return true;
      if (node.shadowRoot && walk(node.shadowRoot)) return true;
    }
    return false;
  };
  return walk(document);
}`;

function documentIdFunctionDeclaration(): string {
  return `function() {
    const documentNode = this.nodeType === Node.DOCUMENT_NODE ? this : this.ownerDocument;
    if (!documentNode) return null;
    const key = ${JSON.stringify(DOCUMENT_ID_PROPERTY)};
    if (typeof documentNode[key] !== 'string') {
      const values = crypto.getRandomValues(new Uint32Array(4));
      const value = Array.from(values, number => number.toString(16).padStart(8, '0')).join('');
      Object.defineProperty(documentNode, key, { value });
    }
    return documentNode[key];
  }`;
}

function documentIdsExpression(documentIds: string[]): string {
  return `(() => {
    const key = ${JSON.stringify(DOCUMENT_ID_PROPERTY)};
    const wanted = new Set(${JSON.stringify(documentIds)});
    const pending = [document];
    const seen = new Set();
    const ids = [];
    let scanned = 0;
    // The same walk target discovery uses, because it has to reach the same documents: an upload can
    // be assigned to an input in an iframe nested inside a shadow root, and \`querySelectorAll\` stops
    // at the shadow boundary. A document this misses looks closed to the caller, which frees the
    // staged files the still-open input is holding.
    while (pending.length && scanned < ${MAX_SNAPSHOT_SCANNED_NODES} && wanted.size > 0) {
      const root = pending.shift();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      const documentNode = root.nodeType === Node.DOCUMENT_NODE ? root : root.ownerDocument;
      if (documentNode && typeof documentNode[key] === 'string' && wanted.has(documentNode[key])) {
        ids.push(documentNode[key]);
        wanted.delete(documentNode[key]);
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode()) && scanned < ${MAX_SNAPSHOT_SCANNED_NODES}) {
        scanned++;
        if (node.shadowRoot) pending.push(node.shadowRoot);
        if (node.localName === 'iframe' || node.localName === 'frame') {
          try { if (node.contentDocument) pending.push(node.contentDocument); } catch {}
        }
      }
    }
    // Completeness is what the caller needs and cannot infer: an id absent from a truncated scan was
    // never looked for, while an id absent from an exhaustive one is genuinely gone.
    return { ids, complete: wanted.size === 0 || scanned < ${MAX_SNAPSHOT_SCANNED_NODES} };
  })()`;
}
const waitForPageSignal = Effect.fn("Browser.waitForPageSignal")((contents: WebContents, timeoutMs: number) =>
  Effect.callback<void>((resume) => {
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
      contents.off("did-stop-loading", signal);
      contents.off("did-navigate-in-page", signal);
    };
    const signal = () => {
      cleanup();
      resume(Effect.void);
    };
    timer = setTimeout(signal, timeoutMs);
    contents.once("did-stop-loading", signal);
    contents.once("did-navigate-in-page", signal);
    return Effect.sync(cleanup);
  }),
);
