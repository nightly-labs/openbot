import { isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * A discount link: any openbot.run page with `?promo=CODE`. The website saves the code in this browser,
 * and the web client sends it with the next Checkout request. The account service applies the active
 * Stripe promotion code with that code, or opens Checkout with the code field when there is none.
 */
export const PROMOTION_CODE_PARAM = "promo";

export const PROMOTION_CODE_STORAGE_KEY = "openbot.promotion-code.v1";
/** A link older than this gives no discount: the buyer can still type the code in Checkout. */
export const PROMOTION_CODE_MAX_AGE_DAYS = 30;

/** Wider than the Stripe code characters, so Stripe and not the link decides. Nothing else gets through. */
const PROMOTION_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const DAY_MS = 86_400_000;

/** The promotion code in an untrusted value, or null. */
export function parsePromotionCode(value: unknown): string | null {
  return isString(value) && PROMOTION_CODE.test(value) ? value : null;
}

/**
 * The saved code of this browser, or null when there is none, it is damaged or too old.
 * `storage` is a getter because reading `window.localStorage` throws when the browser blocks storage.
 */
export function readPromotionCode(storage: () => Pick<Storage, "getItem">, now: number): string | null {
  try {
    const stored = storage().getItem(PROMOTION_CODE_STORAGE_KEY);
    const value = stored ? JSON.parse(stored) : null;
    if (!isDynamicRecord(value) || !isNumber(value.savedAt)) return null;
    // A clock that moved back after the save gives a negative age, which is still a new code.
    return now - value.savedAt <= PROMOTION_CODE_MAX_AGE_DAYS * DAY_MS ? parsePromotionCode(value.code) : null;
  } catch {
    return null;
  }
}

/** Saves the code of a discount link. The newest link replaces an older code. Storage failures are silent. */
export function rememberPromotionCode(storage: () => Pick<Storage, "setItem">, href: string, now: number): void {
  try {
    const code = parsePromotionCode(new URL(href).searchParams.get(PROMOTION_CODE_PARAM));
    if (code) storage().setItem(PROMOTION_CODE_STORAGE_KEY, JSON.stringify({ code, savedAt: now }));
  } catch {
    // A discount link must never change what the website does.
  }
}
