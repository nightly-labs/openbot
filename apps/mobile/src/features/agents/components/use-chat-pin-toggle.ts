import type { ChannelSummary } from "@openbot/contracts/ipc";
import { useMemo } from "react";
import { clearPinMotion, isPinMotionRunning, markPinMotion } from "@/features/agents/components/agent-pin-motion";
import { useMobileWorkspaceReader } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleChatPin } from "@/features/workspace/model/agent-pins";
import { haptics } from "@/shared/lib/haptics";

interface PinToggleOptions {
  haptic: boolean;
}

export function useChatPinToggle() {
  const workspace = useMobileWorkspaceReader();
  return useMemo(() => {
    const toggle = (chatId: string, pinned: boolean, commit: () => string, options?: PinToggleOptions) => {
      const { pinnedAgentIds, pinnedChannelIds } = workspace();
      if (isPinMotionRunning(chatId) || !canToggleChatPin(pinnedAgentIds, pinnedChannelIds, chatId)) return;
      markPinMotion(chatId, pinned ? "unpin" : "pin");
      if (options?.haptic !== false) void haptics.selection();
      const save = () => {
        if (commit() === "error") clearPinMotion(chatId);
      };
      if (pinned) save();
      else requestAnimationFrame(save);
    };
    return {
      toggleAgentPin: (agentId: string, options?: PinToggleOptions) => {
        const { agents, pinnedAgentIds } = workspace();
        if (!agents.some((agent) => agent.id === agentId)) return;
        toggle(agentId, pinnedAgentIds.includes(agentId), () => workspace().toggleAgentPin(agentId), options);
      },
      toggleChannelPin: (channel: ChannelSummary, serverId: string, options?: PinToggleOptions) =>
        toggle(
          channel.id,
          workspace().pinnedChannelIds.includes(channel.id),
          () => workspace().toggleChannelPin(channel.id, serverId),
          options,
        ),
    };
  }, [workspace]);
}
