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
import { hasVisibleToasts } from "@openbot/ui";
import {
  type BackupModelSource,
  rememberedBackupModels,
  type UsageLimitAskCardProps,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { unloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import { sidebarAgentWaits } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { ProviderSignInDialogs } from "../../components/ProviderSignInDialogs";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { createScopeGuard } from "../../scope-lifetime";
import { useTurns } from "../../turns";
import { turnsPort } from "../../turns-port";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { conversationThreads } from "../agent-threads/conversation-threads";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { agentThreadAttention } from "../agents/agent-thread-attention";
import { useAgents } from "../agents/agents-context";
import { agentsPort } from "../agents/agents-port";
import { withHostAccountUsage } from "../agents/host-provider-accounts";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { useBrowserTabs } from "../browser/browser-context";
import { useConnectors } from "../connectors/connectors-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { remoteMcpSignIn, serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import { useUsage } from "../usage/usage-context";
import { useWindowPage } from "../window/window-page-context";
import { Conversation } from "./Conversation";
import { useConversation } from "./conversation-context";
import { messagePromptRequestKey, promptRequestKey } from "./conversation-keys";
import type { ConversationThreads } from "./conversation-types";

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
  const serverScope = useServerScope();
  const platform = usePlatform();
  const connectors = useConnectors();
  const { activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { serverSettingsOpen, openServerSettings, openMcpSignIn, serverSettingsTargetId, serverSettingsMcpSignIns } =
    useServerSettings();
  const {
    appSettingsOpen,
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    setPendingPluginSlug,
    setPendingPluginConnect,
    agentAutoApproves,
    generalSettings,
    openNotificationLevels,
  } = useSettings();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    providerAdminServerId,
    connection,
  } = useProviders();
  /**
   * The composer's sign-ins: Connect, and the code from the ⋯ menu. The dialog shows here only while
   * this surface started it: Settings shows its own for the sign-ins it starts.
   */
  const connectFromComposer = async (provider: AgentProviderId) => {
    // A key-only provider, such as Inception, signs in only with a key, which the server's Providers
    // settings take.
    const server = activeServer();
    if (isKeyOnlyProvider(provider) && server) openServerSettings(server.id, null, "providers");
    else await connection.connect(provider, "composer");
  };
  const signInWithCode = (provider: AgentProviderId) => connection.alternative(provider, "composer");
  // Not gated on the server: the picker needs these IDs to label a model it is already showing, and
  // a remote server's OpenCode has its own catalogue. Only the write paths are local-only.
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const {
    agentStatus,
    hostAccountLimits,
    agentList,
    agentListConnecting,
    activeAgent,
    userHiddenAgentIds,
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
    updateQueuedMessage,
    reorderQueue,
    stopActiveTurn,
    usageLimits,
    usageLimitedModels,
    waitedUsageLimits,
    setWaitedUsageLimits,
    queues,
  } = useTurns();
  const {
    activeMessages,
    conversations,
    sendMessage,
    markAgentMessagesRead,
    markAgentMessagesUnread,
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
  const windowPage = useWindowPage();
  // The composer never asks for usage itself. It reads the dock's reading, which is scoped to the
  // active agent's provider and model and cleared on a switch, because a second request would hit
  // the provider's rate-limit endpoint for a card the user may never see.
  const auth = useAuth();
  const { teamPresence, currentTeamMember } = usePresence();
  const { selectAgent, openAgentMessage, messageFocusRequest, globalSearchOpen } = useNavigation();

  // The waits of the agents that this agent asked, by the same rules as the sidebar's "Needs you".
  const agentWaits = createMemo(() =>
    sidebarAgentWaits({
      agentIds: agentList().map((agent) => agent.id),
      ...agentThreadAttention({ agents: agentList(), pendingPrompts: pendingPrompts(), approvals: approvals() }),
      usageLimits: usageLimits(),
    }),
  );

  const activeApproval = createMemo(() => {
    const agent = activeAgent();
    return agent ? approvalOfThread(agent.id, agent.threadId) : undefined;
  });

  /**
   * Access and auto-approve of a joined server's agent, read from its host. Null for this
   * computer's agents, for a member, and for a host without `agent-admin-v1`.
   */
  const remoteAgentAdmin = createRemoteAgentAdmin(() => {
    const server = activeServer();
    const agent = activeAgent();
    return server && agent ? { server, agentId: agent.id, updatedAt: agent.updatedAt ?? null } : null;
  });
  const remoteAgentSettings = remoteAgentAdmin.settings;

  /** A new chat with the active agent, on this computer or on a host that serves `context-reset-v1`. */
  const clearActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || !server || !serverSupportsCapability(server, "context-reset-v1")) return undefined;
    return () => turnsPort().agent.clearContext(agent.id, server.id);
  });

  /** Local only: the Team API has no route to compact a joined server's agent. */
  const compactActiveAgentContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || server?.kind !== "local") return undefined;
    return () => turnsPort().agent.compactContext(agent.id, server.id);
  });

  /** As `compactActiveAgentContext`, for one side thread of the active agent. */
  const compactTaskContext = createMemo(() => {
    const agent = activeAgent();
    const server = activeServer();
    if (!agent || server?.kind !== "local") return undefined;
    return (taskId: string) => turnsPort().agent.compactTaskContext({ agentId: agent.id, taskId }, server.id);
  });

  /** The Team API agent summary has no access, so a joined server's agent shows the host's answer. */
  const conversationAgent = createMemo(() => {
    const agent = activeAgent();
    const settings = remoteAgentSettings();
    const automation = remoteAgentAdmin.automation();
    const busyMessageMode = remoteAgentAdmin.busyMessageMode();
    const backupModels = remoteAgentAdmin.backupModels();
    const usageLimitReturn = remoteAgentAdmin.usageLimitReturn();
    const taskLimit = remoteAgentAdmin.taskLimit();
    return agent
      ? {
          ...agent,
          ...(settings ? { access: settings.access } : {}),
          ...(activeServer()?.kind === "remote" && automation !== undefined ? { allowAutomation: automation } : {}),
          ...(activeServer()?.kind === "remote" && busyMessageMode ? { busyMessageMode } : {}),
          ...(activeServer()?.kind === "remote" && backupModels ? { backupModels } : {}),
          ...(activeServer()?.kind === "remote" && usageLimitReturn ? { usageLimitReturn } : {}),
          ...(activeServer()?.kind === "remote" && typeof taskLimit === "number" ? { taskLimit } : {}),
        }
      : agent;
  });
  /**
   * Who may change an agent's Permissions level: this computer for its own agents, and an owner or
   * admin of a joined server whose host has answered. The level belongs to the computer that runs
   * the agent, so a remote change is written on that host.
   */
  const permissionsEditable = () => activeServer()?.kind === "local" || remoteAgentSettings() !== null;

  /** The agent is named by the caller, because an approval card can outlive a switch to another agent. */
  async function writeAgentPermissions(input: UpdateAgentAdminSettingsInput): Promise<void> {
    if (activeServer()?.kind === "local") await agentsPort().agent.updateAgentAdminSettings(input);
    else await remoteAgentAdmin.update(input);
  }

  /** Read from the local preference, or from the host. Unknown until a host answers. */
  const activeAgentAutoApproves = () =>
    activeServer()?.kind === "local" ? agentAutoApproves(activeAgent()?.id ?? "") : remoteAgentAdmin.autoApproves();

  /** "Always allow" moves an agent at Ask first to Full access. Other levels have nothing to move to. */
  const alwaysAllowApproval = createMemo(() => {
    const agent = conversationAgent();
    const approval = activeApproval();
    const autoApprove = activeAgentAutoApproves();
    if (!agent || !approval || !permissionsEditable() || autoApprove === undefined) return undefined;
    const access = agent.access ?? DEFAULT_AGENT_ACCESS;
    if (agentPermissionLevel({ access, autoApprove }) !== "ask") return undefined;
    // This card is answered first: the grant answers every card that still waits, so an answer sent
    // after it would find this one gone.
    return async () => {
      if (!(await respondToApprovalRequest(agent.id, approval.requestId, "accept"))) return false;
      if (!scopeIsCurrent()) return true;
      await writeAgentPermissions(agentPermissionUpdate(agent.id, "full"));
      return true;
    };
  });

  /** Whether this window runs the sign-in of the agent's provider: on this computer, or on a server it administers. */
  const composerSignIn = () => {
    const provider = conversationAgent()?.provider;
    return provider !== undefined && isKnownAgentProvider(provider) && connection.connectKind(provider) !== null;
  };
  /** Whether the composer offers the code sign-in for the agent's provider, when its Connect is slow or fails. */
  const composerCodeSignIn = () => {
    const provider = conversationAgent()?.provider;
    return (
      composerSignIn() &&
      provider !== undefined &&
      isKnownAgentProvider(provider) &&
      connection.alternativeKind(provider) === "code"
    );
  };

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
  const openProviderSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  /** The named browser profiles live on the computer that runs the agents: this one, or a host an admin manages. */
  const manageBrowserProfiles = createMemo(() => serverCanAdminister(activeServer(), BROWSER_PROFILES_CAPABILITY));
  const openBrowserProfileSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "browser-profiles");
  };
  /** The browser sign-in opens on this computer, so it stays local. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );

  /** Whether a usage limit holds this model and account now. */
  const usageLimited = (choice: AgentModelChoice) =>
    usageLimitedModels().some((limited) => sameAgentModelChoice(limited, choice));

  const { t } = useText();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();
  /** The active agent's threads. A host without side threads shows only the agent's own chat. */
  const threads = createMemo((): ConversationThreads | undefined => {
    const agent = activeAgent();
    if (!agent || !agentTasks.available()) return undefined;
    return conversationThreads({
      agent: { id: agent.id, updatedAt: agent.updatedAt ?? agent.time },
      tasks: agentTasks,
      tabs: agentThreads,
      approvals: approvals(),
      prompts: Object.values(pendingPrompts()).filter((event) => event?.type === "prompt"),
      takeovers: Object.values(pendingPrompts()).flatMap((event) =>
        event?.type === "browser-takeover-requested" ? [event.request] : [],
      ),
      newThreadTitle: t("conversation.threads.new"),
      onRespondApproval: (approval, decision, options) =>
        respondToApprovalRequest(approval.agentId, approval.requestId, decision, options),
      contextStates: threadContextStates,
      onCompactContext: compactTaskContext(),
    });
  });
  /** The thread that the conversation shows: the open side thread, or the agent's own chat. */
  const openThreadId = () => threads()?.open?.threadId;
  /** The thread whose waits the conversation shows. A new thread draft has no turn, so it has none. */
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
  const activePrompt = createMemo(() => {
    const agent = activeAgent();
    const threadId = shownThreadId();
    const event = agent && threadId ? pendingPrompts()[attentionKey(agent.id, threadId)] : undefined;
    return event?.type === "prompt" && event.threadId === threadId ? event : undefined;
  });

  // The timeline leaves the waiting prompt's message out, so its block is read here.
  const activePromptUiBlock = createMemo(() => {
    const agent = activeAgent();
    const prompt = activePrompt();
    if (!agent || !prompt) return undefined;
    const requestKey = promptRequestKey(prompt.turnId, prompt.requestId);
    const messages =
      threads()?.open === undefined ? conversations[agent.id]?.messages : threads()?.conversation?.messages;
    return (messages ?? []).findLast((message) => messagePromptRequestKey(message) === requestKey)?.uiBlock;
  });
  /**
   * A usage limit holds the active agent's queued message on this computer. The chat asks where to
   * send it, unless the agent switches by itself to a saved backup model that is ready.
   */
  const usageLimitAsk = createMemo((): UsageLimitAskCardProps | undefined => {
    const agent = activeAgent();
    // Only this computer holds a message at a usage limit, and its agents use the providers it knows.
    if (!agent || activeServer()?.kind !== "local" || !isKnownAgentProvider(agent.provider)) return undefined;
    const provider = agent.provider;
    const limits = usageLimits();
    if (!(agent.id in limits)) return undefined;
    const resetsAt = limits[agent.id] ?? null;
    if (waitedUsageLimits()[agent.id] === resetsAt && agent.id in waitedUsageLimits()) return undefined;
    if (!queues()[agent.id]?.deliveries.some((delivery) => delivery.status === "queued")) return undefined;
    const source: BackupModelSource = {
      modelOptions: modelOptions(),
      providers: agentStatus().providers,
      limited: usageLimited,
    };
    const options = usageLimitAskOptions({ ...agent, provider }, agent.backupModels, source);
    if (options.length === 0) return undefined;
    const backupModels = agent.backupModels;
    if (
      backupModels?.automatic &&
      backupModels.order.some((choice) => options.some((option) => sameAgentModelChoice(option.choice, choice)))
    )
      return undefined;
    const agentId = agent.id;
    const reasoningEffort = agent.reasoningEffort;
    const fromProvider = agent.provider;
    return {
      provider,
      resetsAt,
      options,
      onSend: async (option, remember) => {
        // The agent keeps its reasoning effort where the other model has it.
        const model = modelOptions().find(
          (candidate) => candidate.provider === option.choice.provider && candidate.id === option.choice.model,
        );
        await updateAgent(agentId, {
          provider: option.choice.provider,
          model: option.choice.model,
          providerAccountId: option.choice.providerAccountId ?? null,
          reasoningEffort:
            model && !model.supportedReasoningEfforts.includes(reasoningEffort)
              ? model.defaultReasoningEffort
              : reasoningEffort,
          leaveUsageLimit: true,
          ...(remember ? { backupModels: rememberedBackupModels(option.choice, backupModels) } : {}),
        });
        desktopAnalytics.track("usage_limit_action", {
          action: "model_switched",
          from_provider: fromProvider,
          to_provider: option.choice.provider,
          to_model: option.choice.model,
        });
      },
      onWait: () => {
        desktopAnalytics.track("usage_limit_action", { action: "waited", from_provider: fromProvider });
        setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt }));
      },
    };
  });
  // One "shown" for each limit that asks, also when the user opens the agent again; a new reset time is a
  // new limit.
  const shownUsageLimits = new Set<string>();
  createEffect(
    () => {
      const ask = usageLimitAsk();
      return ask ? { key: `${activeAgent()?.id ?? ""}:${ask.resetsAt ?? ""}`, provider: ask.provider } : null;
    },
    (shown) => {
      if (!shown || shownUsageLimits.has(shown.key)) return;
      shownUsageLimits.add(shown.key);
      desktopAnalytics.track("usage_limit_action", { action: "shown", from_provider: shown.provider });
    },
  );

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
        // The server settings sign in as their MCP panel does: on this computer, or through a host that
        // relays its sign-in page.
        onOpenMcpSignIn={(() => {
          const server = activeServer();
          if (!server || (server.kind === "remote" && !remoteMcpSignIn(server))) return undefined;
          return (mcpServerId: string, trigger: HTMLElement | null) => openMcpSignIn(server.id, mcpServerId, trigger);
        })()}
        mcpSignedIn={(mcpServerId) =>
          serverSettingsTargetId() === activeServer()?.id && serverSettingsMcpSignIns()[mcpServerId]?.signedIn === true
        }
        onOpenUsage={(trigger) => usage.openUsage(activeServer()?.id ?? "local", trigger, activeAgent()?.id)}
        agentStatus={
          activeServer()?.kind === "remote" &&
          (!serverScope.loaded() || !conversations[activeAgent()?.id ?? ""]?.loaded)
            ? { ...agentStatus(), phase: "starting" }
            : agentStatus()
        }
        agentsConnecting={agentListConnecting()}
        accountUsage={withHostAccountUsage(auth.accountUsage(), hostAccountLimits())}
        providerRuntimeStatuses={providerDownloads() ? providerRuntimeStatuses() : undefined}
        customProviders={customProviders()}
        // The custom agents are this computer's. A joined host's picker counts its own from its models.
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
        mentionAgents={agentList().filter((agent) => !userHiddenAgentIds().has(agent.id))}
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
        queue={activeQueue()}
        browserTabs={browserTabs()}
        activeBrowserTabId={activeBrowserTabId()}
        browserVisibilitySuspended={browserVisibilitySuspended()}
        workspaceCovered={windowPage.conversationCovered()}
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
        // The browser and the remote desktop show in the main window only.
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
        usageLimited={activeServer()?.kind === "local" ? usageLimited : undefined}
        browserTakeover={activeBrowserTakeover()}
        activeTurnId={activeAgent() ? activeTurns()[activeAgent()?.id ?? ""] : null}
        activityDetail={activeAgent() ? turnProgress()[activeAgent()?.id ?? ""]?.detail : undefined}
        turnStepLines={turnStepLines()}
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
        agentWaits={agentWaits()}
        onUpdateAgent={updateConversationAgent}
        onSetAgentAvatar={setAgentAvatar}
        onSendMessage={sendMessage}
        onMarkRead={() => markAgentMessagesRead()}
        // The Team API unread route marks a whole chat, so only an agent on this computer has the item.
        onMarkUnread={
          activeServer()?.kind === "local"
            ? (messageId) => {
                const agentId = activeAgent()?.id;
                return agentId ? markAgentMessagesUnread(agentId, messageId) : Promise.resolve();
              }
            : undefined
        }
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
        onAnswerPrompt={(answers, options) => answerPrompt(answers, options, openThreadId())}
        onPromptResolutionPresented={presentPromptResolution}
        onRespondToApproval={respondToApproval}
        onAlwaysAllowApproval={alwaysAllowApproval()}
        agentAutoApproves={activeAgentAutoApproves()}
        remoteBackupModelsLoaded={remoteAgentAdmin.backupModels() !== undefined}
        remoteTaskLimitLoaded={remoteAgentAdmin.taskLimit() !== undefined}
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
        onCompactAgentContext={compactActiveAgentContext()}
        onRespondToBrowserTakeover={(decision, options) => respondToBrowserTakeover(decision, openThreadId(), options)}
        onCancelQueuedMessage={cancelQueuedMessage}
        waits={activeWaits()}
        threads={threads()}
        onCancelWait={cancelWait}
        onSteerQueuedMessage={steerQueuedMessage}
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
