import type { BrowserWindowAction, BrowserWindowModel } from "@openbot/contracts/ipc";
import { createEffect, onCleanup, onSettled, snapshot } from "solid-js";
import { browserSessionHistory, canReopenBrowserTab } from "../browser/browser-tab-session";
import { browserWindowTabDetails } from "../browser/browser-window-model";
import { serverSupportsCapability } from "../servers/server-capabilities";
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
  const runtime = conversationRuntime(props);
  const { setChatBrowserWindowBridges } = useConversationController();
  onSettled(() => {
    setChatBrowserWindowBridges((count) => count + 1);
    return () => setChatBrowserWindowBridges((count) => count - 1);
  });

  const model = (): BrowserWindowModel => {
    const tabs = controls.tabs();
    const remoteView = props.server?.kind === "remote" && serverSupportsCapability(props.server, "browser-view");
    return {
      tabs,
      activeTabId: activeBrowserTab()?.id ?? null,
      details: tabs.map((tab) =>
        browserWindowTabDetails(
          tab.id,
          browserControlForTab(tab),
          browserControllerForTab(tab),
          browserTabOwner(tab),
          controls.profileForTab(tab),
        ),
      ),
      history: [...browserSessionHistory(controls.serverId())],
      canReopen: canReopenBrowserTab(controls.serverId()),
      canCloseTabs: true,
      liveViewTabId: remoteView ? (activeBrowserTab()?.id ?? null) : null,
      liveViewClipboard: serverSupportsCapability(props.server, "browser-view-clipboard"),
      shortcuts: props.platform === "darwin" ? "mac" : "pc",
    };
  };

  createEffect(model, (next) => {
    void runtime.browser.publishWindowModel(snapshot(next));
  });

  const runAction = (action: BrowserWindowAction) => {
    switch (action.type) {
      case "activate":
        controls.activateTab(action.tabId);
        return;
      case "close":
        controls.closeTabs(action.tabIds);
        return;
      case "new-tab":
        void controls.newTab(action.afterId);
        return;
      case "duplicate":
        controls.duplicateTab(action.tabId);
        return;
      case "move":
        controls.moveTab(action.tabId, action.index);
        return;
      case "reopen":
        controls.reopenTab();
        return;
      case "reload":
        void reloadBrowserTab(action.tabId);
        return;
      case "stop":
        void stopBrowserTab(action.tabId);
        return;
      case "navigate":
        void navigateBrowserTab(action.tabId, action.direction);
        return;
      case "open-address":
        void openBrowserAddress(action.url, action.tabId === undefined);
        return;
    }
  };

  onCleanup(
    runtime.browser.onWindowEvent((event) => {
      if (event.type === "action") runAction(event.action);
    }),
  );

  return null;
}
