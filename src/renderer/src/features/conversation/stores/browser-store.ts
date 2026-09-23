import type { BrowserControlSession, BrowserPreview, BrowserTab } from "@openbot/contracts/ipc";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import { serverSupportsCapability } from "../../servers/server-capabilities";
import { conversationRuntime } from "../conversation-runtime";
import type { ConversationProps, ConversationTarget, RightPanelMode } from "../conversation-types";

export interface BrowserTakeoverPreviewState {
  status: "idle" | "loading" | "ready" | "failed";
  preview: BrowserPreview | null;
}

export interface BrowserTakeoverResolutionState {
  decision: "complete" | "cancel";
  tab: BrowserTab | undefined;
  preview: BrowserPreview | null;
  previewStatus: BrowserTakeoverPreviewState["status"];
  messageMarker: string | null;
}

export function canonicalBrowserUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

function browserAddressUrl(value: string): string {
  const hasProtocol = /^https?:\/\//i.test(value);
  const candidate = hasProtocol ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (
      !/\s/.test(value) &&
      (hasProtocol || url.hostname.includes(".") || url.hostname === "localhost" || url.hostname.startsWith("["))
    ) {
      return candidate;
    }
  } catch {
    // Text that is not a web address is a search query.
  }
  const query = value.replace(/^https?:\/\//i, "");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export interface BrowserPanels {
  setActiveRightPanel: (mode: RightPanelMode) => void;
  screenOpen: () => boolean;
}

export interface BrowserStoreDeps {
  props: ConversationProps;
  browserOpenRequests: Map<
    string,
    {
      promise: Promise<void>;
      serverId: string;
      agentId: string | null;
      url: string;
      existingTabIds: Set<string>;
    }
  >;
  browserAddress: () => string;
  setBrowserAddress: (address: string) => void;
  setBrowserAddressEditing: (editing: boolean) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  panels: BrowserPanels;
}

