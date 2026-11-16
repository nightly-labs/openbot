import type { ChatWindowTarget } from "@openbot/contracts/ipc";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CONVERSATION_UNREAD_FROM_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarCommunityCard } from "@openbot/ui/features/sidebar/SidebarCommunityCard";
import { SidebarMobileAppCard } from "@openbot/ui/features/sidebar/SidebarMobileAppCard";
import { sidebarChannelWaits } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { appPort } from "../../app-port";
import { type ChatHistoryEntry, chatHistoryKeys } from "../../chat-history";
import { useLayout } from "../../layout";
import { DirectConversation } from "../../lazy-views";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useAgentActions } from "../agents/agent-actions";
import { createAgentActivity } from "../agents/agent-activity";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServerActions } from "../servers/server-actions";
import { serverRoleCanAdminister } from "../servers/server-capabilities";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { serverUpdateBadge, showServerUpdate } from "../servers/server-update-flow";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { usePresence } from "../team/team-context";
import { SidebarUpdateIsland } from "../updates/SidebarUpdateIsland";
import { createCommunityCardVisibility } from "./community-card";
import { DevWorktreeLabel } from "./DevWorktreeLabel";
import { createSidebarAlertCards, SidebarAlertCards } from "./SidebarAlertCards";
import { ServerUpgradeOffer } from "./server-upgrade-offer";
import { useSidebar } from "./sidebar-context";

/** Dismissing the mobile app card is a choice of this computer, like the sidebar width. The key is
 * new with the Android release, so a computer that dismissed the iPhone-only card sees it once more. */
const MOBILE_APP_DISMISSED_STORAGE_KEY = "openbot:mobile-app-card-dismissed";

/**
 * The list of Agents and people. It reads the most domains of any pane, and every
 * one of them for the same reason: a sidebar row shows who exists, who is
 * working, who has replied and who is pinned, which is four domains before any
 * of the actions on the row context menu.
 *
 * `peopleEnabled` arrives as a prop because the shell already computes it to
 * decide which pane renders. Deriving it a second time here would let the two
 * answers disagree for a frame.
 */
