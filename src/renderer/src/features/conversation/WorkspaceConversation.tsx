import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useRemoteDesktop } from "../remote-desktop/remote-desktop-context";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
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
  const platform = usePlatform();
  const { activeServer, activeServerSupportsCapability, joinServerOpen } = useServers();
  const { serverSettingsOpen } = useServerSettings();
  const { appSettingsOpen, skillsMarketplaceOpen } = useSettings();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    connectProvider,
  } = useProviders();
  // Not gated on the server: the picker needs these IDs to label a model it is already showing, and
  // a remote server's OpenCode has its own catalogue. Only the write paths are local-only.
  const { customProviders } = useCustomProviders();
  const { agentStatus, agentList, activeAgent, modelOptions, settingsRequest, updateAgent, setAgentAvatar } =
    useAgents();
  const {
    activeQueue,
    activeRoutineIds,
    pendingPrompts,
    pendingApprovals,
    activeTurns,
    turnProgress,
    answerPrompt,
    respondToApproval,
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
  const { teamPresence } = usePresence();
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

  /** Provider downloads are the local machine's business, never a remote host's. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );

  return (
    <Conversation
      agentStatus={agentStatus()}
      providerRuntimeStatuses={localProviderDownloads() ? providerRuntimeStatuses() : undefined}
      customProviders={customProviders()}
      onDownloadProvider={localProviderDownloads() ? downloadProviderRuntime : undefined}
      onCancelProviderDownload={localProviderDownloads() ? cancelProviderRuntimeDownload : undefined}
      onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
      agent={activeAgent()}
      agents={agentList()}
      availableRoutineIds={activeRoutineIds()}
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
      globalOverlayOpen={
        globalSearchOpen() || joinServerOpen() || serverSettingsOpen() || appSettingsOpen() || skillsMarketplaceOpen()
      }
      settingsRequest={settingsRequest()}
      messageFocusRequest={messageFocusRequest()}
      onSelectAgent={selectAgent}
      onUpdateAgent={updateAgent}
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
      onRespondToBrowserTakeover={respondToBrowserTakeover}
      onCancelQueuedMessage={cancelQueuedMessage}
      onSteerQueuedMessage={steerQueuedMessage}
      onUpdateQueuedMessage={updateQueuedMessage}
      onReorderQueue={reorderQueue}
      onActivateBrowserTab={activateBrowserTab}
      onCloseBrowserTab={closeBrowserTab}
      onOpenRemoteDesktop={openRemoteDesktopWorkspace}
      onOpenAgentSetup={() => window.openbot.openExternal("agent-setup")}
      onStop={stopActiveTurn}
    />
  );
}