export function createBrowserStore(deps: BrowserStoreDeps) {
  const browserInteractionAvailable = () =>
    deps.props.browserEnabled !== false && !deps.props.browserVisibilitySuspended;
  const browserTabs = createMemo(() => {
    if (deps.props.browserEnabled === false) return [];
    const agent = deps.props.agent;
    if (!agent) return [];
    return deps.props.browserTabs.filter((tab) =>
      tab.ownerAgentId
        ? tab.ownerAgentId === agent.id
        : Boolean(agent.threadId && tab.ownerThreadId === agent.threadId),
    );
  });
  const closingBrowserTabIds = new Set<string>();
  createEffect(
    () => new Set(browserTabs().map((tab) => tab.id)),
    (visibleTabIds) => {
      for (const tabId of closingBrowserTabIds) {
        if (!visibleTabIds.has(tabId)) closingBrowserTabIds.delete(tabId);
      }
    },
  );
  createEffect(
    () => browserTabs().map((tab) => ({ id: tab.id, url: tab.url })),
    (tabs) => {
      const serverId = deps.props.server?.id ?? "local";
      const agentId = deps.props.agent?.id ?? null;
      for (const [requestKey, request] of deps.browserOpenRequests) {
        if (request.serverId !== serverId || request.agentId !== agentId) continue;
        const tabAppeared = tabs.some(
          (tab) => canonicalBrowserUrl(tab.url) === request.url && !request.existingTabIds.has(tab.id),
        );
        if (tabAppeared) deps.browserOpenRequests.delete(requestKey);
      }
    },
  );
  const activeBrowserTab = createMemo(
    () => browserTabs().find((tab) => tab.id === deps.props.activeBrowserTabId) ?? browserTabs()[0],
  );
  const browserTakeoverTab = createMemo(() => {
    const tabId = deps.props.browserTakeover?.tabId;
    return tabId ? browserTabs().find((tab) => tab.id === tabId) : undefined;
  });
  const [browserTakeoverPreview, setBrowserTakeoverPreview] = createSignal<BrowserTakeoverPreviewState>({
    status: "idle",
    preview: null,
  });
  let browserTakeoverPreviewKey: string | null = null;
  let browserTakeoverPreviewGeneration = 0;
  createEffect(
    () => ({
      request: deps.props.browserTakeover,
      tab: browserTakeoverTab(),
      suspended: deps.props.browserVisibilitySuspended,
    }),
    ({ request, tab, suspended }) => {
      if (!request || request.secret || suspended) {
        browserTakeoverPreviewKey = null;
        browserTakeoverPreviewGeneration += 1;
        setBrowserTakeoverPreview({ status: "idle", preview: null });
        return;
      }

      const requestKey = String(request.requestId);
      if (!tab) {
        if (browserTakeoverPreviewKey !== requestKey) {
          setBrowserTakeoverPreview({ status: "loading", preview: null });
        }
        return;
      }
      if (browserTakeoverPreviewKey === requestKey) return;

      browserTakeoverPreviewKey = requestKey;
      const generation = ++browserTakeoverPreviewGeneration;
      setBrowserTakeoverPreview({ status: "loading", preview: null });
      void conversationRuntime(deps.props)
        .browser.capturePreview(tab.id)
        .then((preview) => {
          if (browserTakeoverPreviewGeneration !== generation) return;
          setBrowserTakeoverPreview({ status: "ready", preview });
        })
        .catch(() => {
          if (browserTakeoverPreviewGeneration !== generation) return;
          setBrowserTakeoverPreview({ status: "failed", preview: null });
        });
    },
  );
  const latestMessageMarker = createMemo(() => {
    const message = deps.props.messages.at(-1);
    return message
      ? `${message.id}:${message.body.length}:${message.streaming === true ? "streaming" : "settled"}`
      : null;
  });
  const [browserTakeoverResolution, setBrowserTakeoverResolution] = createSignal<BrowserTakeoverResolutionState | null>(
    null,
  );
  createEffect(
    () => deps.props.browserTakeover?.requestId,
    (requestId) => {
      if (requestId !== undefined) setBrowserTakeoverResolution(null);
    },
  );
  createEffect(latestMessageMarker, (messageMarker) => {
    const resolution = untrack(browserTakeoverResolution);
    if (resolution && resolution.messageMarker !== messageMarker) setBrowserTakeoverResolution(null);
  });
  const respondToBrowserTakeover = async (decision: "complete" | "cancel") => {
    const request = deps.props.browserTakeover;
    if (!request) return false;
    const resolution = {
      decision,
      tab: browserTakeoverTab(),
      preview: browserTakeoverPreview().preview,
      previewStatus: browserTakeoverPreview().status,
      messageMarker: latestMessageMarker(),
    } satisfies BrowserTakeoverResolutionState;
    const completed = await deps.props.onRespondToBrowserTakeover(decision);
    if (completed && latestMessageMarker() === resolution.messageMarker) setBrowserTakeoverResolution(resolution);
    return completed;
  };
  let previousBrowserTabCount = 0;
  createEffect(
    () => ({ count: browserTabs().length, open: deps.panels.screenOpen() }),
    ({ count, open }) => {
      if (deps.props.browserEnabled === false) return;
      const browserWasClosed = open && previousBrowserTabCount > 0 && count === 0;
      previousBrowserTabCount = count;
      if (browserWasClosed) deps.panels.setActiveRightPanel("browser");
    },
  );

  /**
   * A takeover request used to expand the browser over the conversation the moment it arrived,
   * which took the window away from whatever the user was reading for a step they may not want to
   * start yet. The card carries the page preview instead, and pressing that preview is what opens
   * the page -- the same gesture as a preview card in the browser sidebar.
   */
  function openBrowserTakeoverTab() {
    const tab = browserTakeoverTab();
    if (!tab) return;
    if (deps.props.activeBrowserTabId !== tab.id) activateBrowserTab(tab.id);
    deps.panels.setActiveRightPanel("browser-expanded");
  }

  const agentsByThreadId = createMemo(() => new Map(deps.props.agents.map((agent) => [agent.threadId, agent])));

  // Single pass, no copy and no localeCompare sort per evaluation.
  const newestSession = (sessions: readonly BrowserControlSession[]) => {
    let acting: BrowserControlSession | undefined;
    let newest: BrowserControlSession | undefined;
    for (const session of sessions) {
      if (!newest || session.startedAt > newest.startedAt) newest = session;
      if (session.phase === "acting" && (!acting || session.startedAt > acting.startedAt)) acting = session;
    }
    return acting ?? newest;
  };

  const activeBrowserControl = createMemo(() => {
    if (deps.props.browserEnabled === false) return undefined;
    const sessions = deps.props.browserControlState.sessions;
    const activeTab = activeBrowserTab();
    const forActiveTab = activeTab?.ownerThreadId
      ? sessions.filter((session) => session.threadId === activeTab.ownerThreadId)
      : [];
    const forActiveAgent = deps.props.agent?.threadId
      ? sessions.filter((session) => session.threadId === deps.props.agent?.threadId)
      : [];
    const candidates = forActiveTab.length > 0 ? forActiveTab : forActiveAgent;
    return newestSession(candidates);
  });
  const actingBrowserControl = createMemo(() => {
    const control = activeBrowserControl();
    return control?.phase === "acting" ? control : undefined;
  });
  const browserControlAgent = createMemo(() => {
    const control = activeBrowserControl();
    return control ? agentsByThreadId().get(control.threadId) : undefined;
  });
  const browserControlForTab = (tab: BrowserTab) => {
    const sessions = deps.props.browserControlState.sessions.filter(
      (session) =>
        session.tabId === tab.id ||
        (session.tabId === null && tab.id === activeBrowserTab()?.id && session.threadId === tab.ownerThreadId),
    );
    return newestSession(sessions);
  };
  const browserControllerForTab = (tab: BrowserTab) => {
    const control = browserControlForTab(tab);
    return control ? agentsByThreadId().get(control.threadId) : undefined;
  };

  async function openBrowserAddress(address = deps.browserAddress(), newTab = false) {
    if (!browserInteractionAvailable()) return;
    const value = address.trim();
    if (!value) return;
    deps.setBrowserAddressEditing(false);
    const targetAgentId = deps.props.agent?.id;
    const target = targetAgentId ? { agentId: targetAgentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    const analytics = desktopAnalytics.scope();
    const url = browserAddressUrl(value);
    // A host that cannot move an existing tab to an address gets a new tab for it instead: the
    // released navigate route carries a direction only.
    const canNavigateCurrentTab = serverSupportsCapability(deps.props.server, TEAM_BROWSER_NAVIGATION_CAPABILITY);
    const currentTab = newTab || !canNavigateCurrentTab ? undefined : activeBrowserTab();
    if (currentTab) {
      if (closingBrowserTabIds.has(currentTab.id)) return;
      try {
        await conversationRuntime(deps.props).browser.navigate({ tabId: currentTab.id, url });
      } catch {
        deps.setComposerError("Could not open the address in this tab.", target);
      }
      return;
    }
    const serverId = deps.props.server?.id ?? "local";
    const agentId = deps.props.agent?.id ?? null;
    const canonicalUrl = canonicalBrowserUrl(url);
    const requestKey = JSON.stringify([serverId, agentId, canonicalUrl]);
    const pendingRequest = deps.browserOpenRequests.get(requestKey);
    if (pendingRequest) return pendingRequest.promise;
    const request = (async () => {
      try {
        const tab = await conversationRuntime(deps.props).browser.open({
          url,
          ownerThreadId: deps.props.agent?.threadId ?? null,
          ownerAgentId: deps.props.agent?.id ?? null,
          focus: true,
        });
        deps.setBrowserAddress(tab.url);
        analytics.track("browser_action", { action: "open", result: "succeeded" });
      } catch {
        deps.setBrowserAddress(url);
        analytics.track("browser_action", {
          action: "open",
          result: "failed",
          failure_code: "browser_open_failed",
        });
      }
    })();
    const pendingRequestState = {
      promise: request,
      serverId,
      agentId,
      url: canonicalUrl,
      existingTabIds: new Set(browserTabs().map((tab) => tab.id)),
    };
    deps.browserOpenRequests.set(requestKey, pendingRequestState);
    try {
      await request;
    } finally {
      if (deps.browserOpenRequests.get(requestKey) === pendingRequestState) {
        deps.browserOpenRequests.delete(requestKey);
      }
    }
  }

  async function closeBrowserTab(tabId: string) {
    if (
      !browserInteractionAvailable() ||
      closingBrowserTabIds.has(tabId) ||
      !browserTabs().some((tab) => tab.id === tabId)
    ) {
      return;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    closingBrowserTabIds.add(tabId);
    try {
      await deps.props.onCloseBrowserTab(tabId);
    } catch {
      deps.setComposerError("Could not close the browser tab.", target);
    } finally {
      closingBrowserTabIds.delete(tabId);
    }
  }

  function activateBrowserTab(tabId: string) {
    if (
      !browserInteractionAvailable() ||
      closingBrowserTabIds.has(tabId) ||
      !browserTabs().some((tab) => tab.id === tabId)
    ) {
      return;
    }
    deps.props.onActivateBrowserTab(tabId);
  }

  async function reloadBrowserTab(tabId: string) {
    if (
      !browserInteractionAvailable() ||
      closingBrowserTabIds.has(tabId) ||
      !browserTabs().some((tab) => tab.id === tabId)
    ) {
      return;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    const analytics = desktopAnalytics.scope();
    try {
      await conversationRuntime(deps.props).browser.reload(tabId);
      analytics.track("browser_action", { action: "reload", result: "succeeded" });
    } catch {
      deps.setComposerError("Could not reload the browser tab.", target);
      analytics.track("browser_action", {
        action: "reload",
        result: "failed",
        failure_code: "browser_reload_failed",
      });
    }
  }

  async function navigateBrowserTab(tabId: string, direction: "back" | "forward") {
    if (
      !browserInteractionAvailable() ||
      closingBrowserTabIds.has(tabId) ||
      !browserTabs().some((tab) => tab.id === tabId)
    ) {
      return;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    try {
      await conversationRuntime(deps.props).browser.navigate({ tabId, direction });
    } catch {
      deps.setComposerError(`Could not navigate ${direction}.`, target);
    }
  }

  return {
    browserInteractionAvailable,
    browserTabs,
    activeBrowserTab,
    browserTakeoverTab,
    browserTakeoverPreview,
    browserTakeoverResolution,
    respondToBrowserTakeover,
    openBrowserTakeoverTab,
    activeBrowserControl,
    actingBrowserControl,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    openBrowserAddress,
    closeBrowserTab,
    activateBrowserTab,
    reloadBrowserTab,
    navigateBrowserTab,
  };
}

export type BrowserStore = ReturnType<typeof createBrowserStore>;
