import { BILLING_CURRENCIES, type BillingCurrency, billingListPrices, isBillingAmount } from "./billing";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Invite friends. A friend who signs up with the invite link of a user gets `REFERRAL_SHARE_PERCENT` off
 * each OpenBot payment. The user gets the same share of each payment of the friend as account credit,
 * which Stripe takes off the user's next invoice. The credit starts when the friend pays a second time, and
 * goes to Stripe when it reaches `referralMinimum`.
 */
export const REFERRAL_SHARE_PERCENT = 10;

/** The credit that collects before it goes to Stripe: $20, in minor units. */
const REFERRAL_MINIMUM_USD = 2000;

/** Friends on one page of the list. */
export const REFERRAL_PAGE_SIZE = 20;

/** The invite link: `https://openbot.run/?ref=CODE`. The website saves the code until sign-up. */
export const REFERRAL_CODE_PARAM = "ref";
export const REFERRAL_CODE_STORAGE_KEY = "openbot.referral-code.v1";
/** A link older than this does not count at sign-up. */
export const REFERRAL_CODE_MAX_AGE_DAYS = 30;

/** 8 letters and digits without 0, 1, I, L and O, which a reader can confuse. */
const REFERRAL_CODE = /^[a-hjkmnp-z2-9]{8}$/u;
const DAY_MS = 86_400_000;

export type ReferralFriendStatus = "paying" | "no-plan" | "stopped";
export type ReferralFilter = "all" | ReferralFriendStatus;

export const REFERRAL_FRIEND_STATUSES: readonly ReferralFriendStatus[] = ["paying", "no-plan", "stopped"];
export const REFERRAL_FILTERS: readonly ReferralFilter[] = ["all", ...REFERRAL_FRIEND_STATUSES];

/**
 * A friend who signed up with the link: the status and the credit that the friend gave. It has no plan or
 * price of the friend.
 */
export interface ReferralFriend {
  id: string;
  /** The first name and the initial of the last name, for example "Marta K.". */
  name: string;
  status: ReferralFriendStatus;
  /** Epoch milliseconds. */
  joinedAt: number;
  /** The first paid invoice, or null. */
  paidSince: number | null;
  /** When the last plan of a friend who paid ended, or null. */
  stoppedAt: number | null;
  /** Credit from this friend that went to the reader's account, one amount for each currency. */
  earned: ReferralMoney[];
  /** Credit from this friend that waits until the friend pays a second time. */
  pending: ReferralMoney[];
}

/** An amount in minor units. */
export interface ReferralMoney {
  currency: BillingCurrency;
  amountMinor: number;
}

export interface ReferralState {
  /** False when the account server has no Stripe configuration. */
  available: boolean;
  link: string;
  /** Credit that Stripe takes off the next invoice, one amount for each currency. */
  credit: ReferralMoney[];
  /** All credit from friends since the start, one amount for each currency. */
  earned: ReferralMoney[];
  /**
   * Credit that waits until a friend pays a second time, one amount for each currency. The first renewal of
   * the friend's plan gives it, about one month later on a monthly plan.
   */
  pending: ReferralMoney[];
  /** Credit after the friend's second payment that collects until it reaches `minimum`. */
  ready: ReferralMoney[];
  /** The credit in one currency that goes to Stripe at once, for each currency (`referralMinimum`). */
  minimum: ReferralMoney[];
  counts: Record<ReferralFilter, number>;
  filter: ReferralFilter;
  /** The page of `friends`, from 0. */
  page: number;
  /** Newest first. At most `REFERRAL_PAGE_SIZE`. */
  friends: ReferralFriend[];
}

export interface ReferralPageRequest {
  filter: ReferralFilter;
  page: number;
}

export function isReferralCode(value: unknown): value is string {
  return isString(value) && REFERRAL_CODE.test(value);
}

/**
 * The code in what a reader typed: an invite link or the code alone, in any case. Null when the text has
 * no code.
 */
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

/** The share of an amount in minor units, rounded down, so the credit never is more than the share. */
export function referralShare(amountMinor: number): number {
  return Math.floor((amountMinor * REFERRAL_SHARE_PERCENT) / 100);
}

/**
 * The ready credit in one currency that goes to Stripe at once: $20, and the same at the ratio of the list
 * prices, rounded up to a whole unit (€17, 67 zł, R$100).
 */
export function referralMinimum(currency: BillingCurrency): number {
  return Math.ceil(convertReferralAmount(REFERRAL_MINIMUM_USD, "usd", currency) / 100) * 100;
}

/**
 * An amount in another currency, at the ratio of the list prices (USD is EUR times 1.2, PLN times 4 and
 * BRL times 6). Rounded down.
 */
export function convertReferralAmount(amountMinor: number, from: BillingCurrency, to: BillingCurrency): number {
  if (from === to) return amountMinor;
  const prices = billingListPrices("standard", "month");
  return Math.floor((amountMinor * prices[to]) / prices[from]);
}

/** The saved code of this browser, or null when there is none, it is damaged or too old. */
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

/**
 * Removes the saved code after a sign-in that sent it. Another account that signs up later in this
 * browser must not become a friend of the same account. Storage failures are silent.
 */
export function forgetReferralCode(storage: () => Pick<Storage, "removeItem">): void {
  try {
    storage().removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    // A code that stays expires after REFERRAL_CODE_MAX_AGE_DAYS.
  }
}

/** Saves the code of an invite link. The newest link replaces an older code. Storage failures are silent. */
export function rememberReferralCode(storage: () => Pick<Storage, "setItem">, href: string, now: number): void {
  try {
    const code = new URL(href).searchParams.get(REFERRAL_CODE_PARAM)?.toLowerCase();
    if (isReferralCode(code)) storage().setItem(REFERRAL_CODE_STORAGE_KEY, JSON.stringify({ code, savedAt: now }));
  } catch {
    // An invite link must never change what the website does.
  }
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

/** Returns null for a value that is not a referral state. It drops a friend row that it cannot read. */
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
