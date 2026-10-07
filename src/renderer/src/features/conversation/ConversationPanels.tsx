import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { createSettingsPanelWidth, saveSettingsPanelWidth } from "../../components/settings-panel-width";
import { serverCanAdministerAgents } from "../agents/remote-agent-admin";
import type { AgentFilesOptions } from "../files/AgentFilesSettings";
import { canManageStorage, serverHasStorage } from "../files/storage-usage";
import { serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { htmlAttachmentPageUrl } from "./chat-visual-url";
import { useConversationController } from "./conversation-controller-context";
import { useConversationViewScope } from "./conversation-scope";

const SETTINGS_PANEL_MIN = 180;
const SETTINGS_PANEL_MAX = 1600;
const BROWSER_PANEL_DEFAULT_RATIO = 0.5;
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;
const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import { Portal } from "@solidjs/web";
import { createEffect, Loading, lazy, onSettled, Show } from "solid-js";
import { conversationPort } from "./conversation-port";

/** @internal Stable HMR boundary for conversation panels. */
export function ConversationPanels(panelProps: { onOpenUsage?: (trigger: HTMLButtonElement) => void }) {
  const controller = useConversationController();
  const {
    agentReady,
    activateBrowserTab,
    activeBrowserControl,
    activeBrowserTab,
    agentActivity,
    browserAddress,
    browserControlForTab,
    browserControllerForTab,
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
    openWorkspaceFile,
    openWorkspaceFolder,
    openWorkspaceFolderEntry,
    sidebarFileBack,
    openSidebarFileBack,
    navigateBrowserTab,
    props,
    reloadBrowserTab,
    setActiveRightPanel,
    setBrowserAddress,
    setBrowserAddressEditing,
    setBrowserPanelWidth,
    setBrowserSurfaceElement,
    setSettingsPanelWidth,
    showBrowserPip,
    handleRoutineSettingsRequest,
    sidebarFilePreview,
    settingsOpen,
    profileOpen,
    skillSettingsRequest,
    routineSettingsRequest,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    updateRuntimeSettings,
  } = useConversationViewScope();
  const { t, errorMessage } = useText();
  let browserPreviewTrigger: HTMLButtonElement | undefined;
  const settingsMaxWidth = () =>
    Math.min(
      SETTINGS_PANEL_MAX,
      Math.max(
        SETTINGS_PANEL_MIN,
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
  return (
    <>
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
                onOpenWorkspaceFile={file().directory ? openWorkspaceFolderEntry : openWorkspaceFile}
                onOpenWorkspaceFolder={openWorkspaceFolder}
                onBack={sidebarFileBack() === null ? undefined : openSidebarFileBack}
                sourceUrl={attached()?.previewUrl ?? null}
                pageUrl={htmlAttachmentPageUrl(attached())}
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
                  onClose={() => setActiveRightPanel("none")}
                  onPreviewFile={(file) => void previewAttachment(file)}
                  onShowMessage={(messageId) => void props.onOpenSearchMessage?.(messageId)}
                />
              </Loading>
            )}
          </Show>
        )}
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
          onNewTab={() => void openBrowserAddress("https://www.google.com", true)}
          onCollapse={hideBrowserPanel}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <Portal>
          <div class="ui-dialog-overlay browser-expanded-backdrop" hidden={!browserExpandedOpen()} aria-hidden="true" />
          <BrowserPanel
            open={browserExpandedOpen()}
            macWindowControls={props.platform === "darwin"}
            tabs={browserTabs()}
            activeTab={activeBrowserTab()}
            activeControl={activeBrowserControl()}
            address={browserAddress()}
            controlForTab={browserControlForTab}
            controllerForTab={browserControllerForTab}
            onAddressChange={setBrowserAddress}
            onAddressEditingChange={setBrowserAddressEditing}
            onOpenAddress={(address) => void openBrowserAddress(address, address !== undefined)}
            onNavigate={(tabId, direction) => void navigateBrowserTab(tabId, direction)}
            onReload={(tabId) => void reloadBrowserTab(tabId)}
            onActivateTab={activateBrowserTab}
            onCloseTab={(tabId) => void closeBrowserTab(tabId)}
            canEnterPip={!props.runtime}
            onSurface={setBrowserSurfaceElement}
            liveViewTabId={
              props.server?.kind === "remote" && serverSupportsCapability(props.server, "browser-view")
                ? (activeBrowserTab()?.id ?? null)
                : null
            }
            liveViewRuntime={props.browserRuntime ?? conversationPort().browser}
            onBack={() => setActiveRightPanel("browser")}
            onEnterPip={props.runtime ? () => undefined : showBrowserPip}
          />
        </Portal>
      </Show>

      <Show when={settingsOpen() && props.agent}>
        {(agent) => (
          <Loading>
            <AgentSettingsPanel
              remoteClient={Boolean(props.runtime)}
              adminCalls={props.runtime?.admin}
              skillsMarketplaceOpen={props.skillsMarketplaceOpen}
              onAddFromMarketplace={
                serverCanAdminister(props.server, "skills-admin-v1") ? props.onOpenMarketplace : undefined
              }
              skillsMode={
                props.runtime
                  ? props.runtime.admin && serverCanAdminister(props.server, "skills-admin-v1")
                    ? "host"
                    : "hidden"
                  : props.server?.kind === "local"
                    ? "mutable"
                    : serverCanAdminister(props.server, "skills-admin-v1")
                      ? "host"
                      : "readonly"
              }
              skillsServerId={props.server?.id}
              tablesVisible={
                (!props.runtime || props.runtime.admin !== undefined) &&
                serverCanAdminister(props.server, "shared-tables-v1")
              }
              accessEditable={props.server?.kind === "local" || serverCanAdministerAgents(props.server)}
              computerUseEditable={props.server?.kind === "local"}
              automationEditable={props.server?.kind === "local"}
              busyMessageModeEditable={props.server?.kind === "local"}
              defaultBusyMessageMode={props.defaultBusyMessageMode}
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
              modelOptions={props.modelOptions}
              working={agentActivity() === "Working"}
              maxWidth={settingsMaxWidth}
              onClose={() => setActiveRightPanel("none")}
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
            />
          </Loading>
        )}
      </Show>

      <Show when={profileOpen() && props.accountProfile}>
        {(profile) => {
          // Read on each open, as the agent settings panel does, so the two share the last saved width
          // and the layout reserves this panel's width.
          const [width, setWidth] = createSettingsPanelWidth();
          createEffect(width, (value) => {
            setSettingsPanelWidth(value);
          });
          return (
            <Loading>
              <AccountProfilePanel
                account={profile().account}
                onUpdateAccountName={profile().onUpdateAccountName}
                onUpdateAccountAvatar={profile().onUpdateAccountAvatar}
                onListAccountSessions={profile().onListAccountSessions}
                onRevokeAccountSession={profile().onRevokeAccountSession}
                width={width()}
                maxWidth={settingsMaxWidth}
                onResize={setWidth}
                onResizeEnd={saveSettingsPanelWidth}
                onClose={() => setActiveRightPanel("none")}
              />
            </Loading>
          );
        }}
      </Show>
    </>
  );
}

const AgentSettingsPanel = lazy(loadAgentSettingsPanel);
const AccountProfilePanel = lazy(() => import("@openbot/ui/features/settings/AccountProfilePanel"));
const BrowserPanel = lazy(() => import("@openbot/ui/features/browser/BrowserPanel"));
const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));
const ChatFilesPanel = lazy(() => import("../files/ChatFilesPanel"));

const BrowserPreviewSidebar = lazy(() => import("./BrowserPreviewSidebar"));
