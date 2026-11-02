import { type SidebarPin, sidebarPinKey } from "@openbot/contracts/ipc";
import type { createWorkspacePreferences, RemoteWorkspacePreferences } from "@openbot/team-client";

const MAX_PINNED_AGENTS = 16;

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

/**
 * The pins of this phone as one list for the host (`sidebar-pins-v1`): the pins that are still in
 * `current`, in the order of the last list that the host gave, then the new agent and channel pins.
 * The desktop app mixes agents and channels in one order, and this keeps that order.
 */
export function phoneSidebarPins(current: RemoteWorkspacePreferences): SidebarPin[] {
  const wanted = [
    ...current.pinned.map((id) => ({ kind: "agent" as const, id })),
    ...(current.pinnedChannels ?? []).map((id) => ({ kind: "channel" as const, id })),
  ];
  const keys = new Set(wanted.map(sidebarPinKey));
  const ordered = (current.pinOrder ?? []).filter((pin) => keys.has(sidebarPinKey(pin)));
  const placed = new Set(ordered.map(sidebarPinKey));
  return [...ordered.map(({ kind, id }) => ({ kind, id })), ...wanted.filter((pin) => !placed.has(sidebarPinKey(pin)))];
}

/** True when the pins of this phone differ from the last list that the host gave. */
export function sidebarPinsChanged(current: RemoteWorkspacePreferences): boolean {
  const order = current.pinOrder;
  if (!order) return false;
  const pins = phoneSidebarPins(current);
  return (
    pins.length !== order.length ||
    pins.some((pin, index) => {
      const saved = order[index];
      return saved === undefined || sidebarPinKey(pin) !== sidebarPinKey(saved);
    })
  );
}

/** The preferences with the list that the host keeps for all devices of the user. */
export function withHostSidebarPins(
  current: RemoteWorkspacePreferences,
  items: readonly SidebarPin[],
): RemoteWorkspacePreferences {
  const { pinsPending: _pending, ...rest } = current;
  return {
    ...rest,
    pinned: items.flatMap((pin) => (pin.kind === "agent" ? [pin.id] : [])),
    pinnedChannels: items.flatMap((pin) => (pin.kind === "channel" ? [pin.id] : [])),
    pinOrder: items.map(({ kind, id }) => ({ kind, id })),
  };
}
