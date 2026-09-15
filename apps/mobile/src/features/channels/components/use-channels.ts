import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function useChannels(serverId: string, channelId?: string) {
  const { channelStore } = useMobileWorkspace();
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
