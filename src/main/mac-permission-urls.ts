import type { MacPermissionId } from "@openbot/contracts/ipc";

export const MAC_PERMISSION_URLS: Record<MacPermissionId, string> = {
  "screen-recording": "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
};
