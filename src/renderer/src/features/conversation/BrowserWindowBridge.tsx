import { onSettled } from "solid-js";
import { browserWindowTabDetails } from "../browser/browser-window-model";
import { relayBrowserWindow } from "../browser/browser-window-relay";
import { createBrowserFullViewControls } from "./browser-full-view-controls";
import { useConversationController } from "./conversation-controller-context";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

export default function BrowserWindowBridge() {
  const {
    props,
    activeBrowserTab,
    browserControlForTab,
    browserControllerForTab,
    browserTabOwner,
    navigateBrowserTab,
    openBrowserAddress,
    reloadBrowserTab,
    stopBrowserTab,
  } = useConversationViewScope();
  const controls = createBrowserFullViewControls();
  const { setChatBrowserWindowBridges } = useConversationController();
  onSettled(() => {
    setChatBrowserWindowBridges((count) => count + 1);
    return () => setChatBrowserWindowBridges((count) => count - 1);
  });

  relayBrowserWindow(conversationRuntime(props).browser, {
    serverId: controls.serverId,
    server: () => props.server,
    macShortcuts: () => props.platform === "darwin",
    tabs: controls.tabs,
    activeTabId: () => activeBrowserTab()?.id,
    tabDetails: (tab) =>
      browserWindowTabDetails(
        tab.id,
        browserControlForTab(tab),
        browserControllerForTab(tab),
        browserTabOwner(tab),
        controls.profileForTab(tab),
      ),
    operations: {
      activate: controls.activateTab,
      close: controls.closeTabs,
      newTab: (afterId) => void controls.newTab(afterId),
      duplicate: controls.duplicateTab,
      move: controls.moveTab,
      reopen: controls.reopenTab,
      reload: (tabId) => void reloadBrowserTab(tabId),
      stop: (tabId) => void stopBrowserTab(tabId),
      navigate: (tabId, direction) => void navigateBrowserTab(tabId, direction),
      openAddress: (url, tabId) => void openBrowserAddress(url, tabId === undefined),
    },
  });

  return null;
}
