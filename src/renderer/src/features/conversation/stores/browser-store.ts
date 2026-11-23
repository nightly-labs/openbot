import type { BrowserPreview, BrowserTab, BrowserTeachStep } from "@openbot/contracts/ipc";
import { BROWSER_TEACH_CAPABILITY } from "@openbot/contracts/team-protocol/browser-teach-v1";
import { BROWSER_USER_CONTROL_CAPABILITY } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { BROWSER_NEW_TAB_URL, browserAddressUrl } from "@openbot/ui/features/browser/browser-suggestions";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { actionToast } from "../../../action-toast";
import { desktopAnalytics } from "../../../analytics";
import {
  newestBrowserControlSession,
  ownsBrowserTab,
  browserControlForTab as sharedBrowserControlForTab,
} from "../../browser/browser-window-model";
import { serverSupportsCapability } from "../../servers/server-capabilities";
import { conversationPort } from "../conversation-port";
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
  signInBlocked?: { server: string; signingIn: boolean } | undefined;
}

export interface LocalSignIn {
  tabId: string;
  url: string;
  site: string;
  windowOpen: boolean;
  pending: boolean;
  error?: string | undefined;
}

function webHost(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//iu.test(url)) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

const LOOPBACK_HOST = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/iu;

function returnsToBrowserComputer(redirect: string): boolean {
  if (!URL.canParse(redirect)) return false;
  const { protocol, hostname } = new URL(redirect);
  return !/^https?:$/iu.test(protocol) || LOOPBACK_HOST.test(hostname);
}

function isLoopbackOAuthPage(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const redirect = new URL(url).searchParams.get("redirect_uri");
  return redirect !== null && returnsToBrowserComputer(redirect);
}

function canonicalBrowserUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

interface BrowserPanels {
  activeRightPanel: () => RightPanelMode;
  setActiveRightPanel: (mode: RightPanelMode, agentId?: string) => void;
  reattachBrowserWindow: () => void;
  closeBrowserPane: () => void;
}

export interface BrowserStoreDeps {
  props: ConversationProps;
  browserOpenRequests: Map<
    string,
    {
      promise: Promise<BrowserTab | undefined>;
      serverId: string;
      agentId: string | null;
      url: string;
      existingTabIds: Set<string>;
    }
  >;
  browserAddress: () => string;
  setBrowserAddress: (address: string) => void;
  takeoverPageRequest: () => { agentId: string; tabId: string } | null;
  setTakeoverPageRequest: (request: null) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget, cause?: unknown) => void;
  panels: BrowserPanels;
}

