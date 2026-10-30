import type { ServerSummary } from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { classifyFailure } from "@openbot/telemetry";
import { SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MAX } from "@openbot/ui/components/SettingsPanel";
import { BROWSER_NEW_TAB_URL } from "@openbot/ui/features/browser/browser-suggestions";
import { SidePanelHeader, SidePanelLauncher, type SidePanelPane } from "@openbot/ui/features/conversation/SidePanel";
import { SideQuestionPanel } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { SubagentPanel } from "@openbot/ui/features/conversation/Subagents";
import { VoicePanel } from "@openbot/ui/features/conversation/VoicePanel";
import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { agentTemplatesPort } from "../agent-templates/agent-templates-port";
import { createPublishAgent } from "../agent-templates/PublishAgent";
import { desktopBrowserProfileCalls } from "../browser/browser-profiles-port";
import type { AgentFilesOptions } from "../files/AgentFilesSettings";
import { canManageStorage, serverHasStorage } from "../files/storage-usage";
import { serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { ConversationSideThread } from "./ConversationSideThread";
import { htmlAttachmentPageHtml, htmlAttachmentPageUrl } from "./chat-visual-url";
import { useConversationController } from "./conversation-controller-context";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { agentSkillsMode } from "./installed-skills-source";
import { desktopChatEventRoutinesApi } from "./routine-webhooks-api";

const BROWSER_PANEL_DEFAULT_RATIO = 0.5;
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;
const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { Portal } from "@solidjs/web";
import { createEffect, createMemo, Loading, lazy, onSettled, Show, untrack } from "solid-js";
import { agentFolderCalls } from "./agent-folders-port";
import { conversationPort } from "./conversation-port";

/** The voice conversation with the agent that is open when the pane opens. */
function VoiceConversationPane() {
  const { props, startVoiceConversation, closeSidePanelPane } = useConversationViewScope();
  const agentId = untrack(() => props.agent?.id);
  if (!agentId) return null;
  const conversation = startVoiceConversation(agentId);
  return (
    <Show when={props.agent}>
      {(agent) => (
        <VoicePanel
          agent={agent()}
          phase={conversation.phase()}
          muted={conversation.muted()}
          heard={conversation.heard()}
          said={conversation.said()}
          levels={conversation.levels()}
          error={conversation.error()}
          onToggleMute={conversation.toggleMute}
          onInterrupt={conversation.interrupt}
          onEnd={() => closeSidePanelPane("voice")}
        />
      )}
    </Show>
  );
}

/** @internal Stable HMR boundary for conversation panels. */
export function ConversationPanels(panelProps: { onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined }) {
  const controller = useConversationController();
  const {
    agentReady,
    activateBrowserTab,
    activeBrowserTab,
    agentActivity,
    browserSidebarOpen,
    browserExpandedOpen,
    hideBrowserPanel,
    browserTabs,
    closeSidebarFilePreview,
    closeBrowserTab,
    downloadSidebarFile,
    revealSidebarFile,
    conversationPanelElement,
    filePreviewOpen,
    filesOpen,
    openBrowserAddress,
    openExternalMessageUrl,
    openRoutineRunMessage,
    openSharedFile,
    previewAttachment,
    openSidebarFileExternally,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    previewQuoteId,
    previewWorkspaceAgentId,
    sidebarFileBack,
    openSidebarFileBack,
    props,
    setActiveRightPanel,
    setBrowserPanelWidth,
    setSettingsPanelWidth,
    handleRoutineSettingsRequest,
    sidebarFilePreview,
    settingsOpen,
    skillSettingsRequest,
    routineSettingsRequest,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    updateRuntimeSettings,
    messageLinkRelay,
    openMessageLinkRelay,
    pasteMessageLinkRelay,
    cancelMessageLinkRelay,
    activeRightPanel,
    sidePanel,
    sidePanelOpen,
    setSidePanelMaximized,
    openSidePanelPane,
    toggleSidePanel,
    closeSidePanelPane,
    sideQuestion,
    setSideQuestionDraft,
    askSideQuestion,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    voiceConversationAvailable,
    panelSubagentId,
    shownPanelThreadId,
    openPanelThread,
    closePanelThread,
    movePanelThreadToChat,
    channel,
  } = useConversationViewScope();
  const { t, errorMessage } = useText();
  const publishAgent = createPublishAgent(
    (url) => void conversationRuntime(props).openUrl(url),
    () => props.runtime?.admin?.agentTemplates ?? agentTemplatesPort().agentTemplates,
  );
  // This computer reads the skills of its own agents from the workspace. A joined host publishes its
  // own agents, for an owner or admin, when it serves `agent-publish-v1`.
  // A remote agent's host resolves its settings, so the account defaults of this computer do not apply.
  const localAgentDefaults = () => (props.server?.kind === "local" ? props.agentDefaults : undefined);
  const folderCalls = agentFolderCalls();
  /** An agent's folders are on the computer that runs it, and the Team API does not carry them. */
  const localFolderCalls = () => (props.server?.kind === "local" && !props.runtime ? folderCalls : undefined);
  const canPublish = () =>
    props.runtime
      ? props.runtime.admin !== undefined && serverCanAdminister(props.server, "agent-publish-v1")
      : props.server?.kind === "local";
  // The web client asks the host directly; desktop goes through main for this computer and for a joined server.
  // The calls follow the server id, so a new summary of the same server keeps the loaded profiles.
  const browserProfileServerId = createMemo(() =>
    props.server && serverSupportsCapability(props.server, BROWSER_PROFILES_CAPABILITY) ? props.server.id : undefined,
  );
  const browserProfileCalls = createMemo(() => {
    if (props.runtime) return props.runtime.browserProfiles;
    const serverId = browserProfileServerId();
    return serverId === undefined ? undefined : desktopBrowserProfileCalls(serverId);
  });
  let browserPreviewTrigger: HTMLButtonElement | undefined;
  /** The panes this chat can open. The web client has no Files pane, and a chat without a thread has no files. */
  const sidePanelPanes = createMemo((): SidePanelPane[] => [
    // A channel turn's takeover still shows as a card; the pane belongs to one agent's browser.
    ...(props.browserEnabled !== false && !channel ? (["browser"] as const) : []),
    ...(!props.runtime && props.agent?.threadId && serverHasStorage(props.server) ? (["files"] as const) : []),
    ...(props.agent || channel ? (["settings"] as const) : []),
    ...(props.agent && voiceConversationAvailable() ? (["voice"] as const) : []),
  ]);
  /** The subagent in the Subagent pane, from the newest turn that has it. */
  const panelSubagent = createMemo(() => {
    const subagentId = panelSubagentId();
    if (!subagentId) return undefined;
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const found = props.messages[index]?.subagents?.find((subagent) => subagent.id === subagentId);
      if (found) return found;
    }
    return undefined;
  });
  const settingsMaxWidth = () =>
    Math.min(
      SETTINGS_PANEL_MAX,
      Math.max(
        SETTINGS_PANEL_DEFAULT,
        (conversationPanelElement()?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
      ),
    );
  /** Agent settings > Files. */
  const agentFiles = (server: ServerSummary | undefined, agentId: string): AgentFilesOptions | undefined => {
    // The web client shows host files in Server settings > Storage; its agent settings have no Files.
    if (props.runtime || !serverHasStorage(server)) return undefined;
    return {
      serverId: server.id,
      canManage: canManageStorage(server),
      onOpenWorkspace:
        server.kind === "local"
          ? () =>
              void conversationPort()
                .storage.openLocation({ agentId })
                .catch((error) =>
                  actionToast.error(t("conversation.panels.openWorkspaceFailed"), {
                    ...{
                      description: errorMessage(error, t("conversation.panels.tryAgain")),
                    },
                    report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
                  }),
                )
          : undefined,
      onPreviewFile: (file) => void previewAttachment(file),
      onShowMessage: (messageId) => openRoutineRunMessage(messageId),
      // The agent's chat is behind the settings, so closing them opens it.
      onOpenConversation: () => setActiveRightPanel("none"),
    };
  };
  createEffect(
    () => ({ expanded: browserExpandedOpen(), suspended: props.globalOverlayOpen || props.remoteDesktopVisible }),
    ({ expanded, suspended }) => {
      if (!expanded || suspended) return;
      const frame = conversationPanelElement()?.closest<HTMLElement>(".app-frame");
      if (!frame) return;
      const wasInert = frame.inert;
      frame.inert = true;
      return () => {
        frame.inert = wasInert;
      };
    },
  );
  createEffect(browserSidebarOpen, (open, previous) => {
    if (open && previous === false) onSettled(() => browserPreviewTrigger?.focus());
  });
  /**
   * A plain accessor, not a conditional in the prop: the compiler makes that a memo, and the tabs read
   * it first in an effect callback when the last tab closes, which halts the reactive system.
   */
  const selectedPane = () => (activeRightPanel() === "side-panel" ? null : sidePanel().selected);
  /** The side thread that shows, and whose tab is selected. */
  const shownThread = () => (activeRightPanel() === "thread" ? shownPanelThreadId() : null);
  /** With no side thread to show, the side panel lists the panes. */
  const launcherShown = () =>
    activeRightPanel() === "side-panel" || (activeRightPanel() === "thread" && shownPanelThreadId() === null);
  const sideThreadTabs = () => props.threads?.side.tabs ?? [];
  const moveSideThread = (id: string, index: number) => props.threads?.side.onMove(id, index);
  return (
    <>
      <Show when={sidePanelOpen()}>
        <SidePanelHeader
          panes={sidePanel().panes}
          selected={selectedPane()}
          available={sidePanelPanes()}
          maximized={sidePanel().maximized}
          settingsLabel={channel ? t("channel.settings.title") : undefined}
          onSelect={openSidePanelPane}
          onClose={closeSidePanelPane}
          threads={{
            items: sideThreadTabs(),
            selectedId: shownThread(),
            onSelect: openPanelThread,
            onClose: closePanelThread,
            onMove: moveSideThread,
            onToChat: movePanelThreadToChat,
          }}
          onToggleMaximized={() => setSidePanelMaximized(!sidePanel().maximized)}
          onCollapse={toggleSidePanel}
        />
      </Show>

      <Show when={launcherShown()}>
        <aside class="browser-panel side-panel-empty" aria-label={t("conversation.sidePanel.label")}>
          <SidePanelLauncher
            available={sidePanelPanes()}
            settingsLabel={channel ? t("channel.settings.title") : undefined}
            onOpen={openSidePanelPane}
          />
        </aside>
      </Show>

      <Show when={filePreviewOpen() && sidebarFilePreview()}>
        {(file) => {
          const attached = () => {
            const source = file().source;
            return source.kind === "attachment" ? source.attachment : null;
          };
          return (
            <Loading>
              <FilePreviewPanel
                allowExternalOpen={!props.runtime}
                macWindowControls={props.platform === "darwin"}
                preview={file().preview}
                directory={file().directory ?? null}
                agents={props.agents}
                defaultWidth={() =>
                  (conversationPanelElement()?.clientWidth || window.innerWidth) * BROWSER_PANEL_DEFAULT_RATIO
                }
                maxWidth={() =>
                  Math.min(
                    BROWSER_PANEL_MAX,
                    Math.max(
                      BROWSER_PANEL_MIN,
                      (conversationPanelElement()?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
                    ),
                  )
                }
                onWidthChange={setBrowserPanelWidth}
                onOpenLink={(url) => void openExternalMessageUrl(url)}
                onOpenSharedFile={openSharedFile}
                onOpenWorkspaceFile={previewWorkspaceAgentId() ? openWorkspaceFolderEntry : undefined}
                onOpenWorkspaceFolder={openWorkspaceFolder}
                onBack={sidebarFileBack() === null ? undefined : openSidebarFileBack}
                sourceUrl={attached()?.previewUrl ?? null}
                pageUrl={htmlAttachmentPageUrl(attached()) ?? file().preview?.pageUrl}
                pageHtml={props.runtime?.visualPage ? htmlAttachmentPageHtml(attached(), file().preview) : undefined}
                selectionQuoteId={previewQuoteId()}
                onOpenExternally={openSidebarFileExternally}
                onDownload={downloadSidebarFile}
                /* A browser cannot show a file in the file manager. */
                onReveal={props.runtime ? undefined : revealSidebarFile}
                onClose={closeSidebarFilePreview}
              />
            </Loading>
          );
        }}
      </Show>

      <Show when={filesOpen() && !props.runtime && serverHasStorage(props.server) && props.server}>
        {(server) => (
          <Show when={props.agent?.threadId}>
            {(threadId) => (
              <Loading>
                <ChatFilesPanel
                  serverId={server().id}
                  conversationId={threadId()}
                  conversationTitle={props.agent?.name ?? "this chat"}
                  canManage={canManageStorage(server())}
                  onClose={() => closeSidePanelPane("files")}
                  onPreviewFile={(file) => void previewAttachment(file)}
                  onShowMessage={(messageId) => void props.onOpenSearchMessage?.(messageId)}
                />
              </Loading>
            )}
          </Show>
        )}
      </Show>

      <Show when={activeRightPanel() === "question" && props.agent}>
        {(agent) => (
          <SideQuestionPanel
            agent={agent()}
            agents={props.agents}
            exchanges={sideQuestion().exchanges}
            skills={installedSkills()}
            skillsLoadFailed={installedSkillsLoadFailed()}
            mcpServers={mcpServers()}
            error={sideQuestion().error}
            draft={sideQuestion().draft}
            focusRequest={sideQuestion().focusRequest}
            onDraftChange={setSideQuestionDraft}
            onAsk={askSideQuestion}
            onClosePanel={() => closeSidePanelPane("question")}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            macWindowControls={props.platform === "darwin"}
          />
        )}
      </Show>

      {/* Keyed, so another agent or server gets its own conversation; closing the pane ends it. */}
      <Show
        when={
          activeRightPanel() === "voice" &&
          voiceConversationAvailable() &&
          props.agent &&
          `${props.server?.id ?? "local"}:${props.agent.id}`
        }
        keyed
      >
        <VoiceConversationPane />
      </Show>

      {/* Keyed, so each side thread gets its own messages and read state. */}
      <Show when={shownThread()} keyed>
        {(threadId) => <ConversationSideThread threadId={threadId} />}
      </Show>

      <Show when={activeRightPanel() === "subagent"}>
        <SubagentPanel
          subagent={panelSubagent()}
          agentName={props.agent?.name ?? ""}
          onClosePanel={() => closeSidePanelPane("subagent")}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <BrowserPreviewSidebar
          tabs={browserTabs()}
          hidden={browserExpandedOpen()}
          suspended={props.browserVisibilitySuspended || props.globalOverlayOpen || props.remoteDesktopVisible}
          contextKey={`${props.server?.id ?? "local"}:${props.agent?.id ?? ""}`}
          defaultWidth={() => 320}
          maxWidth={() =>
            Math.min(
              BROWSER_PANEL_MAX,
              Math.max(
                BROWSER_PANEL_MIN,
                (conversationPanelElement()?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
              ),
            )
          }
          onWidthChange={setBrowserPanelWidth}
          capturePreview={props.runtime?.browser.capturePreview}
          onOpenTab={(tabId, trigger) => {
            browserPreviewTrigger = trigger;
            if (activeBrowserTab()?.id !== tabId) activateBrowserTab(tabId);
            setActiveRightPanel("browser-expanded");
          }}
          onCloseTab={(tabId) => void closeBrowserTab(tabId)}
          onNewTab={() => void openBrowserAddress(BROWSER_NEW_TAB_URL, true)}
          onCollapse={hideBrowserPanel}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <Portal>
          <div class="ui-dialog-overlay browser-expanded-backdrop" hidden={!browserExpandedOpen()} aria-hidden="true" />
          <BrowserFullViewAdapter />
        </Portal>
      </Show>

      {channel ? (
        <Show when={settingsOpen()}>
          <channel.SettingsPane
            maxWidth={settingsMaxWidth}
            onWidthChange={setSettingsPanelWidth}
            onClose={() => closeSidePanelPane("settings")}
          />
        </Show>
      ) : null}
      <Show when={settingsOpen() && props.agent}>
        {(agent) => (
          <Loading>
            <AgentSettingsPanel
              remoteClient={Boolean(props.runtime)}
              localHost={props.server?.kind === "local"}
              folders={localFolderCalls()}
              sessionSettingsEditable={serverCanAdminister(props.server, "agent-session-settings-v1")}
              adminCalls={props.runtime?.admin}
              skillsMarketplaceOpen={props.skillsMarketplaceOpen}
              workspaceCovered={props.workspaceCovered}
              onAddFromMarketplace={
                serverCanAdminister(props.server, "skills-admin-v1") ? props.onOpenMarketplace : undefined
              }
              skillsMode={agentSkillsMode(props.server, props.runtime)}
              skillsServerId={props.server?.id}
              previewWorkspaceFile={(path) =>
                conversationRuntime(props).agent.previewWorkspaceFile({ agentId: agent().id, path })
              }
              tablesVisible={
                (!props.runtime || props.runtime.admin !== undefined) &&
                serverCanAdminister(props.server, "shared-tables-v1")
              }
              autoApprove={props.agentAutoApproves}
              onUpdatePermissions={props.onUpdateAgentPermissions}
              computerUseEditable={props.server?.kind === "local"}
              automationEditable={
                props.server?.kind === "local" ||
                (serverCanAdminister(props.server, "agent-host-settings-v1") && agent().allowAutomation !== undefined)
              }
              busyMessageModeEditable={props.server?.kind === "local" || props.remoteBusyMessageModeLoaded === true}
              busyMessageDefaultIsHost={props.server?.kind === "remote"}
              newChatEditable={props.server?.kind === "local"}
              quickAcknowledgementEditable={props.server?.kind === "local"}
              taskLimitEditable={props.server?.kind === "local" || props.remoteTaskLimitLoaded === true}
              backupModelsEditable={props.server?.kind === "local" || props.remoteBackupModelsLoaded === true}
              usageLimited={props.usageLimited}
              defaultBusyMessageMode={props.defaultBusyMessageMode}
              agentDefaults={localAgentDefaults()}
              memoryLimit={props.server?.kind === "local" ? props.agentMemoryLimit : undefined}
              agents={props.agents}
              onStartNewChat={props.onClearAgentContext}
              onCreateSkill={
                serverCanAdminister(props.server, "skills-admin-v1") &&
                agentReady() &&
                !controller.submitting() &&
                controller.voicePhase() === "idle" &&
                !controller.editingDeliveryId()
                  ? () => {
                      if (!props.agent || !props.server) return;
                      controller.startSkillCreation({ serverId: props.server.id, agentId: props.agent.id });
                      setActiveRightPanel("none");
                    }
                  : undefined
              }
              onTrySkill={
                serverCanAdminister(props.server, "skills-admin-v1") &&
                agentReady() &&
                !controller.submitting() &&
                controller.voicePhase() === "idle" &&
                !controller.editingDeliveryId()
                  ? (skill) => {
                      if (!props.agent || !props.server) return;
                      controller.appendSkillExample({ serverId: props.server.id, agentId: props.agent.id }, skill);
                      setActiveRightPanel("none");
                    }
                  : undefined
              }
              onOpenUsage={panelProps.onOpenUsage}
              onPublish={canPublish() ? () => publishAgent.open(agent().id) : undefined}
              agent={agent()}
              runtimeSettings={{
                provider: settingsProvider(),
                model: settingsModel(),
                reasoningEffort: settingsReasoning(),
              }}
              agentStatus={props.agentStatus}
              providerRuntimeStatuses={props.providerRuntimeStatuses}
              customProviders={props.customProviders}
              customAgents={props.customAgents}
              onDownloadProvider={props.onDownloadProvider}
              onCancelProviderDownload={props.onCancelProviderDownload}
              onConnectProvider={props.onConnectProvider}
              canConnectProvider={props.canConnectProvider}
              onManageProviders={props.onManageProviders}
              browserProfileCalls={
                serverCanAdminister(props.server, BROWSER_PROFILES_CAPABILITY) ? browserProfileCalls() : undefined
              }
              onManageBrowserProfiles={props.onManageBrowserProfiles}
              modelOptions={props.modelOptions}
              working={agentActivity() === "Working"}
              maxWidth={settingsMaxWidth}
              onClose={() => closeSidePanelPane("settings")}
              onWidthChange={setSettingsPanelWidth}
              onUpdateAgent={props.onUpdateAgent}
              onUpdateRuntimeSettings={updateRuntimeSettings}
              onSetAgentAvatar={props.onSetAgentAvatar}
              skillSelectionRequest={skillSettingsRequest()?.agentId === agent().id ? skillSettingsRequest() : null}
              routineSelectionRequest={
                routineSettingsRequest()?.agentId === agent().id ? routineSettingsRequest() : null
              }
              onRoutineSelectionRequestHandled={handleRoutineSettingsRequest}
              onOpenRoutineRun={props.onOpenSearchMessage ? openRoutineRunMessage : undefined}
              files={agentFiles(props.server, agent().id)}
              eventRoutines={desktopChatEventRoutinesApi(props.server, props.runtime)}
              routines={props.runtime?.routines}
            />
          </Loading>
        )}
      </Show>

      {publishAgent.dialog()}
      {/* A sign-in link of the host's agent, when this computer cannot take its callback: the user pastes
          the address that the browser shows. */}
      <Show when={messageLinkRelay()} keyed>
        {(relay) => (
          <McpSignInRelayDialog
            name={relay.page.authorizeHost}
            hostName={props.server?.name ?? ""}
            page={relay.page}
            onOpen={openMessageLinkRelay}
            onPaste={pasteMessageLinkRelay}
            onCancel={cancelMessageLinkRelay}
          />
        )}
      </Show>
    </>
  );
}

const AgentSettingsPanel = lazy(loadAgentSettingsPanel);
const BrowserFullViewAdapter = lazy(() => import("./BrowserFullViewAdapter"));
const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));
const ChatFilesPanel = lazy(() => import("../files/ChatFilesPanel"));

const BrowserPreviewSidebar = lazy(() => import("./BrowserPreviewSidebar"));
