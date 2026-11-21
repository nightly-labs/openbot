import type { BrowserTab } from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { BROWSER_NEW_TAB_URL } from "@openbot/ui/features/browser/browser-suggestions";
import { createEffect, createMemo, untrack } from "solid-js";
import { desktopBrowserProfileCalls } from "../browser/browser-profiles-port";
import {
  moveBrowserTab,
  orderedBrowserTabs,
  placeNextBrowserTab,
  recordBrowserPages,
  rememberClosedBrowserTab,
  syncBrowserTabOrder,
  takeClosedBrowserTab,
} from "../browser/browser-tab-session";
import { createBrowserTabProfiles, readTabProfilesWithProxies } from "../browser/stores/browser-tab-profiles";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useConversationViewScope } from "./conversation-scope";

export function createBrowserFullViewControls() {
  const {
    props,
    activateBrowserTab,
    allBrowserTabs,
    browserTabOwner,
    browserTabs,
    closeBrowserTab,
    openBrowserAddress,
    setActiveRightPanel,
    showBrowserTabOf,
  } = useConversationViewScope();
  const serverId = () => props.server?.id ?? "";
  const tabs = createMemo(() => orderedBrowserTabs(serverId(), allBrowserTabs()));
  const readTabProfiles = createMemo(() => {
    if (props.runtime) {
      const calls = props.runtime.browserProfiles;
      return calls && readTabProfilesWithProxies(calls);
    }
    const server = props.server;
    if (!server || !serverSupportsCapability(server, BROWSER_PROFILES_CAPABILITY)) return undefined;
    const calls = desktopBrowserProfileCalls(server.id);
    return serverRoleCanAdminister(server) && serverSupportsCapability(server, BROWSER_PROXIES_CAPABILITY)
      ? readTabProfilesWithProxies(calls)
      : calls.tabProfiles;
  });
  const profileForTab = createBrowserTabProfiles(readTabProfiles, allBrowserTabs);

  createEffect(
    () => ({ id: serverId(), listed: allBrowserTabs() }),
    ({ id, listed }) => untrack(() => syncBrowserTabOrder(id, listed)),
  );

  createEffect(
    () => ({
      id: serverId(),
      pages: allBrowserTabs().map((tab) => ({ tabId: tab.id, url: tab.url, title: tab.title })),
    }),
    ({ id, pages }) => recordBrowserPages(id, pages),
  );

  async function openTab(url: string, placement: { afterId?: string; index?: number }) {
    placeNextBrowserTab(serverId(), placement);
    const tab = await openBrowserAddress(url, true);
    if (!tab) placeNextBrowserTab(serverId(), {});
    return tab;
  }

  function activateTab(tabId: string) {
    if (browserTabs().some((tab) => tab.id === tabId)) {
      activateBrowserTab(tabId);
      return;
    }
    const tab = tabs().find((entry) => entry.id === tabId);
    const owner = tab && browserTabOwner(tab);
    if (!owner || !showBrowserTabOf(owner, tabId)) return;
    setActiveRightPanel("browser-expanded", owner.id);
    props.onSelectAgent(owner.id);
  }

  function closeTabs(tabIds: readonly string[]) {
    const order = tabs();
    const closing = tabIds
      .map((tabId) => ({
        tab: order.find((tab) => tab.id === tabId),
        index: order.findIndex((tab) => tab.id === tabId),
      }))
      .filter((entry): entry is { tab: BrowserTab; index: number } => entry.tab !== undefined)
      .sort((left, right) => right.index - left.index);
    for (const { tab, index } of closing) {
      rememberClosedBrowserTab(serverId(), tab, index);
      void closeBrowserTab(tab.id);
    }
  }

  return {
    serverId,
    tabs,
    profileForTab,
    activateTab,
    closeTabs,
    newTab: (afterId?: string) => openTab(BROWSER_NEW_TAB_URL, afterId === undefined ? {} : { afterId }),
    duplicateTab: (tabId: string) => {
      const tab = tabs().find((entry) => entry.id === tabId);
      if (tab) void openTab(tab.url, { afterId: tab.id });
    },
    moveTab: (tabId: string, index: number) => moveBrowserTab(serverId(), tabs(), tabId, index),
    reopenTab: () => {
      const closed = takeClosedBrowserTab(serverId());
      if (closed) void openTab(closed.url, { index: closed.index });
    },
  };
}
