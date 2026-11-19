import type { LicenseStoreEvent } from "@openbot/ui/features/billing/license-store";
import { desktopAnalytics } from "../../analytics";

export function trackLicenseEvent(event: LicenseStoreEvent): void {
  desktopAnalytics.track("license_action", {
    ...event,
    ...(event.result === "failed"
      ? { failure_code: event.action === "checkout_opened" ? "checkout_failed" : "update_failed" }
      : {}),
  });
}

export function licenseContactUs(open: (() => void) | undefined): (() => void) | undefined {
  return (
    open &&
    (() => {
      desktopAnalytics.track("sales_contact_clicked", { entry_point: "license" });
      open();
    })
  );
}
