import type { AgentStatus, BrowserTakeoverRequest, CentralAuthUser } from "@openbot/contracts/ipc";
import { hasVisibleToasts } from "@openbot/ui";
import { createMemo, Show } from "solid-js";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { quitShortcutHintShown } from "../../quit-shortcut-hint";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useConnectors } from "../connectors/connectors-context";
import { Conversation } from "../conversation/Conversation";
import { trackUsageLimitShown, useUsageLimitAsk } from "../conversation/usage-limit-ask";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import {
  remoteRoutineRecovery,
  serverCanAdminister,
  serverSendsWebhookTests,
  serverSetsWebhookSenderSecret,
  serverSupportsCapability,
} from "../servers/server-capabilities";
import { createServerResponseStyle } from "../servers/server-personality";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { useWindowPage } from "../window/window-page-context";
import { ChannelErrorNotice } from "./ChannelConversationParts";
import { createChannelConversation } from "./channel-conversation";
import { useChannels } from "./channels-context";

/**
 * The desktop's open channel in the conversation view. The reader, the waiting requests and the
 * browser tabs come from the desktop contexts. Keyed by the channel id: the view reads its channel
 * once, so another channel opens a new view.
 */
export function WorkspaceChannelConversation(props: { account: () => CentralAuthUser }) {
  const channels = useChannels();
  return (
    <Show when={channels.state.selectedId} keyed>
      {(channelId) => <DesktopChannelConversation channelId={channelId} account={props.account} />}
    </Show>
  );
}

