import type { createWorkspacePreferences, RemoteWorkspacePreferences } from "@openbot/team-client";

export const MAX_PINNED_AGENTS = 16;

export function canToggleAgentPin(pinned: readonly string[], agentId: string): boolean {
  return pinned.includes(agentId) || pinned.length < MAX_PINNED_AGENTS;
}

/** Call only with a complete server list, never a filtered or loading list. */
export function reconcileAgentPins(
  store: ReturnType<typeof createWorkspacePreferences>,
  serverId: string,
  agents: readonly { id: string }[],
) {
  const current = store.read(serverId);
  const available = new Set(agents.map((agent) => agent.id));
  const pinned = current.pinned.filter((id) => available.has(id));
  if (pinned.length === current.pinned.length) return current;
  const next = { ...current, pinned };
  store.write(serverId, next);
  return next;
}

export function reconcileChannelPins(
  store: ReturnType<typeof createWorkspacePreferences>,
  serverId: string,
  channels: readonly { id: string }[],
) {
  const current = store.read(serverId);
  const available = new Set(channels.map((channel) => channel.id));
  const pinnedChannels = (current.pinnedChannels ?? []).filter((id) => available.has(id));
  if (pinnedChannels.length === (current.pinnedChannels?.length ?? 0)) return current;
  const next = { ...current, pinnedChannels };
  store.write(serverId, next);
  return next;
}

export function setChannelHidden(
  current: RemoteWorkspacePreferences,
  channelId: string,
  hidden: boolean,
): RemoteWorkspacePreferences {
  return {
    ...current,
    hiddenChannels: hidden
      ? [...new Set([...(current.hiddenChannels ?? []), channelId])]
      : (current.hiddenChannels ?? []).filter((id) => id !== channelId),
    ...(hidden ? { pinnedChannels: (current.pinnedChannels ?? []).filter((id) => id !== channelId) } : {}),
  };
}
