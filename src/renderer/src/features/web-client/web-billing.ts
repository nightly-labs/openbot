import { parseBillingSessionUrl, parseBillingState } from "@openbot/contracts/billing";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { BillingCalls } from "@openbot/ui/features/billing/billing-store";
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
  /** GET without a body, POST with one. Returns the decoded response, or null when it does not decode. */
  async function request<T>(path: string, decode: (value: unknown) => T | null, body?: string): Promise<T | null> {
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
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value) && isDynamicRecord(value.error) && isString(value.error.message))
    return value.error.message;
  return currentText().t("webClient.error.requestFailed");
}

/** The Customer Portal returns to `/app?billing=portal`. */
export const WEB_APP_BILLING_PARAM = "billing";
