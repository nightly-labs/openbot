import type { DeviceToolApp } from "@openbot/contracts/team-protocol/device-tools-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";

export const DEVICE_APP_NAME = {
  calendar: "mobile.deviceApps.app.calendar",
  reminders: "mobile.deviceApps.app.reminders",
  contacts: "mobile.deviceApps.app.contacts",
  location: "mobile.deviceApps.app.location",
} as const satisfies Record<DeviceToolApp, MobileTextKey>;
