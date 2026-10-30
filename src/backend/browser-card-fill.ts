// What `fill_card` types into each card field, and the page functions that check and fill the fields.
// The values go to the page only: no function here returns one.

import type { BrowserTarget } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { VaultCardSecret } from "./vault-items";

export const BROWSER_CARD_FIELDS = ["number", "securityCode", "expiry", "expMonth", "expYear", "nameOnCard"] as const;
export type BrowserCardField = (typeof BROWSER_CARD_FIELDS)[number];
export type BrowserCardTargets = { number: BrowserTarget } & {
  [Field in Exclude<BrowserCardField, "number">]?: BrowserTarget | undefined;
};

export interface BrowserCardFillResult {
  filled: BrowserCardField[];
  /** Filled fields whose value the page then changed, such as a mask that did not take every digit. */
  unconfirmed: BrowserCardField[];
}

/** The field as the page shows it, without its value. */
export interface BrowserCardFieldDescription {
  connected: boolean;
  secure: boolean;
  origin: string;
  tag: string;
  type: string;
  multiple: boolean;
  disabled: boolean;
  maxLength: number;
  placeholder: string;
  /** The field's form sends its fields in the page address. */
  sendsGet: boolean;
}

export function parseCardFieldDescription(value: unknown): BrowserCardFieldDescription | null {
  if (!isDynamicRecord(value)) return null;
  const { connected, secure, origin, tag, type, multiple, disabled, maxLength, placeholder, sendsGet } = value;
  if (
    !isBoolean(connected) ||
    !isBoolean(secure) ||
    !isString(origin) ||
    !isString(tag) ||
    !isString(type) ||
    !isBoolean(multiple) ||
    !isBoolean(disabled) ||
    !isNumber(maxLength) ||
    !isString(placeholder) ||
    !isBoolean(sendsGet)
  )
    return null;
  return { connected, secure, origin, tag, type, multiple, disabled, maxLength, placeholder, sendsGet };
}

/**
 * Reads a field without its value. `ownerDocument === document` keeps the field in the frame whose
 * context runs the function: the main page, or a payment frame in its own process.
 */
export const CARD_FIELD_DESCRIPTION_FUNCTION = `function() {
  const form = this.form;
  const sendsGet = (element) => element.hasAttribute('formmethod') && element.getAttribute('formmethod').trim().toLowerCase() === 'get';
  return {
    connected: this.isConnected && this.ownerDocument === document,
    secure: location.protocol === 'https:' && window.isSecureContext,
    origin: location.origin,
    tag: this.localName,
    type: typeof this.type === 'string' ? this.type : '',
    multiple: this.multiple === true,
    disabled: this.disabled === true || this.readOnly === true,
    maxLength: typeof this.maxLength === 'number' ? this.maxLength : -1,
    placeholder: this.getAttribute('placeholder') ?? '',
    sendsGet: !!form && ((form.getAttribute('method') ?? '').trim().toLowerCase() === 'get' || [...form.elements].some(sendsGet)),
  };
}`;

/** The identity of a field. A field that changes between the check and the fill takes no value. */
const FINGERPRINT = `JSON.stringify([this.isConnected, location.origin, this.localName, this.type, this.id, this.name, this.getAttribute('autocomplete'), this.getAttribute('aria-label'), this.form?.action, this.form?.method])`;

export const CARD_FIELD_FINGERPRINT_FUNCTION = `function() { return ${FINGERPRINT}; }`;

/** Selects the field's text, so the native insert replaces it. */
export const CARD_FIELD_SELECT_FUNCTION = `function(expected) {
  if (${FINGERPRINT} !== expected || this.disabled || this.readOnly) throw new Error('The card field changed. Take a fresh snapshot.');
  this.select();
}`;

/** Whether the field holds what was typed. A mask can add spaces, so the number compares digits only. */
export const CARD_FIELD_CHECK_FUNCTION = `function(expected, digitsOnly) {
  const value = String(this.value ?? '');
  return digitsOnly ? value.replace(/[^0-9]/g, '') === expected.replace(/[^0-9]/g, '') : value.trim() === expected.trim();
}`;

/**
 * Picks the month or year option of a native select. A month matches by number, such as `3`, `03`
 * or `03 - March`, or by its name in the page's language or in English; a year matches four or two
 * digits. The page gets the same input and change events a person's choice sends.
 */
