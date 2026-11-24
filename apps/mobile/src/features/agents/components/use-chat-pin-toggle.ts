import type { ChannelSummary } from "@openbot/contracts/ipc";
import { useMemo } from "react";
import { clearPinMotion, markPinMotion } from "@/features/agents/components/agent-pin-motion";
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
      if (!canToggleChatPin(pinnedAgentIds, pinnedChannelIds, chatId)) return;
      markPinMotion(chatId, pinned ? "unpin" : "pin");
      if (commit() === "error") {
        clearPinMotion();
        return;
      }
      if (options?.haptic !== false) void haptics.selection();
    };
    return {
      toggleAgentPin: (agentId: string, options?: PinToggleOptions) =>
        toggle(
          agentId,
          workspace().pinnedAgentIds.includes(agentId),
          () => workspace().toggleAgentPin(agentId),
          options,
        ),
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