export function WorkspaceSidebar(props: { peopleEnabled: boolean }) {
  const { t } = useText();
  const layout = useLayout();
  const platform = usePlatform();
  const channels = useChannels();
  const serverScope = useServerScope();
  const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
  // The chats that main shows in a window of their own. Main sends the list on each change.
  const [chatWindows, setChatWindows] = createSignal<ChatWindowTarget[]>([]);
  onSettled(() => {
    const unsubscribe = appPort().onChatWindows(setChatWindows);
    void appPort()
      .getChatWindows()
      .then(setChatWindows)
      .catch(() => undefined);
    return unsubscribe;
  });
  const windowAgentIds = createMemo(
    () => new Set(chatWindows().flatMap((target) => (target.serverId === activeServerId() ? [target.agentId] : []))),
  );
  const { openServerSettings, serverSettingsOpen } = useServerSettings();
  const serverActions = useServerActions();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const {
    agentList,
    agentListConnecting,
    agentListSettled,
    activeAgent,
    agentSetupDraft,
    duplicatingAgentIds,
    openAgentSetup,
    userHiddenAgents,
    userPausedAgentIds,
    userHiddenAgentsWork,
    mutedAgentIds,
  } = useAgents();
  const {
    editAgent,
    duplicateAgent,
    duplicateSection,
    duplicatingSectionIds,
    deleteAgent,
    setAgentHiddenByUser,
    setAgentMuted,
  } = useAgentActions();
  // A server that keeps no levels has no mute item: the item must not fail.
  const muteSupported = () => activeServerSupportsCapability(AGENT_NOTIFICATION_LEVELS_CAPABILITY);
  // The host refuses a member: an agent is hidden for every member.
  const hideAllowed = () =>
    activeServerSupportsCapability(AGENT_HIDDEN_CAPABILITY) && serverRoleCanAdminister(activeServer());
  const { pendingPrompts, approvals } = useTurns();
  const { agentUnreadReplies, markAgentChatRead, markAgentChatUnread, markAllAgentMessagesRead } = useConversation();
  const { directPeople, teamPresence } = usePresence();
  const { activeDirectMember, activeDirectMemberId, directThreads } = useDirectMessages();
  const { selectAgent, selectDirectMember, setGlobalSearchVisibility, chatHistory } = useNavigation();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();
  // The agent menu offers Mark read for these. The count also holds the side threads, as the badge does.
  const unreadAgentIds = createMemo(
    () => new Set(agentList().flatMap((agent) => ((agentUnreadReplies()[agent.id] ?? 0) > 0 ? [agent.id] : []))),
  );
  /**
   * Opens the agent's chat with a new thread. A host without threads has no such item, and neither has a
   * chat window: another agent opens in a window of its own, which does not get the new thread.
   */
  const newAgentThread = () =>
    agentTasks.available() && !platform.chatWindow
      ? (agentId: string) => {
          if (selectAgent(agentId)) agentThreads.startNew(agentId);
        }
      : undefined;
  /** What Back opens: the list of an open settings detail page, or else the previous chat. */
  const backTarget = (): { name: string } | null => {
    const pageBack = chatHistory.pageBack();
    return pageBack ? { name: pageBack.name } : chatName(chatHistory.previous());
  };
  /** The name of a chat as its sidebar row shows it. */
  const chatName = (entry: ChatHistoryEntry | undefined): { name: string } | null => {
    if (!entry) return null;
    if (entry.kind === "agent") return { name: agentList().find((agent) => agent.id === entry.id)?.name ?? "" };
    if (entry.kind === "channel") {
      return { name: channels.state.channels.find((channel) => channel.id === entry.id)?.name ?? "" };
    }
    const member = directPeople().find((person) => person.id === entry.id);
    return { name: member ? teamMemberName(member) : "" };
  };
  const {
    sidebarLayout,
    collapsedSidebarSectionIds,
    mutateSidebarLayout,
    toggleSidebarSection,
    pinnedSidebarItems,
    sidebarPeopleOrder,
    pinSidebarItem,
    unpinSidebarItem,
    reorderPinnedSidebarItems,
    reorderSidebarPeople,
  } = useSidebar();
  const [mobileAppDismissed, setMobileAppDismissed] = createSignal(
    window.localStorage.getItem(MOBILE_APP_DISMISSED_STORAGE_KEY) === "true",
  );
  const communityCard = createCommunityCardVisibility();
  const alertCards = createSidebarAlertCards(activeServer);
  // A clear in Server settings frees space and can change an alert level, so both cards read
  // again when settings close.
  createEffect(serverSettingsOpen, (open, wasOpen) => {
    if (!open && wasOpen) alertCards.refresh();
  });

  /* Channels reach the sidebar as data, not as a list of their own: they sit in the layout's
   * sections beside the agents, so the sidebar has to be able to order and group them. The Routines
   * view lists only agents: a channel has no routine canvas. */
  const channelsListed = () => channels.supported() && layout.sidebarView() !== "routines";
  /* Until a joined server lists channels, the frame's rows hold their place, so the agents below stay. */
  const sidebarChannels = () =>
    !channels.state.listed &&
    layout.sidebarView() !== "routines" &&
    (!serverScope.loaded() || channels.supported()) &&
    serverScope.frameChannels().length > 0
      ? serverScope.frameChannels()
      : channelsListed()
        ? channels.state.channels
        : [];
  const visibleChannels = createMemo(() => sidebarChannels().filter((channel) => !channel.archived));
  /* A channel can open while the Routines view is on: from search, a notification, or a selection
   * restored at start. Its row must be in the list, so the list goes back to the agents view. */
  createEffect(
    () => layout.sidebarView() === "routines" && channels.state.selectedId !== null,
    (channelOpenInRoutines) => {
      if (channelOpenInRoutines) layout.setSidebarView("agents");
    },
  );

  const { agentStates: sidebarAgentStates, agentMoods } = createAgentActivity();

  /* A wait in a channel thread goes to the channel instead. Selecting the channel opens the view
   * that answers it. */
  const channelWaits = createMemo(() => {
    const prompts = Object.values(pendingPrompts());
    return sidebarChannelWaits({
      channels: visibleChannels(),
      prompts: prompts.flatMap((event) => (event?.type === "prompt" ? [event] : [])),
      takeovers: prompts.flatMap((event) => (event?.type === "browser-takeover-requested" ? [event.request] : [])),
      approvals: approvals(),
    });
  });

  return (
    <>
      <Sidebar
        channels={visibleChannels()}
        deletedChannels={sidebarChannels().filter((channel) => channel.archived)}
        activeChannelId={channels.state.selectedId}
        onSelectChannel={(id) => void channels.open(id)}
        onEditChannel={(id) => void channels.editChannel(id)}
        onDeleteChannel={channels.deletionSupported() ? channels.remove : undefined}
        onRestoreChannel={channels.deletionSupported() ? channels.restore : undefined}
        showingArchivedChannels={channelsListed() && channels.state.archived}
        onToggleArchivedChannels={channelsListed() ? channels.toggleArchived : undefined}
        onCreateChannel={channelsListed() ? channels.create : undefined}
        onMarkAllRead={() => {
          void markAllAgentMessagesRead();
          void channels.markAllRead();
        }}
        hasUnread={
          agentList().some(
            (agent) => !userPausedAgentIds().has(agent.id) && (agentUnreadReplies()[agent.id] ?? 0) > 0,
          ) || channels.hasUnread()
        }
        view={layout.sidebarView()}
        serverName={activeServer()?.name ?? t("sidebar.topbar.localServer")}
        onOpenServerSettings={(trigger) => {
          const server = activeServer();
          if (server) openServerSettings(server.id, trigger);
        }}
        chatHistory={{
          back: backTarget(),
          forward: chatName(chatHistory.next()),
          keys: chatHistoryKeys(platform.appInfo()?.platform === "darwin"),
          onBack: chatHistory.goBack,
          onForward: chatHistory.goForward,
        }}
        serverUpdate={(() => {
          const server = activeServer();
          const badge = server ? serverUpdateBadge(server.id) : null;
          return server && badge ? { ...badge, onOpen: () => void showServerUpdate(server.id) } : undefined;
        })()}
        topbarDetail={<DevWorktreeLabel />}
        serverMenu={
          platform.appInfo()
            ? {
                servers: serverActions.orderedServers(),
                view: layout.serverView(),
                onViewChange: layout.setServerView,
                onSelect: serverActions.select,
                onAdd: serverActions.add,
                onCreateLocal: serverActions.addMenuCreateLocal(),
                onInstallServer: serverActions.addMenuInstallServer(),
                addCreatesServer: serverActions.addCreatesServer(),
                hiddenLocal: serverActions.hiddenLocal(),
                ...serverActions.callbacks,
              }
            : undefined
        }
        agents={agentList()}
        activeAgentId={activeDirectMember() || channels.state.selectedId ? "" : (activeAgent()?.id ?? "")}
        showPeople={props.peopleEnabled}
        people={directPeople()}
        directThreads={directThreads()}
        activeDirectMemberId={activeDirectMemberId()}
        agentStates={sidebarAgentStates()}
        channelWaits={channelWaits()}
        channelPreviewsPending={!channels.state.listed}
        agentMoods={agentMoods()}
        layout={sidebarLayout()}
        layoutMutable={activeServerSupportsCapability("sidebar-layout")}
        chatOrder={layout.sidebarChatOrder()}
        onChatOrderChange={layout.setSidebarChatOrder}
        foldersSupported={activeServerSupportsCapability("sidebar-folders-v1")}
        collapsedSectionIds={collapsedSidebarSectionIds()}
        onMutateLayout={mutateSidebarLayout}
        sectionDuplicateSupported={
          activeServerSupportsCapability("agent-duplication") && activeServerSupportsCapability("sidebar-layout")
        }
        duplicatingSectionIds={duplicatingSectionIds()}
        onDuplicateSection={duplicateSection}
        onToggleSection={toggleSidebarSection}
        pinnedItems={pinnedSidebarItems()}
        peopleOrder={sidebarPeopleOrder()}
        onPin={pinSidebarItem}
        onUnpin={unpinSidebarItem}
        onReorderPinned={reorderPinnedSidebarItems}
        onReorderPeople={reorderSidebarPeople}
        onSelectAgent={selectAgent}
        onSelectPerson={(memberId) => void selectDirectMember(memberId)}
        onPreloadDirectConversation={props.peopleEnabled ? () => void DirectConversation.preload() : undefined}
        onCreateAgent={() => {
          channels.close();
          openAgentSetup();
        }}
        onEditAgent={editAgent}
        duplicateSupported={activeServerSupportsCapability("agent-duplication")}
        duplicatingAgentIds={duplicatingAgentIds()}
        onDuplicateAgent={duplicateAgent}
        onDeleteAgent={deleteAgent}
        userHiddenAgents={userHiddenAgents()}
        userHiddenAgentsWork={userHiddenAgentsWork()}
        unreadAgentIds={unreadAgentIds()}
        onMarkAgentRead={(agentId) => void markAgentChatRead(agentId)}
        onMarkAgentUnread={
          activeServerSupportsCapability(CONVERSATION_UNREAD_FROM_CAPABILITY)
            ? (agentId) => void markAgentChatUnread(agentId)
            : undefined
        }
        mutedAgentIds={muteSupported() ? mutedAgentIds() : undefined}
        onSetAgentMuted={muteSupported() ? (agentId, muted) => void setAgentMuted(agentId, muted) : undefined}
        onHideAgent={hideAllowed() ? (agentId) => void setAgentHiddenByUser(agentId, true) : undefined}
        onRestoreAgent={hideAllowed() ? (agentId) => void setAgentHiddenByUser(agentId, false) : undefined}
        onNewAgentThread={newAgentThread()}
        onOpenAgentWindow={
          platform.landingPreview
            ? undefined
            : (agentId) => void appPort().openChatWindow({ serverId: activeServerId(), agentId })
        }
        windowAgentIds={windowAgentIds()}
        compact={layout.leftPanelCompact()}
        onExpand={layout.expandSidebar}
        onCollapse={() => layout.setSidebarClosed(true)}
        onOpenSearch={() => setGlobalSearchVisibility(true)}
        footer={
          <>
            {/* One card at a time. A machine over its alert level comes first, then a disk that is
             * almost full; the community card waits until the mobile app card is dismissed. */}
            <SidebarAlertCards
              cards={alertCards}
              serverName={activeServer()?.name ?? ""}
              members={teamPresence().members}
              onOpenStorage={(serverId) => openServerSettings(serverId, null, "storage")}
            />
            <Show when={!platform.landingPreview && !alertCards.shown() && !mobileAppDismissed()}>
              <SidebarMobileAppCard
                onOpenInstall={() => openAppSettings(null, "mobile-connect")}
                onDismiss={() => {
                  window.localStorage.setItem(MOBILE_APP_DISMISSED_STORAGE_KEY, "true");
                  setMobileAppDismissed(true);
                }}
              />
            </Show>
            <Show
              when={
                !platform.landingPreview && !alertCards.shown() && mobileAppDismissed() && !communityCard.dismissed()
              }
            >
              <SidebarCommunityCard
                onJoinDiscord={() => void appPort().openExternal("discord")}
                onFollowX={() => void appPort().openExternal("x")}
                onDismiss={communityCard.dismiss}
              />
            </Show>
            <SidebarUpdateIsland />
          </>
        }
        onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
        agentsConnecting={agentListConnecting()}
        emptyAction={
          agentList().length === 0 && agentListSettled()
            ? {
                label: t("sidebar.empty.firstAgent"),
                avatarSeed: agentSetupDraft().avatarSeed,
                avatarHue: agentSetupDraft().avatarHue,
                avatarColor: agentSetupDraft().avatarColor ?? null,
                onSelect: () => {
                  channels.close();
                  openAgentSetup();
                },
              }
            : undefined
        }
      />
      {/* A compact sidebar hides the footer card, so the offer is outside the footer. */}
      <ServerUpgradeOffer
        card={alertCards.storageCard.card()}
        server={activeServer()}
        blocked={serverSettingsOpen()}
        onFreeUpSpace={(serverId) => openServerSettings(serverId, null, "storage")}
      />
    </>
  );
}
