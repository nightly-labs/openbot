import { useConversationViewScope } from "./conversation-scope";

const SETTINGS_PANEL_MIN = 180;
const SETTINGS_PANEL_MAX = 1600;
const BROWSER_PANEL_DEFAULT_RATIO = 0.5;
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;
const loadAgentSettingsPanel = () => import("./AgentSettingsPanel");

import type { BrowserPreview } from "@openbot/contracts/ipc";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, Loading, lazy, onSettled, Show } from "solid-js";

/** @internal Stable HMR boundary for conversation panels. */
export function ConversationPanels(panelProps: { onOpenUsage: (trigger: HTMLButtonElement) => void }) {
  const {
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
    conversationPanelElement,
    filePreviewOpen,
    openBrowserAddress,
    openExternalMessageUrl,
    openRoutineRunMessage,
    openSharedFile,
    openSidebarFileExternally,
    openWorkspaceFile,
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
    routineSettingsRequest,
    settingsModel,
    settingsProvider,
    settingsReasoning,
    updateRuntimeSettings,
  } = useConversationViewScope();
  const [browserMotionPreview, setBrowserMotionPreview] = createSignal<{
    tabId: string;
    preview: BrowserPreview | null;
  } | null>(null);
  createEffect(
    () => JSON.stringify([props.server?.id, props.agent?.id]),
    () => {
      setBrowserMotionPreview(null);
    },
  );
  let browserPreviewTrigger: HTMLButtonElement | undefined;
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
        {(file) => (
          <Loading>
            <FilePreviewPanel
              preview={file().preview}
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
              onOpenWorkspaceFile={openWorkspaceFile}
              onOpenExternally={openSidebarFileExternally}
              onClose={closeSidebarFilePreview}
            />
          </Loading>
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
          onOpenTab={(tabId, trigger, preview) => {
            setBrowserMotionPreview({ tabId, preview });
            browserPreviewTrigger = trigger;
            if (activeBrowserTab()?.id !== tabId) activateBrowserTab(tabId);
            setActiveRightPanel("browser-expanded");
          }}
          onCloseTab={(tabId) => void closeBrowserTab(tabId)}
          onNewTab={() => void openBrowserAddress("https://www.google.com")}
          onCollapse={hideBrowserPanel}
        />
      </Show>

      <Show when={browserSidebarOpen() || browserExpandedOpen()}>
        <Portal>
          <div class="browser-expanded-backdrop" hidden={!browserExpandedOpen()} aria-hidden="true" />
          <BrowserPanel
            open={browserExpandedOpen()}
            preview={browserMotionPreview()?.tabId === activeBrowserTab()?.id ? browserMotionPreview()?.preview : null}
            tabs={browserTabs()}
            activeTab={activeBrowserTab()}
            activeControl={activeBrowserControl()}
            address={browserAddress()}
            controlForTab={browserControlForTab}
            controllerForTab={browserControllerForTab}
            onAddressChange={setBrowserAddress}
            onAddressEditingChange={setBrowserAddressEditing}
            onOpenAddress={(address) => void openBrowserAddress(address)}
            onNavigate={(tabId, direction) => void navigateBrowserTab(tabId, direction)}
            onReload={(tabId) => void reloadBrowserTab(tabId)}
            onActivateTab={activateBrowserTab}
            onCloseTab={(tabId) => void closeBrowserTab(tabId)}
            onSurface={setBrowserSurfaceElement}
            onBack={() => setActiveRightPanel("browser")}
            onEnterPip={showBrowserPip}
          />
        </Portal>
      </Show>

      <Show when={settingsOpen() && props.agent}>
        {(agent) => (
          <Loading>
            <AgentSettingsPanel
              onOpenUsage={panelProps.onOpenUsage}
              agent={agent()}
              runtimeSettings={{
                provider: settingsProvider(),
                model: settingsModel(),
                reasoningEffort: settingsReasoning(),
              }}
              agentStatus={props.agentStatus}
              providerRuntimeStatuses={props.providerRuntimeStatuses}
              onDownloadProvider={props.onDownloadProvider}
              onCancelProviderDownload={props.onCancelProviderDownload}
              onConnectProvider={props.onConnectProvider}
              modelOptions={props.modelOptions}
              working={agentActivity() === "Working"}
              maxWidth={() =>
                Math.min(
                  SETTINGS_PANEL_MAX,
                  Math.max(
                    SETTINGS_PANEL_MIN,
                    (conversationPanelElement()?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
                  ),
                )
              }
              onClose={() => setActiveRightPanel("none")}
              onWidthChange={setSettingsPanelWidth}
              onUpdateAgent={props.onUpdateAgent}
              onUpdateRuntimeSettings={updateRuntimeSettings}
              onSetAgentAvatar={props.onSetAgentAvatar}
              routineSelectionRequest={
                routineSettingsRequest()?.agentId === agent().id ? routineSettingsRequest() : null
              }
              onRoutineSelectionRequestHandled={handleRoutineSettingsRequest}
              onOpenRoutineRun={props.onOpenSearchMessage ? openRoutineRunMessage : undefined}
            />
          </Loading>
        )}
      </Show>
    </>
  );
}

const AgentSettingsPanel = lazy(loadAgentSettingsPanel);
const BrowserPanel = lazy(() => import("./BrowserPanel"));
const FilePreviewPanel = lazy(() => import("./FilePreviewPanel"));

const BrowserPreviewSidebar = lazy(() => import("./BrowserPreviewSidebar"));
