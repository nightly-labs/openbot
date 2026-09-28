import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useServers } from "../servers/servers-context";
import { usePresence } from "../team/team-context";
import { ChannelConversation } from "./ChannelConversation";
import { isOwnChannelAuthor } from "./channel-timeline";

/** The desktop's open channel: the reader, the waiting requests and the browser tabs come from its contexts. */
export function WorkspaceChannelConversation() {
  const { selectAgent } = useNavigation();
  const { centralAuth } = useAuth();
  const { currentTeamMember } = usePresence();
  const { activeServer } = useServers();
  const { pendingApprovals, pendingPrompts } = useTurns();
  const { browserTabs } = useBrowserTabs();
  const pendingTakeovers = createMemo(() => {
    const takeovers: Record<string, BrowserTakeoverRequest | undefined> = {};
    for (const [agentId, event] of Object.entries(pendingPrompts()))
      if (event?.type === "browser-takeover-requested") takeovers[agentId] = event.request;
    return takeovers;
  });
  return (
    <ChannelConversation
      isOwnMessage={(authorId) => {
        const auth = centralAuth();
        return isOwnChannelAuthor(authorId, {
          memberId: currentTeamMember()?.id ?? null,
          accountUserId: auth.status === "signed_in" ? auth.user.id : null,
          onOwnComputer: activeServer()?.kind === "local",
        });
      }}
      pendingApprovals={pendingApprovals()}
      pendingTakeovers={pendingTakeovers()}
      browserTabs={browserTabs()}
      onSelectAgent={selectAgent}
    />
  );
}