export const CARD_SELECT_OPTION_FUNCTION = `function(kind, month, year, expected) {
  if (${FINGERPRINT} !== expected || this.localName !== 'select' || this.multiple || this.disabled) throw new Error('The card field changed. Take a fresh snapshot.');
  const options = [...this.options];
  const usable = (option) => !option.disabled && option.parentElement?.disabled !== true;
  const clean = (text) => text.trim().toLowerCase().replace(/\\.$/, '');
  const leadingNumber = (text) => { const match = /^0*([0-9]{1,2})(?![0-9])/.exec(text.trim()); return match ? Number(match[1]) : null; };
  const names = new Set();
  for (const locale of [document.documentElement.lang || undefined, 'en']) {
    for (const style of ['long', 'short']) {
      try { names.add(clean(new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1))))); } catch {}
    }
  }
  const fullYear = String(year);
  const shortYear = fullYear.slice(-2);
  const rules = kind === 'year'
    ? [(o) => o.value.trim() === fullYear, (o) => o.text.trim() === fullYear, (o) => o.value.trim() === shortYear, (o) => o.text.trim() === shortYear]
    : [(o) => /^[0-9]{1,2}$/.test(o.value.trim()) && leadingNumber(o.value) === month, (o) => leadingNumber(o.text) === month, (o) => names.has(clean(o.text)) || names.has(clean(o.value))];
  for (const rule of rules) {
    const found = options.filter((option) => usable(option) && rule(option));
    if (found.length > 1) throw new Error('More than one ' + kind + ' option matches the card.');
    if (found.length === 1) {
      this.selectedIndex = found[0].index;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  throw new Error('No ' + kind + ' option matches the card.');
}`;

const TEXT_INPUT_TYPES = new Set(["", "text", "tel", "number", "password", "search"]);

/** Which fields a native select can be: the number, the code and the name are always typed. */
export function cardFieldAccepts(field: BrowserCardField, description: BrowserCardFieldDescription): boolean {
  if (description.tag === "select") return !description.multiple && (field === "expMonth" || field === "expYear");
  return description.tag === "input" && TEXT_INPUT_TYPES.has(description.type);
}

/** The text to type into `field`, or null when the card has no value for it. */
export function cardFieldText(
  field: BrowserCardField,
  card: VaultCardSecret,
  description: BrowserCardFieldDescription,
): string | null {
  const month = String(card.expMonth).padStart(2, "0");
  const year = String(card.expYear);
  switch (field) {
    case "number":
      return card.number.replace(/[^0-9]/gu, "") || null;
    case "securityCode":
      return card.securityCode || null;
    case "nameOnCard":
      return card.nameOnCard.trim() || null;
    case "expMonth":
      return month;
    case "expYear":
      return description.maxLength === 2 || /^\s*(?:yy|aa|jj|\d\d)\s*$/iu.test(description.placeholder)
        ? year.slice(-2)
        : year;
    case "expiry":
      return expiryText(month, year, description);
  }
}

/**
 * One expiry field. The placeholder decides first: `MM/YY`, `MM / YYYY`, `MMYY`, a translated year
 * such as `MM/AA` or `MM/JJ`, or an example such as `12/28`. Then the length limit: 4 is `MMYY`, 5 is
 * `MM/YY`, 6 is `MMYYYY` and 7 is `MM/YYYY`. Otherwise `MM/YY`, the most common form.
 */
function expiryText(month: string, year: string, description: BrowserCardFieldDescription): string {
  const short = year.slice(-2);
  const placeholder = description.placeholder.trim();
  const letters = /^mm(\s*[/\-.]?\s*)([a-z])\2(\2\2)?$/iu.exec(placeholder);
  if (letters) return `${month}${letters[1] ?? ""}${letters[3] ? year : short}`;
  const example = /^[0-9]{2}(\s*[/\-.]?\s*)[0-9]{2}([0-9]{2})?$/u.exec(placeholder);
  if (example) return `${month}${example[1] ?? ""}${example[2] ? year : short}`;
  switch (description.maxLength) {
    case 4:
      return `${month}${short}`;
    case 6:
      return `${month}${year}`;
    case 7:
      return `${month}/${year}`;
    default:
      return `${month}/${short}`;
  }
}
