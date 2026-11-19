import { isDynamicRecord, isNumber, isString } from "./runtime-values";

export const PROMOTION_CODE_PARAM = "promo";

export const PROMOTION_CODE_STORAGE_KEY = "openbot.promotion-code.v1";
export const PROMOTION_CODE_MAX_AGE_DAYS = 30;

const PROMOTION_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const DAY_MS = 86_400_000;

export function parsePromotionCode(value: unknown): string | null {
  return isString(value) && PROMOTION_CODE.test(value) ? value : null;
}

export function readPromotionCode(storage: () => Pick<Storage, "getItem">, now: number): string | null {
  try {
    const stored = storage().getItem(PROMOTION_CODE_STORAGE_KEY);
    const value = stored ? JSON.parse(stored) : null;
    if (!isDynamicRecord(value) || !isNumber(value.savedAt)) return null;
    return now - value.savedAt <= PROMOTION_CODE_MAX_AGE_DAYS * DAY_MS ? parsePromotionCode(value.code) : null;
  } catch {
    return null;
  }
}

export function rememberPromotionCode(storage: () => Pick<Storage, "setItem">, href: string, now: number): void {
  try {
    const code = parsePromotionCode(new URL(href).searchParams.get(PROMOTION_CODE_PARAM));
    if (code) storage().setItem(PROMOTION_CODE_STORAGE_KEY, JSON.stringify({ code, savedAt: now }));
  } catch {}
}
