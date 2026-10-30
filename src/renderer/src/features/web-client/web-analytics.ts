import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { version } from "../../../../../package.json";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import {
  setWebAccountPending,
  setWebReportsEnabled,
  WEB_PREFERENCE,
  webAccountPending,
  webKeepsOff,
  webReportsEnabled,
} from "../../error-reports";
import type { WebAccountCalls } from "./web-account";

/**
 * Starts product analytics for the signed-in account of this browser. The sign-in screen loads this
 * module later than failure reports, so the event catalogue is not in its first download.
 */
export function configureWebAnalytics(account: CentralAuthUser | null): void {
  desktopAnalytics.configureWeb({ version, user: account, enabled: webReportsEnabled() });
}

/** Records a return from a Stripe page to the web client. */
export function trackBillingReturn(event: DesktopAnalyticsProperties<"billing_return_viewed">): void {
  desktopAnalytics.track("billing_return_viewed", event);
}

/**
 * Sets the one web preference for failure reports and product analytics, and marks it for the
 * account. Returns the stored value.
 */
export function setWebAnalyticsEnabled(value: boolean): boolean {
  // Product analytics stops first, so its opt-out event goes before the reports stop too.
  if (!value) desktopAnalytics.setTrackingEnabled(false, { recordOptOut: true });
  const enabled = setWebReportsEnabled(value);
  desktopAnalytics.setTrackingEnabled(enabled);
  setWebAccountPending(value);
  return enabled;
}

let sending = false;

/**
 * Sends the choice that the account does not have yet, also a newer one that the user makes during
 * the send. The account keeps a newer answer from another device, and this browser follows it,
 * except for an "on" over a kept "off". A failed send stays marked; the next session check or
 * choice sends it again.
 */
export async function sendWebAnalyticsChoice(calls: Pick<WebAccountCalls, "updateAnalytics">): Promise<void> {
  // The send in progress reads the latest choice when it ends.
  if (sending) return;
  sending = true;
  try {
    for (let choice = webAccountPending(); choice; choice = webAccountPending()) {
      const account = await calls.updateAnalytics(choice.enabled, Math.max(0, Date.now() - choice.at));
      if (webAccountPending()?.at !== choice.at) continue;
      setWebAccountPending(null);
      if (account === null || account === choice.enabled || (account && webKeepsOff())) continue;
      setWebReportsEnabled(account);
      followWebReportsPreference();
    }
  } finally {
    sending = false;
  }
}

/**
 * Follows the saved answer of the sign-in screen. The user has not used the app yet, so an answer of
 * off records no opt-out event.
 */
export function followWebReportsPreference(): void {
  desktopAnalytics.setTrackingEnabled(webReportsEnabled());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === WEB_PREFERENCE) followWebReportsPreference();
  });
}
