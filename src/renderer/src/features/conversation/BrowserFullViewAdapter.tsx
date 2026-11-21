import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import BrowserLocalSignInDialog from "@openbot/ui/features/browser/BrowserLocalSignInDialog";
import { useText } from "@openbot/ui/text";
import { createMemo, onCleanup, Show } from "solid-js";
import { browserSessionHistory, canReopenBrowserTab } from "../browser/browser-tab-session";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { BrowserDockAdapter } from "./BrowserDockAdapter";
import { createBrowserFullViewControls } from "./browser-full-view-controls";
import { browserTeachFile, browserTeachSteps } from "./browser-teach-message";
import { conversationPort } from "./conversation-port";
import { useConversationViewScope } from "./conversation-scope";

export default function BrowserFullViewAdapter() {
  const {
    props,
    activeBrowserTab,
    browserControlForTab,
    browserControllerForTab,
    browserExpandedOpen,
    browserTabOwner,
    navigateBrowserTab,
    openBrowserAddress,
    openBrowserWindow,
    reloadBrowserTab,
    stopBrowserTab,
    setActiveRightPanel,
    setBrowserSurfaceElement,
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
  const canDetach = () =>
    !props.runtime && (props.server?.kind !== "remote" || serverSupportsCapability(props.server, "browser-view"));
  const windowOpener = () => (canDetach() ? openBrowserWindow : undefined);

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

  onCleanup(localSignIn.cancel);

  return (
    <BrowserFullView
      open={browserExpandedOpen()}
      macWindowControls={props.platform === "darwin"}
      shortcuts={props.runtime ? undefined : props.platform === "darwin" ? "mac" : "pc"}
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
      canEnterPip={canDetach()}
      canOpenWindow={canDetach()}
      onSurface={setBrowserSurfaceElement}
      liveViewTabId={
        props.server?.kind === "remote" && serverSupportsCapability(props.server, "browser-view")
          ? (activeBrowserTab()?.id ?? null)
          : null
      }
      liveViewRuntime={props.browserRuntime ?? conversationPort().browser}
      liveViewClipboard={serverSupportsCapability(props.server, "browser-view-clipboard")}
      onBack={() => setActiveRightPanel("browser")}
      onEnterPip={props.runtime ? () => undefined : showBrowserPip}
      onOpenWindow={windowOpener()}
      onSignInLocally={localSignIn.canStart(activeBrowserTab()) ? localSignIn.start : undefined}
      teach={teach()}
      dock={<BrowserDockAdapter tab={activeBrowserTab()} overlay={!props.runtime && props.server?.kind === "local"} />}
      dialogs={
        <Show when={localSignIn.state()}>
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
