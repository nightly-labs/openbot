import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { appPort } from "./app-port";

/**
 * The local agents that a quit stops, while the window shows how to quit after one press of
 * `Cmd + Q` on a Mac. Empty means that no hint shows.
 */
const [quitShortcutHintAgents, setQuitShortcutHintAgents] = createSignal<ClientAgentSummary[]>([]);

/** A browser tab is a native view over the page, so the conversations hide it while this is true, as for a toast. */
const quitShortcutHintShown = () => quitShortcutHintAgents().length > 0;

/** Follows the hint state from main. Returns the unsubscribe. */
export function watchQuitShortcutHint(): () => void {
  return appPort().onQuitShortcutHint((agents) => setQuitShortcutHintAgents(agents));
}

export { quitShortcutHintAgents, quitShortcutHintShown };
