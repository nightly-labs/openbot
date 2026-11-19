import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";

export function useChannelSubscription(serverId: string) {
  const { channelStore } = useMobileWorkspaceActions();
  const subscribe = useCallback(
    (listener: () => void) => channelStore.subscribe(serverId, listener),
    [channelStore, serverId],
  );
  return { channelStore, subscribe };
}

export function useChannels(serverId: string, channelId?: string) {
  const { channelStore, subscribe } = useChannelSubscription(serverId);
  const snapshot = useCallback(() => channelStore.get(serverId), [channelStore, serverId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(
    () => (channelId ? channelStore.observe(serverId, channelId) : undefined),
    [channelStore, serverId, channelId],
  );
  return { ...state, store: channelStore };
}

export function useChannel(serverId: string, channelId: string) {
  const { channelStore, subscribe } = useChannelSubscription(serverId);
  const snapshot = useCallback(
    () => channelStore.channelView(serverId, channelId),
    [channelStore, serverId, channelId],
  );
  const view = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => channelStore.observe(serverId, channelId), [channelStore, serverId, channelId]);
  return { ...view, store: channelStore };
}

export function useChannelList(serverId: string) {
  const { channelStore, subscribe } = useChannelSubscription(serverId);
  const snapshot = useCallback(() => channelStore.get(serverId).channels, [channelStore, serverId]);
  return useSyncExternalStore(subscribe, snapshot);
}
