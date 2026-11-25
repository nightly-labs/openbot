import type { BrowserControlState, BrowserDisplayState, BrowserTab, ServerSummary } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { usePlatform } from "../../platform";
import { createScopeGuard } from "../../scope-lifetime";
import { createSimpleContext } from "../../simple-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSwitch } from "../servers/server-switch";
import { useServers } from "../servers/servers-context";
import { useWindowPage } from "../window/window-page-context";
import { browserPort } from "./browser-port";
import { activeTabAfterLoad, browserTabsAfterClose } from "./browser-tab-reconciliation";

const BrowserTabs = createSimpleContext({
  name: "Browser tabs",
  init: () => {
    const { landingPreview } = usePlatform();
    const { currentServerSelection } = useServers();
    const { browserVisibilitySuspended: switchHidesBrowser } = useServerSwitch();
    const windowPage = useWindowPage();
    const { browserWindowOpen } = useConversationController();
    const browserVisibilitySuspended = () => switchHidesBrowser() || windowPage.conversationCovered();
    const browserTabsHidden = () => switchHidesBrowser() || (windowPage.conversationCovered() && !browserWindowOpen());
    const scopeIsCurrent = createScopeGuard();

    const [browserTabs, setBrowserTabs] = createSignal<BrowserTab[]>([]);
    const [activeBrowserTabId, setActiveBrowserTabId] = createSignal<string | null>(null);
    const [browserControlState, setBrowserControlState] = createSignal<BrowserControlState>({ sessions: [] });
    const [noticedBrowserTabIds, setNoticedBrowserTabIds] = createSignal<ReadonlySet<string> | null>(null);
    const browserTabActivationOperations = new Map<string, Promise<void>>();
    let browserChangeRevision = 0;

    function supportsBrowser(server: ServerSummary | undefined): boolean {
      return !landingPreview && serverSupportsCapability(server, "browser-control");
    }

    function loadDisplayState(server: ServerSummary | undefined): Promise<BrowserDisplayState> {
      if (!supportsBrowser(server)) return Promise.resolve({ tabs: [], activeTabId: null });
      return browserPort().browser.getDisplayState();
    }

    function loadControlState(server: ServerSummary | undefined): Promise<BrowserControlState> {
      if (!supportsBrowser(server)) return Promise.resolve({ sessions: [] });
      return browserPort().browser.getControlState();
    }

    function beginBrowserLoad(): (state: BrowserDisplayState) => void {
      const requestedAtRevision = browserChangeRevision;
      return (state) => {
        if (!noticedBrowserTabIds()) setNoticedBrowserTabIds(new Set(state.tabs.map((tab) => tab.id)));
        if (browserChangeRevision !== requestedAtRevision) return;
        setBrowserTabs(state.tabs);
        setActiveBrowserTabId(activeTabAfterLoad(state));
      };
    }

    function noticeBrowserTabs(tabIds: readonly string[]): void {
      const noticed = noticedBrowserTabIds();
      if (!noticed || tabIds.every((tabId) => noticed.has(tabId))) return;
      setNoticedBrowserTabIds(new Set([...noticed, ...tabIds]));
    }

    function applyBrowserChange(tabs: BrowserTab[], activeTabId: string | null): void {
      browserChangeRevision += 1;
      setBrowserTabs(tabs);
      setActiveBrowserTabId(activeTabId);
    }

    function activateBrowserTab(tabId: string) {
      const analytics = desktopAnalytics.scope();
      const operation = browserPort().browser.activate(tabId);
      browserTabActivationOperations.set(tabId, operation);
      void operation
        .then(() => analytics.track("browser_action", { action: "activate", result: "succeeded" }))
        .catch(() =>
          analytics.track("browser_action", {
            action: "activate",
            result: "failed",
            failure_code: "browser_activate_failed",
          }),
        )
        .finally(() => {
          if (browserTabActivationOperations.get(tabId) === operation) {
            browserTabActivationOperations.delete(tabId);
          }
        });
    }

    async function closeBrowserTab(tabId: string) {
      const analytics = desktopAnalytics.scope();
      const selectionIsCurrent = currentServerSelection();
      try {
        await browserTabActivationOperations.get(tabId)?.catch(() => undefined);
        if (browserTabsHidden() || !selectionIsCurrent() || !scopeIsCurrent()) {
          return;
        }
        await browserPort().browser.close(tabId);
        if (scopeIsCurrent()) {
          browserChangeRevision += 1;
          const next = browserTabsAfterClose(browserTabs(), tabId, activeBrowserTabId());
          setBrowserTabs(next.tabs);
          setActiveBrowserTabId(next.activeTabId);
        }
        analytics.track("browser_action", { action: "close", result: "succeeded" });
      } catch (error) {
        analytics.track("browser_action", {
          action: "close",
          result: "failed",
          failure_code: "browser_close_failed",
        });
        throw error;
      }
    }

    return {
      browserTabs,
      activeBrowserTabId,
      browserVisibilitySuspended,
      browserControlState,
      setBrowserControlState,
      noticedBrowserTabIds,
      noticeBrowserTabs,
      supportsBrowser,
      loadDisplayState,
      loadControlState,
      beginBrowserLoad,
      applyBrowserChange,
      activateBrowserTab,
      closeBrowserTab,
    };
  },
});

export const BrowserTabsProvider = BrowserTabs.provider;
export const useBrowserTabs = BrowserTabs.use;