function DesktopChannelConversation(props: { channelId: string; account: () => CentralAuthUser }) {
  const channels = useChannels();
  const platform = usePlatform();
  const scope = useServerScope();
  const connectors = useConnectors();
  const { selectAgent, messageFocusRequest, globalSearchOpen } = useNavigation();
  const auth = useAuth();
  const { teamPresence, currentTeamMember } = usePresence();
  const { activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { serverSettingsOpen } = useServerSettings();
  const { appSettingsOpen, skillsMarketplaceOpen, generalSettings } = useSettings();
  const { agentStatus, agentList, updateAgent, setAgentAvatar, userPausedAgentIds } = useAgents();
  const { approvals, pendingPrompts, usageLimits } = useTurns();
  const {
    browserTabs,
    activeBrowserTabId,
    browserVisibilitySuspended,
    browserControlState,
    activateBrowserTab,
    closeBrowserTab,
  } = useBrowserTabs();
  const { activeRemoteDesktopSession, remoteDesktopWorkspaceVisible, openRemoteDesktopWorkspace } = useRemoteDesktop();
  const windowPage = useWindowPage();
  const isOwnSender = (senderId: string) => {
    const state = auth.centralAuth();
    return isReaderAuthor(senderId, {
      memberId: currentTeamMember()?.id ?? null,
      accountUserId: state.status === "signed_in" ? state.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };
  const takeovers = createMemo(() => {
    const requests: BrowserTakeoverRequest[] = [];
    for (const event of Object.values(pendingPrompts()))
      if (event?.type === "browser-takeover-requested") requests.push(event.request);
    return requests;
  });
  const view = createChannelConversation({
    channelId: props.channelId,
    isOwnSender,
    connectionReady: () => scope.loaded(),
    routines: {
      localHost: () => activeServer()?.kind === "local",
      onceSchedule: () => serverSupportsCapability(activeServer(), "routines-once-v1"),
      eventsServerId: () => (serverCanAdminister(activeServer(), "events-v1") ? activeServer()?.id : undefined),
      routineRecovery: () => remoteRoutineRecovery(activeServer()),
      webhookTests: () => serverSendsWebhookTests(activeServer()),
      webhookSenderSecret: () => serverSetsWebhookSenderSecret(activeServer()),
    },
    approvals,
    takeovers,
    pausedAgentIds: userPausedAgentIds,
  });
  // A usage limit that holds the member whose turn a queued request waits for, the lead while no member
  // owns it, asks where that member's work goes, as the agent's own chat does. Before, the channel only
  // went quiet.
  const usageLimitAskFor = useUsageLimitAsk();
  // The first held agent that asks: one that the user chose to wait for asks no more.
  const usageLimitAsk = createMemo(() => {
    const page = channels.state.page;
    if (page?.channel.id !== props.channelId || page.channel.archived) return undefined;
    const limits = usageLimits();
    for (const task of page.tasks) {
      const agentId = task.ownerAgentId ?? page.channel.leadAgentId;
      if (task.state !== "queued" || !agentId || !(agentId in limits)) continue;
      const ask = usageLimitAskFor(
        agentList().find((agent) => agent.id === agentId),
        true,
      );
      if (ask) return { agentId, ask };
    }
    return undefined;
  });
  trackUsageLimitShown(usageLimitAsk);
  // A named function, not a ternary in the prop: the compiler makes a memo for a ternary, and the
  // composer reads this prop in an effect, where Solid cannot make a memo.
  const shownAgentStatus = (): AgentStatus =>
    scope.loaded() ? agentStatus() : { ...agentStatus(), phase: "starting" };
  const responseStyle = createServerResponseStyle(activeServer, window.openbot.hostAdmin);
  return (
    <Conversation
      channel={view.source}
      notice={<ChannelErrorNotice />}
      platform={platform.appInfo()?.platform}
      connectors={connectors.active}
      agentStatus={shownAgentStatus()}
      agent={undefined}
      agents={agentList()}
      mentionAgents={view.mentionAgents()}
      modelOptions={[]}
      messages={view.messages()}
      unreadCount={view.unreadCount()}
      firstUnreadMessageId={view.firstUnreadMessageId()}
      loaded={view.loaded()}
      hasOlder={view.hasOlder()}
      unloadedHistory={view.unloadedHistory()}
      queue={undefined}
      browserTabs={browserTabs()}
      activeBrowserTabId={activeBrowserTabId()}
      browserVisibilitySuspended={browserVisibilitySuspended()}
      workspaceCovered={windowPage.conversationCovered()}
      browserControlState={browserControlState()}
      server={activeServer()}
      responseStyle={responseStyle()}
      presence={teamPresence()}
      currentUserEmail={props.account().email}
      isOwnSender={isOwnSender}
      browserEnabled={!platform.landingPreview && activeServerSupportsCapability("browser-control")}
      openLinksInBrowser={generalSettings().externalLinkTarget.kind === "openbot"}
      remoteDesktopSessionActive={Boolean(activeRemoteDesktopSession())}
      remoteDesktopVisible={remoteDesktopWorkspaceVisible()}
      remoteDesktopEnabled={!platform.landingPreview && activeServerSupportsCapability("remote-desktop")}
      prompt={view.prompt()}
      promptUiBlock={view.promptUiBlock()}
      approval={view.approval()}
      usageLimitAsk={usageLimitAsk()?.ask}
      browserTakeover={view.browserTakeover()}
      activeTurnId={view.activeTurnId()}
      skillsMarketplaceOpen={skillsMarketplaceOpen()}
      mcpSettingsOpen={serverSettingsOpen() || skillsMarketplaceOpen()}
      globalOverlayOpen={
        globalSearchOpen() ||
        joinServerOpen() ||
        serverSettingsOpen() ||
        appSettingsOpen() ||
        skillsMarketplaceOpen() ||
        hasVisibleToasts() ||
        quitShortcutHintShown()
      }
      settingsRequest={view.settingsRequest()}
      messageFocusRequest={messageFocusRequest()}
      onSelectAgent={selectAgent}
      onUpdateAgent={updateAgent}
      onSetAgentAvatar={setAgentAvatar}
      onSendMessage={view.onSendMessage}
      onMarkRead={view.onMarkRead}
      onLoadOlder={view.onLoadOlder}
      onTypingChange={() => {}}
      onAnswerPrompt={view.onAnswerPrompt}
      onRespondToApproval={view.onRespondToApproval}
      onRespondToBrowserTakeover={view.onRespondToBrowserTakeover}
      onCancelQueuedMessage={() => {}}
      onSteerQueuedMessage={() => {}}
      onUpdateQueuedMessage={() => Promise.resolve(false)}
      onReorderQueue={() => {}}
      onActivateBrowserTab={activateBrowserTab}
      onCloseBrowserTab={closeBrowserTab}
      onOpenRemoteDesktop={openRemoteDesktopWorkspace}
      onStop={view.onStop}
      onDeleteMessage={view.deleteMessageAction()}
      canDeleteMessage={view.canDeleteMessage}
    />
  );
}
