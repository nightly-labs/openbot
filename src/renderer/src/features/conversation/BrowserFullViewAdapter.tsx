import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import BrowserLocalSignInDialog from "@openbot/ui/features/browser/BrowserLocalSignInDialog";
import type { BrowserPageMenu } from "@openbot/ui/features/browser/browser-page-cover";
import { useText } from "@openbot/ui/text";
import { createMemo, onCleanup, Show } from "solid-js";
import { browserSessionHistory, canReopenBrowserTab } from "../browser/browser-tab-session";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { BrowserDockAdapter } from "./BrowserDockAdapter";
import { createBrowserFullViewControls } from "./browser-full-view-controls";
import { browserTeachFile, browserTeachSteps } from "./browser-teach-message";
import { conversationPort } from "./conversation-port";
import { useConversationViewScope } from "./conversation-scope";

export interface BrowserPaneMode {
  open: boolean;
  coveringMenus: readonly (BrowserPageMenu | undefined)[];
}

export default function BrowserFullViewAdapter(adapter: { pane?: BrowserPaneMode | undefined }) {
  const {
    props,
    activeBrowserTab,
    browserControlForTab,
    browserControllerForTab,
    browserExpandedOpen,
    browserTabOwner,
    navigateBrowserTab,
    openBrowserAddress,
    browserCanDetach,
    openBrowserWindow,
    reloadBrowserTab,
    stopBrowserTab,
    setActiveRightPanel,
    setBrowserSurfaceElement,
    setBrowserPaneSurfaceElement,
    releaseBrowserPaneSurface,
    showBrowserPip,
    localSignIn,
    browserTeach,
    closeBrowserTeach,
    startBrowserTeach,
    stopBrowserTeach,
    sendCardFile,
    addPageText,
  } = useConversationViewScope();
  const { t } = useText();
  const controls = createBrowserFullViewControls();
  const windowOpener = () => (browserCanDetach() ? openBrowserWindow : undefined);

  async function saveTeach() {
    const steps = await stopBrowserTeach(true);
    if (!steps) return;
    const message = t("browser.teach.message");
    if (await sendCardFile(message, browserTeachFile(t, steps))) return;
    addPageText(`${message}\n\n${browserTeachSteps(t, steps)}`);
  }
  const teach = createMemo(() => {
    const current = browserTeach();
    const name = props.agent?.name;
    if (!current || name === undefined) return undefined;
    return {
      agentName: name,
      pending: current.pending,
      startedAt: current.phase === "recording" ? current.startedAt : null,
      onStart: () => void startBrowserTeach(),
      onSave: () => void saveTeach(),
      onClose: () => (current.phase === "recording" ? void stopBrowserTeach(false) : closeBrowserTeach()),
    };
  });

  let paneSurface: HTMLDivElement | undefined;
  const setPaneSurface = (element: HTMLDivElement | undefined) => {
    paneSurface = element;
    setBrowserPaneSurfaceElement(element);
  };
  if (adapter.pane) onCleanup(() => releaseBrowserPaneSurface(paneSurface));
  else onCleanup(localSignIn.cancel);
  const full = () => adapter.pane === undefined;

  return (
    <BrowserFullView
      open={adapter.pane ? adapter.pane.open : browserExpandedOpen()}
      pane={adapter.pane !== undefined}
      coveringMenus={adapter.pane?.coveringMenus}
      macWindowControls={props.platform === "darwin"}
      shortcuts={props.runtime || !full() ? undefined : props.platform === "darwin" ? "mac" : "pc"}
      tabs={controls.tabs()}
      activeTab={activeBrowserTab()}
      history={browserSessionHistory(controls.serverId())}
      canReopen={canReopenBrowserTab(controls.serverId())}
      controlForTab={browserControlForTab}
      controllerForTab={browserControllerForTab}
      ownerForTab={browserTabOwner}
      profileForTab={controls.profileForTab}
      onActivateTab={controls.activateTab}
      onCloseTabs={controls.closeTabs}
      onNewTab={controls.newTab}
      onDuplicateTab={controls.duplicateTab}
      onMoveTab={controls.moveTab}
      onReopenTab={controls.reopenTab}
      onReload={(tabId) => void reloadBrowserTab(tabId)}
      onStop={(tabId) => void stopBrowserTab(tabId)}
      onNavigate={(tabId, direction) => void navigateBrowserTab(tabId, direction)}
      onOpenAddress={(url, tabId) => void openBrowserAddress(url, tabId === undefined)}
      canEnterPip={browserCanDetach()}
      canOpenWindow={browserCanDetach()}
      onSurface={full() ? setBrowserSurfaceElement : setPaneSurface}
      liveViewTabId={
        props.server?.kind === "remote" && serverSupportsCapability(props.server, "browser-view")
          ? (activeBrowserTab()?.id ?? null)
          : null
      }
      liveViewRuntime={props.browserRuntime ?? conversationPort().browser}
      liveViewClipboard={serverSupportsCapability(props.server, "browser-view-clipboard")}
      onBack={() => setActiveRightPanel("browser")}
      onOpenFullView={full() ? undefined : () => setActiveRightPanel("browser-expanded")}
      onEnterPip={props.runtime ? () => undefined : showBrowserPip}
      onOpenWindow={windowOpener()}
      onSignInLocally={full() && localSignIn.canStart(activeBrowserTab()) ? localSignIn.start : undefined}
      teach={full() ? teach() : undefined}
      dock={
        <Show when={full()}>
          <BrowserDockAdapter tab={activeBrowserTab()} overlay={!props.runtime && props.server?.kind === "local"} />
        </Show>
      }
      dialogs={
        <Show when={full() && localSignIn.state()}>
          {(current) => (
            <BrowserLocalSignInDialog
              open
              site={current().site}
              server={props.server?.name ?? ""}
              windowOpen={current().windowOpen}
              pending={current().pending}
              error={current().error}
              onReopen={() => localSignIn.reopen(current().tabId, current().url)}
              onCancel={localSignIn.cancel}
              onDone={localSignIn.finish}
            />
          )}
        </Show>
      }
    />
  );
}
