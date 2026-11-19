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

export function configureWebAnalytics(account: CentralAuthUser | null): void {
  desktopAnalytics.configureWeb({ version, user: account, enabled: webReportsEnabled() });
}

export function trackBillingReturn(event: DesktopAnalyticsProperties<"billing_return_viewed">): void {
  desktopAnalytics.track("billing_return_viewed", event);
}

export function setWebAnalyticsEnabled(value: boolean): boolean {
  if (!value) desktopAnalytics.setTrackingEnabled(false, { recordOptOut: true });
  const enabled = setWebReportsEnabled(value);
  desktopAnalytics.setTrackingEnabled(enabled);
  setWebAccountPending(value);
  return enabled;
}

let sending = false;

export async function sendWebAnalyticsChoice(calls: Pick<WebAccountCalls, "updateAnalytics">): Promise<void> {
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

export function followWebReportsPreference(): void {
  desktopAnalytics.setTrackingEnabled(webReportsEnabled());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === WEB_PREFERENCE) followWebReportsPreference();
  });
}
