import { router } from "expo-router";
import { createContext, useContext, useMemo } from "react";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { selectLiveState } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";

/**
 * Opens the browser tab that a tag in a message names, as a click on the desktop chip does.
 * Undefined where the phone cannot show the host's browser: the tag is then a badge only.
 */
export type OpenTaggedTab = (tabId: string) => void;

export const ChatTagActionsContext = createContext<OpenTaggedTab | undefined>(undefined);

/** The opener of the message list around this component. */
export function useOpenTaggedTab(): OpenTaggedTab | undefined {
  return useContext(ChatTagActionsContext);
}

/**
 * The opener for the messages of one server. It reads the tab list at the tap, so a list change does
 * not draw the messages again. The tab opens in the browser of its owner agent. A tab that the host
 * closed, or that has no owner agent, opens nothing, as on the desktop.
 */
export function useTaggedTabOpener(serverId: string): OpenTaggedTab | undefined {
  const browserAllowed = useBrowserFeature();
  const browserView = useMobileWorkspaceSelector((current) => current.browserViewSupport(serverId).view);
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  return useMemo(() => {
    if (!browserAllowed || !browserView) return undefined;
    return (tabId: string) => {
      const tab = liveState.get().browserTabs[serverId]?.tabs.find((candidate) => candidate.id === tabId);
      if (!tab?.ownerAgentId) {
        void haptics.notification("warning");
        return;
      }
      void haptics.selection();
      router.push({ pathname: "/browser/[agentId]", params: { agentId: tab.ownerAgentId, serverId, tabId } });
    };
  }, [browserAllowed, browserView, liveState, serverId]);
}
