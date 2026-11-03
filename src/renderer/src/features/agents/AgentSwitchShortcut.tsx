import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import { createMemo, onSettled } from "solid-js";
import { agentSwitchIndex } from "../../agent-switch-shortcut";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useSidebar } from "../sidebar/sidebar-context";
import { useAgents } from "./agents-context";

/**
 * `Cmd+Option+1-9` on macOS and `Ctrl+Alt+1-9` elsewhere open the agents in the order the sidebar draws
 * them: the pinned strip, then each section, collapsed ones included. A hidden agent has no number.
 * It renders nothing.
 */
export function AgentSwitchShortcut() {
  const platform = usePlatform();
  const { agentList, userHiddenAgentIds } = useAgents();
  const { sidebarLayout, pinnedSidebarItems } = useSidebar();
  const { selectAgent } = useNavigation();
  const numbered = createMemo(() => {
    const hiddenAgentIds = userHiddenAgentIds();
    return sidebarAgentOrder(
      agentList().filter((agent) => !hiddenAgentIds.has(agent.id)),
      { layout: sidebarLayout(), pinnedItems: pinnedSidebarItems(), hiddenAgentIds },
    );
  });

  onSettled(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const appInfo = platform.appInfo();
      if (platform.landingPreview || !appInfo || event.defaultPrevented) return;
      const index = agentSwitchIndex(event, appInfo.platform === "darwin");
      if (index === null) return;
      const agent = numbered()[index];
      if (!agent) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectAgent(agent.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return null;
}
