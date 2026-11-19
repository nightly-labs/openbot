import { parseBillingSessionUrl, parseBillingState } from "@openbot/contracts/billing";
import { parseBillingDetails } from "@openbot/contracts/billing-details";
import {
  PRICING_ORDER_PARAMS,
  type PricingOrder,
  parseLicenseCheckoutUrl,
  parseLicenseState,
  parsePricingOrder,
} from "@openbot/contracts/license";
import { readPromotionCode } from "@openbot/contracts/promotion-code";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { BillingDetailsCalls } from "@openbot/ui/features/billing/BillingDetailsFields";
import type { BillingCalls } from "@openbot/ui/features/billing/billing-store";
import type { LicenseCalls } from "@openbot/ui/features/billing/license-store";
import { currentText } from "@openbot/ui/text";

const REQUEST_TIMEOUT_MS = 15_000;

export function createWebBillingCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): BillingCalls & BillingDetailsCalls {
  const request = browserRequest(accountFetch);

  async function details(body?: string) {
    const value = await request("v1/me/billing/details", parseBillingDetails, body, "PUT");
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
  ): Promise<T | null> => {
    const post = body !== undefined;
    const response = await accountFetch(`/api/browser/${path}`, {
      method: post ? method : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
