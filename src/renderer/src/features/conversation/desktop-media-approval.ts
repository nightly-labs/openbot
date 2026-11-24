import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { useWindowPage } from "../window/window-page-context";
import { creditsHoldControls } from "./credits-hold-controls";
import { desktopMediaApprovalDefault } from "./media-approval-default";

export function useDesktopMediaApproval(): MediaApprovalControls {
  const { activeServer, activeServerId } = useServers();
  const { agentList } = useAgents();
  const { readMediaApproval, respondToMediaApproval, respondToCreditsHold, setCreditsAskMuted } = useTurns();
  const windowPage = useWindowPage();
  return {
    read: readMediaApproval,
    allow: respondToMediaApproval,
    setDefault: desktopMediaApprovalDefault(activeServerId),
    hold: creditsHoldControls({
      agents: agentList,
      credits: windowPage.creditsMenu,
      walletId: () =>
        activeServer()?.kind === "local" ? (windowPage.creditsMenu().localServerId ?? null) : activeServerId(),
      serverId: () => activeServer()?.id,
      respond: respondToCreditsHold,
      setMuted: setCreditsAskMuted,
    }),
  };
}
