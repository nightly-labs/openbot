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
  settledRequestKeys,
  teammateTurnCompleted,
} from "@openbot/team-client/agent-notifications";
import { channelReplyNotifications } from "@openbot/team-client/channel-notifications";
import type { TextValue } from "@openbot/ui/text";
import { createSignal, onCleanup, untrack } from "solid-js";
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
  withdrawSettledWebAgentNotifications,
  withdrawWebAgentNotification,
} from "./web-notifications";

export function createWebNotificationRouting(options: {
  workspace: Pick<WebWorkspace, "state" | "onHostEvent" | "onHostNotice">;
  notifications: ReturnType<typeof createWebServerNotifications>;
  t: TextValue["t"];
  onOpen: (hostId: string, agentId: string) => void;
  onOpenChannel: (hostId: string, channelId: string) => void;
  channelForThread: (hostId: string, threadId: string) => AgentNotificationChannel | null;
  readAgentLevels?: ((hostId: string) => Promise<AgentNotificationLevelsSnapshot>) | undefined;
  hiddenAgentIds: (hostId: string) => ReadonlySet<string>;
}) {
  const { workspace, notifications } = options;
  const [agentLevels, setAgentLevels] = createSignal<
    Readonly<Record<string, ReadonlyMap<string, ServerNotificationLevel>>>
  >({});
  const NO_MUTED_AGENTS: ReadonlySet<string> = new Set();
  const applied = new Map<string, number>();

  function applyLevels(
    hostId: string,
    snapshot: AgentNotificationLevelsSnapshot,
  ): ReadonlyMap<string, ServerNotificationLevel> {
    const levels = agentNotificationLevelMap(snapshot);
    applied.set(hostId, (applied.get(hostId) ?? 0) + 1);
    setAgentLevels((current) => ({ ...current, [hostId]: levels }));
    notifications.setSyncedLevel(hostId, snapshot.server);
    return levels;
  }
  function mutedAgentIds(hostId: string | null | undefined): ReadonlySet<string> {
    const levels = hostId ? agentLevels()[hostId] : undefined;
    if (!levels) return NO_MUTED_AGENTS;
    return new Set([...levels].flatMap(([agentId, level]) => (level === "nothing" ? [agentId] : [])));
  }
  const waitingRequests = new Set<string>();

  async function levelsOf(hostId: string): Promise<ReadonlyMap<string, ServerNotificationLevel> | null> {
    const read = options.readAgentLevels;
    if (!read) return null;
    const before = applied.get(hostId) ?? 0;
    try {
      const snapshot = await read(hostId);
      if ((applied.get(hostId) ?? 0) !== before) return untrack(agentLevels)[hostId] ?? null;
      return applyLevels(hostId, snapshot);
    } catch {
      return untrack(agentLevels)[hostId] ?? null;
    }
  }
  function refreshLevels(hostId: string): void {
    void levelsOf(hostId);
  }
  function notify(hostId: string, event: AgentEvent, agents: ClientAgentSummary[]): void {
    if (event.type === "runtime-snapshot") {
      for (const key of settledRequestKeys(hostId, event.snapshot, waitingRequests)) waitingRequests.delete(key);
      withdrawSettledWebAgentNotifications(hostId, event.snapshot);
      return;
    }
    withdrawWebAgentNotification(hostId, event);
    const requestKey = notificationRequestKey(hostId, event);
    if (event.type === "agent-input-resolved" || event.type === "browser-takeover-resolved") {
      if (requestKey) waitingRequests.delete(requestKey);
      return;
    }
    if (teammateTurnCompleted(event)) return;
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
      const current = untrack(() => notifications.state(hostId));
      if (current.muted) return;
      const hidden = untrack(() => options.hiddenAgentIds(hostId)).has(agentId);
      show(hostId, event, agents, agentNotificationLevel(current.level, levels, agentId, hidden));
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
  function notifyChannelReplies(hostId: string, previous: ChannelSummary[] | null, next: ChannelSummary[]): void {
    const { muted, level } = untrack(() => notifications.state(hostId));
    if (muted) return;
    const replies = channelReplyNotifications(previous, next, {
      agents: untrack(() => workspace.state.agents),
      translate: options.t,
      level,
      agentLevels: untrack(agentLevels)[hostId] ?? null,
      redact: null,
    });
    showWebChannelNotifications({ hostId, replies, onOpen: (channelId) => options.onOpenChannel(hostId, channelId) });
  }
  function setMuted(hostId: string, muted: boolean, durationMs?: number) {
    if (!muted) requestWebNotificationPermission(true);
    notifications.setMuted(hostId, muted, durationMs);
  }
  function setNotificationLevel(hostId: string, level: ServerNotificationLevel) {
    if (level !== "nothing") requestWebNotificationPermission(true);
    notifications.setLevel(hostId, level);
  }
  window.addEventListener("pointerdown", unlockCompletionSound, true);
  window.addEventListener("keydown", unlockCompletionSound, true);
  onCleanup(() => {
    window.removeEventListener("pointerdown", unlockCompletionSound, true);
    window.removeEventListener("keydown", unlockCompletionSound, true);
  });
  startActionSounds();
  const playAgentEventSound = createAgentEventSounds((agentId) => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId) return false;
    const { muted, level } = untrack(() => notifications.state(hostId));
    return (
      !muted &&
      agentNotificationLevel(level, untrack(agentLevels)[hostId] ?? null, agentId) !== "nothing" &&
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
  return { setMuted, setNotificationLevel, notifyChannelReplies, refreshLevels, applyLevels, mutedAgentIds };
}
