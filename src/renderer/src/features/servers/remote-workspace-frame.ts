import {
  type Channel,
  type ChannelSummary,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type HiddenAgent,
  isChannel,
  isClientAgentModelOption,
  isClientAgentSummary,
  isHiddenAgent,
  isSidebarLayoutSnapshot,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export interface RemoteWorkspaceFrame {
  agents: ClientAgentSummary[];
  models: ClientAgentModelOption[];
  sidebarLayout: SidebarLayoutSnapshot | null;
  hiddenAgents: HiddenAgent[];
  channels: ChannelSummary[];
  selectedAgentId: string | null;
  recentAgentIds: string[];
  unreadCounts: Record<string, number>;
}

type FrameStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const FRAME_KEY_PREFIX = "openbot:remote-frame:v1:";
const RECENT_AGENTS = 4;
const FRAME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function frameKey(accountId: string, serverId: string): string {
  return `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(serverId)}`;
}

function frameChannel(channel: Channel): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    title: channel.title,
    instructions: "",
    members: channel.members.map((member) => ({ agentId: member.agentId })),
    leadAgentId: channel.leadAgentId,
    archived: channel.archived,
    revision: channel.revision,
    createdAt: channel.createdAt,
    unreadCount: 0,
    activeTasks: 0,
    lastMessage: null,
  };
}

function decodeFrame(frame: unknown): RemoteWorkspaceFrame | null {
  if (!isDynamicRecord(frame) || !isNumber(frame.savedAt) || Date.now() - frame.savedAt > FRAME_MAX_AGE_MS) return null;
  if (!Array.isArray(frame.agents) || !frame.agents.every(isClientAgentSummary)) return null;
  return {
    agents: frame.agents,
    models: Array.isArray(frame.models) ? frame.models.filter(isClientAgentModelOption) : [],
    sidebarLayout: isSidebarLayoutSnapshot(frame.sidebarLayout) ? frame.sidebarLayout : null,
    hiddenAgents: Array.isArray(frame.hiddenAgents) ? frame.hiddenAgents.filter(isHiddenAgent) : [],
    channels: Array.isArray(frame.channels) ? frame.channels.filter(isChannel).map(frameChannel) : [],
    selectedAgentId: isString(frame.selectedAgentId) ? frame.selectedAgentId : null,
    recentAgentIds: Array.isArray(frame.recentAgentIds) ? frame.recentAgentIds.filter(isString) : [],
    unreadCounts: unreadCounts(frame.unreadCounts),
  };
}

function unreadCounts(counts: unknown): Record<string, number> {
  if (!isDynamicRecord(counts)) return {};
  return Object.fromEntries(
    Object.entries(counts).flatMap(([agentId, count]) => (isNumber(count) && count > 0 ? [[agentId, count]] : [])),
  );
}

export function readRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  storage: FrameStorage = window.localStorage,
): RemoteWorkspaceFrame | null {
  try {
    const raw = storage.getItem(frameKey(accountId, serverId));
    return raw ? decodeFrame(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  update: Partial<Omit<RemoteWorkspaceFrame, "recentAgentIds">>,
  storage: FrameStorage = window.localStorage,
): void {
  const current = readRemoteWorkspaceFrame(accountId, serverId, storage);
  const agents = update.agents ?? current?.agents ?? [];
  const recent = current?.recentAgentIds ?? [];
  const selected = update.selectedAgentId;
  const frame = {
    savedAt: Date.now(),
    agents: agents.map((agent) => ({ ...agent, preview: "" })),
    models: update.models ?? current?.models ?? [],
    sidebarLayout: update.sidebarLayout ?? current?.sidebarLayout ?? null,
    hiddenAgents: update.hiddenAgents ?? current?.hiddenAgents ?? [],
    channels: (update.channels ?? current?.channels ?? []).map(frameChannel),
    selectedAgentId: update.selectedAgentId !== undefined ? update.selectedAgentId : (current?.selectedAgentId ?? null),
    recentAgentIds: selected ? [selected, ...recent.filter((id) => id !== selected)].slice(0, RECENT_AGENTS) : recent,
    unreadCounts: unreadCounts(update.unreadCounts ?? current?.unreadCounts ?? {}),
  };
  try {
    storage.setItem(frameKey(accountId, serverId), JSON.stringify(frame));
  } catch {}
}

const savedChannelRows = new Map<string, string>();

export function saveRemoteFrameChannels(
  accountId: string,
  serverId: string,
  channels: readonly ChannelSummary[],
): void {
  const rows = channels.map(frameChannel);
  const key = frameKey(accountId, serverId);
  const value = JSON.stringify(rows);
  if (savedChannelRows.get(key) === value) return;
  savedChannelRows.set(key, value);
  saveRemoteWorkspaceFrame(accountId, serverId, { channels: rows });
}

const savedUnreadCounts = new Map<string, string>();

export function saveRemoteFrameUnreadCounts(
  accountId: string,
  serverId: string,
  counts: Readonly<Record<string, number>>,
): void {
  const key = frameKey(accountId, serverId);
  const value = JSON.stringify(counts);
  if (savedUnreadCounts.get(key) === value) return;
  savedUnreadCounts.set(key, value);
  saveRemoteWorkspaceFrame(accountId, serverId, { unreadCounts: { ...counts } });
}

function frameKeys(storage: FrameStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

export function deleteRemoteWorkspaceFrames(
  accountId: string | null,
  keepServerIds: readonly string[] = [],
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.clear();
  savedUnreadCounts.clear();
  try {
    const prefix = accountId === null ? FRAME_KEY_PREFIX : `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:`;
    const kept = new Set(accountId === null ? [] : keepServerIds.map((serverId) => frameKey(accountId, serverId)));
    for (const key of frameKeys(storage, prefix)) if (!kept.has(key)) storage.removeItem(key);
  } catch {}
}

export function deleteRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.delete(frameKey(accountId, serverId));
  savedUnreadCounts.delete(frameKey(accountId, serverId));
  try {
    storage.removeItem(frameKey(accountId, serverId));
  } catch {}
}
