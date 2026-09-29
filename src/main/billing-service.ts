import {
  type BillingPortalRequest,
  type BillingState,
  parseBillingSessionUrl,
  parseBillingState,
} from "@openbot/contracts/billing";
import { sourceText } from "@openbot/i18n/source";

export interface BillingAuthClient {
  requestAuthorized<T>(path: string, init: RequestInit, decoder: (value: unknown) => T, timeoutMs?: number): Promise<T>;
}

/**
 * The Stripe plan of each server that the account pays for. The renderer never sends a URL: this
 * service gets the Customer Portal URL from the account server and opens it only when it is an https
 * Stripe page.
 */
export class BillingDesktopService {
  constructor(
    private readonly auth: BillingAuthClient,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {}

  getState(): Promise<BillingState> {
    return this.auth.requestAuthorized("/v1/me/billing/", { method: "GET" }, decodeBillingState);
  }

  async openPortal(request: BillingPortalRequest): Promise<void> {
    const url = await this.auth.requestAuthorized(
      "/v1/me/billing/portal",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) },
      decodeSessionUrl,
    );
    await this.openExternal(url);
  }
}

function decodeBillingState(value: unknown): BillingState {
  const state = parseBillingState(value);
  if (!state) throw new Error(sourceText("error.billing.invalidResponse"));
  return state;
}

function decodeSessionUrl(value: unknown): string {
  const url = parseBillingSessionUrl(value);
  if (!url) throw new Error(sourceText("error.billing.notStripePage"));
  return url;
}
