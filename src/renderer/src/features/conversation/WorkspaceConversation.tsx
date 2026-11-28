import { type AgentProviderId, isKeyOnlyProvider, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentModelChoice,
  agentPermissionLevel,
  agentPermissionUpdate,
  type CentralAuthUser,
  DEFAULT_AGENT_ACCESS,
  sameAgentModelChoice,
  type UpdateAgentAdminSettingsInput,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { CONVERSATION_UNREAD_FROM_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { THREAD_MESSAGE_SEARCH_CAPABILITY } from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { withWholePromptText } from "@openbot/team-client/runtime-attention";
import type { AgentMessage } from "@openbot/ui/data";
import type { UsageLimitAskCardProps } from "@openbot/ui/features/conversation/BackupModels";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { sidebarAgentWaits } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { withoutSideThreadTurns } from "../../queue-reconciliation";
import { quitShortcutHintShown } from "../../quit-shortcut-hint";
import { createScopeGuard } from "../../scope-lifetime";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { conversationThreads } from "../agent-threads/conversation-threads";
import { useAgentActions } from "../agents/agent-actions";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { agentTakeoverTabIds, agentThreadAttention } from "../agents/agent-thread-attention";
import { useAgents } from "../agents/agents-context";
import { agentsPort } from "../agents/agents-port";
import { withHostAccountUsage } from "../agents/host-provider-accounts";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { useBrowserTabs } from "../browser/browser-context";
import { useChannels } from "../channels/channels-context";
import { useConnectors } from "../connectors/connectors-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { useServerActions } from "../servers/server-actions";
import {
  remoteMcpSignIn,
  serverCanAdminister,
  serverRoleCanAdminister,
  serverSupportsCapability,
} from "../servers/server-capabilities";
import { createServerResponseStyle } from "../servers/server-personality";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { serversPort } from "../servers/servers-port";
import { appSettingRowOpener } from "../settings/setting-link-targets";
import { useSettings } from "../settings/settings-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { useUsage } from "../usage/usage-context";
import { useWindowPage } from "../window/window-page-context";
import { backgroundWorkKey } from "./background-work-key";
import { Conversation } from "./Conversation";
import { useConversation } from "./conversation-context";
import { useConversationController } from "./conversation-controller-context";
import { messagePromptRequestKey, promptRequestKey } from "./conversation-keys";
import type { ConversationThreads } from "./conversation-types";
import { useDesktopMediaApproval } from "./desktop-media-approval";
import {
  createAgentMessageDeleteAccess,
  desktopAgentMessageDeleteAccess,
  readerCanDeleteMessage,
} from "./message-delete-access";
import { trackUsageLimitShown, usageLimitAskFrom } from "./usage-limit-ask";

export function WorkspaceConversation(props: { account: () => CentralAuthUser }) {
  const scopeIsCurrent = createScopeGuard();
  const serverScope = useServerScope();
  const platform = usePlatform();
  const connectors = useConnectors();
  const { servers, serversLoaded, activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { select: selectServer } = useServerActions();
  const { serverSettingsOpen, openServerSettings } = useServerSettings();
  const {
    appSettingsOpen,
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    setPendingMcpSignIn,
    mcpSignIns,
    refreshMcpSignIns,
    setPendingPluginSlug,
    setPendingPluginConnect,
    agentAutoApproves,
    generalSettings,
    openNotificationLevels,
    openAppSettingRow,
  } = useSettings();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    providerAdminServerId,
    connection,
    activeCustomProviders,
  } = useProviders();
  const connectFromComposer = async (provider: AgentProviderId) => {
    const server = activeServer();
    if (isKeyOnlyProvider(provider) && server) openServerSettings(server.id, null, "providers");
    else await connection.connect(provider, "composer");
  };
  const signInWithCode = (provider: AgentProviderId) => connection.alternative(provider, "composer");
  const responseStyle = createServerResponseStyle(activeServer, window.openbot.hostAdmin);
  const { customAgents } = useCustomAgents();
  const localEndpoints = useCustomProviders();
  const {
    agentStatus,
    hostAccountLimits,
    agentList,
    agentListConnecting,
    activeAgent,
    userPausedAgentIds,
    modelOptions,
    settingsRequest,
    updateAgent,
    setAgentAvatar,
  } = useAgents();
  const {
    contextStates,
    threadContextStates,
    activeQueue,
    activeWaits,
    activeRoutineIds,
    activeRoutines,
    pendingPrompts,
    approvals,
    approvalOfThread,
    activeTurns,
    turnProgress,
    turnStepLines,
    answerPrompt,
    respondToApproval,
    respondToApprovalRequest,
    respondToBrowserTakeover,
    cancelQueuedMessage,
    cancelWait,
    steerQueuedMessage,
    sendQueuedMessageNow,
    updateQueuedMessage,
    reorderQueue,
    stopActiveTurn,
    stoppableSubagentTurn,
    backgroundWork,
    usageLimits,
    usageLimitedModels,
    waitedUsageLimits,
    setWaitedUsageLimits,
    failedModels,
    queues,
  } = useTurns();

  const {
    activeMessages,
    conversations,
    sendMessage,
    markAgentMessagesRead,
    markAgentMessagesUnread,
    deleteAgentMessage,
    messagePins,
    loadOlderAgentMessages,
    loadLatestAgentMessages,
    searchAgentMessages,
    searchAgentThreadMessages,
    setTeamTyping,
    presentPromptResolution,
  } = useConversation();
  const {
    browserTabs,
    activeBrowserTabId,
    browserVisibilitySuspended,
    browserControlState,
    noticedBrowserTabIds,
    noticeBrowserTabs,
    activateBrowserTab,
    closeBrowserTab,
  } = useBrowserTabs();
  const browserTabNoticeShown = () => !platform.landingPreview && activeServerSupportsCapability("browser-control");
  const { activeRemoteDesktopSession, remoteDesktopWorkspaceVisible, openRemoteDesktopWorkspace } = useRemoteDesktop();
  const remoteLoading = () =>
    activeServer()?.kind === "remote" && (!serverScope.loaded() || !conversations[activeAgent()?.id ?? ""]?.loaded);
  const panelAgentStatus = () => (remoteLoading() ? { ...agentStatus(), phase: "starting" as const } : agentStatus());
  const usage = useUsage();
  const windowPage = useWindowPage();
  const mediaApproval = useDesktopMediaApproval();
  const auth = useAuth();
  const { teamPresence, readerMemberId } = usePresence();
  const { selectAgent, openAgentMessage, messageFocusRequest, globalSearchOpen } = useNavigation();
  const channels = useChannels();
  const conversationController = useConversationController();
  const sendToChannel = () => {
    if (!channels.supported()) return;
    const open = channels.state.channels.filter((channel) => !channel.archived);
    if (open.length === 0) return;
    return {
      channels: open.map((channel) => ({ id: channel.id, name: channel.name })),
      onSend: (channelId: string, text: string) => {
        conversationController.appendChannelText({ serverId: activeServer()?.id ?? "local", channelId }, text);
        void channels.open(channelId);
      },
    };
  };

  const agentWaits = createMemo(() =>
    sidebarAgentWaits({
      agentIds: agentList().map((agent) => agent.id),
      ...agentThreadAttention({ agents: agentList(), pendingPrompts: pendingPrompts(), approvals: approvals() }),
      usageLimits: usageLimits(),
    }),
  );
  const pendingTakeovers = createMemo(() =>
    Object.values(pendingPrompts()).flatMap((event) =>
      event?.type === "browser-takeover-requested" ? [event.request] : [],
    ),
  );
  const agentTakeoverTabs = createMemo(() => agentTakeoverTabIds(agentList(), pendingTakeovers()));

  const activeApproval = createMemo(() => {
    const agent = activeAgent();
    return agent ? approvalOfThread(agent.id, agent.threadId) : undefined;
  });

  const remoteAgentAdmin = createRemoteAgentAdmin(() => {
    const server = activeServer();
    const agent = activeAgent();
    return server && agent ? { server, agentId: agent.id, updatedAt: agent.updatedAt ?? null } : null;
  });
  const remoteAgentSettings = remoteAgentAdmin.settings;

  const clearActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-reset-v1")) return undefined;
    return () => turnsPort().agent.clearContext(agent.id, server.id);
  });

  const deletesAnyAgentMessage = createAgentMessageDeleteAccess(desktopAgentMessageDeleteAccess(activeServer));

  const deleteActiveAgentHistory = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "chat-history-v1")) return undefined;
    if (!deletesAnyAgentMessage(agent.id)) return undefined;
    return async () => {
      await turnsPort().agent.deleteHistory(agent.id, server.id);
      await loadLatestAgentMessages(agent.id);
    };
  });

  const { deleteAgent } = useAgentActions();
  const deleteAgentAllowed = () => !platform.chatWindow && serverRoleCanAdminister(activeServer());

  const compactActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-compact-v1")) return undefined;
    return () => turnsPort().agent.compactContext(agent.id, server.id);
  });

  const compactTaskContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-compact-v1")) return undefined;
    return (taskId: string) => turnsPort().agent.compactTaskContext({ agentId: agent.id, taskId }, server.id);
  });

  const conversationAgent = createMemo(() => {
    const agent = activeAgent();
    const settings = remoteAgentSettings();
    const automation = remoteAgentAdmin.automation();
    const busyMessageMode = remoteAgentAdmin.busyMessageMode();
    const backupModels = remoteAgentAdmin.backupModels();
    const usageLimitReturn = remoteAgentAdmin.usageLimitReturn();
    const quickAcknowledgement = remoteAgentAdmin.quickAcknowledgement();
    const memory = remoteAgentAdmin.memory();
    const fastMode = remoteAgentAdmin.fastMode();
    const ultrafast = remoteAgentAdmin.ultrafast();
    const computerUse = remoteAgentAdmin.computerUse();
    const allowNewChat = remoteAgentAdmin.allowNewChat();
    return agent
      ? {
          ...agent,
          ...(settings ? { access: settings.access } : {}),
          ...(activeServer()?.kind === "remote" && automation !== undefined ? { allowAutomation: automation } : {}),
          ...(activeServer()?.kind === "remote" && busyMessageMode ? { busyMessageMode } : {}),
          ...(activeServer()?.kind === "remote" && backupModels ? { backupModels } : {}),
          ...(activeServer()?.kind === "remote" && usageLimitReturn ? { usageLimitReturn } : {}),
          ...(activeServer()?.kind === "remote" && quickAcknowledgement !== undefined ? { quickAcknowledgement } : {}),
          ...(activeServer()?.kind === "remote" && memory !== undefined ? { memory } : {}),
          ...(activeServer()?.kind === "remote" && typeof fastMode === "boolean" ? { fastMode, ultrafast } : {}),
          ...(activeServer()?.kind === "remote" && computerUse !== undefined ? { computerUse } : {}),
          ...(activeServer()?.kind === "remote" && allowNewChat !== undefined ? { allowNewChat } : {}),
        }
      : agent;
  });
  const permissionsEditable = () => activeServer()?.kind === "local" || remoteAgentSettings() !== null;

  async function writeAgentPermissions(input: UpdateAgentAdminSettingsInput): Promise<void> {
    if (activeServer()?.kind === "local") await agentsPort().agent.updateAgentAdminSettings(input);
    else await remoteAgentAdmin.update(input);
  }

  const activeAgentAutoApproves = () =>
    activeServer()?.kind === "local" ? agentAutoApproves(activeAgent()?.id ?? "") : remoteAgentAdmin.autoApproves();

  const alwaysAllowApproval = createMemo(() => {
    const agent = conversationAgent();
    const approval = activeApproval();
    const autoApprove = activeAgentAutoApproves();
    if (!agent || !approval || !permissionsEditable() || autoApprove === undefined) return undefined;
    const access = agent.access ?? DEFAULT_AGENT_ACCESS;
    if (agentPermissionLevel({ access, autoApprove }) !== "ask") return undefined;
    return async () => {
      if (!(await respondToApprovalRequest(agent.id, approval.requestId, "accept"))) return false;
      if (!scopeIsCurrent()) return true;
      await writeAgentPermissions(agentPermissionUpdate(agent.id, "full"));
      return true;
    };
  });

  const composerSignIn = () => {
    const provider = conversationAgent()?.provider;
    return provider !== undefined && isKnownAgentProvider(provider) && connection.connectKind(provider) !== null;
  };
  const composerCodeSignIn = () => {
    const provider = conversationAgent()?.provider;
    return (
      composerSignIn() &&
      provider !== undefined &&
      isKnownAgentProvider(provider) &&
      connection.alternativeKind(provider) === "code"
    );
  };

  async function updateConversationAgent(agentId: string, updates: Omit<UpdateAgentInput, "agentId">): Promise<void> {
    if (activeServer()?.kind === "local") return updateAgent(agentId, updates);
    await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, ({ agentId: id, ...rest }) =>
      updateAgent(id, rest),
    );
  }

  const providerDownloads = createMemo(
    () =>
      (activeServer()?.kind === "local" || providerAdminServerId() !== undefined) &&
      providerRuntimeDownloadsAvailable(),
  );
  const manageProviders = createMemo(() => activeServer()?.kind === "local" || providerAdminServerId() !== undefined);
  const openProviderSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  const manageBrowserProfiles = createMemo(() => serverCanAdminister(activeServer(), BROWSER_PROFILES_CAPABILITY));
  const openBrowserProfileSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "browser-profiles");
  };
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );

  const usageLimited = (choice: AgentModelChoice) =>
    usageLimitedModels().some((limited) => sameAgentModelChoice(limited, choice));
  const providerFailed = (choice: AgentModelChoice) =>
    failedModels().some((failed) => sameAgentModelChoice(failed, choice));

  const isOwnSender = (senderId: string) => {
    const state = auth.centralAuth();
    return isReaderAuthor(senderId, {
      memberId: readerMemberId(),
      accountUserId: state.status === "signed_in" ? state.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };
  const messageDeleteSupported = () => activeServerSupportsCapability(MESSAGE_DELETE_CAPABILITY);
  const canDeleteAgentMessage = (message: AgentMessage) =>
    readerCanDeleteMessage(message, {
      deleteAny: deletesAnyAgentMessage(activeAgent()?.id),
      isOwnSender,
    });
  const deleteActiveAgentMessage = (messageId: string) => {
    const agentId = activeAgent()?.id;
    return agentId ? deleteAgentMessage(agentId, messageId) : Promise.resolve();
  };
  const deleteMessageAction = () => (messageDeleteSupported() ? deleteActiveAgentMessage : undefined);
  const messagePinsAction = () => (activeServerSupportsCapability(MESSAGE_PINS_CAPABILITY) ? messagePins : undefined);
  const searchThreadsAction = () =>
    activeServerSupportsCapability(THREAD_MESSAGE_SEARCH_CAPABILITY) ? searchActiveAgentThreads : undefined;
  function searchActiveAgentThreads(query: string) {
    const agentId = activeAgent()?.id;
    return agentId ? searchAgentThreadMessages(agentId, query) : Promise.resolve([]);
  }
  const { t } = useText();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();
  const mainQueue = createMemo(() => {
    const agent = activeAgent();
    const queue = activeQueue();
    return agent && queue ? withoutSideThreadTurns(queue, agentTasks.snapshot(agent.id)?.tasks ?? []) : queue;
  });
  const threads = createMemo((): ConversationThreads | undefined => {
    const agent = activeAgent();
    if (!agent || !agentTasks.available()) return undefined;
    return conversationThreads({
      agent: { id: agent.id, updatedAt: agent.updatedAt ?? agent.time },
      tasks: agentTasks,
      tabs: agentThreads,
      approvals: approvals(),
      prompts: Object.values(pendingPrompts()).filter((event) => event?.type === "prompt"),
      takeovers: pendingTakeovers(),
      newThreadTitle: t("conversation.threads.new"),
      onRespondApproval: (approval, decision, options) =>
        respondToApprovalRequest(approval.agentId, approval.requestId, decision, options),
      contextStates: threadContextStates,
      onCompactContext: compactTaskContext(),
      onOpenMainMessage: (messageId) => openAgentMessage(agent.id, messageId),
    });
  });
  const openThreadId = () => threads()?.open?.threadId;
  const shownThreadId = () => {
    const open = threads()?.open;
    return open === undefined ? activeAgent()?.threadId : open?.threadId;
  };
  const activeBrowserTakeover = createMemo(() => {
    const agent = activeAgent();
    const threadId = shownThreadId();
    const event = agent && threadId ? pendingPrompts()[attentionKey(agent.id, threadId)] : undefined;
    return event?.type === "browser-takeover-requested" && event.request.threadId === threadId
      ? event.request
      : undefined;
  });
  const pendingPromptEvent = createMemo(() => {
    const agent = activeAgent();
    const threadId = shownThreadId();
    const event = agent && threadId ? pendingPrompts()[attentionKey(agent.id, threadId)] : undefined;
    return event?.type === "prompt" && event.threadId === threadId ? event : undefined;
  });
  const activePromptMessage = createMemo(() => {
    const agent = activeAgent();
    const prompt = pendingPromptEvent();
    if (!agent || !prompt) return undefined;
    const requestKey = promptRequestKey(prompt.turnId, prompt.requestId);
    const messages =
      threads()?.open === undefined ? conversations[agent.id]?.messages : threads()?.conversation?.messages;
    return (messages ?? []).findLast((message) => messagePromptRequestKey(message) === requestKey);
  });
  const activePrompt = createMemo(() => {
    const prompt = pendingPromptEvent();
    return prompt && withWholePromptText(prompt, activePromptMessage()?.questionPrompt?.questions);
  });

  const activePromptUiBlock = () => activePromptMessage()?.uiBlock;
  const usageLimitsShown = () => serverSupportsCapability(activeServer(), "agent-usage-limit-v1");
  const usageLimitAskFor = usageLimitAskFrom({
    available: (agentId) =>
      usageLimitsShown() && (activeServer()?.kind !== "remote" || deletesAnyAgentMessage(agentId)),
    rememberable: () => serverCanAdminister(activeServer(), "agent-backup-models-v1"),
    usageLimits,
    waited: waitedUsageLimits,
    wait: (agentId, resetsAt) => setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt })),
    modelOptions,
    providers: () => agentStatus().providers,
    limited: usageLimited,
    update: updateConversationAgent,
  });
  const usageLimitAsk = createMemo((): UsageLimitAskCardProps | undefined => {
    const agent = conversationAgent();
    if (!agent || !queues()[agent.id]?.deliveries.some((delivery) => delivery.status === "queued")) return undefined;
    return usageLimitAskFor(agent);
  });
  trackUsageLimitShown(() => {
    const ask = usageLimitAsk();
    const agent = activeAgent();
    return ask && agent ? { agentId: agent.id, ask } : undefined;
  });

  return (
    <>
      <Conversation
        contextState={contextStates()[activeAgent()?.id ?? ""]}
        platform={platform.appInfo()?.platform}
        onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
        connectors={connectors.active}
        onOpenMarketplaceApp={(request) => {
          setPendingPluginConnect(request.connect);
          setPendingPluginSlug(request.appId);
          setSkillsMarketplaceOpen(true);
        }}
        appSettingOpener={appSettingRowOpener(
          () => ({ platform: platform.appInfo()?.platform, chatWindow: platform.chatWindow !== null }),
          openAppSettingRow,
        )}
        onOpenMcpSignIn={(() => {
          const server = activeServer();
          if (!server || (server.kind === "remote" && !remoteMcpSignIn(server))) return undefined;
          return (mcpServerId: string) => {
            setPendingMcpSignIn(mcpServerId);
            setSkillsMarketplaceOpen(true);
          };
        })()}
        mcpSignedIn={(mcpServerId) => {
          const known = mcpSignIns();
          return known?.serverId === activeServer()?.id && known?.states[mcpServerId]?.signedIn === true;
        }}
        refreshMcpSignIns={() => refreshMcpSignIns(activeServer()?.id)}
        serverInstall={{
          get servers() {
            return servers();
          },
          get loaded() {
            return serversLoaded();
          },
          retryConnection: (serverId) => serversPort().servers.retryConnection(serverId),
          onOpenServer: selectServer,
        }}
        onOpenUsage={(trigger) => usage.openUsage(activeServer()?.id ?? "local", trigger, activeAgent()?.id)}
        agentStatus={panelAgentStatus()}
        agentsConnecting={agentListConnecting() || (remoteLoading() && activeServer()?.state === "online")}
        accountUsage={withHostAccountUsage(auth.accountUsage(), hostAccountLimits())}
        providerRuntimeStatuses={providerDownloads() ? providerRuntimeStatuses() : undefined}
        customProviders={activeCustomProviders()}
        onUpdateCustomProvider={activeServer()?.kind === "local" ? localEndpoints.updateCustomProvider : undefined}
        customAgents={activeServer()?.kind === "local" ? customAgents() : undefined}
        onDownloadProvider={providerDownloads() ? downloadProviderRuntime : undefined}
        onCancelProviderDownload={providerDownloads() ? cancelProviderRuntimeDownload : undefined}
        onConnectProvider={localProviderDownloads() || providerAdminServerId() ? connectFromComposer : undefined}
        canConnectProvider={(provider) => connection.connectKind(provider) !== null}
        onSignInProvider={composerSignIn() ? connectFromComposer : undefined}
        onSignInWithCodeProvider={composerCodeSignIn() ? signInWithCode : undefined}
        onManageProviders={manageProviders() ? openProviderSettings : undefined}
        onManageBrowserProfiles={manageBrowserProfiles() ? openBrowserProfileSettings : undefined}
        onOpenNotificationSettings={openNotificationLevels}
        agent={conversationAgent()}
        agents={agentList()}
        mentionAgents={agentList().filter((agent) => !userPausedAgentIds().has(agent.id))}
        availableRoutineIds={activeRoutineIds()}
        routines={activeRoutines()}
        modelOptions={modelOptions()}
        messages={activeMessages()}
        messageReferences={activeAgent() ? (conversations[activeAgent()?.id ?? ""]?.references ?? {}) : {}}
        missingMessageReferences={activeAgent() ? conversations[activeAgent()?.id ?? ""]?.missingReferences : undefined}
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
        queue={mainQueue()}
        browserTabs={browserTabs()}
        noticedBrowserTabIds={browserTabNoticeShown() ? (noticedBrowserTabIds() ?? undefined) : undefined}
        onNoticeBrowserTabs={noticeBrowserTabs}
        activeBrowserTabId={activeBrowserTabId()}
        browserVisibilitySuspended={browserVisibilitySuspended()}
        workspaceCovered={windowPage.conversationCovered()}
        browserControlState={browserControlState()}
        server={activeServer()}
        responseStyle={responseStyle()}
        presence={teamPresence()}
        currentUserEmail={props.account().email}
        currentUserChatColor={props.account().chatColor}
        isOwnSender={isOwnSender}
        browserEnabled={
          !platform.landingPreview && !platform.chatWindow && activeServerSupportsCapability("browser-control")
        }
        openLinksInBrowser={generalSettings().externalLinkTarget.kind === "openbot"}
        remoteDesktopSessionActive={Boolean(activeRemoteDesktopSession())}
        remoteDesktopVisible={remoteDesktopWorkspaceVisible()}
        remoteDesktopEnabled={
          !platform.landingPreview && !platform.chatWindow && activeServerSupportsCapability("remote-desktop")
        }
        prompt={activePrompt()}
        promptUiBlock={activePromptUiBlock()}
        approval={activeApproval()}
        usageLimitAsk={usageLimitAsk()}
        usageLimited={usageLimitsShown() ? usageLimited : undefined}
        providerFailed={usageLimitsShown() ? providerFailed : undefined}
        browserTakeover={activeBrowserTakeover()}
        activeTurnId={activeAgent() ? activeTurns()[activeAgent()?.id ?? ""] : null}
        subagentTurnId={stoppableSubagentTurn(activeAgent())}
        activityDetail={activeAgent() ? turnProgress()[activeAgent()?.id ?? ""]?.detail : undefined}
        activityRunning={activeAgent() ? turnProgress()[activeAgent()?.id ?? ""]?.running : undefined}
        activityKind={activeAgent() ? turnProgress()[activeAgent()?.id ?? ""]?.activity : undefined}
        backgroundWorkSince={(taskId) => {
          const agentId = activeAgent()?.id;
          return agentId ? backgroundWork()[backgroundWorkKey(agentId, taskId)] : undefined;
        }}
        turnStepLines={turnStepLines()}
        skillsMarketplaceOpen={skillsMarketplaceOpen()}
        mcpSettingsOpen={skillsMarketplaceOpen()}
        globalOverlayOpen={
          globalSearchOpen() ||
          joinServerOpen() ||
          serverSettingsOpen() ||
          appSettingsOpen() ||
          skillsMarketplaceOpen() ||
          quitShortcutHintShown()
        }
        settingsRequest={settingsRequest()}
        messageFocusRequest={messageFocusRequest()}
        onSelectAgent={selectAgent}
        agentWaits={agentWaits()}
        agentTakeoverTabIds={agentTakeoverTabs()}
        onUpdateAgent={updateConversationAgent}
        onSetAgentAvatar={setAgentAvatar}
        onSendMessage={sendMessage}
        onMarkRead={() => markAgentMessagesRead()}
        onMarkUnread={
          activeServerSupportsCapability(CONVERSATION_UNREAD_FROM_CAPABILITY)
            ? (messageId) => {
                const agentId = activeAgent()?.id;
                return agentId ? markAgentMessagesUnread(agentId, messageId) : Promise.resolve();
              }
            : undefined
        }
        onDeleteMessage={deleteMessageAction()}
        canDeleteMessage={canDeleteAgentMessage}
        messagePins={messagePinsAction()}
        sendToChannel={sendToChannel()}
        onLoadOlder={() => void loadOlderAgentMessages()}
        onLoadLatest={() => (activeAgent() ? loadLatestAgentMessages(activeAgent()?.id ?? "") : Promise.resolve())}
        onSearchMessages={(query) =>
          activeAgent()
            ? searchAgentMessages(activeAgent()?.id ?? "", query)
            : Promise.resolve({ messageIds: [], total: 0 })
        }
        onSearchThreads={searchThreadsAction()}
        onOpenSearchMessage={async (messageId) => {
          const agentId = activeAgent()?.id;
          if (agentId) await openAgentMessage(agentId, messageId);
        }}
        onTypingChange={setTeamTyping}
        onAnswerPrompt={(answers, options) => answerPrompt(answers, options, openThreadId())}
        onPromptResolutionPresented={presentPromptResolution}
        onRespondToApproval={respondToApproval}
        onAlwaysAllowApproval={alwaysAllowApproval()}
        mediaApproval={mediaApproval}
        agentAutoApproves={activeAgentAutoApproves()}
        remoteBackupModelsLoaded={remoteAgentAdmin.backupModels() !== undefined}
        remotePlanCardLoaded={remoteAgentAdmin.quickAcknowledgement() !== undefined}
        remoteBuiltinMemoryLoaded={remoteAgentAdmin.memory() !== undefined}
        remoteComputerUseLoaded={remoteAgentAdmin.computerUse() !== undefined}
        remoteNewChatLoaded={remoteAgentAdmin.allowNewChat() !== undefined}
        remoteBusyMessageModeLoaded={remoteAgentAdmin.busyMessageMode() !== undefined}
        onUpdateAgentPermissions={permissionsEditable() ? writeAgentPermissions : undefined}
        defaultBusyMessageMode={
          activeServer()?.kind === "remote"
            ? remoteAgentAdmin.defaultBusyMessageMode()
            : generalSettings().busyMessageMode
        }
        agentDefaults={generalSettings().agentDefaults}
        agentMemoryLimit={generalSettings().agentMemoryLimit}
        onClearAgentContext={clearActiveAgentContext()}
        onDeleteAgentHistory={deleteActiveAgentHistory()}
        onDeleteAgent={deleteAgentAllowed() ? (agentId) => deleteAgent(agentId) : undefined}
        onCompactAgentContext={compactActiveAgentContext()}
        onRespondToBrowserTakeover={(decision, options) => respondToBrowserTakeover(decision, openThreadId(), options)}
        onCancelQueuedMessage={cancelQueuedMessage}
        waits={activeWaits()}
        threads={threads()}
        onCancelWait={cancelWait}
        onSteerQueuedMessage={steerQueuedMessage}
        onSendQueuedMessageNow={sendQueuedMessageNow}
        onUpdateQueuedMessage={updateQueuedMessage}
        onReorderQueue={reorderQueue}
        onActivateBrowserTab={activateBrowserTab}
        onCloseBrowserTab={closeBrowserTab}
        onOpenRemoteDesktop={openRemoteDesktopWorkspace}
        onStop={stopActiveTurn}
      />
      <ProviderSignInDialogs api={connection} opener="composer" />
    </>
  );
}
