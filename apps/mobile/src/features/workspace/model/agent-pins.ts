import { type SidebarPin, sidebarPinKey } from "@openbot/contracts/ipc";
import type { createWorkspacePreferences, RemoteWorkspacePreferences } from "@openbot/team-client";

const MAX_PINNED_AGENTS = 16;

export function canToggleChatPin(
  pinnedAgentIds: readonly string[],
  pinnedChannelIds: readonly string[],
  chatId: string,
): boolean {
  return (
    pinnedAgentIds.includes(chatId) ||
    pinnedChannelIds.includes(chatId) ||
    pinnedAgentIds.length + pinnedChannelIds.length < MAX_PINNED_AGENTS
  );
}

export function canAddChatPin(count: number): boolean {
  return count < MAX_PINNED_AGENTS;
}

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

export function samePinList(left: readonly SidebarPin[], right: readonly SidebarPin[]): boolean {
  return (
    left.length === right.length &&
    left.every((pin, index) => {
      const other = right[index];
      return other !== undefined && sidebarPinKey(pin) === sidebarPinKey(other);
    })
  );
}

export function sidebarPinsChanged(
  current: RemoteWorkspacePreferences,
  previous?: RemoteWorkspacePreferences,
): boolean {
  const order = current.pinOrder;
  if (!order) return false;
  const pins = phoneSidebarPins(current);
  return (
    !samePinList(pins, order) || (previous?.pinsPending === true && !samePinList(pins, phoneSidebarPins(previous)))
  );
}

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

export function withPhoneSidebarPins(
  current: RemoteWorkspacePreferences,
  items: readonly SidebarPin[],
): RemoteWorkspacePreferences {
  return {
    ...current,
    pinned: items.flatMap((pin) => (pin.kind === "agent" ? [pin.id] : [])),
    pinnedChannels: items.flatMap((pin) => (pin.kind === "channel" ? [pin.id] : [])),
    ...(current.pinOrder ? { pinOrder: items.map(({ kind, id }) => ({ kind, id })) } : {}),
  };
}
