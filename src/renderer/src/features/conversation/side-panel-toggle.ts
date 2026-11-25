import type { SidePanelToggleProps } from "@openbot/ui/features/conversation/SidePanel";
import { useText } from "@openbot/ui/text";
import { useConversationViewScope } from "./conversation-scope";

export function useSidePanelToggle(): () => SidePanelToggleProps | undefined {
  const { t } = useText();
  const { actingBrowserControl, browserControlAgent, channel, sidePanelOpen, toggleSidePanel } =
    useConversationViewScope();
  return () =>
    channel?.readOnly()
      ? undefined
      : {
          open: sidePanelOpen(),
          actingAgentName: actingBrowserControl()
            ? (browserControlAgent()?.name ?? t("conversation.header.agentFallback"))
            : undefined,
          onToggle: toggleSidePanel,
        };
}
