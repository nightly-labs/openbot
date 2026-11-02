import { parseBillingSessionUrl, parseBillingState } from "@openbot/contracts/billing";
import {
  PRICING_ORDER_PARAMS,
  type PricingOrder,
  parseLicenseCheckoutUrl,
  parseLicenseState,
  parsePricingOrder,
} from "@openbot/contracts/license";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { BillingCalls } from "@openbot/ui/features/billing/billing-store";
import type { LicenseCalls } from "@openbot/ui/features/billing/license-store";
import { currentText } from "@openbot/ui/text";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The Billing dialog calls for a signed-in browser. They use the `/api/browser/v1/me/billing...`
 * operations. The page goes only to a Stripe Customer Portal URL.
 */
export function createWebBillingCalls(
  accountFetch: typeof fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): BillingCalls {
  const request = browserRequest(accountFetch);

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
  };
}

/**
 * The license calls for a signed-in browser, through the `/api/browser/v1/me/license...` operations.
 * Checkout goes only to a Stripe Checkout URL.
 */
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
      const url = await request("v1/me/license/checkout", parseLicenseCheckoutUrl, JSON.stringify(checkout));
      if (!url) throw new Error(currentText().sourceText("error.billing.notStripePage"));
      navigate(url);
    },
    setUsers: (users) => state("v1/me/license/users", JSON.stringify(users)),
    changePlan: (plan) => state("v1/me/license/plan", JSON.stringify(plan)),
    setRenewal: (renewal) => state("v1/me/license/renewal", JSON.stringify(renewal)),
  };
}

/** GET without a body, POST with one. Returns the decoded response, or null when it does not decode. */
function browserRequest(accountFetch: typeof fetch) {
  return async <T>(path: string, decode: (value: unknown) => T | null, body?: string): Promise<T | null> => {
    const post = body !== undefined;
    const response = await accountFetch(`/api/browser/${path}`, {
      method: post ? "POST" : "GET",
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

/** The Customer Portal returns to `/app?billing=portal`. */
export const WEB_APP_BILLING_PARAM = "billing";

/** The pricing page sends `/app?start=server` or `/app?start=license`, with the order of its form. */
const WEB_APP_START_PARAM = "start";
/**
 * What a pricing page button opens: the add server dialog or Billing, where the license is. With the order, the
 * dialog fills it in and goes on to Checkout. An old link has no order.
 */
export interface WebAppStart {
  kind: "server" | "license";
  order: PricingOrder | null;
}

/** Reads the pricing page link and removes it from the URL, so a reload does not buy again. */
export function takeWebAppStart(url: URL): WebAppStart | null {
  const start = url.searchParams.get(WEB_APP_START_PARAM);
  if (start === null) return null;
  const order = parsePricingOrder(url.searchParams);
  url.searchParams.delete(WEB_APP_START_PARAM);
  for (const param of PRICING_ORDER_PARAMS) url.searchParams.delete(param);
  return start === "server" || start === "license" ? { kind: start, order } : null;
}
