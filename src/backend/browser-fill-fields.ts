import { Effect, Schema } from "effect";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";

export const BROWSER_FILL_FIELDS_MAX_FIELDS = 16;
export const BROWSER_FILL_FIELDS_MAX_TEXT_BYTES = 16 * 1024;
export const BROWSER_FILL_FIELDS_MAX_TIMEOUT_MS = 30_000;

export type BrowserFillFieldsReason =
  | "invalid_target"
  | "stale_snapshot"
  | "target_changed"
  | "document_changed"
  | "policy_changed"
  | "deadline"
  | "input_failed"
  | "snapshot_failed"
  | "tab_closed";

export class BrowserFillFieldsFailure extends Schema.TaggedError<BrowserFillFieldsFailure>()(
  "BrowserFillFieldsFailure",
  {
    reason: Schema.Literals([
      "invalid_target",
      "stale_snapshot",
      "target_changed",
      "document_changed",
      "policy_changed",
      "deadline",
    ]),
  },
) {}

/** Contains indices only. It never retains field text, page errors, or credentials. */
export interface BrowserFillFieldsProgress {
  confirmed: number[];
  failedIndex: number | null;
  uncertainIndex: number | null;
  stopped: boolean;
}

export interface BrowserPreparedField {
  verify(): Effect.Effect<void, BrowserOperationError>;
  replace(onDispatch: () => void): Effect.Effect<void, BrowserOperationError>;
}

export function fillFieldsFailure(reason: BrowserFillFieldsFailure["reason"]): BrowserOperationError {
  return browserFailure(new BrowserFillFieldsFailure({ reason }));
}

/** Owns ordered prepared-field execution. The engine owns native handles and its CDP lease. */
export const fillPreparedFields = Effect.fn("BrowserFillFields.fillPrepared")(function* (
  prepared: readonly BrowserPreparedField[],
  progress: BrowserFillFieldsProgress,
  deadline: number,
  checkPolicy: () => void,
) {
  for (const [index, field] of prepared.entries()) {
    progress.failedIndex = index;
    if (progress.stopped || Date.now() >= deadline) return yield* fillFieldsFailure("deadline");
    yield* browserSync(checkPolicy);
    yield* field.verify();
    yield* field.replace(() => {
      progress.uncertainIndex = index;
    });
    progress.confirmed.push(index);
    progress.uncertainIndex = null;
  }
  progress.failedIndex = null;
});

/** Fixed page code used only on retained native field handles. No caller supplies JavaScript. */
export const FILL_FIELD_STATE_FUNCTION = String.raw`function(expected, origin, select, text, requireActive) {
  if (!this.isConnected || this.ownerDocument !== document || window !== window.top || location.origin !== origin) return null;
  if (this.localName !== 'textarea' && (this.localName !== 'input' || !['text', 'search', 'tel', 'url', 'email'].includes(this.type))) return null;
  if (this.isContentEditable || this.readOnly || this.disabled || this.matches(':disabled') || this.getAttribute('aria-disabled') === 'true') return null;
  const autocomplete = (this.getAttribute('autocomplete') || this.form?.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
  if (autocomplete.some(value => value.includes('password') || value === 'one-time-code' || value.startsWith('cc-'))) return null;
  if (this.getClientRects().length === 0) return null;
  for (let element = this; element; element = element.parentElement || element.getRootNode()?.host) {
    const style = getComputedStyle(element);
    if (Element.prototype.hasAttribute.call(element, 'hidden') || Element.prototype.hasAttribute.call(element, 'inert') || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return null;
  }
  const fingerprint = JSON.stringify([this.localName, this.type || '', this.getAttribute('autocomplete'), this.form?.getAttribute('autocomplete'), this.getAttribute('id'), this.getAttribute('name'), this.getAttribute('aria-label'), this.getAttribute('placeholder'), this.getAttribute('maxlength'), this.getAttribute('pattern')]);
  const state = JSON.stringify([fingerprint, this.value]);
  if (expected !== null && (text === null ? state !== expected : fingerprint !== JSON.parse(expected)[0])) return null;
  if (select || requireActive) {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== this) return null;
    if (select) this.select();
  }
  if (text !== null && this.value !== text) return null;
  return state;
}`;
