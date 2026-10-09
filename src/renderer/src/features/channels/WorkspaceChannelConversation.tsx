import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useBrowserTabs } from "../browser/browser-context";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServerScope } from "../servers/server-scope";
import { useServers } from "../servers/servers-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { ChannelConversation } from "./ChannelConversation";

/** The desktop's open channel: the reader, the waiting requests and the browser tabs come from its contexts. */
export function WorkspaceChannelConversation() {
  const platform = usePlatform();
  const scope = useServerScope();
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
      connectionReady={scope.loaded()}
      platform={platform.appInfo()?.platform}
      isOwnMessage={(authorId) => {
        const auth = centralAuth();
        return isReaderAuthor(authorId, {
          memberId: currentTeamMember()?.id ?? null,
          accountUserId: auth.status === "signed_in" ? auth.user.id : null,
          onOwnComputer: activeServer()?.kind === "local",
        });
      }}
      pendingApprovals={pendingApprovals()}
      pendingTakeovers={pendingTakeovers()}
      browserTabs={browserTabs()}
      onSelectAgent={selectAgent}
      localHost={activeServer()?.kind === "local"}
      eventsServerId={serverCanAdminister(activeServer(), "events-v1") ? activeServer()?.id : undefined}
    />
  );
}
