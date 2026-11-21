import type { BrowserTab, BrowserWindowAction, BrowserWindowModel } from "@openbot/contracts/ipc";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { classifyFailure } from "@openbot/telemetry";
import { BROWSER_NEW_TAB_URL, browserAddressUrl } from "@openbot/ui/features/browser/browser-suggestions";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, onCleanup, Show, snapshot } from "solid-js";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useAgents } from "../agents/agents-context";
import { desktopTabProfilesReader, followBrowserTabSession } from "../conversation/browser-full-view-controls";
import { useConversationController } from "../conversation/conversation-controller-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useBrowserTabs } from "./browser-context";
import { browserPort } from "./browser-port";
import {
  browserSessionHistory,
  canReopenBrowserTab,
  closeBrowserTabsInOrder,
  moveBrowserTab,
  orderedBrowserTabs,
  placeNextBrowserTab,
  takeClosedBrowserTab,
} from "./browser-tab-session";
import { browserControlForTab, browserWindowTabDetails, ownsBrowserTab } from "./browser-window-model";
import { createBrowserTabProfiles } from "./stores/browser-tab-profiles";

export function ServerBrowserWindowBridge() {
  const { browserWindowOpen, chatBrowserWindowBridges } = useConversationController();
  return (
    <Show when={browserWindowOpen() && chatBrowserWindowBridges() === 0}>
      <ServerBrowserWindowRelay />
    </Show>
  );
}

function ServerBrowserWindowRelay() {
  const browserTabs = useBrowserTabs();
  const { agentList, activeAgent } = useAgents();
  const { activeServer } = useServers();
  const platform = usePlatform();
  const browser = browserPort().browser;
  const serverId = () => activeServer()?.id ?? "";
  const allTabs = () => browserTabs.browserTabs();
  const tabs = createMemo(() => orderedBrowserTabs(serverId(), allTabs()));
  const activeTab = createMemo(() => tabs().find((tab) => tab.id === browserTabs.activeBrowserTabId()) ?? tabs()[0]);
  const agentsByThreadId = createMemo(() => new Map(agentList().map((agent) => [agent.threadId, agent])));
  const profileForTab = createBrowserTabProfiles(() => desktopTabProfilesReader(activeServer()), allTabs);
  followBrowserTabSession(serverId, allTabs);

  const tabDetails = (tab: BrowserTab, activeTabId: string | undefined) => {
    const control = browserControlForTab(browserTabs.browserControlState().sessions, tab, activeTabId);
    return browserWindowTabDetails(
      tab.id,
      control,
      control ? agentsByThreadId().get(control.threadId) : undefined,
      agentList().find((agent) => ownsBrowserTab(agent, tab)),
      profileForTab(tab),
    );
  };

  const model = (): BrowserWindowModel => {
    const server = activeServer();
    const ordered = tabs();
    const activeTabId = activeTab()?.id;
    const remoteView = server?.kind === "remote" && serverSupportsCapability(server, "browser-view");
    return {
      tabs: ordered,
      activeTabId: activeTabId ?? null,
      details: ordered.map((tab) => tabDetails(tab, activeTabId)),
      history: [...browserSessionHistory(serverId())],
      canReopen: canReopenBrowserTab(serverId()),
      canCloseTabs: true,
      liveViewTabId: remoteView ? (activeTabId ?? null) : null,
      liveViewClipboard: serverSupportsCapability(server, "browser-view-clipboard"),
      shortcuts: platform.appInfo()?.platform === "darwin" ? "mac" : "pc",
    };
  };

  createEffect(model, (next) => {
    void browser.publishWindowModel(snapshot(next));
  });

  const failed = (title: string) => (error: unknown) => {
    actionToast.error(title, {
      error,
      fallback: title,
      report: { operation: "browser", source: "action", cause_code: classifyFailure(error) },
    });
  };

  const newTabOwner = () => {
    const tab = activeTab();
    if (tab && (tab.ownerAgentId || tab.ownerThreadId)) {
      return { ownerAgentId: tab.ownerAgentId, ownerThreadId: tab.ownerThreadId };
    }
    const agent = activeAgent();
    return agent ? { ownerAgentId: agent.id, ownerThreadId: agent.threadId ?? null } : undefined;
  };

  async function openTab(url: string, placement: { afterId?: string; index?: number }) {
    const owner = newTabOwner();
    if (!owner) return;
    placeNextBrowserTab(serverId(), placement);
    try {
      await browser.open({ url, ...owner, focus: true });
    } catch (error) {
      placeNextBrowserTab(serverId(), {});
      failed(currentText().t("browser.error.openAddress"))(error);
    }
  }

  const listed = (tabId: string) => tabs().find((tab) => tab.id === tabId);

  const runAction = (action: BrowserWindowAction) => {
    const { t } = currentText();
    switch (action.type) {
      case "activate":
        if (listed(action.tabId)) browserTabs.activateBrowserTab(action.tabId);
        return;
      case "close":
        closeBrowserTabsInOrder(serverId(), tabs(), action.tabIds, (tabId) => {
          browserTabs.closeBrowserTab(tabId).catch(failed(t("browser.error.closeTab")));
        });
        return;
      case "new-tab":
        void openTab(BROWSER_NEW_TAB_URL, action.afterId === undefined ? {} : { afterId: action.afterId });
        return;
      case "duplicate": {
        const tab = listed(action.tabId);
        if (tab) void openTab(tab.url, { afterId: tab.id });
        return;
      }
      case "move":
        moveBrowserTab(serverId(), tabs(), action.tabId, action.index);
        return;
      case "reopen": {
        const closed = takeClosedBrowserTab(serverId());
        if (closed) void openTab(closed.url, { index: closed.index });
        return;
      }
      case "reload":
        if (listed(action.tabId)) browser.reload(action.tabId).catch(failed(t("browser.error.reloadTab")));
        return;
      case "stop":
        if (listed(action.tabId)) browser.stop(action.tabId).catch(failed(t("browser.error.stopLoading")));
        return;
      case "navigate":
        if (!listed(action.tabId)) return;
        browser
          .navigate({ tabId: action.tabId, direction: action.direction })
          .catch(
            failed(t(action.direction === "back" ? "browser.error.navigateBack" : "browser.error.navigateForward")),
          );
        return;
      case "open-address": {
        const value = action.url.trim();
        if (!value) return;
        const url = browserAddressUrl(value);
        const tab = action.tabId === undefined ? undefined : listed(action.tabId);
        if (tab && serverSupportsCapability(activeServer(), TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
          browser.navigate({ tabId: tab.id, url }).catch(failed(t("browser.error.openAddress")));
          return;
        }
        void openTab(url, {});
        return;
      }
    }
  };

  onCleanup(
    browser.onWindowEvent((event) => {
      if (event.type === "action") runAction(event.action);
    }),
  );

  return null;
}
