import { useEffect, useRef } from "react";
import { useUnreadAgentIds } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { chatBubbleNative } from "./chat-bubble-native";
import { writeChatBubbleConfig } from "./model/chat-bubble-config";
import { bubbleEnabledFor, useChatBubblePreference } from "./model/chat-bubble-preference";

export function useChatBubbleSync(): void {
  const preference = useChatBubblePreference();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const unreadAgentIds = useUnreadAgentIds();
  const previousUnread = useRef<readonly string[]>([]);

  useEffect(() => {
    writeChatBubbleConfig(preference, agents);
  }, [preference, agents]);

  useEffect(() => {
    const previous = previousUnread.current;
    previousUnread.current = unreadAgentIds;
    if (!chatBubbleNative || previous.length === 0) return;
    const unread = new Set(unreadAgentIds);
    for (const agentId of previous) {
      if (unread.has(agentId)) continue;
      const agent = agents.find((item) => item.id === agentId);
      if (!agent || !bubbleEnabledFor(preference, agent.serverId, agent.id)) continue;
      chatBubbleNative.dismiss(agent.serverId, agent.id);
    }
  }, [unreadAgentIds, agents, preference]);
}
