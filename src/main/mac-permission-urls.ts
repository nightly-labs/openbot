// The System Settings panes macOS opens from a URL, kept out of the renderer.

import type { MacPermissionId } from "@openbot/contracts/ipc";

/**
 * Where macOS shows the grant for each permission Computer Use needs.
 *
 * These addresses are a product contract the checker cannot judge: a wrong one sends a user who
 * asked for screen recording to some other pane, and the type only says "a string". They live here,
 * apart from the services that open them, because two unrelated callers read the same two URLs -
 * the Computer Use panel and the `mac-screen-recording` external destination.
 */
export const MAC_PERMISSION_URLS: Record<MacPermissionId, string> = {
  "screen-recording": "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
};
