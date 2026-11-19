import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";

export function useWaitingChannel(
  activity: MobileAgentActivity | undefined,
  serverId: string,
): { id: string; name: string } | null {
  const { channelStore } = useMobileWorkspaceActions();
  const threadId = activity?.phase === "waiting" ? (activity.threadId ?? null) : null;
  const subscribe = useCallback(
    (listener: () => void) => channelStore.subscribe(serverId, listener),
    [channelStore, serverId],
  );
  const select = useCallback(() => {
    if (!threadId) return "";
    const channel = channelStore
      .get(serverId)
      .channels.find((item) => !item.archived && item.threads?.some((thread) => thread.threadId === threadId));
    return channel ? `${channel.id}\n${channel.name}` : "";
  }, [channelStore, serverId, threadId]);
  const key = useSyncExternalStore(subscribe, select);
  return useMemo(() => {
    if (!key) return null;
    const [id = "", ...name] = key.split("\n");
    return { id, name: name.join("\n") };
  }, [key]);
}
