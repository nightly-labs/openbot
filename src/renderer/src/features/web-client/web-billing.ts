import { parseBillingSessionUrl, parseBillingState } from "@openbot/contracts/billing";
import { parseBillingDetails } from "@openbot/contracts/billing-details";
import { type CreditMediaCatalog, parseCreditMediaCatalog } from "@openbot/contracts/credit-media";
import {
  parseCreditActivity,
  parseCreditCheckoutUrl,
  parseCreditRedeemResult,
  parseCreditsState,
} from "@openbot/contracts/credits";
import {
  PRICING_ORDER_PARAMS,
  type PricingOrder,
  parseLicenseCheckoutUrl,
  parseLicenseState,
  parsePricingOrder,
} from "@openbot/contracts/license";
import { readPromotionCode } from "@openbot/contracts/promotion-code";
import { parseReferralState } from "@openbot/contracts/referral";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { BillingDetailsCalls } from "@openbot/ui/features/billing/BillingDetailsFields";
import type { BillingCalls } from "@openbot/ui/features/billing/billing-store";
import type { LicenseCalls } from "@openbot/ui/features/billing/license-store";
import type { CreditsCalls } from "@openbot/ui/features/credits/credits-store";
import type { ReferralCalls } from "@openbot/ui/features/referral/referral-store";
import { currentText } from "@openbot/ui/text";

const REQUEST_TIMEOUT_MS = 15_000;
const DETAILS_SAVE_TIMEOUT_MS = 30_000;

export function createWebBillingCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): BillingCalls & BillingDetailsCalls {
  const request = browserRequest(accountFetch);

  async function details(body?: string) {
    const value = await request(
      "v1/me/billing/details",
      parseBillingDetails,
      body,
      "PUT",
      body === undefined ? REQUEST_TIMEOUT_MS : DETAILS_SAVE_TIMEOUT_MS,
    );
    if (!value) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
    return value;
  }

  async function openStripe(path: string, body: string): Promise<void> {
    const url = await request(path, parseBillingSessionUrl, body);
    if (!url) throw new Error(currentText().sourceText("error.billing.notStripePage"));
    navigate(url);
  }

  return {
    async getState() {
      const state = await request("v1/me/billing", parseBillingState);
      if (!state) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
      return state;
    },
    openPortal: (portal) => openStripe("v1/me/billing/portal", JSON.stringify(portal)),
    async buyStorage(storage) {
      const state = await request("v1/me/billing/storage", parseBillingState, JSON.stringify(storage));
      if (!state) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
      return state;
    },
    getDetails: () => details(),
    setDetails: (value) => details(JSON.stringify(value)),
  };
}

export function createWebLicenseCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): LicenseCalls {
  const request = browserRequest(accountFetch);

  async function state(path: string, body?: string) {
    const license = await request(path, parseLicenseState, body);
    if (!license) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
    return license;
  }

  return {
    getState: () => state("v1/me/license"),
    async openCheckout(checkout) {
      const body = JSON.stringify({ ...checkout, ...savedPromotionCode() });
      const url = await request("v1/me/license/checkout", parseLicenseCheckoutUrl, body);
      if (!url) throw new Error(currentText().sourceText("error.billing.notStripePage"));
      navigate(url);
    },
    setUsers: (users) => state("v1/me/license/users", JSON.stringify(users)),
    changePlan: (plan) => state("v1/me/license/plan", JSON.stringify(plan)),
    setRenewal: (renewal) => state("v1/me/license/renewal", JSON.stringify(renewal)),
  };
}

export function createWebCreditsCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): CreditsCalls {
  const request = browserRequest(accountFetch);

  async function state(path: string, body?: string) {
    const credits = await request(path, parseCreditsState, body);
    if (!credits) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
    return credits;
  }

  return {
    getState: () => state("v1/me/credits"),
    async getActivity() {
      const activity = await request("v1/me/credits/activity", parseCreditActivity);
      if (!activity) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
      return activity;
    },
    async openCheckout(checkout) {
      const url = await request("v1/me/credits/checkout", parseCreditCheckoutUrl, JSON.stringify(checkout));
      if (!url) throw new Error(currentText().sourceText("error.billing.notStripePage"));
      navigate(url);
    },
    transfer: (transfer) => state("v1/me/credits/transfer", JSON.stringify(transfer)),
    async redeem(redeem) {
      const result = await request("v1/me/credits/redeem", parseCreditRedeemResult, JSON.stringify(redeem));
      if (!result) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
      return result;
    },
  };
}

export async function readCreditCatalog(accountFetch: typeof fetch): Promise<CreditMediaCatalog> {
  const response = await accountFetch("/v1/media/models", {
    credentials: "omit",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const catalog = response.ok ? parseCreditMediaCatalog(await response.json().catch(() => null)) : null;
  if (!catalog) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
  return catalog;
}

export function createWebReferralCalls(accountFetch: typeof fetch): ReferralCalls {
  const request = browserRequest(accountFetch);
  return {
    async getState(page) {
      const query = new URLSearchParams({ filter: page.filter, page: String(page.page) });
      const state = await request(`v1/me/referrals?${query.toString()}`, parseReferralState);
      if (!state) throw new Error(currentText().sourceText("error.billing.invalidResponse"));
      return state;
    },
  };
}

export function savedPromotionCode(): { promotionCode?: string } {
  const code = readPromotionCode(() => window.localStorage, Date.now());
  return code ? { promotionCode: code } : {};
}

function browserRequest(accountFetch: typeof fetch) {
  return async <T>(
    path: string,
    decode: (value: unknown) => T | null,
    body?: string,
    method: "POST" | "PUT" = "POST",
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T | null> => {
    const post = body !== undefined;
    const response = await accountFetch(`/api/browser/${path}`, {
      method: post ? method : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: post ? { "Content-Type": "application/json", "X-OpenBot-Browser": "1" } : {},
      ...(post ? { body } : {}),
    }).catch(() => {
      throw new Error(errorMessage(null));
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(value));
    return decode(value);
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message))
    return value.error.message;
  return currentText().t("webClient.error.requestFailed");
}

export const WEB_APP_BILLING_PARAM = "billing";

const WEB_APP_START_PARAM = "start";
export interface WebAppStart {
  kind: "server" | "license";
  order: PricingOrder | null;
}

export function takeWebAppStart(url: URL): WebAppStart | null {
  const start = url.searchParams.get(WEB_APP_START_PARAM);
  if (start === null) return null;
  const order = parsePricingOrder(url.searchParams);
  url.searchParams.delete(WEB_APP_START_PARAM);
  for (const param of PRICING_ORDER_PARAMS) url.searchParams.delete(param);
  return start === "server" || start === "license" ? { kind: start, order } : null;
}
