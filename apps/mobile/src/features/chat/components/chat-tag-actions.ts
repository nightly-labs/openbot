import { router } from "expo-router";
import { createContext, useContext, useMemo } from "react";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { selectLiveState } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";

export type OpenTaggedTab = (tabId: string) => void;

export const ChatTagActionsContext = createContext<OpenTaggedTab | undefined>(undefined);

export function useOpenTaggedTab(): OpenTaggedTab | undefined {
  return useContext(ChatTagActionsContext);
}

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
