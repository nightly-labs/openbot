import { useEffect, useRef } from "react";
import { appLockBlocks, useAppLock } from "@/features/app-lock/model/app-lock";
import { useUnreadAgentIds } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { chatBubbleNative } from "./chat-bubble-native";
import { isBubbleActivityAlive } from "./model/chat-bubble-activity";
import { writeChatBubbleConfig } from "./model/chat-bubble-config";
import { bubbleEnabledFor, useChatBubblePreference } from "./model/chat-bubble-preference";

export function useChatBubbleSync(): void {
  const preference = useChatBubblePreference();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const unreadAgentIds = useUnreadAgentIds();
  const locked = useAppLock(appLockBlocks);
  const previousUnread = useRef<readonly string[]>([]);
  const previousLocked = useRef(locked);

  useEffect(() => {
    writeChatBubbleConfig(preference, agents, locked);
  }, [preference, agents, locked]);

  useEffect(() => {
    const previous = previousUnread.current;
    previousUnread.current = unreadAgentIds;
    if (!chatBubbleNative || previous.length === 0) return;
    const unread = new Set(unreadAgentIds);
    for (const agentId of previous) {
      if (unread.has(agentId)) continue;
      const agent = agents.find((item) => item.id === agentId);
      if (!agent || !bubbleEnabledFor(preference, agent.serverId, agent.id)) continue;
      if (isBubbleActivityAlive(agent.serverId, agent.id)) continue;
      chatBubbleNative.dismiss(agent.serverId, agent.id);
    }
  }, [unreadAgentIds, agents, preference]);

  useEffect(() => {
    const was = previousLocked.current;
    previousLocked.current = locked;
    if (!locked || was || !chatBubbleNative) return;
    for (const agent of agents) {
      if (!bubbleEnabledFor(preference, agent.serverId, agent.id)) continue;
      chatBubbleNative.dismiss(agent.serverId, agent.id);
    }
  }, [locked, agents, preference]);
}
