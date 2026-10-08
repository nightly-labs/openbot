import type { CentralAuthUser, UpdateAgentInput } from "@openbot/contracts/ipc";
import { hasVisibleToasts } from "@openbot/ui";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { createScopeGuard } from "../../scope-lifetime";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { useBrowserTabs } from "../browser/browser-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { useUsage } from "../usage/usage-context";
import { Conversation } from "./Conversation";
import { useConversation } from "./conversation-context";

/**
 * The transcript of the active Agent, with everything the composer needs to send
 * to it. The widest pane by props because `Conversation` is where the browser,
 * the queue, prompts, approvals and search all surface, and each of those is a
 * domain of its own.
 *
 * Everything here is a projection of the active Agent, so the whole component
 * reads `activeAgent()` and hands `Conversation` the slice for that id. It stays
 * mounted across an Agent change on purpose - `Conversation` owns the scroll and
 * composer state that survives one - which is why the id is read per prop
 * rather than captured once.
 */
export function WorkspaceConversation(props: { account: () => CentralAuthUser }) {
  const scopeIsCurrent = createScopeGuard();
  const platform = usePlatform();
  const { activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { serverSettingsOpen, openServerSettings } = useServerSettings();
  const {
    appSettingsOpen,
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    setPendingPluginSlug,
    setPendingPluginConnect,
    setAgentAutoApprove,
    agentAutoApproves,
    generalSettings,
  } = useSettings();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    connectProvider,
    providerAdminServerId,
  } = useProviders();
  // Not gated on the server: the picker needs these IDs to label a model it is already showing, and
  // a remote server's OpenCode has its own catalogue. Only the write paths are local-only.
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const {
    agentStatus,
    agentList,
    agentListConnecting,
    activeAgent,
    modelOptions,
    settingsRequest,
    updateAgent,
    setAgentAvatar,
  } = useAgents();
  const {
    activeQueue,
    activeRoutineIds,
    activeRoutines,
    pendingPrompts,
    pendingApprovals,
    activeTurns,
    turnProgress,
    answerPrompt,
    respondToApproval,
    respondToApprovalRequest,
    respondToBrowserTakeover,
    cancelQueuedMessage,
    steerQueuedMessage,
    updateQueuedMessage,
    reorderQueue,
    stopActiveTurn,
  } = useTurns();
  const {
    activeMessages,
    conversations,
    sendMessage,
    markAgentMessagesRead,
    loadOlderAgentMessages,
    loadLatestAgentMessages,
    searchAgentMessages,
    setTeamTyping,
    presentPromptResolution,
  } = useConversation();
  const {
    browserTabs,
    activeBrowserTabId,
    browserVisibilitySuspended,
    browserControlState,
    activateBrowserTab,
    closeBrowserTab,
  } = useBrowserTabs();
  const { activeRemoteDesktopSession, remoteDesktopWorkspaceVisible, openRemoteDesktopWorkspace } = useRemoteDesktop();
  const usage = useUsage();
  // The composer never asks for usage itself. It reads the dock's reading, which is scoped to the
  // active agent's provider and model and cleared on a switch, because a second request would hit
  // the provider's rate-limit endpoint for a card the user may never see.
  const auth = useAuth();
  const { teamPresence, currentTeamMember } = usePresence();
  const { selectAgent, openAgentMessage, messageFocusRequest, globalSearchOpen } = useNavigation();

  const activePrompt = createMemo(() => {
    const agent = activeAgent();
    const event = agent ? pendingPrompts()[agent.id] : undefined;
    return event?.type === "prompt" && event.threadId === agent?.threadId ? event : undefined;
  });

  const activeApproval = createMemo(() => {
    const agent = activeAgent();
    const approval = agent ? pendingApprovals()[agent.id] : undefined;
    return approval?.threadId === agent?.threadId ? approval : undefined;
  });

  const activeBrowserTakeover = createMemo(() => {
    const agent = activeAgent();
    const event = agent ? pendingPrompts()[agent.id] : undefined;
    return event?.type === "browser-takeover-requested" && event.request.threadId === agent?.threadId
      ? event.request
      : undefined;
  });

  /**
   * Access and auto-approve of a joined server's agent, read from its host. Null for this
   * computer's agents, for a member, and for a host without `agent-admin-v1`.
   */
  const remoteAgentAdmin = createRemoteAgentAdmin(() => {
    const server = activeServer();
    const agent = activeAgent();
    return server && agent ? { server, agentId: agent.id } : null;
  });
  const remoteAgentSettings = remoteAgentAdmin.settings;

  /**
   * Who may grant an agent standing approval: this computer for its own agents, and an owner or
   * admin of a joined server whose host has answered. The policy belongs to the computer that runs
   * the agent, so a remote grant is written on that host.
   */
  const autoApproveEditable = () => activeServer()?.kind === "local" || remoteAgentSettings() !== null;

  async function writeAgentAutoApprove(agentId: string, autoApprove: boolean): Promise<void> {
    if (activeServer()?.kind === "local") return setAgentAutoApprove(agentId, autoApprove);
    await remoteAgentAdmin.update({ agentId, autoApprove });
  }

  /** "Always allow", where the grant is the user's to give. */
  const alwaysAllowApproval = createMemo(() => {
    const agent = activeAgent();
    const approval = activeApproval();
    if (!agent || !approval || !autoApproveEditable()) return undefined;
    return async () => {
      await writeAgentAutoApprove(agent.id, true);
      if (!scopeIsCurrent()) return false;
      return respondToApprovalRequest(agent.id, approval.requestId, "accept");
    };
  });

  /**
   * The same grant as the approval card's, offered before an approval rather than during one, so an
   * agent can be trusted without waiting for it to ask.
   */
  const setAgentAutoApproveForActiveAgent = createMemo(() => {
    const agent = activeAgent();
    if (!agent || !autoApproveEditable()) return undefined;
    return (autoApprove: boolean) => writeAgentAutoApprove(agent.id, autoApprove);
  });

  /** A new chat with the active agent, on this computer or on a host that serves `context-reset-v1`. */
  const clearActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-reset-v1")) return undefined;
    return () => turnsPort().agent.clearContext(agent.id, server.id);
  });

  /** The Team API agent summary has no access, so a joined server's agent shows the host's answer. */
  const conversationAgent = createMemo(() => {
    const agent = activeAgent();
    const settings = remoteAgentSettings();
    return agent && settings ? { ...agent, access: settings.access } : agent;
  });

  /** Access of a joined server's agent goes to its host; every other field keeps the Team API route. */
  async function updateConversationAgent(agentId: string, updates: Omit<UpdateAgentInput, "agentId">): Promise<void> {
    if (activeServer()?.kind === "local") return updateAgent(agentId, updates);
    await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, ({ agentId: id, ...rest }) =>
      updateAgent(id, rest),
    );
  }

  /**
   * Provider downloads run on the computer the agents run on: this one, or a host the account
   * administers over `providers-v1`.
   */
  const providerDownloads = createMemo(
    () =>
      (activeServer()?.kind === "local" || providerAdminServerId() !== undefined) &&
      providerRuntimeDownloadsAvailable(),
  );
  /** Custom endpoints are added in the Providers section that this computer, or an administered host, shows. */
  const manageProviders = createMemo(() => activeServer()?.kind === "local" || providerAdminServerId() !== undefined);
  const openProviderSettings = () => {
    const server = activeServer();
    if (server) openServerSettings(server.id, null, "providers");
  };
  /** The browser sign-in opens on this computer, so it stays local. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );

  return (
    <Conversation
      platform={platform.appInfo()?.platform}
      onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
      onOpenMarketplaceApp={(request) => {
        setPendingPluginConnect(request.connect);
        setPendingPluginSlug(request.appId);
        setSkillsMarketplaceOpen(true);
      }}
      onOpenUsage={(trigger) => usage.openUsage(activeServer()?.id ?? "local", trigger, activeAgent()?.id)}
      agentStatus={agentStatus()}
      agentsConnecting={agentListConnecting()}
      accountUsage={auth.accountUsage()}
      providerRuntimeStatuses={providerDownloads() ? providerRuntimeStatuses() : undefined}
      customProviders={customProviders()}
      // The custom agents are this computer's. A joined host's picker counts its own from its models.
      customAgents={activeServer()?.kind === "local" ? customAgents() : undefined}
      onDownloadProvider={providerDownloads() ? downloadProviderRuntime : undefined}
      onCancelProviderDownload={providerDownloads() ? cancelProviderRuntimeDownload : undefined}
      onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
      onSignInProvider={activeServer()?.kind === "local" ? connectProvider : undefined}
      onManageProviders={manageProviders() ? openProviderSettings : undefined}
      agent={conversationAgent()}
      agents={agentList()}
      availableRoutineIds={activeRoutineIds()}
      routines={activeRoutines()}
      modelOptions={modelOptions()}
      messages={activeMessages()}
      messageReferences={activeAgent() ? (conversations[activeAgent()?.id ?? ""]?.references ?? {}) : {}}
      unreadCount={activeAgent() ? (conversations[activeAgent()?.id ?? ""]?.read?.unreadCount ?? 0) : 0}
      firstUnreadMessageId={
        activeAgent() ? (conversations[activeAgent()?.id ?? ""]?.read?.firstUnreadMessageId ?? null) : null
      }
      loaded={activeAgent() ? conversations[activeAgent()?.id ?? ""]?.loaded === true : false}
      hasOlder={
        activeServerSupportsCapability("conversation-pagination") && activeAgent()
          ? (conversations[activeAgent()?.id ?? ""]?.page?.hasOlder ?? false)
          : false
      }
      unloadedHistory={activeAgent() ? unloadedHistory(conversations[activeAgent()?.id ?? ""]?.page) : undefined}
      discontinuous={activeAgent() ? conversations[activeAgent()?.id ?? ""]?.windowMode === "around" : false}
      loadingOlder={activeAgent() ? conversations[activeAgent()?.id ?? ""]?.olderLoading === true : false}
      olderError={activeAgent() ? (conversations[activeAgent()?.id ?? ""]?.olderError ?? null) : null}
      queue={activeQueue()}
      browserTabs={browserTabs()}
      activeBrowserTabId={activeBrowserTabId()}
      browserVisibilitySuspended={browserVisibilitySuspended()}
      workspaceCovered={usage.state.serverId !== null}
      browserControlState={browserControlState()}
      server={activeServer()}
      presence={teamPresence()}
      currentUserEmail={props.account().email}
      isOwnSender={(senderId) => {
        const state = auth.centralAuth();
        return isReaderAuthor(senderId, {
          memberId: currentTeamMember()?.id ?? null,
          accountUserId: state.status === "signed_in" ? state.user.id : null,
          onOwnComputer: activeServer()?.kind === "local",
        });
      }}
      browserEnabled={!platform.landingPreview && activeServerSupportsCapability("browser-control")}
      remoteDesktopSessionActive={Boolean(activeRemoteDesktopSession())}
      remoteDesktopVisible={remoteDesktopWorkspaceVisible()}
      remoteDesktopEnabled={!platform.landingPreview && activeServerSupportsCapability("remote-desktop")}
      prompt={activePrompt()}
      approval={activeApproval()}
      browserTakeover={activeBrowserTakeover()}
      activeTurnId={activeAgent() ? activeTurns()[activeAgent()?.id ?? ""] : null}
      activityDetail={activeAgent() ? turnProgress()[activeAgent()?.id ?? ""]?.detail : undefined}
      skillsMarketplaceOpen={skillsMarketplaceOpen()}
      mcpSettingsOpen={serverSettingsOpen() || skillsMarketplaceOpen()}
      globalOverlayOpen={
        globalSearchOpen() ||
        joinServerOpen() ||
        serverSettingsOpen() ||
        appSettingsOpen() ||
        skillsMarketplaceOpen() ||
        hasVisibleToasts()
      }
      settingsRequest={settingsRequest()}
      messageFocusRequest={messageFocusRequest()}
      onSelectAgent={selectAgent}
      onUpdateAgent={updateConversationAgent}
      onSetAgentAvatar={setAgentAvatar}
      onSendMessage={sendMessage}
      onMarkRead={() => markAgentMessagesRead()}
      onLoadOlder={() => void loadOlderAgentMessages()}
      onLoadLatest={() => (activeAgent() ? loadLatestAgentMessages(activeAgent()?.id ?? "") : Promise.resolve())}
      onSearchMessages={(query) =>
        activeAgent()
          ? searchAgentMessages(activeAgent()?.id ?? "", query)
          : Promise.resolve({ messageIds: [], total: 0 })
      }
      onOpenSearchMessage={(messageId) =>
        activeAgent() ? openAgentMessage(activeAgent()?.id ?? "", messageId) : Promise.resolve()
      }
      onTypingChange={setTeamTyping}
      onAnswerPrompt={answerPrompt}
      onPromptResolutionPresented={presentPromptResolution}
      onRespondToApproval={respondToApproval}
      onAlwaysAllowApproval={alwaysAllowApproval()}
      agentAutoApproves={
        activeServer()?.kind === "local"
          ? agentAutoApproves(activeAgent()?.id ?? "")
          : (remoteAgentSettings()?.autoApprove ?? false)
      }
      agentAutoApproveLocked={
        activeServer()?.kind === "local"
          ? generalSettings().turboMode
          : (remoteAgentSettings()?.autoApproveLocked ?? false)
      }
      onSetAgentAutoApprove={setAgentAutoApproveForActiveAgent()}
      defaultBusyMessageMode={generalSettings().busyMessageMode}
      onClearAgentContext={clearActiveAgentContext()}
      onRespondToBrowserTakeover={respondToBrowserTakeover}
      onCancelQueuedMessage={cancelQueuedMessage}
      onSteerQueuedMessage={steerQueuedMessage}
      onUpdateQueuedMessage={updateQueuedMessage}
      onReorderQueue={reorderQueue}
      onActivateBrowserTab={activateBrowserTab}
      onCloseBrowserTab={closeBrowserTab}
      onOpenRemoteDesktop={openRemoteDesktopWorkspace}
      onStop={stopActiveTurn}
    />
  );
}
