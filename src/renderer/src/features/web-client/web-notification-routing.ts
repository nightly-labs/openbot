import {
  type AgentEvent,
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ChannelSummary,
  type ClientAgentSummary,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import {
  type AgentNotificationChannel,
  agentEventAgentId,
  agentEventRequestThread,
  agentNotificationLevel,
  notificationRequestKey,
} from "@openbot/team-client/agent-notifications";
import { channelReplyNotifications } from "@openbot/team-client/channel-notifications";
import type { TextValue } from "@openbot/ui/text";
import { onCleanup, untrack } from "solid-js";
import { startActionSounds } from "../../action-sounds";
import { playCompletionSoundForAgentEvent, unlockCompletionSound } from "../../completion-sound";
import { createAgentEventSounds } from "../agents/agent-event-sounds";
import type { WebWorkspace } from "./web-client-context";
import { isWebHostNotice } from "./web-host-connections";
import type { createWebServerNotifications } from "./web-notification-preferences";
import {
  requestWebNotificationPermission,
  showWebAgentNotification,
  showWebChannelNotifications,
  watchWebTabFocus,
  withdrawWebAgentNotification,
} from "./web-notifications";

/**
 * The browser notifications and sounds of host events. As on desktop, mute and the notification level
 * decide what a host's event says; the sound follows them too. The level that the user chose for an
 * agent replaces the server level for the events of that agent. The server level is the level that
 * the host keeps for all devices of the user, else the level of this browser.
 */
export function createWebNotificationRouting(options: {
  workspace: Pick<WebWorkspace, "state" | "onHostEvent" | "onHostNotice">;
  notifications: ReturnType<typeof createWebServerNotifications>;
  t: TextValue["t"];
  /** Opens the agent of a notification that the user clicked. */
  onOpen: (hostId: string, agentId: string) => void;
  /** Opens the channel of a notification that the user clicked. */
  onOpenChannel: (hostId: string, channelId: string) => void;
  /** The channel of a thread on the open host, from its channel list, or null. */
  channelForThread: (hostId: string, threadId: string) => AgentNotificationChannel | null;
  /** The user's own level for each agent of a host. Absent, the server level applies to each agent. */
  readAgentLevels?: ((hostId: string) => Promise<AgentNotificationLevelsSnapshot>) | undefined;
}) {
  const { workspace, notifications } = options;
  /** The last levels that each host gave, for a read that fails. */
  const agentLevels = new Map<string, ReadonlyMap<string, ServerNotificationLevel>>();
  /** The requests whose notification waits for the levels. An answer on any device removes its key. */
  const waitingRequests = new Set<string>();

  async function levelsOf(hostId: string): Promise<ReadonlyMap<string, ServerNotificationLevel> | null> {
    const read = options.readAgentLevels;
    if (!read) return null;
    try {
      const snapshot = await read(hostId);
      const levels = agentNotificationLevelMap(snapshot);
      agentLevels.set(hostId, levels);
      notifications.setSyncedLevel(hostId, snapshot.server);
      return levels;
    } catch {
      return agentLevels.get(hostId) ?? null;
    }
  }
  /** Reads the levels of a host again, such as after it comes online. Another device can have changed them. */
  function refreshLevels(hostId: string): void {
    void levelsOf(hostId);
  }
  function notify(hostId: string, event: AgentEvent, agents: ClientAgentSummary[]): void {
    withdrawWebAgentNotification(hostId, event);
    const requestKey = notificationRequestKey(hostId, event);
    if (event.type === "agent-input-resolved" || event.type === "browser-takeover-resolved") {
      if (requestKey) waitingRequests.delete(requestKey);
      return;
    }
    const { muted, level } = untrack(() => notifications.state(hostId));
    if (muted) return;
    const agentId = agentEventAgentId(event);
    if (agentId === null) {
      show(hostId, event, agents, level);
      return;
    }
    if (requestKey) waitingRequests.add(requestKey);
    void levelsOf(hostId).then((levels) => {
      if (requestKey && !waitingRequests.delete(requestKey)) return;
      // The user can mute the server or change its level while the read runs. The read also gives
      // the server level that the host keeps for the user.
      const current = untrack(() => notifications.state(hostId));
      if (current.muted) return;
      show(hostId, event, agents, agentNotificationLevel(current.level, levels, agentId));
    });
  }
  function show(hostId: string, event: AgentEvent, agents: ClientAgentSummary[], level: ServerNotificationLevel) {
    if (level === "nothing") return;
    if (event.type === "turn-completed" && level === "all") playCompletionSoundForAgentEvent(event, agents);
    const threadId = agentEventRequestThread(event);
    showWebAgentNotification({
      hostId,
      event,
      agents,
      level,
      translate: options.t,
      channel: threadId === null ? null : options.channelForThread(hostId, threadId),
      onOpen: (agentId, channelId) =>
        channelId ? options.onOpenChannel(hostId, channelId) : options.onOpen(hostId, agentId),
    });
  }
  /** The replies that a new channel list of the open host shows. The first list is the baseline. */
  function notifyChannelReplies(hostId: string, previous: ChannelSummary[] | null, next: ChannelSummary[]): void {
    const { muted, level } = untrack(() => notifications.state(hostId));
    if (muted) return;
    const replies = channelReplyNotifications(previous, next, {
      agents: untrack(() => workspace.state.agents),
      translate: options.t,
      level,
      // As for an agent reply, the web client shows no preview.
      redact: null,
    });
    showWebChannelNotifications({ hostId, replies, onOpen: (channelId) => options.onOpenChannel(hostId, channelId) });
  }
  function setMuted(hostId: string, muted: boolean, durationMs?: number) {
    if (!muted) requestWebNotificationPermission(true);
    notifications.setMuted(hostId, muted, durationMs);
  }
  /** Sets the level of this browser. The notification settings also write it to a host that keeps it. */
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
      if (hostId && isWebHostNotice(event)) notify(hostId, event, workspace.state.agents);
      playAgentEventSound(event);
    }),
  );
  return { setMuted, setNotificationLevel, notifyChannelReplies, refreshLevels };
}
