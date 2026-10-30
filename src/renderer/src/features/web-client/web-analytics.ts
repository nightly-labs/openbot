import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { version } from "../../../../../package.json";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { setWebReportsEnabled, WEB_PREFERENCE, webReportsEnabled } from "../../error-reports";

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

/** Sets the one web preference for failure reports and product analytics. Returns the stored value. */
export function setWebAnalyticsEnabled(value: boolean): boolean {
  // Product analytics stops first, so its opt-out event goes before the reports stop too.
  if (!value) desktopAnalytics.setTrackingEnabled(false, { recordOptOut: true });
  const enabled = setWebReportsEnabled(value);
  desktopAnalytics.setTrackingEnabled(enabled);
  return enabled;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === WEB_PREFERENCE) desktopAnalytics.setTrackingEnabled(webReportsEnabled());
  });
}
