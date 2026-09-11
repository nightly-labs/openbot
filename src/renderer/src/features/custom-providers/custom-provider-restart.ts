import type { CustomProviderRestart } from "@openbot/contracts/ipc";

/**
 * One `opencode acp` process serves every OpenCode agent, and it reads its config only at spawn, so a
 * saved or removed endpoint needs a respawn that OpenBot will not force through a turn in progress.
 * The write is durable either way, which is why none of these is an error message: they say when the
 * model list catches up, not that something failed.
 */
const RESTART_NOTE: Record<CustomProviderRestart, string> = {
  restarted: "OpenBot is loading the models.",
  "skipped-busy": "OpenCode reads the list after the current task stops. Press Connect then.",
  "not-running": "OpenCode reads the list when it next starts.",
};

export function customProviderRestartMessage(action: "Saved" | "Removed", restart: CustomProviderRestart): string {
  return `${action}. ${RESTART_NOTE[restart]}`;
}
