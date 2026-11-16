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
