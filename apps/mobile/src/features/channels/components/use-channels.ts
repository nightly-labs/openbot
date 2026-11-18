import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";

export function useChannels(serverId: string, channelId?: string) {
  const { channelStore } = useMobileWorkspaceActions();
  const subscribe = useCallback(
    (listener: () => void) => channelStore.subscribe(serverId, listener),
    [channelStore, serverId],
  );
  const snapshot = useCallback(() => channelStore.get(serverId), [channelStore, serverId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(
    () => (channelId ? channelStore.observe(serverId, channelId) : undefined),
    [channelStore, serverId, channelId],
  );
  return { ...state, store: channelStore };
}

/**
 * One channel of a server, and the server flags. The value stays the same while the list row, the page
 * and the flags of this channel stay the same, so a change to another channel does not render the caller
 * again. The page of the channel loads while the caller is mounted.
 */
export function useChannel(serverId: string, channelId: string) {
  const { channelStore } = useMobileWorkspaceActions();
  const subscribe = useCallback(
    (listener: () => void) => channelStore.subscribe(serverId, listener),
    [channelStore, serverId],
  );
  const snapshot = useCallback(
    () => channelStore.channelView(serverId, channelId),
    [channelStore, serverId, channelId],
  );
  const view = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => channelStore.observe(serverId, channelId), [channelStore, serverId, channelId]);
  return { ...view, store: channelStore };
}

/**
 * Only the channel list of a server. The list keeps its identity while it stays the same, so a
 * message page that changes, such as on each event of a channel reply, does not render the caller again.
 */
export function useChannelList(serverId: string) {
  const { channelStore } = useMobileWorkspaceActions();
  const subscribe = useCallback(
    (listener: () => void) => channelStore.subscribe(serverId, listener),
    [channelStore, serverId],
  );
  const snapshot = useCallback(() => channelStore.get(serverId).channels, [channelStore, serverId]);
  return useSyncExternalStore(subscribe, snapshot);
}
