import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { appPort } from "./app-port";

const [quitShortcutHintAgents, setQuitShortcutHintAgents] = createSignal<ClientAgentSummary[] | null>(null);

const quitShortcutHintShown = () => quitShortcutHintAgents() !== null;

export function watchQuitShortcutHint(): () => void {
  return appPort().onQuitShortcutHint((agents) => setQuitShortcutHintAgents(agents));
}

export { quitShortcutHintAgents, quitShortcutHintShown };
