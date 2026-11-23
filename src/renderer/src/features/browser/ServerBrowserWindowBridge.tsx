import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { classifyFailure } from "@openbot/telemetry";
import { BROWSER_NEW_TAB_URL, browserAddressUrl } from "@openbot/ui/features/browser/browser-suggestions";
import { currentText } from "@openbot/ui/text";
import { createMemo, Show } from "solid-js";
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
  closeBrowserTabsInOrder,
  moveBrowserTab,
  orderedBrowserTabs,
  placeNextBrowserTab,
  takeClosedBrowserTab,
} from "./browser-tab-session";
import { browserControlForTab, browserWindowTabDetails, ownsBrowserTab } from "./browser-window-model";
import { relayBrowserWindow } from "./browser-window-relay";
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

  relayBrowserWindow(browser, {
    serverId,
    server: activeServer,
    macShortcuts: () => platform.appInfo()?.platform === "darwin",
    tabs,
    activeTabId: () => activeTab()?.id,
    tabDetails: (tab) => {
      const control = browserControlForTab(browserTabs.browserControlState().sessions, tab, activeTab()?.id);
      return browserWindowTabDetails(
        tab.id,
        control,
        control ? agentsByThreadId().get(control.threadId) : undefined,
        agentList().find((agent) => ownsBrowserTab(agent, tab)),
        profileForTab(tab),
      );
    },
    operations: {
      activate: (tabId) => {
        if (listed(tabId)) browserTabs.activateBrowserTab(tabId);
      },
      close: (tabIds) =>
        closeBrowserTabsInOrder(serverId(), tabs(), tabIds, (tabId) => {
          browserTabs.closeBrowserTab(tabId).catch(failed(currentText().t("browser.error.closeTab")));
        }),
      newTab: (afterId) => void openTab(BROWSER_NEW_TAB_URL, afterId === undefined ? {} : { afterId }),
      duplicate: (tabId) => {
        const tab = listed(tabId);
        if (tab) void openTab(tab.url, { afterId: tab.id });
      },
      move: (tabId, index) => moveBrowserTab(serverId(), tabs(), tabId, index),
      reopen: () => {
        const closed = takeClosedBrowserTab(serverId());
        if (closed) void openTab(closed.url, { index: closed.index });
      },
      reload: (tabId) => {
        if (listed(tabId)) browser.reload(tabId).catch(failed(currentText().t("browser.error.reloadTab")));
      },
      stop: (tabId) => {
        if (listed(tabId)) browser.stop(tabId).catch(failed(currentText().t("browser.error.stopLoading")));
      },
      navigate: (tabId, direction) => {
        if (!listed(tabId)) return;
        browser
          .navigate({ tabId, direction })
          .catch(
            failed(
              currentText().t(direction === "back" ? "browser.error.navigateBack" : "browser.error.navigateForward"),
            ),
          );
      },
      openAddress: (address, tabId) => {
        const value = address.trim();
        if (!value) return;
        const url = browserAddressUrl(value);
        const tab = tabId === undefined ? undefined : listed(tabId);
        if (tab && serverSupportsCapability(activeServer(), TEAM_BROWSER_NAVIGATION_CAPABILITY)) {
          browser.navigate({ tabId: tab.id, url }).catch(failed(currentText().t("browser.error.openAddress")));
          return;
        }
        void openTab(url, {});
      },
    },
  });

  return null;
}
