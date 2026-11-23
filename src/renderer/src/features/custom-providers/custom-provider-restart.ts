import type { CustomProviderRestart } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";

const RESTART_NOTE = {
  Saved: {
    restarted: "customProvider.saved.restarted",
    "skipped-busy": "customProvider.saved.skippedBusy",
    "not-running": "customProvider.saved.notRunning",
  },
  Removed: {
    restarted: "customProvider.removed.restarted",
    "skipped-busy": "customProvider.removed.skippedBusy",
    "not-running": "customProvider.removed.notRunning",
  },
} as const satisfies Record<"Saved" | "Removed", Record<CustomProviderRestart, AppTextKey>>;

export function customProviderRestartMessage(
  action: "Saved" | "Removed",
  restart: CustomProviderRestart,
  t: AppTranslate,
): string {
  return t(RESTART_NOTE[action][restart]);
}
