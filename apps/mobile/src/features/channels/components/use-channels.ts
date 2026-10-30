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