export function createBrowserStore(deps: BrowserStoreDeps) {
  const browserInteractionAvailable = createMemo(
    () => deps.props.browserEnabled !== false && !deps.props.browserVisibilitySuspended,
  );
  const browserSidebarOpen = () => browserInteractionAvailable() && deps.panels.activeRightPanel() === "browser";
  const browserExpandedOpen = () =>
    browserInteractionAvailable() && deps.panels.activeRightPanel() === "browser-expanded";
  const browserPipOpen = () => browserInteractionAvailable() && deps.panels.activeRightPanel() === "browser-pip";
  const screenOpen = () => browserSidebarOpen() || browserExpandedOpen() || browserPipOpen();
  const allBrowserTabs = createMemo(() => (deps.props.browserEnabled === false ? [] : deps.props.browserTabs));
  const tabsOwnedBy = (agent: Pick<AgentProfile, "id" | "threadId">) =>
    allBrowserTabs().filter((tab) => ownsBrowserTab(agent, tab));
  const browserTabOwner = (tab: BrowserTab) => deps.props.agents.find((agent) => ownsBrowserTab(agent, tab));
  const channel = untrack(() => deps.props.channel);
  const viewId = () => deps.props.agent?.id ?? channel?.id ?? null;
  const viewOwner = () => ({ agentId: deps.props.agent?.id ?? null, threadId: deps.props.agent?.threadId ?? null });
  const browserTabs = createMemo(() => {
    const agent = deps.props.agent;
    if (agent) return tabsOwnedBy(agent);
    if (!channel) return [];
    const threadIds = channel.memberThreadIds();
    return allBrowserTabs().filter((tab) => tab.ownerThreadId !== null && threadIds.has(tab.ownerThreadId));
  });
  const closingBrowserTabIds = new Set<string>();
  createEffect(
    () => new Set(allBrowserTabs().map((tab) => tab.id)),
    (visibleTabIds) => {
      for (const tabId of closingBrowserTabIds) {
        if (!visibleTabIds.has(tabId)) closingBrowserTabIds.delete(tabId);
      }
    },
  );
  createEffect(
    () => browserTabs().map((tab) => ({ id: tab.id, url: tab.url })),
    (tabs) => {
      const serverId = untrack(() => deps.props.server?.id ?? "local");
      const agentId = untrack(viewId);
      for (const [requestKey, request] of deps.browserOpenRequests) {
        if (request.serverId !== serverId || request.agentId !== agentId) continue;
        const tabAppeared = tabs.some(
          (tab) => canonicalBrowserUrl(tab.url) === request.url && !request.existingTabIds.has(tab.id),
        );
        if (tabAppeared) deps.browserOpenRequests.delete(requestKey);
      }
    },
  );
  const lastShownTabs = new Map<string, { id: string; index: number }>();
  const activeBrowserTab = createMemo(() => {
    const tabs = browserTabs();
    const agentId = viewId();
    const shownIndex = tabs.findIndex((tab) => tab.id === deps.props.activeBrowserTabId);
    const shown = tabs[shownIndex];
    if (shown) {
      if (agentId) lastShownTabs.set(agentId, { id: shown.id, index: shownIndex });
      return shown;
    }
    const lastShown = agentId ? lastShownTabs.get(agentId) : undefined;
    if (!lastShown) return tabs.find((tab) => tab.id === deps.props.browserTakeover?.tabId) ?? tabs[0];
    return tabs.find((tab) => tab.id === lastShown.id) ?? tabs[lastShown.index] ?? tabs[lastShown.index - 1] ?? tabs[0];
  });
  const browserTakeoverTab = createMemo(() => {
    const tabId = deps.props.browserTakeover?.tabId;
    return tabId ? allBrowserTabs().find((tab) => tab.id === tabId) : undefined;
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
      suspended: deps.props.browserVisibilitySuspended,
    }),
    ({ request, suspended }) => {
      if (!request || request.secret || suspended) {
        browserTakeoverPreviewKey = null;
        browserTakeoverPreviewGeneration += 1;
        setBrowserTakeoverPreview({ status: "idle", preview: null });
        return;
      }

      const requestKey = String(request.requestId);
      if (browserTakeoverPreviewKey === requestKey) return;

      browserTakeoverPreviewKey = requestKey;
      const generation = ++browserTakeoverPreviewGeneration;
      setBrowserTakeoverPreview({ status: "loading", preview: null });
      void conversationRuntime(deps.props)
        .browser.capturePreview(request.tabId)
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
    const threads = deps.props.threads;
    if (threads?.open !== undefined)
      return `thread:${threads.open?.id ?? "new"}:${threads.conversation?.revision ?? 0}`;
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
  let takeoverFullViewTabId: string | null = null;
  createEffect(
    () => deps.panels.activeRightPanel() === "browser-expanded",
    (expanded) => {
      if (!expanded) takeoverFullViewTabId = null;
    },
  );
  const respondToBrowserTakeover = async (decision: "complete" | "cancel") => {
    const request = deps.props.browserTakeover;
    if (!request) return false;
    const resolution = {
      decision,
      tab: browserTakeoverTab(),
      preview: browserTakeoverPreview().preview,
      previewStatus: browserTakeoverPreview().status,
      messageMarker: latestMessageMarker(),
      signInBlocked: blockedTakeoverSignIn(),
    } satisfies BrowserTakeoverResolutionState;
    const sideThread = request.threadId === deps.props.threads?.open?.threadId;
    const completed = await deps.props.onRespondToBrowserTakeover(
      decision,
      sideThread
        ? {
            onError: (error) => {
              const { t, errorMessage } = currentText();
              actionToast.error(errorMessage(error, t("app.errorStatus.browserTakeover")), {
                report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
              });
            },
          }
        : undefined,
    );
    if (completed && latestMessageMarker() === resolution.messageMarker) setBrowserTakeoverResolution(resolution);
    if (
      completed &&
      takeoverFullViewTabId === request.tabId &&
      activeBrowserTab()?.id === request.tabId &&
      deps.panels.activeRightPanel() === "browser-expanded"
    )
      deps.panels.setActiveRightPanel("browser");
    return completed;
  };
  let previousBrowserTabs: { owner: string; count: number } = { owner: "", count: 0 };
  createEffect(
    () => ({
      owner: `${deps.props.server?.id ?? "local"}:${deps.props.agent?.id ?? ""}`,
      count: browserTabs().length,
      enabled: deps.props.browserEnabled !== false,
    }),
    ({ owner, count, enabled }) => {
      const previous = previousBrowserTabs;
      previousBrowserTabs = { owner, count };
      if (!enabled || previous.owner !== owner || previous.count === 0 || count > 0) return;
      const mode = untrack(deps.panels.activeRightPanel);
      if (mode === "browser" || mode === "browser-expanded" || mode === "browser-pip")
        untrack(deps.panels.closeBrowserPane);
    },
  );

  function openBrowserTakeoverTab(tab = browserTakeoverTab()) {
    if (!tab) return;
    if (browserTabs().some((entry) => entry.id === tab.id)) {
      if (deps.props.activeBrowserTabId !== tab.id) activateBrowserTab(tab.id);
      deps.panels.setActiveRightPanel("browser-expanded");
      takeoverFullViewTabId = tab.id;
      return;
    }
    const owner = browserTabOwner(tab);
    if (owner && showTabInAgentChat(tab, owner.id)) deps.props.onSelectAgent(owner.id);
  }

  function showTabInAgentChat(tab: BrowserTab, agentId: string): boolean {
    if (!browserInteractionAvailable() || closingBrowserTabIds.has(tab.id)) return false;
    deps.props.onActivateBrowserTab(tab.id);
    deps.panels.setActiveRightPanel("browser-expanded", agentId);
    return true;
  }

  function openWaitingAgent(agentId: string) {
    const wait = deps.props.agentWaits?.[agentId];
    const tabId =
      wait?.kind === "waiting" && wait.reason === "takeover" ? deps.props.agentTakeoverTabIds?.[agentId] : undefined;
    const tab = tabId ? allBrowserTabs().find((entry) => entry.id === tabId) : undefined;
    if (tab) showTabInAgentChat(tab, agentId);
    deps.props.onSelectAgent(agentId, MAIN_THREAD_ID);
  }

  const canOpenBrowserTakeoverTab = () => {
    const tab = browserTakeoverTab();
    if (!tab) return false;
    if (browserTabs().some((entry) => entry.id === tab.id)) return true;
    return browserTabOwner(tab) !== undefined && browserInteractionAvailable() && !closingBrowserTabIds.has(tab.id);
  };

  const [localSignIn, setLocalSignIn] = createSignal<LocalSignIn | null>(null);
  const canSendLocalSignIn = (tab: BrowserTab | undefined) =>
    !deps.props.runtime &&
    deps.props.server?.kind === "remote" &&
    serverSupportsCapability(deps.props.server, "browser-sign-in") &&
    webHost(tab?.url) !== null;

  const canSignInLocally = (tab: BrowserTab | undefined) =>
    canSendLocalSignIn(tab) && !isLoopbackOAuthPage(tab?.url ?? "");

  const canSignInTakeoverLocally = () => {
    const tab = browserTakeoverTab();
    if (tab === undefined || !browserTabs().some((entry) => entry.id === tab.id)) return false;
    return deps.props.browserTakeover?.reason === "sign-in-blocked" ? canSendLocalSignIn(tab) : canSignInLocally(tab);
  };

  const takeoverNeedsDesktopSignIn = () =>
    deps.props.runtime !== undefined && deps.props.browserTakeover?.reason === "sign-in-blocked";

  function blockedTakeoverSignIn() {
    const tab = browserTakeoverTab();
    if (deps.props.browserTakeover?.reason !== "sign-in-blocked" || !tab || !canSignInTakeoverLocally())
      return undefined;
    return { server: deps.props.server?.name ?? "", signingIn: localSignIn()?.tabId === tab.id };
  }

  createEffect(
    () => {
      const request = deps.takeoverPageRequest();
      if (!request || request.agentId !== deps.props.agent?.id) return undefined;
      const tab = browserTabs().find((entry) => entry.id === request.tabId);
      if (!tab) return undefined;
      const signInFromCard = deps.props.browserTakeover?.tabId === tab.id && blockedTakeoverSignIn() !== undefined;
      return { tab, signInFromCard };
    },
    (target) => {
      if (!target) return;
      deps.setTakeoverPageRequest(null);
      if (!target.signInFromCard) {
        untrack(() => openBrowserTakeoverTab(target.tab));
        return;
      }
      if (untrack(deps.panels.activeRightPanel) === "browser-expanded") deps.panels.setActiveRightPanel("browser");
    },
  );

  function updateLocalSignIn(tabId: string, change: Partial<LocalSignIn>) {
    setLocalSignIn((current) => (current?.tabId === tabId ? { ...current, ...change } : current));
  }

  function openLocalSignInWindow(tabId: string, url: string) {
    updateLocalSignIn(tabId, { windowOpen: true, error: undefined });
    waitForLocalSignIn(tabId, url);
  }

  function waitForLocalSignIn(tabId: string, url: string) {
    conversationPort()
      .browser.openLocalSignIn({ tabId, url })
      .then(
        ({ signedIn }) => {
          if (!signedIn) updateLocalSignIn(tabId, { windowOpen: false });
          else if (localSignIn()?.tabId === tabId) void finishLocalSignIn(true);
        },
        (error: unknown) =>
          updateLocalSignIn(tabId, {
            windowOpen: false,
            error: currentText().errorMessage(error, currentText().t("browser.signIn.failed")),
          }),
      );
  }

  function startLocalSignIn(tabId: string) {
    const tab = allBrowserTabs().find((entry) => entry.id === tabId);
    const site = webHost(tab?.url);
    if (!tab || !site) return;
    setLocalSignIn({ tabId, url: tab.url, site, windowOpen: true, pending: false });
    openLocalSignInWindow(tabId, tab.url);
  }

  function signInTakeoverTabLocally() {
    const tab = browserTakeoverTab();
    if (!tab) return;
    openBrowserTakeoverTab();
    startLocalSignIn(tab.id);
  }

  async function finishLocalSignIn(check = false) {
    const current = localSignIn();
    if (!current || current.pending) return;
    const { t, errorMessage } = currentText();
    const server = deps.props.server?.name ?? "";
    updateLocalSignIn(current.tabId, { pending: true, error: undefined });
    try {
      const result = await conversationPort().browser.finishLocalSignIn({ send: true, check });
      if (!result?.signedIn) {
        updateLocalSignIn(current.tabId, {
          pending: false,
          windowOpen: result !== null && (check || current.windowOpen),
          error:
            result && result.cookies > 0
              ? t("browser.signIn.stillSignedOut", { site: current.site, server })
              : t("browser.signIn.notFound", { site: current.site }),
        });
        if (result && check) waitForLocalSignIn(current.tabId, current.url);
        return;
      }
      setLocalSignIn(null);
      toast.success(t("browser.signIn.sent", { site: current.site, server }));
      if (deps.props.browserTakeover?.tabId === current.tabId) void respondToBrowserTakeover("complete");
    } catch (error) {
      updateLocalSignIn(current.tabId, { pending: false, error: errorMessage(error, t("browser.signIn.failed")) });
    }
  }

  function cancelLocalSignIn() {
    if (!localSignIn()) return;
    setLocalSignIn(null);
    void conversationPort()
      .browser.finishLocalSignIn({ send: false })
      .catch(() => undefined);
  }

  const agentsByThreadId = createMemo(() => new Map(deps.props.agents.map((agent) => [agent.threadId, agent])));

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
    return newestBrowserControlSession(candidates);
  });
  const actingBrowserControl = createMemo(() => {
    const control = activeBrowserControl();
    return control?.phase === "acting" ? control : undefined;
  });
  const browserControlAgent = createMemo(() => {
    const control = activeBrowserControl();
    return control ? agentsByThreadId().get(control.threadId) : undefined;
  });
  const browserControlForTab = (tab: BrowserTab) =>
    sharedBrowserControlForTab(deps.props.browserControlState.sessions, tab, activeBrowserTab()?.id);
  const browserControllerForTab = (tab: BrowserTab) => {
    const control = browserControlForTab(tab);
    return control ? agentsByThreadId().get(control.threadId) : undefined;
  };

  async function openBrowserAddress(address = deps.browserAddress(), newTab = false): Promise<BrowserTab | undefined> {
    if (!browserInteractionAvailable()) return;
    const value = address.trim();
    if (!value) return;
    const owner = channel && !deps.props.agent ? channel.browserOwner() : viewOwner();
    const targetAgentId = deps.props.agent?.id;
    const target = targetAgentId ? { agentId: targetAgentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    const analytics = desktopAnalytics.scope();
    const url = browserAddressUrl(value);
    const canNavigateCurrentTab = serverSupportsCapability(deps.props.server, TEAM_BROWSER_NAVIGATION_CAPABILITY);
    const currentTab = newTab || !canNavigateCurrentTab ? undefined : activeBrowserTab();
    if (currentTab) {
      if (closingBrowserTabIds.has(currentTab.id)) return;
      try {
        await conversationRuntime(deps.props).browser.navigate({ tabId: currentTab.id, url });
      } catch (error) {
        const text = currentText();
        deps.setComposerError(text.errorMessage(error, text.t("browser.error.openAddress")), target, error);
      }
      return;
    }
    if (!owner) {
      deps.setComposerError(currentText().t("browser.error.channelNoBrowserMember"), target);
      return;
    }
    const serverId = deps.props.server?.id ?? "local";
    const agentId = viewId();
    const canonicalUrl = canonicalBrowserUrl(url);
    const requestKey = JSON.stringify([serverId, agentId, canonicalUrl]);
    const pendingRequest = deps.browserOpenRequests.get(requestKey);
    if (pendingRequest) return pendingRequest.promise;
    const request = (async () => {
      try {
        const tab = await conversationRuntime(deps.props).browser.open({
          url,
          ownerThreadId: owner.threadId,
          ownerAgentId: owner.agentId,
          focus: true,
        });
        deps.setBrowserAddress(tab.url);
        analytics.track("browser_action", { action: "open", result: "succeeded" });
        return tab;
      } catch (error) {
        deps.setBrowserAddress(url);
        analytics.track("browser_action", {
          action: "open",
          result: "failed",
          failure_code: "browser_open_failed",
        });
        const text = currentText();
        deps.setComposerError(text.errorMessage(error, text.t("browser.error.openAddress")), target, error);
        return undefined;
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
      return await request;
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
      !allBrowserTabs().some((tab) => tab.id === tabId)
    ) {
      return;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    closingBrowserTabIds.add(tabId);
    try {
      await deps.props.onCloseBrowserTab(tabId);
    } catch (error) {
      deps.setComposerError(currentText().t("browser.error.closeTab"), target, error);
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

  function showBrowserTabOf(agent: Pick<AgentProfile, "id" | "threadId">, tabId: string) {
    if (!browserInteractionAvailable() || closingBrowserTabIds.has(tabId)) return false;
    const index = tabsOwnedBy(agent).findIndex((tab) => tab.id === tabId);
    if (index < 0) return false;
    lastShownTabs.set(agent.id, { id: tabId, index });
    return true;
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
    } catch (error) {
      deps.setComposerError(currentText().t("browser.error.reloadTab"), target, error);
      analytics.track("browser_action", {
        action: "reload",
        result: "failed",
        failure_code: "browser_reload_failed",
      });
    }
  }

  async function stopBrowserTab(tabId: string) {
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
      await conversationRuntime(deps.props).browser.stop(tabId);
    } catch (error) {
      deps.setComposerError(currentText().t("browser.error.stopLoading"), target, error);
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
    } catch (error) {
      deps.setComposerError(
        currentText().t(direction === "back" ? "browser.error.navigateBack" : "browser.error.navigateForward"),
        target,
        error,
      );
    }
  }

  const takenBrowserTabIds = new Set<string>();

  async function takeBrowserControl(tabId: string) {
    if (await setBrowserControl(tabId, "take")) takenBrowserTabIds.add(tabId);
  }

  async function releaseBrowserControl(tabId: string) {
    if (await setBrowserControl(tabId, "release")) takenBrowserTabIds.delete(tabId);
  }

  let fullViewWasOpen = false;
  createEffect(browserExpandedOpen, (open) => {
    const closed = fullViewWasOpen && !open;
    fullViewWasOpen = open;
    if (!closed) return;
    const held = new Set(untrack(allBrowserTabs).flatMap((tab) => (tab.userControl ? [tab.id] : [])));
    for (const tabId of [...takenBrowserTabIds]) {
      if (held.has(tabId)) void releaseBrowserControl(tabId);
      else takenBrowserTabIds.delete(tabId);
    }
  });

  async function setBrowserControl(tabId: string, action: "take" | "release"): Promise<boolean> {
    const tabs = action === "take" ? browserTabs() : allBrowserTabs();
    if (!browserInteractionAvailable() || closingBrowserTabIds.has(tabId) || !tabs.some((tab) => tab.id === tabId)) {
      return false;
    }
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    const browser = conversationRuntime(deps.props).browser;
    try {
      if (action === "take") await browser.takeControl(tabId);
      else await browser.releaseControl(tabId);
      return true;
    } catch (error) {
      deps.setComposerError(
        currentText().t(action === "take" ? "browser.error.takeControl" : "browser.error.releaseControl"),
        target,
        error,
      );
      return false;
    }
  }

  type BrowserTeachState =
    | { phase: "ready"; pending: boolean }
    | {
        phase: "recording";
        tabId: string;
        agentId: string | undefined;
        startedAt: number;
        controlled: boolean;
        pending: boolean;
      };
  const [teach, setTeach] = createSignal<BrowserTeachState | null>(null);
  createEffect(
    () => {
      const current = teach();
      if (!current) return undefined;
      const controlled =
        current.phase === "recording" && allBrowserTabs().some((tab) => tab.id === current.tabId && tab.userControl);
      const moved = current.phase === "recording" && deps.props.agent?.id !== current.agentId;
      return { current, controlled, moved, open: browserExpandedOpen() };
    },
    (state) => {
      if (!state) return;
      const { current, controlled, moved, open } = state;
      if (current.phase === "ready") {
        if (!open) setTeach(null);
        return;
      }
      if (moved) {
        takenBrowserTabIds.delete(current.tabId);
        setTeach(null);
        void conversationRuntime(deps.props)
          .browser.stopTeach({ tabId: current.tabId, save: false })
          .catch(() => undefined);
        return;
      }
      if (controlled && !current.controlled) setTeach({ ...current, controlled: true });
      else if (!controlled && current.controlled) setTeach(null);
    },
  );
  const browserTeach = () => {
    const current = teach();
    if (!current) return null;
    return current.phase === "ready"
      ? { phase: current.phase, pending: current.pending }
      : { phase: current.phase, pending: current.pending, tabId: current.tabId, startedAt: current.startedAt };
  };
  const canTeachBrowserTask = () =>
    browserInteractionAvailable() &&
    Boolean(deps.props.agent) &&
    serverSupportsCapability(deps.props.server, BROWSER_TEACH_CAPABILITY) &&
    serverSupportsCapability(deps.props.server, BROWSER_USER_CONTROL_CAPABILITY);

  async function openBrowserTeach() {
    if (!canTeachBrowserTask() || teach()) return;
    const tab = activeBrowserTab() ?? (await openBrowserAddress(BROWSER_NEW_TAB_URL, true));
    if (!tab || closingBrowserTabIds.has(tab.id)) return;
    deps.panels.reattachBrowserWindow();
    setTeach({ phase: "ready", pending: false });
  }

  function closeBrowserTeach() {
    if (teach()?.phase === "ready") setTeach(null);
  }

  async function startBrowserTeach() {
    const tab = activeBrowserTab();
    const current = teach();
    if (!tab || current?.phase !== "ready" || current.pending) return;
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    setTeach({ phase: "ready", pending: true });
    try {
      await conversationRuntime(deps.props).browser.startTeach(tab.id);
      takenBrowserTabIds.add(tab.id);
      setTeach({
        phase: "recording",
        tabId: tab.id,
        agentId,
        startedAt: Date.now(),
        controlled: false,
        pending: false,
      });
    } catch (error) {
      setTeach({ phase: "ready", pending: false });
      const text = currentText();
      deps.setComposerError(text.errorMessage(error, text.t("browser.error.teachStart")), target, error);
    }
  }

  async function stopBrowserTeach(save: boolean): Promise<BrowserTeachStep[] | undefined> {
    const current = teach();
    if (current?.phase !== "recording" || current.pending) return undefined;
    const { tabId } = current;
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    setTeach({ ...current, pending: true });
    try {
      const steps = await conversationRuntime(deps.props).browser.stopTeach({ tabId, save });
      takenBrowserTabIds.delete(tabId);
      setTeach(null);
      if (!save) return undefined;
      deps.panels.setActiveRightPanel("none");
      if (steps.length > 1) return steps;
      toast(currentText().t("browser.error.teachEmpty"));
      return undefined;
    } catch (error) {
      setTeach((state) => (state?.phase === "recording" ? { ...state, pending: false } : state));
      deps.setComposerError(currentText().t("browser.error.teachStop"), target, error);
      return undefined;
    }
  }

  return {
    browserTeach,
    canTeachBrowserTask,
    openBrowserTeach,
    closeBrowserTeach,
    startBrowserTeach,
    stopBrowserTeach,
    browserInteractionAvailable,
    browserSidebarOpen,
    browserExpandedOpen,
    browserPipOpen,
    screenOpen,
    allBrowserTabs,
    browserTabs,
    activeBrowserTab,
    browserTakeoverTab,
    browserTakeoverPreview,
    browserTakeoverResolution,
    respondToBrowserTakeover,
    openBrowserTakeoverTab,
    openWaitingAgent,
    canOpenBrowserTakeoverTab,
    localSignIn: {
      state: localSignIn,
      canStart: canSignInLocally,
      start: startLocalSignIn,
      canStartForTakeover: canSignInTakeoverLocally,
      startForTakeover: signInTakeoverTabLocally,
      blockedTakeover: blockedTakeoverSignIn,
      needsDesktopForTakeover: takeoverNeedsDesktopSignIn,
      reopen: openLocalSignInWindow,
      finish: () => finishLocalSignIn(),
      cancel: cancelLocalSignIn,
    },
    activeBrowserControl,
    actingBrowserControl,
    browserControlAgent,
    browserControlForTab,
    browserControllerForTab,
    openBrowserAddress,
    closeBrowserTab,
    activateBrowserTab,
    showBrowserTabOf,
    browserTabOwner,
    reloadBrowserTab,
    stopBrowserTab,
    navigateBrowserTab,
    takeBrowserControl,
    releaseBrowserControl,
  };
}
