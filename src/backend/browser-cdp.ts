import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type {
  BrowserActionHistoryEntry,
  BrowserDiagnosticEntry,
  BrowserEnvironment,
  BrowserFocus,
  BrowserJsonValue,
  BrowserLocation,
  BrowserSnapshot,
  BrowserTarget,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { BROWSER_VIEW_MAX_CLIPBOARD_TEXT } from "@openbot/contracts/team-protocol/browser-view-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Option, Scope } from "effect";
import type { NativeImage, WebContents } from "electron";
import {
  BROWSER_CARD_FIELDS,
  type BrowserCardField,
  type BrowserCardFieldDescription,
  type BrowserCardFillResult,
  type BrowserCardTargets,
  CARD_FIELD_CHECK_FUNCTION,
  CARD_FIELD_DESCRIPTION_FUNCTION,
  CARD_FIELD_FINGERPRINT_FUNCTION,
  CARD_FIELD_SELECT_FUNCTION,
  CARD_SELECT_OPTION_FUNCTION,
  cardFieldAccepts,
  cardFieldText,
  LOADED_FROM_NETWORK,
  parseCardFieldDescription,
} from "./browser-card-fill";
import {
  buttonMask,
  dispatchMouseClick,
  dispatchPointerMove,
  dispatchShortcut,
  dispatchText,
  dispatchTextKey,
  modifierMask,
  namedKey,
  type PointerPoint,
  printableKeyCode,
  SHIFT_MODIFIER,
} from "./browser-cdp-input";
import {
  boundSerializedSnapshot,
  CardValueScrub,
  collectBoundedSnapshot,
  collectFocus,
  controlIdentity,
  cssObjectMatch,
  describeTargetCandidates,
  fallbackRole,
  MAX_SNAPSHOT_SCANNED_NODES,
  MAX_TARGET_CANDIDATES,
  pageContainsText,
  type SemanticMatch,
  type SnapshotTarget,
  semanticAxMatches,
  type TargetCandidateText,
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
  frameAutomationContextId,
  frameIds,
  isFiniteNumber,
  isRecord,
  isSessionGone,
  numberValue,
  recordValue,
  type SendCommand,
  skipGoneFrame,
  stringValue,
} from "./browser-cdp-values";
import { type DetectedChallenge, detectChallenge } from "./browser-challenge";
import {
  type BrowserOperationError,
  browserCall,
  browserFailure,
  browserSync,
  secureInputFailure,
} from "./browser-effects";
import {
  type BrowserFillFieldsProgress,
  type BrowserPreparedField,
  FILL_FIELD_STATE_FUNCTION,
  fillFieldsFailure,
  fillPreparedFields,
} from "./browser-fill-fields";
import { describeBrowserTarget, stopLoadingAndWait, waitForLoading } from "./browser-navigation";
import { guardedPress } from "./browser-press-guard";
import { createFramePacer } from "./browser-screencast-pacing";
import { probeSettle, SETTLE_BUSY_WAIT_MS, SETTLE_RESERVE_MS, waitForSettle } from "./browser-settle";
import { CLICK_READ_TIMEOUT_MS, readClickTarget } from "./browser-user-click";
import { BROWSER_VALUE_TOO_LARGE } from "./model-text-limit";
import type { VaultCardSecret } from "./vault-items";

export const SNAPSHOT_NAVIGATED_MESSAGE = "Page navigated during the browser snapshot. Take a fresh snapshot.";

const ACTION_TIMEOUT_MS = 10_000;
const WAIT_TIMEOUT_MS = 30_000;
const BROWSER_LOCATION_DEFAULT_ACCURACY = 50;
const PAGE_ANSWER_WAIT_MS = 2_000;
const PAGE_ANSWER_RETRY_MS = 100;
const MAX_RESULT_BYTES = 64 * 1024;
const DOCUMENT_ID_PROPERTY = "__openbot_browser_document_id__";
const MAX_SNAPSHOT_FRAMES = 12;
const DOM_QUIET_MS = 250;
const CHOOSER_WAIT_MS = 5_000;
const DROP_FRAME_WAIT_MS = 1_500;
const DROP_FRAME_SCRIPT = "new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))";
const NEW_PAGE_MS = 1_500;
const NEW_PAGE_FRAME_SCRIPT = `performance.now() - (performance.getEntriesByType("navigation")[0]?.responseStart ?? 0) < ${NEW_PAGE_MS} && ${DROP_FRAME_SCRIPT}`;

const waitForFrame = Effect.fn("Browser.waitForFrame")(function* (
  send: SendCommand,
  sessionId: string | undefined,
  deadline: number | undefined,
  expression = DROP_FRAME_SCRIPT,
) {
  const frameWaitMs =
    deadline === undefined
      ? DROP_FRAME_WAIT_MS
      : Math.min(DROP_FRAME_WAIT_MS, deadline - Date.now() - SETTLE_RESERVE_MS);
  if (frameWaitMs <= 0) return;
  yield* Effect.gen(function* () {
    const contextId = yield* automationContextId(send, sessionId);
    yield* send("Runtime.evaluate", { expression, contextId, awaitPromise: true }, sessionId);
  }).pipe(Effect.timeoutOrElse({ duration: frameWaitMs, orElse: () => Effect.void }), Effect.ignore);
});

type ActionDispatch = () => void;

export interface SnapshotReadResult {
  snapshot: BrowserSnapshot;
  recommendImage: boolean;
  imageReason: string;
  challenge: DetectedChallenge | null;
}

export interface BrowserPageStatus {
  title: string;
  url: string;
  loading: boolean;
  focus: BrowserFocus | null;
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
  deadline: number;
}

export interface BrowserScreencastOptions {
  quality: number;
  maxWidth: number;
  maxHeight: number;
  viewport?: { width: number; height: number };
  onPageCopy?: (text: string) => void;
  watchDialogs?: boolean;
}

export interface BrowserScreencastFrame {
  sequence: number;
  width: number;
  height: number;
  image: Uint8Array;
}

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
  | { type: "paste"; text: string }
  | { type: "cut"; text: string };

const FOCUSED_SELECTION = `
  let doc = document;
  let active = doc.activeElement;
  for (;;) {
    if (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    else if (active?.tagName === "IFRAME" && active.contentDocument?.activeElement) {
      doc = active.contentDocument;
      active = doc.activeElement;
    } else break;
  }
  const isField = active?.tagName === "TEXTAREA" || active?.tagName === "INPUT";
  const selected = () => {
    if (active?.tagName === "INPUT" && active.type === "password") return "";
    if (isField) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      return typeof start === "number" && typeof end === "number" ? active.value.slice(start, end) : "";
    }
    const root = active?.getRootNode() ?? doc;
    const selection = typeof root.getSelection === "function" ? root.getSelection() : doc.getSelection();
    return selection?.toString() ?? "";
  };`;

const FOCUSED_FRAME_SCRIPT = `(() => {${FOCUSED_SELECTION}
  return active?.tagName === "IFRAME" || active?.tagName === "FRAME" ? active : null;
})()`;

const MAX_FOCUSED_FRAME_DEPTH = 8;
const CLICK_PRESS_ATTEMPTS = 3;

const COUNT_TYPED_KEYS = `
  globalThis.openbotTypedKeys?.view.removeEventListener('keydown', globalThis.openbotTypedKeys.listener, true);
  const typedKeys = {
    view: this.ownerDocument.defaultView, count: 0, text: 'value' in this ? String(this.value) : this.textContent,
    listener: () => { typedKeys.count += 1; },
  };
  typedKeys.view.addEventListener('keydown', typedKeys.listener, true);
  globalThis.openbotTypedKeys = typedKeys;`;
const TYPED_KEY_ARRIVED_FUNCTION = `function(expected) {
  const typedKeys = globalThis.openbotTypedKeys;
  if (!typedKeys) return true;
  typedKeys.view.removeEventListener('keydown', typedKeys.listener, true);
  globalThis.openbotTypedKeys = undefined;
  const text = 'value' in this ? String(this.value) : this.textContent;
  return typedKeys.count >= expected || text !== typedKeys.text;
}`;
const SAVE_TYPED_TEXT_FUNCTION = `function() {
  if (globalThis.openbotTypedKeys) globalThis.openbotTypedKeys.text = 'value' in this ? String(this.value) : this.textContent;
}`;
const PASTE_APPLY_WAIT_MS = 1000;
const PASTE_HANDLER_WAIT_MS = 50;
const PASTE_TEXT_FUNCTION = `function(text) {
  if ('value' in this || !this.isContentEditable) return false;
  let host = this;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  const root = host.getRootNode();
  const selection = () => typeof root.getSelection === 'function' ? root.getSelection() : host.ownerDocument.getSelection();
  const state = () => JSON.stringify([host.textContent, selection()?.toString() ?? '']);
  const before = state();
  const focused = root.activeElement;
  const range = selection()?.rangeCount ? selection().getRangeAt(0).cloneRange() : null;
  const notTaken = () => {
    if (host.contains(root.activeElement) && host.contains(selection()?.anchorNode ?? null)) return false;
    focused?.focus({ preventScroll: true });
    if (range) { selection()?.removeAllRanges(); selection()?.addRange(range); }
    return false;
  };
  let elsewhere = false;
  const taken = (records) => {
    elsewhere ||= records.some((record) => !host.contains(record.target) && [...record.addedNodes].some((node) => node.nodeType === 1));
    return elsewhere || state() !== before;
  };
  let finish = () => {};
  const observer = new MutationObserver((records) => { if (taken(records)) finish(); });
  observer.observe(host, { childList: true, subtree: true, characterData: true });
  const form = host.closest('form');
  if (form) observer.observe(form, { childList: true, subtree: true });
  const data = new DataTransfer();
  data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
  const stopped = !this.dispatchEvent(event);
  if (!stopped) {
    observer.disconnect();
    return new Promise((resolve) => setTimeout(() => resolve(notTaken()), ${PASTE_HANDLER_WAIT_MS}));
  }
  if (taken(observer.takeRecords())) { observer.disconnect(); return true; }
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(), ${PASTE_APPLY_WAIT_MS});
    finish = () => { observer.disconnect(); clearTimeout(timer); resolve(taken(observer.takeRecords()) || notTaken()); };
  });
}`;

const HOLDS_FOCUS_FUNCTION = `function() {
  if (!this.isConnected) return false;
  for (let node = this;;) {
    const root = node.getRootNode();
    if (root.activeElement !== node) return false;
    if (root.nodeType === Node.DOCUMENT_NODE) return true;
    node = root.host;
  }
}`;

const SELECTION_TEXT_SCRIPT = `(max) => {${FOCUSED_SELECTION}
  const text = selected();
  return text.length > max ? null : text;
}`;

const CUT_SCRIPT = `(expected) => {${FOCUSED_SELECTION}
  const editable = isField ? !active.readOnly && !active.disabled : active?.isContentEditable === true;
  if (!editable || selected() !== expected) return false;
  return doc.execCommand("delete");
}`;

const PASTE_EVENT_SCRIPT = `(text) => {${FOCUSED_SELECTION}
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true });
  return (active ?? doc.body).dispatchEvent(event);
}`;

const PAGE_COPY_RETRY_MS = 500;
const PAGE_COPY_SCRIPT = `(() => {
  const key = Symbol.for("openbot.pageCopy");
  let state = globalThis[key];
  if (!state) {
    state = { waits: [] };
    Object.defineProperty(globalThis, key, { value: state });
    const active = () => navigator.userActivation?.isActive === true;
    const report = (text) => {
      if (typeof text !== "string" || text.length === 0 || text.length > ${BROWSER_VIEW_MAX_CLIPBOARD_TEXT}) return;
      const waits = state.waits;
      state.waits = [];
      for (const wake of waits) wake(text);
    };
    const proto = globalThis.Clipboard?.prototype;
    const writeText = proto?.writeText;
    if (writeText) proto.writeText = { writeText(text) { if (active()) report(String(text)); return writeText.apply(this, arguments); } }.writeText;
    const write = proto?.write;
    if (write) proto.write = { write(items) {
      if (active()) Promise.resolve().then(async () => {
        for (const item of items) if (item.types.includes("text/plain")) return report(await (await item.getType("text/plain")).text());
      }).catch(() => {});
      return write.apply(this, arguments);
    } }.write;
    addEventListener("copy", (event) => {
      if (!event.isTrusted || !active()) return;
      const selection = String(getSelection() ?? "");
      const data = event.clipboardData;
      let set = null;
      if (data) {
        const setData = data.setData;
        data.setData = function (type, value) {
          const kind = String(type).toLowerCase();
          if (kind === "text" || kind === "text/plain") set = String(value);
          return setData.apply(this, arguments);
        };
      }
      setTimeout(() => report(event.defaultPrevented ? set : selection));
    }, true);
  }
  return new Promise((resolve) => { state.waits.push(resolve); });
})()`;

function pageCopies(send: SendCommand, onPageCopy: (text: string) => void): Effect.Effect<never> {
  return Effect.forever(
    send("Runtime.evaluate", { expression: PAGE_COPY_SCRIPT, awaitPromise: true, returnByValue: true }).pipe(
      Effect.flatMap((answer) => {
        const text = answer.exceptionDetails === undefined ? recordValue(answer.result)?.value : undefined;
        if (!isString(text)) return Effect.sleep(PAGE_COPY_RETRY_MS);
        return Effect.sync(() => onPageCopy(text));
      }),
      Effect.catch(() => Effect.sleep(PAGE_COPY_RETRY_MS)),
    ),
  );
}

function shortcutLetter(key: string, code: string): string {
  if (/^[a-z]$/iu.test(key)) return key.toLowerCase();
  return /^Key[A-Z]$/u.test(code) ? code.slice(3).toLowerCase() : "";
}

const COMMAND_MODIFIERS = 2 | 4;

type BrowserDialogType = "alert" | "confirm";

export interface BrowserDialog {
  id: string;
  type: BrowserDialogType;
  message: string;
  agent: boolean;
}

export interface BrowserDialogOwner {
  threadId: string;
  turnId: string;
}

interface DialogWatch {
  owner: BrowserDialogOwner;
  opened: Deferred.Deferred<BrowserDialog>;
}

const DIALOG_MESSAGE_LIMIT = 2_000;
const PERSON_ACTIVATION_MS = 5_000;
const CANCEL_DIALOGS_EVENT = "-cancel-dialogs";
const RUN_DIALOG_EVENT = "-run-dialog";
const DIALOG_CLOSED_ERROR = "This dialog is closed. A person answered it, or the page closed it. Read the tab again.";
const DIALOG_FOR_PERSON_ERROR = "Only a person can answer this dialog in the tab. Ask the user to answer it.";

export class BrowserCdpEngine {
  readonly #contents: WebContents;
  #viewButton: "left" | "middle" | "right" | null = null;
  #pointer: { point: PointerPoint; sessionId: string | undefined } | null = null;
  #viewPress: PointerPoint | null = null;
  #targets = new Map<string, TargetRecord>();
  #lastSnapshot: BrowserSnapshot | null = null;
  #environment: BrowserEnvironment | null = null;
  #location: BrowserLocation | null = null;
  #locationApplied = false;
  readonly #viewViewports: Array<{ width: number; height: number }> = [];
  #navigationGeneration = 0;
  #documentGeneration = 0;
  #settleTimedOutDocument = -1;
  #emptyWaitedDocument = -1;
  readonly #cardScrub: CardValueScrub;

  readonly prepareSecret = Effect.fn("BrowserCdp.prepareSecret")(function* (
    this: BrowserCdpEngine,
    targets: BrowserTarget[],
    submission: "on_input" | "enter" | "click",
    submitTarget: BrowserTarget | undefined,
    singlePassword: boolean,
  ): Effect.fn.Return<
    {
      enter: (
        values: readonly string[],
        vault: boolean,
        onSubmitSent: () => void,
      ) => Effect.Effect<void, BrowserOperationError>;
      clear: (secrets: readonly string[]) => Effect.Effect<boolean, BrowserOperationError>;
      hide: (secret: string, shown: boolean) => void;
      kinds: Array<{ password: boolean; oneTimeCode: boolean }>;
      hiddenPasswordFill: boolean;
      servedByWorker: boolean;
      origin: string;
    },
    BrowserOperationError
  > {
    const generation = this.#documentGeneration;
    const fingerprintFields = `[this.localName, this.type, this.id, this.name, this.getAttribute('autocomplete'), this.getAttribute('aria-label'), this.form?.action, this.form?.method, [...(this.form?.elements ?? [])].some((element) => element.hasAttribute('formmethod') && element.getAttribute('formmethod').trim().toLowerCase() !== 'post')]`;
    const fingerprint = `function() { return JSON.stringify(${fingerprintFields}); }`;
    const nodes = yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const labels = [
          ...targets.map((_, index) => (targets.length === 1 ? "The field target" : `Field target ${index + 1}`)),
          ...(submitTarget ? ["submitTarget"] : []),
        ];
        const nodes = [];
        for (const [index, target] of [...targets, ...(submitTarget ? [submitTarget] : [])].entries())
          nodes.push(
            yield* this.#resolveElementEffect(send, target, Date.now() + 10_000).pipe(
              Effect.mapError((error) =>
                browserFailure(
                  new Error(
                    `${labels[index]}: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
                  ),
                ),
              ),
            ),
          );
        const located: Array<{ backendNodeId: number; sessionId: string | undefined; contextId: number }> = [];
        let fieldOrigin = "";
        for (const [index, node] of nodes.entries()) {
          const input = index < targets.length;
          const contextId = yield* this.#nodeFrameContextId(send, node.backendNodeId, node.sessionId).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );
          const valid =
            contextId === undefined
              ? false
              : yield* this.#callOnNode(
                  send,
                  node.backendNodeId,
                  `function(input) { return this.isConnected && this.ownerDocument === document && (location.protocol === 'https:' || location.protocol === 'http:') && (!input || (this.localName === 'input' && !this.disabled && !this.readOnly && ['password','text','tel','number'].includes(this.type))) ? location.origin : false; }`,
                  [input],
                  node.sessionId,
                  contextId,
                );
          if (contextId === undefined || !isString(valid))
            return yield* browserFailure(
              new Error(
                input
                  ? `${labels[index]} is not an enabled, editable password, text, tel, or number input of this page. Target the input itself, not its label or container.`
                  : `${labels[index]} is not on this page. Take a fresh snapshot and target the page's submit button.`,
              ),
            );
          const first = located[0];
          if (first && (first.sessionId !== node.sessionId || first.contextId !== contextId || fieldOrigin !== valid))
            return yield* browserFailure(
              new Error(`${labels[index]} is in another frame than the first field target. Target one form.`),
            );
          fieldOrigin = valid;
          located.push({ backendNodeId: node.backendNodeId, sessionId: node.sessionId, contextId });
        }
        const inputs = located.slice(0, targets.length);
        const button = submitTarget ? located[targets.length] : undefined;
        if (new Set(inputs.map((node) => node.backendNodeId)).size !== inputs.length)
          return yield* browserFailure(new Error("Authentication fields must be distinct."));
        const fingerprints: string[] = [];
        for (const [index, node] of located.entries()) {
          const value = yield* this.#callOnNode(
            send,
            node.backendNodeId,
            fingerprint,
            [],
            node.sessionId,
            node.contextId,
          );
          if (!isString(value))
            return yield* browserFailure(new Error(`${labels[index]} is no longer available. Take a fresh snapshot.`));
          fingerprints.push(value);
        }
        const kinds: Array<{ password: boolean; oneTimeCode: boolean }> = [];
        const hiddenPasswords: boolean[] = [];
        let servedByWorker = false;
        for (const node of inputs) {
          const kind = yield* this.#callOnNode(
            send,
            node.backendNodeId,
            `function() {
              const words = (text) => text.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
              const labelledBy = (this.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map((id) => (id && this.getRootNode().getElementById?.(id)?.textContent) || '');
              const named = words([this.id, this.name, this.getAttribute('aria-label') ?? '', this.getAttribute('placeholder') ?? '', this.title, ...[...(this.labels ?? [])].map((label) => label.textContent ?? ''), ...labelledBy].join(' '));
              const codeWord = /totp|\\b(?:otp|2fa|mfa)+(?:code|token|pin)?\\b|\\bauthenticator\\b|\\bauthentication ?(?:app|code)\\b|\\bone ?time ?(?:code|password|passcode|pin)\\b|\\bverification ?code\\b|\\btwo ?(?:factor|step)\\b|\\bmulti ?factor\\b/;
              const authenticatorForm = () => { const text = words(this.form?.innerText ?? ''); return /\\bauthenticator\\b|\\bauthentication ?app\\b|\\btotp\\b/.test(text) && !/\\be ?mail(?:ed)?\\b|\\bsms\\b|\\btext (?:message|messaged)\\b|\\btexted\\b/.test(text); };
              const oneTimeCode = (this.getAttribute('autocomplete') ?? '').toLowerCase().split(/\\s+/).includes('one-time-code') || (['text', 'tel', 'number'].includes(this.type) && (codeWord.test(named) || (/\\b(?:pass)?code\\b/.test(named) && authenticatorForm())) && !/backup|recovery|mail|phone|sms|name|label|promo|coupon|voucher|discount|gift|invite|referral|zip|postal|country|card|cvc|cvv|csc/.test(named));
              const shown = (element) => element.checkVisibility({ visibilityProperty: true });
              const formInputs = [...(this.form?.elements ?? [])].filter((element) => element.localName === 'input' && element !== this);
              const hiddenPassword = this.type === 'password' && !shown(this) && formInputs.some((element) => ['text', 'email', 'tel'].includes(element.type) && !element.disabled && !element.readOnly && shown(element)) && !formInputs.some((element) => element.type === 'password' && shown(element));
              return { password: this.type === 'password' || (this.type === 'text' && !['', 'none'].includes(getComputedStyle(this).getPropertyValue('-webkit-text-security'))), oneTimeCode, hiddenPassword, network: ${LOADED_FROM_NETWORK} };
            }`,
            [],
            node.sessionId,
            node.contextId,
          );
          kinds.push({
            password: isDynamicRecord(kind) && kind.password === true,
            oneTimeCode: isDynamicRecord(kind) && kind.oneTimeCode === true,
          });
          hiddenPasswords.push(isDynamicRecord(kind) && kind.hiddenPassword === true);
          servedByWorker ||= !isDynamicRecord(kind) || kind.network !== true;
        }
        const firstInput = inputs[0];
        const companion =
          singlePassword && firstInput && !kinds[0]?.password
            ? yield* this.#hiddenPasswordOf(send, firstInput)
            : undefined;
        const companionFingerprint = companion
          ? yield* this.#callOnNode(
              send,
              companion.backendNodeId,
              fingerprint,
              [],
              companion.sessionId,
              companion.contextId,
            )
          : undefined;
        if (submission === "enter" && hiddenPasswords.at(-1))
          return yield* browserFailure(
            new Error(
              "The password field is hidden, so Enter cannot be pressed in it. Use submission=click with the page's sign-in button as submitTarget.",
            ),
          );
        return {
          inputs,
          button,
          fingerprints,
          kinds,
          hiddenPasswords,
          companion:
            companion && isString(companionFingerprint)
              ? { ...companion, fingerprint: companionFingerprint }
              : undefined,
          servedByWorker,
          origin: fieldOrigin,
        };
      }),
    );
    if (generation !== this.#documentGeneration)
      return yield* browserFailure(new Error("Authentication page changed."));
    const writeHidden = (
      send: SendCommand,
      node: { backendNodeId: number; sessionId: string | undefined; contextId: number },
      text: string,
    ) =>
      this.#callOnNode(
        send,
        node.backendNodeId,
        `function(origin, text) {
                if (!this.isConnected || this.ownerDocument !== document || location.origin !== origin || this.disabled || this.readOnly || this.type !== 'password') throw new Error('Authentication target changed.');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(this, text);
                this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
                if (this.value !== text) throw new Error('Authentication field did not keep the value.');
              }`,
        [nodes.origin, text],
        node.sessionId,
        node.contextId,
      );
    const enter = (values: readonly string[], vault: boolean, onSubmitSent: () => void) =>
      Effect.gen({ self: this }, function* () {
        yield* Effect.gen({ self: this }, function* () {
          yield* this.#leaseEffect((send) =>
            Effect.gen({ self: this }, function* () {
              if (generation !== this.#documentGeneration)
                return yield* browserFailure(new Error("Authentication page changed."));
              for (const [index, node] of [...nodes.inputs, ...(nodes.button ? [nodes.button] : [])].entries()) {
                if (
                  (yield* this.#callOnNode(
                    send,
                    node.backendNodeId,
                    fingerprint,
                    [],
                    node.sessionId,
                    node.contextId,
                  )) !== nodes.fingerprints[index]
                )
                  return yield* browserFailure(new Error("Authentication target changed."));
                const valid = yield* this.#callOnNode(
                  send,
                  node.backendNodeId,
                  `function(origin, input) { return this.isConnected && this.ownerDocument === document && location.origin === origin && (!input || (!this.disabled && !this.readOnly)); }`,
                  [nodes.origin, nodes.inputs.includes(node)],
                  node.sessionId,
                  node.contextId,
                );
                if (valid !== true) return yield* browserFailure(new Error("Authentication target changed."));
              }
              const { companion } = nodes;
              if (vault && companion) {
                if (
                  (yield* this.#callOnNode(
                    send,
                    companion.backendNodeId,
                    fingerprint,
                    [],
                    companion.sessionId,
                    companion.contextId,
                  )) !== companion.fingerprint
                )
                  return yield* browserFailure(new Error("Authentication target changed."));
                const text = values[0];
                if (text === undefined || values.length !== 1)
                  return yield* browserFailure(new Error("Authentication target changed."));
                yield* writeHidden(send, companion, text);
              }
              for (const [index, node] of nodes.inputs.entries()) {
                if (vault && companion) break;
                if (generation !== this.#documentGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                if (nodes.hiddenPasswords[index]) {
                  const text = values[index];
                  if (text === undefined) return yield* browserFailure(new Error("Authentication target changed."));
                  yield* writeHidden(send, node, text);
                  continue;
                }
                yield* send("DOM.focus", { backendNodeId: node.backendNodeId }, node.sessionId);
                yield* this.#callOnNode(
                  send,
                  node.backendNodeId,
                  `function(origin) {
                if (!this.isConnected || this.ownerDocument !== document || location.origin !== origin || this.disabled || this.readOnly) throw new Error('Authentication target changed.');
                this.select();
              }`,
                  [nodes.origin],
                  node.sessionId,
                  node.contextId,
                );
                if (generation !== this.#documentGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                const text = values[index];
                if (text === undefined) return yield* browserFailure(new Error("Authentication target changed."));
                yield* send("Input.insertText", { text }, node.sessionId);
              }
              if (submission === "on_input" || generation !== this.#documentGeneration) return;
              const { button } = nodes;
              if (submission === "click" && button) {
                yield* this.#callOnNode(
                  send,
                  button.backendNodeId,
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
                  [nodes.origin, nodes.fingerprints.at(-1)],
                  button.sessionId,
                  button.contextId,
                );
                const { sessionId, ...point } = yield* this.#elementPointEffect(
                  send,
                  button.backendNodeId,
                  true,
                  button.sessionId,
                );
                if (generation !== this.#documentGeneration)
                  return yield* browserFailure(new Error("Authentication page changed."));
                onSubmitSent();
                yield* dispatchMouseClick(send, point, "left", 1, 0, sessionId);
              } else if (submission === "enter") {
                const last = nodes.inputs.at(-1);
                if (!last) return yield* browserFailure(new Error("Authentication target changed."));
                if (
                  (yield* this.#callOnNode(
                    send,
                    last.backendNodeId,
                    fingerprint,
                    [],
                    last.sessionId,
                    last.contextId,
                  )) !== nodes.fingerprints[nodes.inputs.length - 1]
                )
                  return yield* browserFailure(new Error("Authentication target changed."));
                yield* send("DOM.focus", { backendNodeId: last.backendNodeId }, last.sessionId);
                onSubmitSent();
                yield* dispatchShortcut(send, "Enter", last.sessionId);
              }
            }),
          );
        }).pipe(
          Effect.catch((error) => {
            const reason = secureInputFailure(error);
            return Effect.fail(
              browserFailure(
                new Error(
                  `Secure authentication could not be completed.${reason ? ` ${reason}` : ""} Take over to check the page.`,
                ),
              ),
            );
          }),
        );
      });
    const clear = (secrets: readonly string[]) =>
      this.#leaseEffect((send) =>
        Effect.gen({ self: this }, function* () {
          for (const node of [...nodes.inputs, ...(nodes.companion ? [nodes.companion] : [])]) {
            const cleared = yield* this.#callOnNode(
              send,
              node.backendNodeId,
              `function() { this.value = ''; this.defaultValue = ''; return this.value === ''; }`,
              [],
              node.sessionId,
              node.contextId,
            ).pipe(Effect.catch(() => Effect.succeed(false)));
            if (cleared !== true) return false;
          }
          const field = nodes.inputs[0];
          const documents = [
            { executionContextId: yield* automationContextId(send), sessionId: undefined },
            ...(field ? [{ executionContextId: field.contextId, sessionId: field.sessionId }] : []),
          ];
          for (const { executionContextId, sessionId } of documents)
            for (const secret of secrets) {
              const scan = yield* send(
                "Runtime.callFunctionOn",
                {
                  executionContextId,
                  functionDeclaration: SECRET_SCAN_FUNCTION,
                  arguments: [{ value: secret }],
                  returnByValue: true,
                },
                sessionId,
              );
              if (recordValue(scan.exceptionDetails) || recordValue(scan.result)?.value !== false) return false;
            }
          return true;
        }),
      ).pipe(Effect.catch(() => Effect.succeed(false)));
    const hide = (secret: string, shown: boolean) => this.#cardScrub.addDocumentSecret(secret, shown);
    return {
      enter,
      clear,
      hide,
      kinds: nodes.kinds,
      hiddenPasswordFill: nodes.companion !== undefined,
      servedByWorker: nodes.servedByWorker,
      origin: nodes.origin,
    };
  });

  readonly fillCard = Effect.fn("BrowserCdp.fillCard")(function* (
    this: BrowserCdpEngine,
    targets: BrowserCardTargets,
    card: VaultCardSecret,
    policy: {
      checkOrigin: (origin: string, servedByWorker: boolean) => void;
      allowFill: () => Effect.Effect<boolean, BrowserOperationError>;
      onFill: () => void;
    },
    deadline: number,
  ): Effect.fn.Return<BrowserCardFillResult, BrowserOperationError> {
    const generation = this.#navigationGeneration;
    const unavailable = (field: BrowserCardField, reason: string) =>
      browserFailure(new Error(`The ${field} target ${reason}`));
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const fields: Array<{
          field: BrowserCardField;
          backendNodeId: number;
          sessionId?: string | undefined;
          contextId: number;
          description: BrowserCardFieldDescription;
          text: string;
          fingerprint: string;
        }> = [];
        const seen = new Set<string>();
        for (const field of BROWSER_CARD_FIELDS) {
          const target = targets[field];
          if (!target) continue;
          const node = yield* this.#resolveElementEffect(send, target, deadline);
          const key = `${node.sessionId ?? "main"}:${node.backendNodeId}`;
          if (seen.has(key)) return yield* browserFailure(new Error("Each card field needs its own target."));
          seen.add(key);
          const contextId = yield* this.#nodeFrameContextId(send, node.backendNodeId, node.sessionId);
          if (contextId === undefined)
            return yield* unavailable(field, "is unavailable here. Take a fresh snapshot, or use request_takeover.");
          const description = parseCardFieldDescription(
            yield* this.#callOnNode(
              send,
              node.backendNodeId,
              CARD_FIELD_DESCRIPTION_FUNCTION,
              [],
              node.sessionId,
              contextId,
            ),
          );
          if (!description?.connected)
            return yield* unavailable(field, "is unavailable here. Take a fresh snapshot, or use request_takeover.");
          if (!description.secure) return yield* unavailable(field, "is not in an HTTPS page. Use request_takeover.");
          yield* browserSync(() => policy.checkOrigin(description.origin, !description.network));
          if (description.disabled || !cardFieldAccepts(field, description))
            return yield* unavailable(field, "is not an enabled field that takes this value.");
          if (description.sendsGet && (field === "number" || field === "securityCode"))
            return yield* unavailable(
              field,
              "is in a form that sends its fields in the page address. Use request_takeover.",
            );
          const text = cardFieldText(field, card, description);
          if (text === null)
            return yield* unavailable(
              field,
              "has no saved value on this card. Leave it to the user with request_takeover.",
            );
          const fingerprint = yield* this.#callOnNode(
            send,
            node.backendNodeId,
            CARD_FIELD_FINGERPRINT_FUNCTION,
            [],
            node.sessionId,
            contextId,
          );
          if (!isString(fingerprint)) return yield* unavailable(field, "is unavailable. Take a fresh snapshot.");
          fields.push({ field, ...node, contextId, description, text, fingerprint });
        }
        if (!(yield* policy.allowFill())) return { filled: [], unconfirmed: [] };
        yield* browserSync(() => assertBeforeDeadline(deadline));
        if (generation !== this.#navigationGeneration)
          return yield* browserFailure(new Error("The card page changed. Take a fresh snapshot."));
        this.#cardScrub.add(card.number, card.securityCode);
        policy.onFill();
        const filled: BrowserCardField[] = [];
        const unconfirmed: BrowserCardField[] = [];
        yield* Effect.gen({ self: this }, function* () {
          for (const entry of fields) {
            yield* browserSync(() => assertBeforeDeadline(deadline));
            if (generation !== this.#navigationGeneration)
              return yield* browserFailure(new Error("The card page changed."));
            if (entry.description.tag === "select") {
              yield* this.#callOnNode(
                send,
                entry.backendNodeId,
                CARD_SELECT_OPTION_FUNCTION,
                [entry.field === "expYear" ? "year" : "month", card.expMonth, card.expYear, entry.fingerprint],
                entry.sessionId,
                entry.contextId,
              );
              filled.push(entry.field);
              continue;
            }
            yield* send("DOM.focus", { backendNodeId: entry.backendNodeId }, entry.sessionId);
            yield* this.#callOnNode(
              send,
              entry.backendNodeId,
              CARD_FIELD_SELECT_FUNCTION,
              [entry.fingerprint],
              entry.sessionId,
              entry.contextId,
            );
            yield* send("Input.insertText", { text: entry.text }, entry.sessionId);
            filled.push(entry.field);
            const holds = yield* this.#callOnNode(
              send,
              entry.backendNodeId,
              CARD_FIELD_CHECK_FUNCTION,
              [entry.text, entry.field !== "nameOnCard"],
              entry.sessionId,
              entry.contextId,
            ).pipe(Effect.catch(() => Effect.succeed(false)));
            if (holds !== true) unconfirmed.push(entry.field);
          }
        }).pipe(
          Effect.catch((failure) =>
            browserFailure(
              new Error(
                `Card fill stopped. Filled fields: ${filled.join(", ") || "none"}. Read the page before you continue. ${failure.cause instanceof Error ? this.#cardScrub.text(failure.cause.message) : ""}`.trim(),
              ),
            ),
          ),
        );
        return { filled, unconfirmed };
      }),
    );
  });
  #retainDebugger = false;
  #ownsDebugger = false;
  #idleDetach: NodeJS.Immediate | undefined;
  #idleFocusOff = false;
  #frozen = false;
  #closing = false;
  #disposed = false;
  readonly #scope = Scope.makeUnsafe();
  #activeLeases = 0;
  readonly #dialogWatches = new Set<DialogWatch>();
  #dialog: (BrowserDialog & { owner: BrowserDialogOwner | undefined }) | undefined;
  #dialogChanged = Deferred.makeUnsafe<void>();
  readonly #dialogListeners = new Set<() => void>();
  #viewDialogWatches = 0;
  #pageEnabled = false;
  #dialogBoxPending = false;
  #cancelDialogBox = false;
  #dialogsReleased = false;
  #acceptsPageAlert: ((message: string) => boolean) | undefined;
  #personInputAt = Number.NEGATIVE_INFINITY;
  #highlightSessionId: string | undefined;
  readonly #uploadDocumentIds = new Set<string>();
  readonly #targetSessions = new Map<string, { sessionId: string; url: string }>();

  constructor(contents: WebContents, cardScrub = new CardValueScrub()) {
    this.#contents = contents;
    this.#cardScrub = cardScrub;
    contents.once("close", () => {
      this.#closing = true;
    });
    const internalEvents: NodeJS.EventEmitter = contents;
    internalEvents.on(RUN_DIALOG_EVENT, (info: unknown, reply: unknown) => {
      this.#dialogBoxPending = false;
      if (this.#cancelDialogBox) {
        this.#cancelDialogBox = false;
        contents.emit(CANCEL_DIALOGS_EVENT);
        return;
      }
      if (this.#acceptedPageAlert(info, reply)) contents.emit(CANCEL_DIALOGS_EVENT);
    });
    contents.on("before-mouse-event", (_event, input) => {
      if (input.type === "mouseDown") this.#notePersonInput();
    });
    contents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown") this.#notePersonInput();
    });
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame) this.#navigationGeneration += 1;
      if (details.isMainFrame && !details.isSameDocument) this.#documentGeneration += 1;
      if (details.isMainFrame) {
        this.#targets.clear();
        this.#lastSnapshot = null;
        return;
      }
      if (details.isSameDocument) return;
      for (const [ref, record] of this.#targets) {
        if (record.targetId !== undefined) this.#targets.delete(ref);
      }
    });
    contents.on("did-navigate", () => this.#cardScrub.endDocument());
    contents.debugger.on("message", (_event, method, params, sessionId) => {
      if (method === "Target.attachedToTarget" && isRecord(params)) {
        const attachedSessionId = stringValue(params.sessionId) || sessionId || "";
        const targetInfo = recordValue(params.targetInfo);
        const targetId = stringValue(targetInfo?.targetId);
        if (attachedSessionId && targetId && targetInfo?.type === "iframe") {
          this.#targetSessions.set(targetId, { sessionId: attachedSessionId, url: stringValue(targetInfo?.url) });
        }
      }
      if (method === "Page.javascriptDialogOpening" && !sessionId && isRecord(params)) this.#dialogOpened(params);
      if (method === "Page.javascriptDialogClosed" && !sessionId) this.#dialogClosed();
      if (method === "Target.detachedFromTarget" && isRecord(params)) {
        this.#forgetTargetSession(stringValue(params.sessionId));
      }
    });
    contents.debugger.on("detach", () => {
      this.#clearDebuggerSessions();
      this.#restoreLocation();
    });
  }

  #restoreLocation(): void {
    if (!this.#location || this.#disposed || this.#closing || this.#contents.isDestroyed()) return;
    Effect.runFork(this.#leaseEffect(() => Effect.void, false).pipe(Effect.ignore));
  }

  #forgetTargetSession(sessionId: string): void {
    for (const [targetId, target] of this.#targetSessions) {
      if (target.sessionId === sessionId) this.#targetSessions.delete(targetId);
    }
  }

  readonly snapshot = Effect.fn("BrowserCdp.snapshot")(function* (
    this: BrowserCdpEngine,
    context: SnapshotContext,
  ): Effect.fn.Return<SnapshotReadResult, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        let navigationGeneration = this.#navigationGeneration;
        const documentGeneration = this.#documentGeneration;
        const collect = () =>
          Effect.all(
            [
              collectBoundedSnapshot(send, this.#snapshotTargets(), context.revision, true),
              collectFocus(send).pipe(Effect.catch(() => Effect.succeed(null))),
            ],
            { concurrency: "unbounded" },
          );
        let [metrics, [parsed, focus], challenge, settle] = yield* Effect.all(
          [
            send("Page.getLayoutMetrics"),
            collect(),
            detectChallenge(this.#contents, send, [...this.#targetSessions.keys()]),
            probeSettle(send),
          ],
          { concurrency: "unbounded" },
        );
        const busyWait = settle?.busy === true && this.#settleTimedOutDocument !== documentGeneration;
        const emptyWait =
          settle !== null &&
          !settle.busy &&
          (parsed.elements.length === 0 || parsed.fallback) &&
          settle.emptyWaitMs > 0 &&
          settle.document !== this.#emptyWaitedDocument;
        const settleBudget = Math.min(
          busyWait ? SETTLE_BUSY_WAIT_MS : (settle?.emptyWaitMs ?? 0),
          context.deadline - Date.now() - SETTLE_RESERVE_MS,
        );
        if (
          challenge === null &&
          (busyWait || emptyWait) &&
          settleBudget > 0 &&
          navigationGeneration === this.#navigationGeneration
        ) {
          if (emptyWait && settle !== null) this.#emptyWaitedDocument = settle.document;
          const settled = yield* waitForSettle(send, emptyWait, settleBudget);
          if (!settled && busyWait) this.#settleTimedOutDocument = documentGeneration;
          if (documentGeneration === this.#documentGeneration) navigationGeneration = this.#navigationGeneration;
          if (navigationGeneration === this.#navigationGeneration) [parsed, focus] = yield* collect();
        }
        if (navigationGeneration !== this.#navigationGeneration) {
          return yield* browserFailure(new Error(SNAPSHOT_NAVIGATED_MESSAGE));
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
        const emptyPage =
          parsed.elements.length === 0 &&
          !parsed.text &&
          parsed.hasRoot &&
          !snapshot.loading &&
          /^https?:/u.test(snapshot.url);
        const lowCoverage = (parsed.elements.length < 3 && parsed.text.length > 200) || emptyPage;
        const recommendImage = parsed.hasVisualSurface || parsed.hasFrame || lowCoverage;
        const imageReason = parsed.hasVisualSurface
          ? "canvas-or-video"
          : parsed.hasFrame
            ? "iframe"
            : "low-semantic-coverage";
        return { snapshot: this.#cardScrub.snapshot(snapshot), recommendImage, imageReason, challenge };
      }),
    );
  });

  readonly pageStatus = Effect.fn("BrowserCdp.pageStatus")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<BrowserPageStatus, BrowserOperationError> {
    const focus = yield* this.#leaseEffect((send) => collectFocus(send)).pipe(Effect.catch(() => Effect.succeed(null)));
    if (this.#closing || this.#contents.isDestroyed())
      return yield* browserFailure(new Error("Browser tab was closed."));
    return {
      title: this.#cardScrub.text(this.#contents.getTitle().slice(0, 500)),
      url: this.#cardScrub.text(this.#contents.getURL()),
      loading: this.#contents.isLoading(),
      focus: focus && { ...focus, name: this.#cardScrub.text(focus.name) },
    };
  });

  readonly click = Effect.fn("BrowserCdp.click")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget,
    options: {
      button?: "left" | "middle" | "right" | undefined;
      clickCount?: number | undefined;
      modifiers?: string[] | undefined;
    } = {},
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
        const element = resolved.backendNodeId;
        const button = options.button ?? "left";
        const totalClicks = options.clickCount ?? 1;
        const modifiers = modifierMask(options.modifiers ?? []);
        const contextId = element
          ? yield* this.#nodeFrameContextId(send, element, resolved.sessionId).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
          : undefined;
        for (let attempt = 1; ; attempt += 1) {
          yield* browserSync(() => assertBeforeDeadline(deadline));
          const point = element
            ? yield* this.#elementPointEffect(send, element, true, resolved.sessionId)
            : { x: resolved.x, y: resolved.y };
          const { sessionId, ...coordinates } = point;
          yield* browserSync(() => assertBeforeDeadline(deadline));
          if (attempt === 1) onDispatch?.();
          const from = this.#pointerIn(sessionId);
          this.#pointer = { point: coordinates, sessionId };
          const press = dispatchMouseClick(send, coordinates, button, totalClicks, modifiers, sessionId, from);
          if (!element) return yield* press;
          const missed = yield* guardedPress(send, element, contextId, sessionId, press);
          if (missed === undefined) return;
          if (attempt >= CLICK_PRESS_ATTEMPTS)
            return yield* browserFailure(new Error(sourceText("error.backend.browserClickMoved", { element: missed })));
        }
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
        const from = this.#pointerIn(sessionId);
        this.#pointer = { point: coordinates, sessionId };
        yield* dispatchPointerMove(send, from, coordinates, 0, sessionId);
      }),
    );
  });

  readonly type = Effect.fn("BrowserCdp.type")(function* (
    this: BrowserCdpEngine,
    target: BrowserTarget | undefined,
    text: string,
    options: { mode?: "replace" | "append" | undefined; submit?: boolean } = {},
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const mode = options.mode ?? "replace";
    if (!target) return yield* this.#typeFocusedEffect(text, options.submit === true, deadline, onDispatch);
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
        if (!resolved.backendNodeId) return yield* browserFailure(new Error("Typing requires an element target."));
        const chain = yield* this.#focusChain(send, resolved.backendNodeId, resolved.sessionId);
        const checkFocus = (
          key:
            | "error.backend.browserTypingFocusMoved"
            | "error.backend.browserTypingFocusMovedWhileTyping"
            | "error.backend.browserTypingSubmitSkipped",
        ) =>
          Effect.forEach(
            chain,
            (link) =>
              Effect.gen({ self: this }, function* () {
                const focused = yield* this.#callOnNode(
                  send,
                  link.backendNodeId,
                  HOLDS_FOCUS_FUNCTION,
                  [],
                  link.sessionId,
                  link.contextId,
                ).pipe(Effect.catch(() => Effect.succeed(false)));
                if (focused !== true) return yield* browserFailure(new Error(sourceText(key)));
              }),
            { discard: true },
          );
        yield* browserSync(() => assertBeforeDeadline(deadline));
        onDispatch?.();
        yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, resolved.sessionId);
        const useEndKey = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          `function(mode) {
          if (!('value' in this) && !this.isContentEditable) throw new Error('Target does not accept text.');
          ${COUNT_TYPED_KEYS}
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
        if (useEndKey === true) {
          yield* checkFocus("error.backend.browserTypingFocusMoved");
          yield* dispatchShortcut(send, "End", resolved.sessionId);
        }
        yield* checkFocus("error.backend.browserTypingFocusMoved");
        yield* browserSync(() => assertBeforeDeadline(deadline));
        const keyArrived = this.#callOnNode(
          send,
          resolved.backendNodeId,
          TYPED_KEY_ARRIVED_FUNCTION,
          [useEndKey === true ? 2 : 1],
          resolved.sessionId,
        ).pipe(
          Effect.map((arrived) => arrived !== false),
          Effect.catch(() => Effect.succeed(true)),
        );
        const multiline = /[\n\r]/.test(text);
        const pasted =
          multiline &&
          (yield* this.#callOnNode(send, resolved.backendNodeId, PASTE_TEXT_FUNCTION, [text], resolved.sessionId)) ===
            true;
        if (multiline && !pasted) {
          yield* checkFocus("error.backend.browserTypingFocusMoved");
          yield* browserSync(() => assertBeforeDeadline(deadline));
        }
        if (!pasted)
          yield* dispatchText(send, text, resolved.sessionId, {
            keyArrived,
            saveText: this.#callOnNode(
              send,
              resolved.backendNodeId,
              SAVE_TYPED_TEXT_FUNCTION,
              [],
              resolved.sessionId,
            ).pipe(Effect.asVoid),
            beforeNext: (typed, total) =>
              browserSync(() => assertTypingProgressBeforeDeadline(deadline, typed, total)).pipe(
                Effect.andThen(checkFocus("error.backend.browserTypingFocusMovedWhileTyping")),
              ),
          });
        if (options.submit === true) {
          yield* checkFocus("error.backend.browserTypingSubmitSkipped");
          const total = [...text].length;
          yield* browserSync(() => assertTypingProgressBeforeDeadline(deadline, total, total));
          yield* dispatchShortcut(send, "Enter", resolved.sessionId);
        }
      }),
    );
  });

  readonly fillFields = Effect.fn("BrowserCdp.fillFields")(function* (
    this: BrowserCdpEngine,
    revision: number,
    fields: readonly { ref: string; text: string }[],
    deadline: number,
    progress: BrowserFillFieldsProgress,
    checkPolicy: () => void,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (!this.#lastSnapshot || this.#lastSnapshot.revision !== revision)
      return yield* fillFieldsFailure("stale_snapshot");
    const generation = this.#navigationGeneration;
    const origin = yield* browserSync(() => new URL(this.#contents.getURL()).origin);
    yield* this.#leaseEffect(
      (send) =>
        Effect.gen({ self: this }, function* () {
          const document = yield* send("DOM.getDocument", { depth: 0 });
          const documentNodeId = numberValue(recordValue(document.root)?.backendNodeId);
          if (!documentNodeId) return yield* fillFieldsFailure("document_changed");
          const contextId = yield* automationContextId(send);
          const objects: string[] = [];
          const prepared: BrowserPreparedField[] = [];
          const checkDocument = () =>
            Effect.gen({ self: this }, function* () {
              if (progress.stopped || Date.now() >= deadline) return yield* fillFieldsFailure("deadline");
              if (generation !== this.#navigationGeneration) return yield* fillFieldsFailure("document_changed");
              yield* browserSync(checkPolicy);
              const current = yield* send("DOM.getDocument", { depth: 0 });
              if (numberValue(recordValue(current.root)?.backendNodeId) !== documentNodeId)
                return yield* fillFieldsFailure("document_changed");
            });
          const state = (
            objectId: string,
            expected: string | null,
            select = false,
            text: string | null = null,
            requireActive = false,
          ) =>
            Effect.gen(function* () {
              const result = yield* send("Runtime.callFunctionOn", {
                objectId,
                functionDeclaration: FILL_FIELD_STATE_FUNCTION,
                arguments: [expected, origin, select, text, requireActive].map((value) => ({ value })),
                returnByValue: true,
              });
              const value = recordValue(result.result)?.value;
              if (result.exceptionDetails || !isString(value)) return yield* fillFieldsFailure("target_changed");
              return value;
            });
          yield* Effect.gen({ self: this }, function* () {
            for (const [index, field] of fields.entries()) {
              progress.failedIndex = index;
              yield* checkDocument();
              const record = this.#targets.get(field.ref);
              if (!record || record.targetId) return yield* fillFieldsFailure("invalid_target");
              const target: BrowserTarget = { kind: "ref", ref: field.ref, revision };
              const resolved = yield* this.#resolveElementEffect(send, target, deadline).pipe(
                Effect.catch(() =>
                  Effect.fail(fillFieldsFailure(Date.now() >= deadline ? "deadline" : "invalid_target")),
                ),
              );
              const object = yield* send("DOM.resolveNode", {
                backendNodeId: resolved.backendNodeId,
                executionContextId: contextId,
              });
              const objectId = stringValue(recordValue(object.object)?.objectId);
              if (!objectId) return yield* fillFieldsFailure("invalid_target");
              objects.push(objectId);
              const fingerprint = yield* state(objectId, null).pipe(
                Effect.catch(() => Effect.fail(fillFieldsFailure("invalid_target"))),
              );
              const preflightEmpty = JSON.parse(fingerprint)[1] === "";
              const verify = () =>
                Effect.gen({ self: this }, function* () {
                  yield* checkDocument();
                  const current = yield* this.#targetFingerprint(send, resolved.backendNodeId).pipe(
                    Effect.catch(() =>
                      Effect.fail(fillFieldsFailure(Date.now() >= deadline ? "deadline" : "target_changed")),
                    ),
                  );
                  if (
                    !current.visible ||
                    current.role !== record.element.role ||
                    current.name !== record.element.name ||
                    current.tag !== record.element.tag ||
                    current.visibleText !== record.visibleText
                  )
                    return yield* fillFieldsFailure("target_changed");
                  yield* state(objectId, fingerprint);
                });
              prepared.push({
                verify,
                replace: (onDispatch) =>
                  Effect.gen({ self: this }, function* () {
                    yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId });
                    yield* state(objectId, fingerprint, true);
                    yield* verify();
                    yield* state(objectId, fingerprint, false, null, true);
                    if (generation !== this.#navigationGeneration) return yield* fillFieldsFailure("document_changed");
                    if (progress.stopped || Date.now() >= deadline) return yield* fillFieldsFailure("deadline");
                    yield* browserSync(checkPolicy);
                    yield* Effect.gen({ self: this }, function* () {
                      onDispatch();
                      if (field.text.length > 0) yield* send("Input.insertText", { text: field.text });
                      else if (!preflightEmpty) yield* dispatchShortcut(send, "Backspace");
                      yield* browserSync(checkPolicy);
                      if (generation !== this.#navigationGeneration)
                        return yield* fillFieldsFailure("document_changed");
                      yield* state(objectId, fingerprint, false, field.text);
                      if (generation !== this.#navigationGeneration)
                        return yield* fillFieldsFailure("document_changed");
                    }).pipe(Effect.uninterruptible);
                  }),
              });
            }
            progress.failedIndex = null;
            yield* fillPreparedFields(prepared, progress, deadline, checkPolicy);
          }).pipe(
            Effect.ensuring(
              Effect.suspend(() =>
                Effect.forEach(objects, (objectId) => send("Runtime.releaseObject", { objectId }).pipe(Effect.ignore), {
                  discard: true,
                }),
              ),
            ),
          );
        }),
      false,
    );
  });

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
        yield* waitForFrame(send, sessionId, deadline, NEW_PAGE_FRAME_SCRIPT);
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
          const box = this.getBoundingClientRect();
          return {
            multiple: this.multiple,
            desiredIndices: this.multiple ? uniqueDesiredIndices : uniqueDesiredIndices.slice(0, 1),
            desiredLabel,
            selectedIndex: this.selectedIndex,
            typeaheadCycleIndices,
            enabledIndices,
            labels: Array.from(this.options, option => option.label || option.text),
            center: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
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
        let selectNodeId = resolved.backendNodeId;
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
            const targetCycleRank = cycleIndices.indexOf(firstDesiredIndex);
            if (targetCycleRank < 0) {
              return yield* browserFailure(new Error("Select target returned an invalid typeahead navigation plan."));
            }
            const initial = Array.from(plan.desiredLabel)[0];
            if (!initial) return yield* browserFailure(new Error("Select target returned an empty typeahead key."));
            yield* this.#callOnNode(
              send,
              resolved.backendNodeId,
              "function() { this.blur(); }",
              [],
              resolved.sessionId,
            );
            yield* send("DOM.focus", { backendNodeId: resolved.backendNodeId }, resolved.sessionId);
            const labels = Array.isArray(plan.labels) ? plan.labels.filter(isString) : [];
            const center = recordValue(plan.center);
            let presses = 0;
            for (let reads = 0; reads <= 2 * cycleIndices.length + 1; reads++) {
              const state = yield* this.#callOnNode(
                send,
                selectNodeId,
                "function() { return { connected: this.isConnected, selectedIndex: this.selectedIndex }; }",
                [],
                resolved.sessionId,
              );
              if (recordValue(state)?.connected !== true) {
                const replacement = yield* this.#replacementSelectEffect(
                  send,
                  labels,
                  numberValue(center?.x),
                  numberValue(center?.y),
                  resolved.sessionId,
                );
                if (replacement === null) break;
                selectNodeId = replacement;
                yield* send("DOM.focus", { backendNodeId: selectNodeId }, resolved.sessionId);
                continue;
              }
              if (recordValue(state)?.selectedIndex === firstDesiredIndex || presses === cycleIndices.length) break;
              yield* browserSync(() => assertBeforeDeadline(deadline));
              yield* dispatchTextKey(send, initial, resolved.sessionId);
              presses++;
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
          selectNodeId,
          "function() { return Array.from(this.options, (option, index) => option.selected ? index : -1).filter(index => index >= 0); }",
          [],
          resolved.sessionId,
        );
        const selectedIndices = Array.isArray(selected) ? selected.filter(isNumber) : [];
        if (
          selectedIndices.length !== desiredIndices.length ||
          selectedIndices.some((index, position) => index !== desiredIndices[position])
        ) {
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
              stopWaitingForIntercept();
              yield* send("Input.setInterceptDrags", { enabled: false }, sessionId).pipe(Effect.ignore);
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
          if (dragData) {
            yield* send("Input.dispatchDragEvent", { type: "dragEnter", x: to.x, y: to.y, data: dragData }, sessionId);
            yield* send("Input.dispatchDragEvent", { type: "dragOver", x: to.x, y: to.y, data: dragData }, sessionId);
            yield* waitForFrame(send, sessionId, deadline);
            yield* send("Input.dispatchDragEvent", { type: "drop", x: to.x, y: to.y, data: dragData }, sessionId);
          }
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
        const isFileInput = yield* this.#callOnNode(
          send,
          resolved.backendNodeId,
          "function() { return this.localName === 'input' && this.type === 'file'; }",
          [],
          resolved.sessionId,
        );
        yield* browserSync(() => assertBeforeDeadline(deadline));
        if (isFileInput !== true) {
          yield* this.#uploadThroughChooserEffect(send, resolved, paths, deadline, onDispatch);
          return assignment;
        }
        onDispatch?.();
        yield* this.#clearFileInputEffect(send, resolved.backendNodeId, resolved.sessionId);
        yield* send(
          "DOM.setFileInputFiles",
          { backendNodeId: resolved.backendNodeId, files: paths },
          resolved.sessionId,
        );
        return assignment;
      }),
    );
  });

  readonly #uploadThroughChooserEffect = Effect.fn("BrowserCdp.uploadThroughChooser")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    resolved: { backendNodeId: number; sessionId?: string | undefined },
    paths: string[],
    deadline?: number,
    onDispatch?: ActionDispatch,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const { sessionId, ...point } = yield* this.#elementPointEffect(
      send,
      resolved.backendNodeId,
      true,
      resolved.sessionId,
    );
    const attachOwnSession = Effect.gen(function* () {
      if (sessionId !== undefined) return undefined;
      const info = yield* send("Target.getTargetInfo");
      const targetId = stringValue(recordValue(info.targetInfo)?.targetId);
      const attached = yield* send("Target.attachToTarget", { targetId, flatten: true });
      const ownSessionId = stringValue(attached.sessionId);
      if (!ownSessionId) return yield* browserFailure(new Error("Unable to intercept the file chooser."));
      return ownSessionId;
    });
    yield* Effect.acquireUseRelease(
      attachOwnSession,
      (ownSessionId) =>
        Effect.gen({ self: this }, function* () {
          const chooserSessionId = ownSessionId ?? sessionId;
          const chooser = Deferred.makeUnsafe<DynamicRecord | null>();
          const stopWaitingForChooser = yield* browserSync(() => {
            let stopWaitingForChooser = () => undefined;
            const debuggerClient = this.#contents.debugger;
            const listener = (_event: Electron.Event, method: string, params: unknown, messageSessionId?: string) => {
              if (method !== "Page.fileChooserOpened" || messageSessionId !== chooserSessionId) return;
              stopWaitingForChooser();
              Deferred.doneUnsafe(chooser, Effect.succeed(recordValue(params) ?? null));
            };
            const timeout = setTimeout(
              () => {
                stopWaitingForChooser();
                Deferred.doneUnsafe(chooser, Effect.succeed(null));
              },
              Math.min(CHOOSER_WAIT_MS, deadline === undefined ? CHOOSER_WAIT_MS : Math.max(0, deadline - Date.now())),
            );
            stopWaitingForChooser = () => {
              clearTimeout(timeout);
              debuggerClient.removeListener("message", listener);
            };
            debuggerClient.on("message", listener);
            return stopWaitingForChooser;
          });
          yield* Effect.gen({ self: this }, function* () {
            yield* send("Page.enable", {}, chooserSessionId);
            yield* send("Page.setInterceptFileChooserDialog", { enabled: true }, chooserSessionId);
            yield* browserSync(() => assertBeforeDeadline(deadline));
            onDispatch?.();
            yield* dispatchMouseClick(send, point, "left", 1, 0, sessionId);
            const opened = yield* Deferred.await(chooser);
            if (!opened) {
              return yield* browserFailure(
                new Error("The target was clicked but did not open a file chooser. Take a fresh snapshot."),
              );
            }
            const backendNodeId = numberValue(opened.backendNodeId);
            if (!backendNodeId) return yield* browserFailure(new Error("The file chooser has no file input."));
            if (opened.mode === "selectSingle" && paths.length > 1)
              return yield* browserFailure(new Error("The file chooser accepts only one file."));
            yield* this.#clearFileInputEffect(send, backendNodeId, chooserSessionId);
            yield* send("DOM.setFileInputFiles", { backendNodeId, files: paths }, chooserSessionId);
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                stopWaitingForChooser();
                if (ownSessionId) return;
                yield* send("Page.setInterceptFileChooserDialog", { enabled: false }, chooserSessionId).pipe(
                  Effect.ignore,
                );
                yield* send("Page.disable", {}, chooserSessionId).pipe(Effect.ignore);
              }),
            ),
          );
        }),
      (ownSessionId) =>
        ownSessionId ? send("Target.detachFromTarget", { sessionId: ownSessionId }).pipe(Effect.ignore) : Effect.void,
    );
  });

  readonly #clearFileInputEffect = Effect.fn("BrowserCdp.clearFileInput")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId?: string,
  ): Effect.fn.Return<void> {
    yield* this.#callOnNode(
      send,
      backendNodeId,
      "function() { this.files = new DataTransfer().files; }",
      [],
      sessionId,
    ).pipe(Effect.ignore);
  });

  readonly #identifyUploadTargetEffect = Effect.fn("BrowserCdp.identifyUploadTarget")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    resolved: { backendNodeId: number; sessionId?: string | undefined },
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

  scrubText(value: string): string {
    return this.#cardScrub.text(value);
  }

  forContents(contents: WebContents): BrowserCdpEngine {
    return new BrowserCdpEngine(contents, this.#cardScrub);
  }

  #namesCardValue(...values: Array<string | undefined>): boolean {
    return values.some((value) => value !== undefined && this.#cardScrub.reveals(value));
  }

  watchDialogs(owner: BrowserDialogOwner): { opened: Effect.Effect<BrowserDialog>; end: () => void } {
    const watch: DialogWatch = { owner, opened: Deferred.makeUnsafe<BrowserDialog>() };
    this.#dialogWatches.add(watch);
    return {
      opened: Deferred.await(watch.opened),
      end: () => {
        if (!this.#dialogWatches.delete(watch)) return;
        this.#signalDialogChange();
        this.#releaseIdleDebugger();
      },
    };
  }

  readonly observeDialogs = Effect.fn("BrowserCdp.observeDialogs")(function* (this: BrowserCdpEngine) {
    yield* this.#leaseEffect(() => Effect.void, false);
  });

  get dialog(): BrowserDialog | undefined {
    if (!this.#dialog) return undefined;
    const { owner: _owner, ...dialog } = this.#dialog;
    return dialog;
  }

  dialogOwnedBy(owner: BrowserDialogOwner): boolean {
    const dialog = this.#dialog;
    return dialog?.agent === true && dialog.owner?.threadId === owner.threadId && dialog.owner.turnId === owner.turnId;
  }

  readonly nextDialog = Effect.fn("BrowserCdp.nextDialog")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<BrowserDialog | undefined> {
    while (true) {
      const dialog = this.dialog;
      if (dialog || this.#dialogWatches.size === 0) return dialog;
      yield* Deferred.await(this.#dialogChanged);
    }
  });

  readonly answerDialog = Effect.fn("BrowserCdp.answerDialog")(function* (
    this: BrowserCdpEngine,
    id: string,
    accept: boolean,
    owner: BrowserDialogOwner,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (this.#dialog?.id !== id) return yield* browserFailure(new Error(DIALOG_CLOSED_ERROR));
    if (!this.dialogOwnedBy(owner)) return yield* browserFailure(new Error(DIALOG_FOR_PERSON_ERROR));
    yield* this.#sendDialogAnswer(id, accept);
  });

  readonly answerPersonDialog = Effect.fn("BrowserCdp.answerPersonDialog")(function* (
    this: BrowserCdpEngine,
    id: string,
    accept: boolean,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (this.#dialog?.id !== id) return yield* browserFailure(new Error(DIALOG_CLOSED_ERROR));
    yield* this.#sendDialogAnswer(id, accept);
  });

  onDialogChange(listener: () => void): () => void {
    this.#dialogListeners.add(listener);
    return () => this.#dialogListeners.delete(listener);
  }

  readonly #sendDialogAnswer = Effect.fn("BrowserCdp.sendDialogAnswer")(function* (
    this: BrowserCdpEngine,
    id: string,
    accept: boolean,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const answered = yield* browserCall(() =>
      this.#contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept }).then(() => {
        this.#contents.emit(CANCEL_DIALOGS_EVENT);
      }),
    ).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (this.#dialog?.id === id) {
      this.#dialog = undefined;
      this.#signalDialogChange();
    }
    if (!answered) return yield* browserFailure(new Error(DIALOG_CLOSED_ERROR));
  });

  handOffDialogs(threadId?: string, turnId?: string): void {
    const matches = (owner: BrowserDialogOwner) =>
      (threadId === undefined || owner.threadId === threadId) && (turnId === undefined || owner.turnId === turnId);
    let changed = false;
    for (const watch of this.#dialogWatches)
      if (matches(watch.owner)) changed = this.#dialogWatches.delete(watch) || changed;
    if (this.#dialog?.owner && matches(this.#dialog.owner)) {
      this.#dialog = { ...this.#dialog, agent: false, owner: undefined };
      changed = true;
    }
    if (!changed) return;
    this.#signalDialogChange();
    this.#releaseIdleDebugger();
  }

  acceptPageAlerts(accepts: (message: string) => boolean): void {
    this.#acceptsPageAlert = accepts;
  }

  #notePersonInput(): void {
    if (this.#activeLeases === 0) this.#personInputAt = Date.now();
  }

  notePersonViewInput(): void {
    this.#personInputAt = Date.now();
  }

  #acceptedPageAlert(info: unknown, reply: unknown): boolean {
    if (!this.#acceptsPageAlert || this.#dialogsReleased || this.#dialogWatches.size > 0 || this.#dialog?.agent)
      return false;
    if (Date.now() - this.#personInputAt < PERSON_ACTIVATION_MS) return false;
    if (!isRecord(info) || info.dialogType !== "alert" || typeof reply !== "function") return false;
    const message = redactText(this.#cardScrub.text(stringValue(info.messageText))).slice(0, DIALOG_MESSAGE_LIMIT);
    if (!this.#acceptsPageAlert(message)) return false;
    reply(true, "");
    return true;
  }

  releaseDialogs(): void {
    this.#dialogsReleased = true;
    this.#dialogWatches.clear();
    this.#signalDialogChange();
    if (this.#dialog) this.#detachOwnedDebugger();
  }

  #dialogOpened(params: DynamicRecord): void {
    const type = stringValue(params.type);
    if (type !== "alert" && type !== "confirm") return;
    if (this.#dialogsReleased) {
      this.#dialogBoxPending = true;
      this.#detachOwnedDebugger();
      return;
    }
    const watch = [...this.#dialogWatches].at(-1);
    const agent = watch !== undefined && this.#ownsDebugger && this.#contents.listenerCount(CANCEL_DIALOGS_EVENT) > 0;
    const dialog: BrowserDialog = {
      id: randomUUID(),
      type,
      message: redactText(this.#cardScrub.text(stringValue(params.message))).slice(0, DIALOG_MESSAGE_LIMIT),
      agent,
    };
    this.#dialog = { ...dialog, owner: agent ? watch.owner : undefined };
    this.#dialogBoxPending = true;
    for (const current of this.#dialogWatches) Deferred.doneUnsafe(current.opened, Effect.succeed(dialog));
    this.#signalDialogChange();
  }

  #dialogClosed(): void {
    if (!this.#dialog) return;
    this.#dialog = undefined;
    this.#signalDialogChange();
    this.#releaseIdleDebugger();
  }

  #releaseIdleDebugger(): void {
    if (!this.#debuggerIdle() || this.#idleDetach) return;
    this.#idleDetach = setImmediate(() => {
      this.#idleDetach = undefined;
      if (this.#debuggerIdle()) this.#detachOwnedDebugger();
    });
  }

  #debuggerIdle(): boolean {
    return (
      this.#activeLeases === 0 &&
      !this.#retainDebugger &&
      !this.#location &&
      !this.#dialog &&
      this.#dialogWatches.size === 0
    );
  }

  #signalDialogChange(): void {
    const changed = this.#dialogChanged;
    this.#dialogChanged = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(changed, Effect.void);
    for (const listener of [...this.#dialogListeners]) listener();
  }

  cancelPendingCommands(): boolean {
    if (!this.#ownsDebugger || this.#dialog) return false;
    this.#detachOwnedDebugger();
    return true;
  }

  readonly pageAnswers = Effect.fn("BrowserCdp.pageAnswers")(function* (
    this: BrowserCdpEngine,
  ): Effect.fn.Return<boolean, BrowserOperationError> {
    if (this.#disposed || this.#closing || this.#frozen || this.#dialog) return true;
    if (this.#contents.isDestroyed() || this.#contents.isCrashed()) return true;
    const pageDebugger = this.#contents.debugger;
    this.#activeLeases += 1;
    return yield* Effect.gen({ self: this }, function* () {
      while (!this.#contents.isDestroyed()) {
        if (!pageDebugger.isAttached()) {
          yield* browserSync(() => pageDebugger.attach("1.3"));
          this.#ownsDebugger = true;
        }
        const reply = yield* Effect.exit(
          browserCall(() => pageDebugger.sendCommand("Runtime.evaluate", { expression: "0" })),
        );
        if (Exit.isSuccess(reply)) return;
        yield* Effect.sleep(PAGE_ANSWER_RETRY_MS);
      }
    }).pipe(
      Effect.timeoutOption(PAGE_ANSWER_WAIT_MS),
      Effect.map(Option.isSome),
      Effect.ensuring(
        Effect.sync(() => {
          this.#activeLeases -= 1;
          this.#releaseIdleDebugger();
        }),
      ),
    );
  });

  readonly setIdleFocus = Effect.fn("BrowserCdp.setIdleFocus")(function* (
    this: BrowserCdpEngine,
    enabled: boolean,
  ): Effect.fn.Return<void, BrowserOperationError> {
    this.#idleFocusOff = !enabled;
    if (!this.#mayEmulateIdleFocus()) return;
    yield* browserCall(() => this.#contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled }));
  });

  get frozen(): boolean {
    return this.#frozen;
  }

  readonly setFrozen = Effect.fn("BrowserCdp.setFrozen")(function* (
    this: BrowserCdpEngine,
    frozen: boolean,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if ((!frozen && !this.#frozen) || this.#disposed || this.#closing || this.#contents.isDestroyed()) return;
    this.#frozen = frozen;
    if (!this.#contents.debugger.isAttached()) {
      yield* browserSync(() => this.#contents.debugger.attach("1.3"));
      this.#ownsDebugger = true;
    }
    yield* browserCall(() =>
      this.#contents.debugger.sendCommand("Page.setWebLifecycleState", { state: frozen ? "frozen" : "active" }),
    ).pipe(Effect.ensuring(Effect.sync(() => this.#releaseIdleDebugger())));
  });

  readonly setLocation = Effect.fn("BrowserCdp.setLocation")(function* (
    this: BrowserCdpEngine,
    location: BrowserLocation | null,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (location) {
      const previous = this.#location;
      this.#location = location;
      this.#locationApplied = false;
      yield* this.#leaseEffect(() => Effect.void, false).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            this.#location = previous;
            this.#locationApplied = false;
          }),
        ),
      );
      return;
    }
    if (!this.#location) return;
    this.#location = null;
    this.#locationApplied = false;
    if (!this.#disposed && !this.#closing && !this.#contents.isDestroyed() && this.#contents.debugger.isAttached())
      yield* browserCall(() => this.#contents.debugger.sendCommand("Emulation.clearGeolocationOverride")).pipe(
        Effect.ignore,
      );
    this.#releaseIdleDebugger();
  });

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
              yield* this.#applyEnvironmentEffect(send, this.#appliedEnvironment(environment) ?? environment);
            }).pipe(
              Effect.catch((operationFailure) =>
                Effect.gen({ self: this }, function* () {
                  const error = operationFailure.cause;
                  const previous = this.#appliedEnvironment(previousEnvironment);
                  if (previous) yield* this.#applyEnvironmentEffect(send, previous);
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
          this.#releaseIdleDebugger();
          return yield* browserFailure(error);
        }),
      ),
    );
  });

  readonly screenshot = Effect.fn("BrowserCdp.screenshot")(function* (
    this: BrowserCdpEngine,
    target?: BrowserTarget,
    deadline?: number,
    cssPixels = false,
  ): Effect.fn.Return<NativeImage, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const clip = target ? yield* this.#elementClipEffect(send, target, deadline) : undefined;
        const environment = this.#appliedEnvironment(this.#environment);
        const fill = !environment || environment.viewport.mode === "fill";
        let cssSize: { width: number; height: number } | undefined;
        if (fill || (cssPixels && !clip)) {
          const contextId = yield* automationContextId(send);
          const result = yield* send("Runtime.evaluate", {
            expression: "({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })",
            contextId,
            returnByValue: true,
          });
          const viewport = recordValue(recordValue(result.result)?.value);
          cssSize = { width: numberValue(viewport?.width), height: numberValue(viewport?.height) };
          if (fill) {
            yield* send("Emulation.setDeviceMetricsOverride", {
              ...cssSize,
              deviceScaleFactor: numberValue(viewport?.scale),
              mobile: false,
            });
          }
        }
        if (clip) {
          const zoom = this.#contents.getZoomFactor();
          cssSize = { width: Math.round(clip.width / zoom), height: Math.round(clip.height / zoom) };
        }
        return yield* Effect.gen({ self: this }, function* () {
          const image = yield* browserCall(() => this.#contents.capturePage(clip));
          if (!cssPixels || !cssSize || cssSize.width < 1 || cssSize.height < 1) return image;
          const size = image.getSize();
          if (size.width <= cssSize.width && size.height <= cssSize.height) return image;
          return image.resize({ ...cssSize, quality: "good" });
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
    const viewport = options.viewport ? { ...options.viewport } : null;
    if (viewport) this.#viewViewports.push(viewport);
    let viewportHeld = viewport !== null;
    const releaseViewport = () => {
      if (!viewportHeld || !viewport) return false;
      viewportHeld = false;
      this.#viewViewports.splice(this.#viewViewports.indexOf(viewport), 1);
      return true;
    };
    let watchesDialogs = options.watchDialogs === true;
    if (watchesDialogs) this.#viewDialogWatches += 1;
    const releaseDialogWatch = () => {
      if (!watchesDialogs) return;
      watchesDialogs = false;
      this.#viewDialogWatches -= 1;
    };
    let sequence = 0;
    const pacer = createFramePacer<Omit<BrowserScreencastFrame, "sequence">>((frame) => {
      sequence += 1;
      onFrame({ ...frame, sequence });
    });
    const listener = (_event: unknown, method: string, params?: DynamicRecord | unknown, sessionId?: string): void => {
      if (method !== "Page.screencastFrame" || !isDynamicRecord(params)) return;
      const metadata = recordValue(params.metadata);
      const data = stringValue(params.data);
      const frameSessionId = numberValue(params.sessionId);
      void this.#contents.debugger
        .sendCommand("Page.screencastFrameAck", { sessionId: frameSessionId }, sessionId || undefined)
        .catch(() => undefined);
      if (!data) return;
      pacer.offer({
        image: Buffer.from(data, "base64"),
        width: Math.max(1, Math.round(numberValue(metadata?.deviceWidth))),
        height: Math.max(1, Math.round(numberValue(metadata?.deviceHeight))),
      });
    };
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
                    const ended = Effect.raceFirst(Deferred.await(stopped), Deferred.await(detached));
                    const onPageCopy = options.onPageCopy;
                    yield* onPageCopy ? Effect.raceFirst(ended, pageCopies(send, onPageCopy)) : ended;
                  }).pipe(
                    Effect.ensuring(
                      Effect.gen({ self: this }, function* () {
                        this.#contents.debugger.off("message", listener);
                        this.#contents.debugger.off("detach", onDetach);
                        if (!stopRequested) return;
                        yield* send("Page.stopScreencast").pipe(Effect.ignore);
                        if (!releaseViewport()) return;
                        const environment = this.#appliedEnvironment(this.#environment);
                        yield* (
                          environment
                            ? this.#applyEnvironmentEffect(send, environment)
                            : this.#clearEnvironmentEffect(send)
                        ).pipe(Effect.ignore);
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
              releaseViewport();
              releaseDialogWatch();
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
          if (input.type === "paste") {
            const world = yield* this.#focusedWorld(send);
            const result = yield* send(
              "Runtime.evaluate",
              {
                expression: `(${PASTE_EVENT_SCRIPT})(${JSON.stringify(input.text)})`,
                contextId: world.contextId,
                returnByValue: true,
              },
              world.sessionId,
            );
            if (recordValue(result.result)?.value !== false) yield* send("Input.insertText", { text: input.text });
            return;
          }
          if (input.type === "cut") {
            const world = yield* this.#focusedWorld(send);
            yield* send(
              "Runtime.evaluate",
              {
                expression: `(${CUT_SCRIPT})(${JSON.stringify(input.text)})`,
                contextId: world.contextId,
                returnByValue: true,
              },
              world.sessionId,
            );
            return;
          }
          if (input.type === "key") {
            if (input.action === "char") {
              yield* send("Input.dispatchKeyEvent", {
                type: "char",
                modifiers: input.modifiers,
                key: input.key,
                code: input.code,
                text: input.text,
              });
              return;
            }
            const { text, ...keyCodes } = namedKey(input.key);
            const unmodified = (input.modifiers & ~SHIFT_MODIFIER) === 0;
            const character = input.action === "down" && unmodified ? text : undefined;
            const printableCode =
              (unmodified || input.action === "up") && keyCodes.windowsVirtualKeyCode === undefined
                ? printableKeyCode(input.key, input.code)
                : undefined;
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
              ...(printableCode === undefined ? {} : { windowsVirtualKeyCode: printableCode }),
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
          const held = this.#viewButton;
          this.#pointer = { point: { x: input.x, y: input.y }, sessionId: undefined };
          if (input.action === "down") this.#viewButton = input.button;
          if (input.action === "up") this.#viewButton = null;
          if (input.action === "down") this.#viewPress = { x: input.x, y: input.y };
          yield* send("Input.dispatchMouseEvent", {
            type: input.action === "move" ? "mouseMoved" : input.action === "down" ? "mousePressed" : "mouseReleased",
            x: input.x,
            y: input.y,
            button: input.action === "move" ? (held ?? "none") : input.button,
            buttons:
              input.action === "down"
                ? buttonMask(input.button)
                : input.action === "move" && held
                  ? buttonMask(held)
                  : 0,
            clickCount: input.action === "move" ? 0 : input.clickCount,
            modifiers: input.modifiers,
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                this.#viewPress = null;
              }),
            ),
          );
        }),
      input.type === "paste" || input.type === "cut",
    );
  });

  viewPress(): PointerPoint | null {
    return this.#viewPress;
  }

  readonly viewportSelectionText = Effect.fn("BrowserCdp.viewportSelectionText")(function* (
    this: BrowserCdpEngine,
    max: number,
  ): Effect.fn.Return<string | null, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        const world = yield* this.#focusedWorld(send);
        const result = yield* send(
          "Runtime.evaluate",
          { expression: `(${SELECTION_TEXT_SCRIPT})(${max})`, contextId: world.contextId, returnByValue: true },
          world.sessionId,
        );
        const value = recordValue(result.result)?.value;
        return value === null ? null : stringValue(value);
      }),
    );
  });

  readonly clickTargetAt = Effect.fn("BrowserCdp.clickTargetAt")(function* (
    this: BrowserCdpEngine,
    x: number,
    y: number,
    inPage: boolean,
  ) {
    const read = this.#leaseEffect((send) =>
      readClickTarget(send, (frameId) => this.#targetSessions.get(frameId)?.sessionId, x, y, inPage),
    );
    const target = yield* read.pipe(
      Effect.timeoutOption(CLICK_READ_TIMEOUT_MS),
      Effect.catch(() => Effect.succeed(Option.none())),
    );
    return Option.getOrNull(target);
  });

  readonly #focusedWorld = Effect.fn("BrowserCdp.focusedWorld")(function* (this: BrowserCdpEngine, send: SendCommand) {
    let sessionId: string | undefined;
    let contextId = yield* automationContextId(send);
    for (let depth = 0; depth < MAX_FOCUSED_FRAME_DEPTH; depth += 1) {
      const probe = yield* send(
        "Runtime.evaluate",
        { expression: FOCUSED_FRAME_SCRIPT, contextId, returnByValue: false },
        sessionId,
      );
      const objectId = stringValue(recordValue(probe.result)?.objectId);
      if (!objectId) break;
      const described = yield* send("DOM.describeNode", { objectId }, sessionId);
      yield* send("Runtime.releaseObject", { objectId }, sessionId).pipe(Effect.ignore);
      const frameId = stringValue(recordValue(described.node)?.frameId);
      if (!frameId) break;
      const target = this.#targetSessions.get(frameId);
      if (target) {
        sessionId = target.sessionId;
        contextId = yield* automationContextId(send, sessionId);
      } else {
        contextId = yield* frameAutomationContextId(send, frameId, sessionId);
      }
    }
    return { contextId, sessionId };
  });

  readonly #nodeFrameWorld = Effect.fn("BrowserCdp.nodeFrameWorld")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId: string | undefined,
    frames: string[],
  ) {
    for (const frameId of frames) {
      const contextId = yield* frameAutomationContextId(send, frameId, sessionId).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (contextId === undefined) continue;
      const own = yield* this.#callOnNode(
        send,
        backendNodeId,
        "function() { return this.ownerDocument === document; }",
        [],
        sessionId,
        contextId,
      ).pipe(Effect.catch(() => Effect.succeed(false)));
      if (own === true) return { frameId, contextId };
    }
    return undefined;
  });

  readonly #hiddenPasswordOf = Effect.fn("BrowserCdp.hiddenPasswordOf")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    node: { backendNodeId: number; sessionId: string | undefined; contextId: number },
  ) {
    const resolved = yield* send(
      "DOM.resolveNode",
      { backendNodeId: node.backendNodeId, executionContextId: node.contextId },
      node.sessionId,
    );
    const objectId = stringValue(recordValue(resolved.object)?.objectId);
    if (!objectId) return undefined;
    return yield* Effect.gen(function* () {
      const result = yield* send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: `function() {
            const shown = (element) => element.checkVisibility({ visibilityProperty: true });
            if (this.localName !== 'input' || this.type !== 'text' || !shown(this)) return null;
            const passwords = [...(this.form?.elements ?? [])].filter((element) => element.localName === 'input' && element.type === 'password');
            const [password] = passwords;
            return passwords.length === 1 && !shown(password) && !password.disabled && !password.readOnly ? password : null;
          }`,
          returnByValue: false,
        },
        node.sessionId,
      );
      const found = stringValue(recordValue(result.result)?.objectId);
      if (recordValue(result.exceptionDetails) || !found) return undefined;
      const described = yield* send("DOM.describeNode", { objectId: found }, node.sessionId).pipe(
        Effect.ensuring(send("Runtime.releaseObject", { objectId: found }, node.sessionId).pipe(Effect.ignore)),
      );
      const backendNodeId = numberValue(recordValue(described.node)?.backendNodeId);
      return backendNodeId ? { backendNodeId, sessionId: node.sessionId, contextId: node.contextId } : undefined;
    }).pipe(Effect.ensuring(send("Runtime.releaseObject", { objectId }, node.sessionId).pipe(Effect.ignore)));
  });

  readonly #nodeFrameContextId = Effect.fn("BrowserCdp.nodeFrameContextId")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId: string | undefined,
  ) {
    const frames = frameIds(yield* send("Page.getFrameTree", {}, sessionId));
    return (yield* this.#nodeFrameWorld(send, backendNodeId, sessionId, frames))?.contextId;
  });

  readonly #focusChain = Effect.fn("BrowserCdp.focusChain")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId: string | undefined,
  ) {
    const chain: Array<{ backendNodeId: number; sessionId: string | undefined; contextId: number }> = [];
    let node = { backendNodeId, sessionId };
    for (let depth = 0; depth <= MAX_FOCUSED_FRAME_DEPTH; depth += 1) {
      const frames = frameIds(yield* send("Page.getFrameTree", {}, node.sessionId));
      const world = yield* this.#nodeFrameWorld(send, node.backendNodeId, node.sessionId, frames);
      if (!world) break;
      const { frameId } = world;
      chain.push({ ...node, contextId: world.contextId });
      if (frameId === frames[0] && node.sessionId === undefined) return chain;
      const owners =
        frameId === frames[0]
          ? [undefined, ...[...this.#targetSessions.values()].map((target) => target.sessionId)].filter(
              (candidate) => candidate !== node.sessionId,
            )
          : [node.sessionId];
      let owner: typeof node | undefined;
      for (const ownerSession of owners) {
        const found = yield* send("DOM.getFrameOwner", { frameId }, ownerSession).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );
        const ownerId = numberValue(found?.backendNodeId);
        if (ownerId) {
          owner = { backendNodeId: ownerId, sessionId: ownerSession };
          break;
        }
      }
      if (!owner) break;
      node = owner;
    }
    return yield* browserFailure(new Error(sourceText("error.backend.browserTypingFocusMoved")));
  });

  releaseViewButton(): void {
    this.#viewButton = null;
  }

  #pointerIn(sessionId: string | undefined): PointerPoint | undefined {
    const pointer = this.#pointer;
    return pointer && pointer.sessionId === sessionId ? pointer.point : undefined;
  }

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
    this.#location = null;
    this.#locationApplied = false;
    clearImmediate(this.#idleDetach);
    this.#idleDetach = undefined;
    this.#detachOwnedDebugger();
    if (this.#dialogBoxPending) this.#cancelDialogBox = true;
    this.#contents.emit(CANCEL_DIALOGS_EVENT);
    this.#targetSessions.clear();
    this.#targets.clear();
    this.#lastSnapshot = null;
    this.#highlightSessionId = undefined;
    this.#uploadDocumentIds.clear();
  });

  readonly waitFor = Effect.fn("BrowserCdp.waitFor")(function* (
    this: BrowserCdpEngine,
    condition: {
      target?: BrowserTarget | undefined;
      text?: string | undefined;
      url?: string | undefined;
      state?: string | undefined;
    },
    timeoutMs = WAIT_TIMEOUT_MS,
  ): Effect.fn.Return<void, BrowserOperationError> {
    if (this.#namesCardValue(condition.text, condition.url))
      return yield* browserFailure(new Error("A wait cannot name a filled card value."));
    if (this.#cardScrub.documentSecretShown && (condition.text || condition.url))
      return yield* browserFailure(
        new Error(
          "A wait cannot check page text or the address while the page can show a password or code that OpenBot typed. Use snapshots until it navigates.",
        ),
      );
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
            const target =
              condition.target &&
              (condition.target.kind === "css" || condition.target.kind === "role" || condition.target.kind === "text")
                ? { ...condition.target, nth: condition.target.nth ?? 0 }
                : condition.target;
            if (target) {
              yield* Effect.gen({ self: this }, function* () {
                yield* this.#resolveTargetEffect(send, target, deadline, true, false);
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
    undefinedAsNull = false,
    maxBytes = MAX_RESULT_BYTES,
  ): Effect.fn.Return<BrowserJsonValue, BrowserOperationError> {
    return yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
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
        if (undefinedAsNull && remoteObject?.type === "undefined") return null;
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
        if (bytes > maxBytes) {
          return yield* browserFailure(
            new Error(
              `Browser evaluation result exceeds ${Math.round(maxBytes / 1024)} KB (${bytes} bytes). ${BROWSER_VALUE_TOO_LARGE}`,
            ),
          );
        }
        const jsonValue: BrowserJsonValue = yield* browserSync(() => JSON.parse(serialized));
        return jsonValue;
      }),
    );
  });

  readonly settle = Effect.fn("BrowserCdp.settle")(function* (
    this: BrowserCdpEngine,
    timeoutMs = ACTION_TIMEOUT_MS,
  ): Effect.fn.Return<void, BrowserOperationError> {
    const deadline = Date.now() + timeoutMs;
    yield* this.#leaseEffect((send) =>
      Effect.gen({ self: this }, function* () {
        while (true) {
          const navigationGeneration = this.#navigationGeneration;
          if (this.#contents.isLoading()) yield* waitForLoading(this.#contents, Math.max(1, deadline - Date.now()));
          const quiet = yield* waitForDomQuietAcrossTargets(
            send,
            this.#snapshotTargets(),
            Math.min(deadline - Date.now(), 1_500),
          ).pipe(
            Effect.as(true),
            Effect.catch((failure) =>
              browserSync(() => {
                const error = failure.cause;
                if (error instanceof Error && error.message === "DOM did not become quiet.") return true;
                if (navigationGeneration !== this.#navigationGeneration || this.#contents.isLoading()) return false;
                throw error;
              }),
            ),
          );
          const navigating = yield* browserSync(
            () => navigationGeneration !== this.#navigationGeneration && this.#contents.isLoading(),
          );
          if (Date.now() >= deadline || (quiet && !navigating)) return;
        }
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
  ): Effect.fn.Return<{ backendNodeId: number; sessionId?: string | undefined }, BrowserOperationError> {
    const resolved = yield* this.#resolveTargetEffect(send, target, deadline);
    if (!resolved.backendNodeId)
      return yield* browserFailure(new Error("This operation requires an element target, not coordinates."));
    return {
      backendNodeId: resolved.backendNodeId,
      ...(resolved.sessionId === undefined ? {} : { sessionId: resolved.sessionId }),
    };
  });

  readonly #resolveTargetEffect = Effect.fn("BrowserCdp.resolveTarget")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    target: BrowserTarget,
    deadline?: number,
    allowNonActionableRole = false,
    describeAmbiguity = true,
  ): Effect.fn.Return<
    { backendNodeId?: number; sessionId?: string | undefined; x: number; y: number },
    BrowserOperationError
  > {
    if (
      this.#namesCardValue(
        target.kind === "role" ? target.name : undefined,
        target.kind === "text" ? target.text : undefined,
        target.kind === "css" ? target.selector : undefined,
      )
    )
      return yield* browserFailure(new Error("A target cannot name a filled card value."));
    if (
      this.#cardScrub.documentSecretShown &&
      (target.kind === "text" || target.kind === "css" || (target.kind === "role" && target.name !== undefined))
    )
      return yield* browserFailure(
        new Error(
          "While the page can show a password or code that OpenBot typed, use a ref from a fresh snapshot as the target until it navigates.",
        ),
      );
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
      const sessionId = record?.targetId ? this.#targetSessions.get(record.targetId)?.sessionId : undefined;
      if (!record || (record.targetId && sessionId === undefined))
        return yield* browserFailure(new Error("Element reference is no longer available. Take a fresh snapshot."));
      if (deadline !== undefined) {
        yield* browserSync(() => assertBeforeDeadline(deadline));
        const contextId = record.ownFrame
          ? yield* this.#nodeFrameContextId(send, record.backendNodeId, sessionId).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
          : undefined;
        const current =
          record.ownFrame && contextId === undefined
            ? null
            : yield* this.#targetFingerprint(send, record.backendNodeId, sessionId, record.drawnOnly, contextId).pipe(
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
        ...(sessionId === undefined ? {} : { sessionId }),
        x: 0,
        y: 0,
      };
    }
    const limit = target.nth === undefined ? MAX_TARGET_CANDIDATES : target.nth + 1;
    if (target.kind === "css") {
      const matches: Array<{ objectId: string; sessionId?: string | undefined; targetId?: string | undefined }> = [];
      const releaseMatches = () =>
        Effect.all(
          matches.map((match) =>
            Effect.exit(send("Runtime.releaseObject", { objectId: match.objectId }, match.sessionId)),
          ),
          { concurrency: "unbounded" },
        );
      yield* Effect.gen({ self: this }, function* () {
        for (const capture of this.#snapshotTargets(Number.POSITIVE_INFINITY)) {
          const found = yield* cssObjectMatch(send, target.selector, capture.sessionId, limit).pipe(
            skipGoneFrame(capture.sessionId, []),
          );
          for (const objectId of found) {
            matches.push({
              objectId,
              ...(capture.sessionId === undefined ? {} : { sessionId: capture.sessionId }),
              ...(capture.targetId === undefined ? {} : { targetId: capture.targetId }),
            });
          }
          if (matches.length >= limit) break;
        }
      }).pipe(
        Effect.catch((operationFailure) =>
          Effect.gen(function* () {
            yield* releaseMatches();
            return yield* browserFailure(operationFailure.cause);
          }),
        ),
      );
      if (target.nth !== undefined) {
        const chosen = matches[target.nth];
        const others = matches.filter((match) => match !== chosen);
        yield* Effect.all(
          others.map((match) =>
            Effect.exit(send("Runtime.releaseObject", { objectId: match.objectId }, match.sessionId)),
          ),
          { concurrency: "unbounded" },
        );
        matches.splice(0, matches.length, ...(chosen ? [chosen] : []));
        if (!chosen && others.length) return yield* browserFailure(new Error(nthMissing(target, others.length)));
      }
      if (matches.length > 1) {
        const summary = `CSS selector is ambiguous (at least ${Math.min(matches.length, MAX_TARGET_CANDIDATES)} matches): ${target.selector}`;
        if (!describeAmbiguity) {
          yield* releaseMatches();
          return yield* browserFailure(new Error(summary));
        }
        const described = yield* Effect.forEach(matches.slice(0, MAX_TARGET_CANDIDATES), (match) =>
          describedMatch(send, match.objectId, match, "").pipe(Effect.catch(() => Effect.succeed(undefined))),
        ).pipe(Effect.ensuring(releaseMatches()));
        const kept = described.flatMap((candidate, index) => (candidate ? [{ candidate, index }] : []));
        return yield* this.#ambiguousTarget(
          send,
          summary,
          kept.map(({ candidate }) => candidate),
          deadline,
          kept.map(({ index }) => index),
        );
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
          ...(match.sessionId === undefined ? {} : { sessionId: match.sessionId }),
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
      for (const candidate of yield* semanticAxMatches(
        send,
        capture,
        target,
        allowNonActionableRole,
        deadline,
        limit,
      ).pipe(skipGoneFrame(capture.sessionId, []))) {
        const key = `${capture.targetId ?? "main"}:${candidate.backendNodeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
      if (target.kind === "text") {
        const objectIds = yield* visibleTextObjectMatches(send, capture, target, deadline, limit).pipe(
          skipGoneFrame(capture.sessionId, []),
        );
        yield* Effect.gen({ self: this }, function* () {
          for (const objectId of objectIds) {
            const candidate = yield* describedMatch(send, objectId, capture, target.text).pipe(
              skipGoneFrame(capture.sessionId, undefined),
            );
            if (!candidate) continue;
            const key = `${capture.targetId ?? "main"}:${candidate.backendNodeId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push(candidate);
            if (candidates.length >= limit) break;
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
      if (candidates.length >= limit) break;
    }
    if (navigationGeneration !== this.#navigationGeneration) {
      return yield* browserFailure(
        new Error("Page navigated during semantic target collection. Take a fresh snapshot."),
      );
    }
    if (target.nth !== undefined) {
      const chosen = candidates[target.nth];
      if (!chosen) {
        return yield* browserFailure(
          new Error(
            candidates.length
              ? nthMissing(target, candidates.length)
              : `No element matches ${describeBrowserTarget(target)}.`,
          ),
        );
      }
      candidates.splice(0, candidates.length, chosen);
    }
    const [found] = candidates;
    if (!found) return yield* browserFailure(new Error(`No element matches ${describeBrowserTarget(target)}.`));
    if (candidates.length > 1) {
      const summary = `Target is ambiguous (at least ${candidates.length} matches): ${describeBrowserTarget(target)}`;
      if (!describeAmbiguity) return yield* browserFailure(new Error(summary));
      return yield* this.#ambiguousTarget(send, summary, candidates, deadline);
    }
    return {
      backendNodeId: found.backendNodeId,
      ...(found.sessionId === undefined ? {} : { sessionId: found.sessionId }),
      x: 0,
      y: 0,
    };
  });

  readonly #ambiguousTarget = Effect.fn("BrowserCdp.ambiguousTarget")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    summary: string,
    candidates: readonly SemanticMatch[],
    deadline?: number,
    positions?: readonly number[],
  ): Effect.fn.Return<never, BrowserOperationError> {
    const key = (candidate: SemanticMatch) => `${candidate.targetId ?? "main"}:${candidate.backendNodeId}`;
    const texts = new Map<string, TargetCandidateText>();
    for (const sessionId of new Set(candidates.map((candidate) => candidate.sessionId))) {
      if (deadline !== undefined && Date.now() >= deadline) break;
      const own = candidates.filter((candidate) => candidate.sessionId === sessionId);
      const described = yield* describeTargetCandidates(
        send,
        sessionId,
        own.map((candidate) => candidate.backendNodeId),
      ).pipe(Effect.catch(() => Effect.succeed([])));
      own.forEach((candidate, index) => {
        const text = described[index];
        if (text) texts.set(key(candidate), text);
      });
    }
    const labels = candidates.map((candidate) => candidate.name.slice(0, 120) || texts.get(key(candidate))?.text || "");
    const revision = this.#lastSnapshot?.revision;
    let missingRef = false;
    const lines = candidates.map((candidate, index) => {
      const text = texts.get(key(candidate));
      const label = labels[index] ?? "";
      const ref = revision === undefined ? undefined : `${revision}:${key(candidate)}`;
      const tokens = [`${(positions?.[index] ?? index) + 1}.`];
      if (ref !== undefined && this.#targets.has(ref)) tokens.push(`ref=${ref}`);
      else missingRef = true;
      if (candidate.role) tokens.push(candidate.role);
      else if (text?.tag) tokens.push(`<${text.tag}>`);
      tokens.push(JSON.stringify(label));
      const shared = !label || labels.filter((other) => other === label).length > 1;
      if (shared && text?.item && text.item !== label) tokens.push(`in ${JSON.stringify(text.item)}`);
      return tokens.join(" ");
    });
    const message = [
      `${summary}. No input was sent. Candidates:`,
      ...lines,
      "Act on the ref of the intended item, add nth (0 for candidate 1) to the target, or use a target that matches only that item." +
        (missingRef ? " Take a fresh snapshot to get a ref for a candidate that has none." : "") +
        " If the task does not say which item, ask the user.",
    ].join("\n");
    return yield* browserFailure(new Error(this.#cardScrub.text(message)));
  });

  readonly #targetFingerprint = Effect.fn("BrowserCdp.targetFingerprint")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    sessionId?: string,
    drawnOnly = false,
    contextId?: number,
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
          String.raw`function(drawnOnly) {
          if (this.nodeType !== 1 || !this.isConnected || this.getClientRects().length === 0) return null;
          let element = this;
          while (element) {
            if (Element.prototype.hasAttribute.call(element, 'hidden') || Element.prototype.hasAttribute.call(element, 'inert') || (!drawnOnly && String(element.getAttribute('aria-hidden')).toLowerCase() === 'true')) return null;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || (!drawnOnly && style.opacity === '0')) return null;
            const parent = element.parentElement;
            if (parent) element = parent;
            else {
              const root = element.getRootNode();
              element = root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? root.host : null;
            }
          }
          return { visibleText: String(this.innerText ?? this.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
        }`,
          [drawnOnly],
          sessionId,
          contextId,
        ),
      ],
      { concurrency: "unbounded" },
    );
    const node = recordValue(description.node);
    const axNodes = Array.isArray(partialAxTree.nodes) ? partialAxTree.nodes.filter(isRecord) : [];
    const ax = axNodes.find((candidate) => numberValue(candidate.backendDOMNodeId) === backendNodeId) ?? axNodes[0];
    const state = recordValue(pageState);
    const visibleText = stringValue(state?.visibleText);
    const identity = drawnOnly
      ? controlIdentity(node ?? {}, ax, visibleText)
      : {
          role: ax ? axValue(ax.role).toLowerCase() || fallbackRole(node ?? {}) : fallbackRole(node ?? {}),
          name: ax ? axValue(ax.name).slice(0, 500) : "",
        };
    return {
      ...identity,
      tag: (stringValue(node?.localName) || stringValue(node?.nodeName)).toLowerCase(),
      visibleText,
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
  ): Effect.fn.Return<{ x: number; y: number; sessionId?: string | undefined }, BrowserOperationError> {
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
  ): Effect.fn.Return<{ x: number; y: number; sessionId?: string | undefined }, BrowserOperationError> {
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
    const session = sessionId === undefined ? {} : { sessionId };
    if (!hitTest) return { ...center, ...session };
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
        {
          x: Math.round(point.x + numberValue(viewport?.pageX)),
          y: Math.round(point.y + numberValue(viewport?.pageY)),
          includeUserAgentShadowDOM: true,
        },
        sessionId,
      );
      const hitId = numberValue(hit.backendNodeId);
      if (hitId && (yield* hitActivatesTarget(send, hitId, backendNodeId, sessionId))) {
        return { ...point, ...session };
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

  readonly #elementClipEffect = Effect.fn("BrowserCdp.elementClip")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    target: BrowserTarget,
    deadline?: number,
  ): Effect.fn.Return<Electron.Rectangle, BrowserOperationError> {
    const resolved = yield* this.#resolveElementEffect(send, target, deadline);
    if (resolved.sessionId !== undefined)
      return yield* browserFailure(
        new Error("This element is in a frame that the image cannot clip. Call screenshot without a target."),
      );
    const { backendNodeId } = resolved;
    yield* send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const box = yield* send("DOM.getBoxModel", { backendNodeId });
    const quad = recordValue(box.model)?.border;
    const corners = Array.isArray(quad) ? quad.filter(isFiniteNumber).slice(0, 8) : [];
    const metrics = yield* send("Page.getLayoutMetrics", {});
    const viewport = recordValue(metrics.cssLayoutViewport);
    const xs = corners.filter((_, index) => index % 2 === 0);
    const ys = corners.filter((_, index) => index % 2 === 1);
    const margin = 8;
    const left = Math.max(0, Math.min(...xs) - margin);
    const top = Math.max(0, Math.min(...ys) - margin);
    const right = Math.min(numberValue(viewport?.clientWidth), Math.max(...xs) + margin);
    const bottom = Math.min(numberValue(viewport?.clientHeight), Math.max(...ys) + margin);
    if (corners.length < 8 || right - left < 1 || bottom - top < 1)
      return yield* browserFailure(new Error("Element has no visible bounds."));
    const zoom = this.#contents.getZoomFactor();
    return {
      x: Math.floor(left * zoom),
      y: Math.floor(top * zoom),
      width: Math.ceil((right - left) * zoom),
      height: Math.ceil((bottom - top) * zoom),
    };
  });

  readonly #callOnNode = Effect.fn("BrowserCdp.callOnNode")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    backendNodeId: number,
    declaration: string,
    args: unknown[],
    sessionId?: string,
    contextId?: number,
  ): Effect.fn.Return<unknown, BrowserOperationError> {
    const executionContextId = contextId ?? (yield* automationContextId(send, sessionId));
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

  readonly #replacementSelectEffect = Effect.fn("BrowserCdp.replacementSelect")(function* (
    this: BrowserCdpEngine,
    send: SendCommand,
    labels: string[],
    x: number,
    y: number,
    sessionId?: string,
  ): Effect.fn.Return<number | null, BrowserOperationError> {
    const executionContextId = yield* automationContextId(send, sessionId);
    const found = yield* send(
      "Runtime.callFunctionOn",
      {
        executionContextId,
        functionDeclaration: `function(labels, x, y) {
          const candidates = Array.from(document.querySelectorAll('select')).filter(select =>
            !select.multiple && select.options.length === labels.length &&
            Array.from(select.options).every((option, index) => (option.label || option.text) === labels[index]));
          return candidates.find(select => {
            const box = select.getBoundingClientRect();
            return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
          }) ?? null;
        }`,
        arguments: [{ value: labels }, { value: x }, { value: y }],
        returnByValue: false,
      },
      sessionId,
    );
    const objectId = stringValue(recordValue(found.result)?.objectId);
    if (!objectId) return null;
    return yield* Effect.gen(function* () {
      const described = yield* send("DOM.describeNode", { objectId, depth: 0 }, sessionId);
      return numberValue(recordValue(described.node)?.backendNodeId) || null;
    }).pipe(Effect.ensuring(send("Runtime.releaseObject", { objectId }, sessionId).pipe(Effect.ignore)));
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
    if (this.#contents.isCrashed())
      return yield* browserFailure(new Error("The page of this browser tab stopped. Load it again with navigate."));
    if (!this.#contents.debugger.isAttached()) {
      yield* browserSync(() => this.#contents.debugger.attach("1.3"));
      this.#ownsDebugger = true;
    }
    this.#activeLeases += 1;
    let accessibilitySessions: Set<string | undefined> | undefined;
    const send: SendCommand = (method, params = {}, sessionId) =>
      Effect.gen({ self: this }, function* () {
        if (method.startsWith("Accessibility.")) {
          accessibilitySessions ??= new Set();
          accessibilitySessions.add(sessionId);
        }
        const result = yield* browserCall(() => this.#contents.debugger.sendCommand(method, params, sessionId)).pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => {
              if (sessionId !== undefined && isSessionGone(failure)) this.#forgetTargetSession(sessionId);
            }),
          ),
        );
        if (!isDynamicRecord(result))
          return yield* browserFailure(new Error(`CDP ${method} returned an invalid result.`));
        return result;
      });
    return yield* Effect.gen({ self: this }, function* () {
      if ((this.#dialogWatches.size > 0 || this.#viewDialogWatches > 0) && this.#ownsDebugger && !this.#pageEnabled) {
        yield* send("Page.enable");
        this.#pageEnabled = true;
      }
      yield* send("Emulation.setFocusEmulationEnabled", { enabled: true });
      if (attachFrames) {
        yield* send("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }],
        }).pipe(Effect.ignore);
      }
      const environment = this.#appliedEnvironment(this.#environment);
      if (environment) yield* this.#applyEnvironmentEffect(send, environment);
      if (this.#location && !this.#locationApplied) {
        yield* send("Emulation.setGeolocationOverride", {
          latitude: this.#location.latitude,
          longitude: this.#location.longitude,
          accuracy: this.#location.accuracyMeters ?? BROWSER_LOCATION_DEFAULT_ACCURACY,
        });
        this.#locationApplied = true;
      }
      return yield* operation(send);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (!accessibilitySessions) return;
          for (const sessionId of accessibilitySessions)
            yield* send("Accessibility.disable", {}, sessionId).pipe(Effect.ignore);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#activeLeases -= 1;
          this.#releaseIdleDebugger();
          this.#restoreIdleFocus();
        }),
      ),
    );
  });

  #restoreIdleFocus(): void {
    if (!this.#idleFocusOff || this.#activeLeases > 0) return;
    setImmediate(() => {
      if (!this.#idleFocusOff || !this.#mayEmulateIdleFocus()) return;
      void this.#contents.debugger
        .sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false })
        .catch(() => {});
    });
  }

  #mayEmulateIdleFocus(): boolean {
    if (!this.#ownsDebugger || this.#activeLeases > 0 || this.#disposed || this.#closing) return false;
    return !this.#contents.isDestroyed() && this.#contents.debugger.isAttached();
  }

  #detachOwnedDebugger(): void {
    if (!this.#ownsDebugger) return;
    this.#ownsDebugger = false;
    this.#clearDebuggerSessions();
    if (this.#closing || this.#contents.isDestroyed() || !this.#contents.debugger.isAttached()) return;
    this.#contents.debugger.detach();
  }

  #clearDebuggerSessions(): void {
    this.#locationApplied = false;
    this.#targetSessions.clear();
    this.#highlightSessionId = undefined;
    this.#pageEnabled = false;
    if (this.#dialog) {
      this.#dialog = undefined;
      this.#signalDialogChange();
    }
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

  #appliedEnvironment(environment: BrowserEnvironment | null): BrowserEnvironment | null {
    const viewport = this.#viewViewports.at(-1);
    if (!viewport || environment?.viewport.mode === "custom") return environment;
    return {
      colorScheme: environment?.colorScheme ?? "system",
      reducedMotion: environment?.reducedMotion ?? false,
      viewport: { mode: "custom", width: viewport.width, height: viewport.height, deviceScaleFactor: 0, preset: null },
    };
  }
}

function nthMissing(target: BrowserTarget, matches: number): string {
  return `${describeBrowserTarget(target)} has no match at that index: it matches ${matches} element${matches === 1 ? "" : "s"}, and nth counts from 0.`;
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

const describedMatch = Effect.fn("Browser.describedMatch")(function* (
  send: SendCommand,
  objectId: string,
  location: { sessionId?: string | undefined; targetId?: string | undefined },
  name: string,
) {
  const described = yield* send("DOM.describeNode", { objectId, depth: 0 }, location.sessionId);
  const node = recordValue(described.node);
  const backendNodeId = numberValue(node?.backendNodeId);
  if (!backendNodeId) return undefined;
  return {
    backendNodeId,
    ...(location.sessionId === undefined ? {} : { sessionId: location.sessionId }),
    ...(location.targetId === undefined ? {} : { targetId: location.targetId }),
    role: fallbackRole(node ?? {}),
    name,
  } satisfies SemanticMatch;
});

const hitActivatesTarget = Effect.fn("Browser.hitActivatesTarget")(function* (
  send: SendCommand,
  candidate: number,
  target: number,
  sessionId?: string,
) {
  if (candidate === target) return true;
  const executionContextId = yield* automationContextId(send, sessionId);
  const objectIds: string[] = [];
  return yield* Effect.gen(function* () {
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
          const start = candidate instanceof CSSPseudoElement ? candidate.element : candidate;
          for (let node = start; node; node = node.assignedSlot || node.parentNode || node.host) {
            if (node === this) return true;
            if (node.localName === 'label' && node.control === this) return true;
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
      }).pipe(
        skipGoneFrame(capture.sessionId, { result: { type: "boolean", value: true } }),
        Effect.timeoutOrElse({
          duration: deadlineMs,
          orElse: () => Effect.succeed({ result: { type: "boolean", value: false } }),
        }),
      ),
    ),
    { concurrency: "unbounded" },
  );
  if (results.some((result) => recordValue(result.result)?.value !== true)) {
    return yield* browserFailure(new Error("DOM did not become quiet."));
  }
});

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
