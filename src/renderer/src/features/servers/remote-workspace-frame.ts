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

/**
 * The frame of a joined server's workspace from its last load: the agents, their sidebar layout and
 * the models. A client shows it while it connects again, read-only, and the next load replaces it.
 * It holds no message text: the last message of each agent (`preview`) is removed before the write,
 * and a channel keeps only its row: no last message, no instructions, no counts.
 * The frame is of one account and one server, and it is deleted on sign-out, when the server leaves
 * the list, and when the host ends access.
 */
export interface RemoteWorkspaceFrame {
  agents: ClientAgentSummary[];
  models: ClientAgentModelOption[];
  sidebarLayout: SidebarLayoutSnapshot | null;
  hiddenAgents: HiddenAgent[];
  /** The channel rows of the sidebar, so the agents below them do not move when the list comes. */
  channels: ChannelSummary[];
  /** The agent that was open, on the web. The desktop app keeps its own selection. */
  selectedAgentId: string | null;
}

type FrameStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const FRAME_KEY_PREFIX = "openbot:remote-frame:v1:";
/** An older frame shows a workspace that has changed too much to be useful. */
const FRAME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function frameKey(accountId: string, serverId: string): string {
  return `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(serverId)}`;
}

/** A channel row with no text but its name and title. */
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
  };
}

/** The saved frame, or null when there is none, when it is too old, or when it does not decode. */
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

/**
 * Writes the given parts over the saved frame. The reads of a load answer in any order, so a layout
 * can come before the agents. A frame with no agents is not shown.
 */
export function saveRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  update: Partial<RemoteWorkspaceFrame>,
  storage: FrameStorage = window.localStorage,
): void {
  const current = readRemoteWorkspaceFrame(accountId, serverId, storage);
  const agents = update.agents ?? current?.agents ?? [];
  const frame = {
    savedAt: Date.now(),
    agents: agents.map((agent) => ({ ...agent, preview: "" })),
    models: update.models ?? current?.models ?? [],
    sidebarLayout: update.sidebarLayout ?? current?.sidebarLayout ?? null,
    hiddenAgents: update.hiddenAgents ?? current?.hiddenAgents ?? [],
    channels: (update.channels ?? current?.channels ?? []).map(frameChannel),
    selectedAgentId: update.selectedAgentId !== undefined ? update.selectedAgentId : (current?.selectedAgentId ?? null),
  };
  try {
    storage.setItem(frameKey(accountId, serverId), JSON.stringify(frame));
  } catch {
    // A full or blocked storage only costs the frame. The workspace still loads from the host.
  }
}

/** The last channel rows written for each frame. A channel list comes on each channel event. */
const savedChannelRows = new Map<string, string>();

/** Writes the channel rows of a list to the frame when they changed since the last write. */
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

function frameKeys(storage: FrameStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Deletes the frames of an account. With `keepServerIds`, the frames of those servers stay; without
 * it, the frames of every account go, as after a sign-out.
 */
export function deleteRemoteWorkspaceFrames(
  accountId: string | null,
  keepServerIds: readonly string[] = [],
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.clear();
  try {
    const prefix = accountId === null ? FRAME_KEY_PREFIX : `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:`;
    const kept = new Set(accountId === null ? [] : keepServerIds.map((serverId) => frameKey(accountId, serverId)));
    for (const key of frameKeys(storage, prefix)) if (!kept.has(key)) storage.removeItem(key);
  } catch {
    // Blocked storage holds no frame.
  }
}

export function deleteRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.delete(frameKey(accountId, serverId));
  try {
    storage.removeItem(frameKey(accountId, serverId));
  } catch {
    // Blocked storage holds no frame.
  }
}
