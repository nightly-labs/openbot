import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { IOS_TESTFLIGHT_URL } from "@openbot/ui/features/mobile-app/ios-testflight";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarMobileAppCard } from "@openbot/ui/features/sidebar/SidebarMobileAppCard";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { writeClipboardText } from "../../clipboard";
import { useLayout } from "../../layout";
import { DirectConversation } from "../../lazy-views";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAgentActions } from "../agents/agent-actions";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useSavedCopy } from "../saved-copy/saved-copy-context";
import { useServerActions } from "../servers/server-actions";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { usePresence } from "../team/team-context";
import { useSidebar } from "./sidebar-context";

/** Dismissing the iOS beta card is a choice of this computer, like the sidebar width. */
const MOBILE_APP_DISMISSED_STORAGE_KEY = "openbot:ios-beta-card-dismissed";

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
  const { activeServer, activeServerSupportsCapability } = useServers();
  const { openServerSettings } = useServerSettings();
  const serverActions = useServerActions();
  const { setSkillsMarketplaceOpen } = useSettings();
  const { agentList, agentListConnecting, activeAgent, agentSetupDraft, duplicatingAgentIds, openBotSetup } =
    useAgents();
  const { editAgent, duplicateAgent, deleteAgent } = useAgentActions();
  const { activeTurns, queues, failedTurns, usageLimits, pendingPrompts, pendingApprovals } = useTurns();
  const { unreadReplies, recentReplies, markAllAgentMessagesRead } = useConversation();
  /* While a joined server connects, the saved copy fills the list. It is for reading only, so the
   * row actions that need the host are off, and selecting a row stays inside the copy. */
  const savedCopy = useSavedCopy();
  const saved = () => savedCopy.visible();
  const { directPeople } = usePresence();
  const { activeDirectMember, activeDirectMemberId, directThreads } = useDirectMessages();
  const { selectAgent, selectDirectMember } = useNavigation();
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

  /* Channels reach the sidebar as data, not as a list of their own: they sit in the layout's
   * sections beside the agents, so the sidebar has to be able to order and group them. The Routines
   * view lists only agents: a channel has no routine canvas. */
  const channelsListed = () => channels.supported() && layout.sidebarView() !== "routines";
  const visibleChannels = createMemo(() =>
    channelsListed() ? channels.state.channels.filter((channel) => !channel.archived) : [],
  );
  /* A channel can open while the Routines view is on: from search, a notification, or a selection
   * restored at start. Its row must be in the list, so the list goes back to the agents view. */
  createEffect(
    () => layout.sidebarView() === "routines" && channels.state.selectedId !== null,
    (channelOpenInRoutines) => {
      if (channelOpenInRoutines) layout.setSidebarView("agents");
    },
  );

  /* The agent conversation shows only the waits of the agent's own thread. A wait in a channel
   * thread stays out of "Needs you", because selecting the row cannot answer it. */
  const sidebarAgentStates = createMemo(() => {
    const agentThreads = new Map(agentList().map((agent) => [agent.id, agent.threadId]));
    const inAgentThread = (agentId: string, threadId: string | undefined) =>
      threadId !== undefined && agentThreads.get(agentId) === threadId;
    return computeSidebarAgentStates({
      agentIds: agentList().map((agent) => agent.id),
      activeTurns: activeTurns(),
      queues: queues(),
      unreadReplies: unreadReplies(),
      recentReplies: recentReplies(),
      pendingPrompts: Object.fromEntries(
        Object.entries(pendingPrompts()).filter(([agentId, event]) =>
          inAgentThread(agentId, event?.type === "prompt" ? event.threadId : event?.request.threadId),
        ),
      ),
      pendingApprovals: Object.fromEntries(
        Object.entries(pendingApprovals()).filter(([agentId, approval]) => inAgentThread(agentId, approval?.threadId)),
      ),
      failedTurns: failedTurns(),
      usageLimits: usageLimits(),
    });
  });

  /* The badge says what an agent is doing; the face says how it is going. `isAgentWorking` is
   * shared, and a routine mark only replaces the badge for that same agent. */
  const agentMoods = createMemo(() =>
    computeAgentAvatarMoods({
      agentIds: agentList().map((agent) => agent.id),
      activeTurns: activeTurns(),
      queues: queues(),
      failedTurns: failedTurns(),
      pendingPrompts: pendingPrompts(),
      pendingApprovals: pendingApprovals(),
      recentReplies: recentReplies(),
    }),
  );

  return (
    <Sidebar
      channels={visibleChannels()}
      deletedChannels={channelsListed() ? channels.state.channels.filter((channel) => channel.archived) : []}
      activeChannelId={channels.state.selectedId}
      onSelectChannel={(id) => void channels.open(id)}
      onEditChannel={(id) => void channels.editChannel(id)}
      onDeleteChannel={channels.deletionSupported() ? channels.remove : undefined}
      showingArchivedChannels={channelsListed() && channels.state.archived}
      onToggleArchivedChannels={channelsListed() ? channels.toggleArchived : undefined}
      onCreateChannel={channelsListed() ? channels.create : undefined}
      onMarkAllRead={
        saved()
          ? undefined
          : () => {
              void markAllAgentMessagesRead();
              void channels.markAllRead();
            }
      }
      hasUnread={agentList().some((agent) => (unreadReplies()[agent.id] ?? 0) > 0) || channels.hasUnread()}
      view={layout.sidebarView()}
      onViewChange={(view) => {
        // An open channel would stay in the middle with no row in the list.
        if (view === "routines") channels.close();
        layout.setSidebarView(view);
      }}
      serverName={activeServer()?.name ?? "Local"}
      onOpenServerSettings={(trigger) => {
        const server = activeServer();
        if (server) openServerSettings(server.id, trigger);
      }}
      serverMenu={
        platform.appInfo()
          ? {
              servers: serverActions.orderedServers(),
              view: layout.serverView(),
              onViewChange: layout.setServerView,
              onSelect: serverActions.select,
              onAdd: serverActions.add,
              addCreatesServer: serverActions.addCreatesServer(),
              ...serverActions.callbacks,
            }
          : undefined
      }
      agents={saved() ? savedCopy.agents() : agentList()}
      activeAgentId={
        saved()
          ? (savedCopy.selectedAgent()?.id ?? "")
          : activeDirectMember() || channels.state.selectedId
            ? ""
            : (activeAgent()?.id ?? "")
      }
      showPeople={props.peopleEnabled}
      people={directPeople()}
      directThreads={directThreads()}
      activeDirectMemberId={activeDirectMemberId()}
      agentStates={saved() ? savedCopy.agentStates() : sidebarAgentStates()}
      agentMoods={agentMoods()}
      layout={(saved() ? savedCopy.layout() : null) ?? sidebarLayout()}
      layoutMutable={!saved() && activeServerSupportsCapability("sidebar-layout")}
      savedCopy={saved()}
      collapsedSectionIds={collapsedSidebarSectionIds()}
      onMutateLayout={mutateSidebarLayout}
      onToggleSection={toggleSidebarSection}
      pinnedItems={pinnedSidebarItems()}
      peopleOrder={sidebarPeopleOrder()}
      onPin={pinSidebarItem}
      onUnpin={unpinSidebarItem}
      onReorderPinned={reorderPinnedSidebarItems}
      onReorderPeople={reorderSidebarPeople}
      onSelectAgent={saved() ? savedCopy.select : selectAgent}
      onSelectPerson={(memberId) => void selectDirectMember(memberId)}
      onPreloadDirectConversation={props.peopleEnabled ? () => void DirectConversation.preload() : undefined}
      onCreateAgent={() => {
        channels.close();
        openBotSetup();
      }}
      createSupported={saved() ? false : undefined}
      editSupported={!saved()}
      deleteSupported={saved() ? false : undefined}
      onEditAgent={editAgent}
      duplicateSupported={!saved() && activeServerSupportsCapability("agent-duplication")}
      duplicatingAgentIds={duplicatingAgentIds()}
      onDuplicateAgent={duplicateAgent}
      onDeleteAgent={deleteAgent}
      compact={layout.leftPanelCompact()}
      onExpand={layout.expandSidebar}
      footer={
        <Show when={!platform.landingPreview && !mobileAppDismissed()}>
          <SidebarMobileAppCard
            onCopyInvite={() => writeClipboardText(IOS_TESTFLIGHT_URL)}
            onDismiss={() => {
              window.localStorage.setItem(MOBILE_APP_DISMISSED_STORAGE_KEY, "true");
              setMobileAppDismissed(true);
            }}
          />
        </Show>
      }
      onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
      agentsConnecting={agentListConnecting()}
      emptyAction={
        agentList().length === 0 && !agentListConnecting()
          ? {
              label: t("sidebar.empty.firstAgent"),
              avatarSeed: agentSetupDraft().avatarSeed,
              avatarHue: agentSetupDraft().avatarHue,
              onSelect: () => {
                channels.close();
                openBotSetup();
              },
            }
          : undefined
      }
    />
  );
}
