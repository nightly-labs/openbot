import type { CustomProviderRestart } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";

/**
 * One `opencode acp` process serves every OpenCode agent, and it reads its config only at spawn, so a
 * saved or removed endpoint needs a respawn that OpenBot will not force through a turn in progress.
 * The write is durable either way, which is why none of these is an error message: they say when the
 * model list catches up, not that something failed.
 */
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
