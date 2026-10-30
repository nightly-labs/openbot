import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAgentActivity } from "@/features/workspace/components/use-agent-activity";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";

/**
 * The channel where this agent waits for the user, or null: its wait is on a channel thread. A host
 * without channel-attention-v1 names no threads, so its waits are not in a channel. The channel
 * list changes while replies stream, so the selector returns a key, and the component renders again
 * only when the channel changes.
 */
export function useWaitingChannel(agentId: string, serverId: string): { id: string; name: string } | null {
  const { channelStore } = useMobileWorkspaceActions();
  const activity = useAgentActivity(agentId);
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
