import type {
  AgentEvent,
  BrowserControlState,
  BrowserLiveViewEvent,
  BrowserOpenInput,
  BrowserPictureInPictureEvent,
  BrowserPreview,
  BrowserTab,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import browserTakeoverPreviewUrl from "../../stories/assets/browser-takeover-preview.svg";
import { STORY_BROWSER_CONTROL, STORY_BROWSER_TABS } from "./fixtures";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockBrowserOptions {
  browserTabs?: BrowserTab[];
  browserControlState?: BrowserControlState;
  browserPreview?: BrowserPreview | null;
  browserPreviews?: Record<string, BrowserPreview | null>;
}

/** The embedded browser: its tabs, the live view the preview cannot show, and picture-in-picture. */
export function createMockBrowser(
  options: MockBrowserOptions,
  { emit }: MockRuntime,
  emitAgentEvent: (event: AgentEvent) => void,
) {
  let browserTabs = clone(options.browserTabs ?? STORY_BROWSER_TABS);
  let activeBrowserTabId = browserTabs.at(-1)?.id ?? null;
  const browserControlState = clone(options.browserControlState ?? STORY_BROWSER_CONTROL);
  const browserPreview =
    options.browserPreview === undefined
      ? { dataUrl: browserTakeoverPreviewUrl, width: 960, height: 600 }
      : options.browserPreview;
  const browserDisplayListeners = new Set<Listener<{ tabs: BrowserTab[]; activeTabId: string | null }>>();
  const browserLiveViewListeners = new Set<Listener<BrowserLiveViewEvent>>();
  const browserPictureInPictureListeners = new Set<Listener<BrowserPictureInPictureEvent>>();

  const browser: OpenBotDesktopApi["browser"] = {
    open: async (input: BrowserOpenInput) => {
      const tab: BrowserTab = {
        id: `browser-tab-${browserTabs.length + 1}`,
        title: input.url,
        url: input.url,
        loading: false,
        ownerThreadId: input.ownerThreadId ?? null,
        ownerAgentId: input.ownerAgentId ?? null,
        // `toPublicTab` in `browser-host.ts` fills all three on every tab it reports, so a mock that
        // left them undefined would be the only surface where a freshly opened tab has no environment.
        // These are `defaultBrowserEnvironment()` -- a fill viewport, which the real host then reports
        // at the view's measured size.
        environment: {
          viewport: { mode: "fill", width: 1200, height: 800, deviceScaleFactor: 1, preset: null },
          colorScheme: "system",
          reducedMotion: false,
        },
        recording: false,
        diagnosticErrorCount: 0,
      };
      browserTabs = [...browserTabs, tab];
      activeBrowserTabId = tab.id;
      emit(browserDisplayListeners, { tabs: browserTabs, activeTabId: tab.id });
      emitAgentEvent({ type: "browser-changed", tabs: browserTabs, activeTabId: tab.id });
      return clone(tab);
    },
    activate: async (tabId) => {
      activeBrowserTabId = tabId;
      emit(browserDisplayListeners, { tabs: browserTabs, activeTabId: activeBrowserTabId });
    },
    navigate: async (input) => {
      if (!("url" in input)) return;
      browserTabs = browserTabs.map((tab) =>
        tab.id === input.tabId ? { ...tab, url: input.url, title: input.url } : tab,
      );
      emit(browserDisplayListeners, { tabs: browserTabs, activeTabId: activeBrowserTabId });
      emitAgentEvent({ type: "browser-changed", tabs: browserTabs, activeTabId: activeBrowserTabId });
    },
    reload: async () => undefined,
    close: async (tabId) => {
      const closedTab = browserTabs.find((tab) => tab.id === tabId);
      const closedIds = new Set([tabId]);
      for (const tab of browserTabs) {
        if (tab.openerTabId && closedIds.has(tab.openerTabId)) closedIds.add(tab.id);
      }
      browserTabs = browserTabs.filter((tab) => !closedIds.has(tab.id));
      if (activeBrowserTabId && closedIds.has(activeBrowserTabId)) {
        activeBrowserTabId =
          browserTabs.find((tab) => tab.id === closedTab?.openerTabId)?.id ?? browserTabs[0]?.id ?? null;
      }
      emit(browserDisplayListeners, { tabs: browserTabs, activeTabId: activeBrowserTabId });
      emitAgentEvent({
        type: "browser-changed",
        tabs: browserTabs,
        activeTabId: activeBrowserTabId,
      });
    },
    listTabs: async () => clone(browserTabs),
    getDisplayState: async () => ({ tabs: clone(browserTabs), activeTabId: activeBrowserTabId }),
    getControlState: async () => clone(browserControlState),
    capturePreview: async (tabId) => {
      const preview = options.browserPreviews?.[tabId] === undefined ? browserPreview : options.browserPreviews[tabId];
      if (!preview) throw new Error("Browser preview is unavailable.");
      return clone(preview);
    },
    setVisible: async () => undefined,
    // The preview has no host, so it answers the one thing that is true: there is nothing live to
    // show. The panel draws its own message for that rather than an empty rectangle.
    startLiveView: async (tabId) => {
      emit(browserLiveViewListeners, { type: "stopped", tabId, reason: "The preview has no host to watch." });
    },
    stopLiveView: async () => undefined,
    sendLiveViewInput: async () => undefined,
    onLiveViewEvent: (listener) => {
      browserLiveViewListeners.add(listener);
      return () => browserLiveViewListeners.delete(listener);
    },
    onDisplayState: (listener) => {
      browserDisplayListeners.add(listener);
      return () => browserDisplayListeners.delete(listener);
    },
    openPictureInPicture: async (bounds) => bounds ?? { x: 16, y: 16, width: 420, height: 300 },
    closePictureInPicture: async () => undefined,
    dockPictureInPicture: async () => {
      emit(browserPictureInPictureListeners, { type: "dock" });
    },
    hidePictureInPicture: async () => {
      emit(browserPictureInPictureListeners, { type: "hide" });
    },
    onPictureInPictureEvent: (listener) => {
      browserPictureInPictureListeners.add(listener);
      return () => browserPictureInPictureListeners.delete(listener);
    },
  };

  return {
    browser,
    dispose: () => {
      browserDisplayListeners.clear();
      browserLiveViewListeners.clear();
      browserPictureInPictureListeners.clear();
    },
  };
}
