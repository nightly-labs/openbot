import type { Href } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { useChannelSubscription } from "./use-channels";

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

export function waitingChannelHref(
  channelId: string,
  serverId: string,
  agentId: string,
  activity: MobileAgentActivity,
): Href {
  return {
    pathname: "/channel/[channelId]",
    params:
      activity.phase === "waiting" && activity.reason === "question"
        ? { channelId, serverId, questionAgentId: agentId }
        : { channelId, serverId },
  };
}
