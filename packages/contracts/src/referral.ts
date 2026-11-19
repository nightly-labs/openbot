import { BILLING_CURRENCIES, type BillingCurrency, billingListPrices, isBillingAmount } from "./billing";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const REFERRAL_SHARE_PERCENT = 10;

const REFERRAL_MINIMUM_USD = 2000;

export const REFERRAL_PAGE_SIZE = 20;

export const REFERRAL_CODE_PARAM = "ref";
export const REFERRAL_CODE_STORAGE_KEY = "openbot.referral-code.v1";
export const REFERRAL_CODE_MAX_AGE_DAYS = 30;

const REFERRAL_CODE = /^[a-hjkmnp-z2-9]{8}$/u;
const DAY_MS = 86_400_000;

export type ReferralFriendStatus = "paying" | "no-plan" | "stopped";
export type ReferralFilter = "all" | ReferralFriendStatus;

export const REFERRAL_FRIEND_STATUSES: readonly ReferralFriendStatus[] = ["paying", "no-plan", "stopped"];
export const REFERRAL_FILTERS: readonly ReferralFilter[] = ["all", ...REFERRAL_FRIEND_STATUSES];

export interface ReferralFriend {
  id: string;
  name: string;
  status: ReferralFriendStatus;
  joinedAt: number;
  paidSince: number | null;
  stoppedAt: number | null;
  earned: ReferralMoney[];
  pending: ReferralMoney[];
}

export interface ReferralMoney {
  currency: BillingCurrency;
  amountMinor: number;
}

export interface ReferralState {
  available: boolean;
  link: string;
  credit: ReferralMoney[];
  earned: ReferralMoney[];
  pending: ReferralMoney[];
  ready: ReferralMoney[];
  minimum: ReferralMoney[];
  counts: Record<ReferralFilter, number>;
  filter: ReferralFilter;
  page: number;
  friends: ReferralFriend[];
}

export interface ReferralPageRequest {
  filter: ReferralFilter;
  page: number;
}

export function isReferralCode(value: unknown): value is string {
  return isString(value) && REFERRAL_CODE.test(value);
}

export function referralCodeFromInput(text: string): string | null {
  const value = text.trim();
  let code = value;
  if (/[/?=]/u.test(value)) {
    try {
      code =
        new URL(/^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : `https://${value}`).searchParams.get(
          REFERRAL_CODE_PARAM,
        ) ?? "";
    } catch {
      return null;
    }
  }
  code = code.toLowerCase();
  return isReferralCode(code) ? code : null;
}

export function referralShare(amountMinor: number): number {
  return Math.floor((amountMinor * REFERRAL_SHARE_PERCENT) / 100);
}

export function referralMinimum(currency: BillingCurrency): number {
  return Math.ceil(convertReferralAmount(REFERRAL_MINIMUM_USD, "usd", currency) / 100) * 100;
}

export function convertReferralAmount(amountMinor: number, from: BillingCurrency, to: BillingCurrency): number {
  if (from === to) return amountMinor;
  const prices = billingListPrices("standard", "month");
  return Math.floor((amountMinor * prices[to]) / prices[from]);
}

export function readReferralCode(storage: () => Pick<Storage, "getItem">, now: number): string | null {
  try {
    const stored = storage().getItem(REFERRAL_CODE_STORAGE_KEY);
    const value = stored ? JSON.parse(stored) : null;
    if (!isDynamicRecord(value) || !isNumber(value.savedAt)) return null;
    return now - value.savedAt <= REFERRAL_CODE_MAX_AGE_DAYS * DAY_MS && isReferralCode(value.code) ? value.code : null;
  } catch {
    return null;
  }
}

export function forgetReferralCode(storage: () => Pick<Storage, "removeItem">): void {
  try {
    storage().removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {}
}

export function rememberReferralCode(storage: () => Pick<Storage, "setItem">, href: string, now: number): void {
  try {
    const code = new URL(href).searchParams.get(REFERRAL_CODE_PARAM)?.toLowerCase();
    if (isReferralCode(code)) storage().setItem(REFERRAL_CODE_STORAGE_KEY, JSON.stringify({ code, savedAt: now }));
  } catch {}
}

export function parseReferralPageRequest(value: unknown): ReferralPageRequest | null {
  if (!isDynamicRecord(value) || !isOneOf(REFERRAL_FILTERS, value.filter)) return null;
  if (!isNumber(value.page) || !Number.isSafeInteger(value.page) || value.page < 0) return null;
  return { filter: value.filter, page: value.page };
}

function parseMoneyList(value: unknown): ReferralMoney[] | null {
  if (!Array.isArray(value)) return null;
  const list: ReferralMoney[] = [];
  for (const item of value) {
    if (!isDynamicRecord(item) || !isOneOf(BILLING_CURRENCIES, item.currency) || !isBillingAmount(item.amountMinor)) {
      return null;
    }
    list.push({ currency: item.currency, amountMinor: item.amountMinor });
  }
  return list;
}

function parseFriend(value: unknown): ReferralFriend | null {
  if (!isDynamicRecord(value)) return null;
  const earned = parseMoneyList(value.earned);
  const pending = parseMoneyList(value.pending);
  if (
    !earned ||
    !pending ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isOneOf(REFERRAL_FRIEND_STATUSES, value.status) ||
    !isNumber(value.joinedAt) ||
    !(value.paidSince === null || isNumber(value.paidSince)) ||
    !(value.stoppedAt === null || isNumber(value.stoppedAt))
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    joinedAt: value.joinedAt,
    paidSince: value.paidSince,
    stoppedAt: value.stoppedAt,
    earned,
    pending,
  };
}

export function parseReferralState(value: unknown): ReferralState | null {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.available) ||
    !isString(value.link) ||
    !isOneOf(REFERRAL_FILTERS, value.filter) ||
    !isNumber(value.page) ||
    !isDynamicRecord(value.counts) ||
    !Array.isArray(value.friends)
  ) {
    return null;
  }
  const credit = parseMoneyList(value.credit);
  const earned = parseMoneyList(value.earned);
  const pending = parseMoneyList(value.pending);
  const ready = parseMoneyList(value.ready);
  const minimum = parseMoneyList(value.minimum);
  if (!credit || !earned || !pending || !ready || !minimum) return null;
  const source = value.counts;
  const count = (filter: ReferralFilter) => {
    const item = source[filter];
    return isNumber(item) && Number.isSafeInteger(item) && item >= 0 ? item : null;
  };
  const all = count("all");
  const paying = count("paying");
  const noPlan = count("no-plan");
  const stopped = count("stopped");
  if (all === null || paying === null || noPlan === null || stopped === null) return null;
  const counts = { all, paying, "no-plan": noPlan, stopped };
  const friends: ReferralFriend[] = [];
  for (const item of value.friends) {
    const friend = parseFriend(item);
    if (friend) friends.push(friend);
  }
  return {
    available: value.available,
    link: value.link,
    credit,
    earned,
    pending,
    ready,
    minimum,
    counts,
    filter: value.filter,
    page: value.page,
    friends,
  };
}
