import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { useChannelSubscription } from "./use-channels";

/**
 * The channel where this agent waits for the user, or null: its wait is on a channel thread. A host
 * without channel-attention-v1 names no threads, so its waits are not in a channel. The channel
 * list changes while replies stream, so the selector returns a key, and the component renders again
 * only when the channel changes.
 *
 * `activity` is the activity of the agent's own chat (`useAgentActivity`) or the activity of the home
 * list (`useAgentListActivity`). Both give the same thread: the list keeps a wait of the own chat as
 * it is, and a wait of a side thread names no thread. The caller reads it, so a row reads it once.
 */
export function useWaitingChannel(
  activity: MobileAgentActivity | undefined,
  serverId: string,
): { id: string; name: string } | null {
  const { channelStore, subscribe } = useChannelSubscription(serverId);
  const threadId = activity?.phase === "waiting" ? (activity.threadId ?? null) : null;
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
