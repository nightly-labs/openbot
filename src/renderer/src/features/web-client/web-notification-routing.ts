import type { AgentEvent, AgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { TextValue } from "@openbot/ui/text";
import { onCleanup, untrack } from "solid-js";
import { startActionSounds } from "../../action-sounds";
import { playCompletionSoundForAgentEvent, unlockCompletionSound } from "../../completion-sound";
import { createAgentEventSounds } from "../agents/agent-event-sounds";
import type { WebWorkspace } from "./web-client-context";
import type { createWebServerNotifications } from "./web-notification-preferences";
import { requestWebNotificationPermission, showWebAgentNotification, watchWebTabFocus } from "./web-notifications";

/**
 * The browser notifications and sounds of host events. As on desktop, mute and the notification level
 * decide what a host's event says; the sound follows them too.
 */
export function createWebNotificationRouting(options: {
  workspace: Pick<WebWorkspace, "state" | "onHostEvent" | "onHostNotice">;
  notifications: ReturnType<typeof createWebServerNotifications>;
  t: TextValue["t"];
  /** Opens the agent of a notification that the user clicked. */
  onOpen: (hostId: string, agentId: string) => void;
}) {
  const { workspace, notifications } = options;
  function notify(hostId: string, event: AgentEvent, agents: AgentSummary[]): void {
    const { muted, level } = untrack(() => notifications.state(hostId));
    if (muted || level === "nothing") return;
    if (event.type === "turn-completed" && level === "all") playCompletionSoundForAgentEvent(event, agents);
    showWebAgentNotification({
      event,
      agents,
      level,
      translate: options.t,
      onOpen: (agentId) => options.onOpen(hostId, agentId),
    });
  }
  function setMuted(hostId: string, muted: boolean, durationMs?: number) {
    if (!muted) requestWebNotificationPermission(true);
    notifications.setMuted(hostId, muted, durationMs);
  }
  function setNotificationLevel(hostId: string, level: ServerNotificationLevel) {
    if (level !== "nothing") requestWebNotificationPermission(true);
    notifications.setLevel(hostId, level);
  }
  // Safari starts audio only from a user action, and can stop it again, so each action starts it.
  window.addEventListener("pointerdown", unlockCompletionSound, true);
  window.addEventListener("keydown", unlockCompletionSound, true);
  onCleanup(() => {
    window.removeEventListener("pointerdown", unlockCompletionSound, true);
    window.removeEventListener("keydown", unlockCompletionSound, true);
  });
  startActionSounds();
  // As with `notify`: a muted server, a server set to nothing, or a muted agent plays no cue.
  const playAgentEventSound = createAgentEventSounds((agentId) => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId) return false;
    const { muted, level } = untrack(() => notifications.state(hostId));
    return (
      !muted &&
      level !== "nothing" &&
      untrack(() => workspace.state.agents).some((agent) => agent.id === agentId && agent.notifications)
    );
  });
  onCleanup(watchWebTabFocus());
  onCleanup(workspace.onHostNotice(notify));
  onCleanup(
    workspace.onHostEvent((event) => {
      const hostId = workspace.state.host?.hostId;
      if (hostId && (event.type === "turn-completed" || event.type === "prompt" || event.type === "approval"))
        notify(hostId, event, workspace.state.agents);
      playAgentEventSound(event);
    }),
  );
  return { setMuted, setNotificationLevel };
}
