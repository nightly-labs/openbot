import type { BrowserTab } from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import BrowserLocalSignInDialog from "@openbot/ui/features/browser/BrowserLocalSignInDialog";
import { BROWSER_NEW_TAB_URL } from "@openbot/ui/features/browser/browser-suggestions";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, onCleanup, Show, untrack } from "solid-js";
import { desktopBrowserProfileCalls } from "../browser/browser-profiles-port";
import {
  browserSessionHistory,
  canReopenBrowserTab,
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
import { BrowserDockAdapter } from "./BrowserDockAdapter";
import { browserTeachFile, browserTeachSteps } from "./browser-teach-message";
import { conversationPort } from "./conversation-port";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The full browser view of the conversation. The order of the tabs, the closed tabs and the pages of the
 * session stay in this window (`browser-tab-session.ts`); the tabs themselves are main's.
 */
export default function BrowserFullViewAdapter() {
  const {
    props,
    activateBrowserTab,
    activeBrowserTab,
    allBrowserTabs,
    browserControlForTab,
    browserControllerForTab,
    browserExpandedOpen,
    browserTabOwner,
    browserTabs,
    closeBrowserTab,
    navigateBrowserTab,
    openBrowserAddress,
    reloadBrowserTab,
    stopBrowserTab,
    setActiveRightPanel,
    setBrowserSurfaceElement,
    showBrowserPip,
    showBrowserTabOf,
    localSignIn,
    browserTeach,
    closeBrowserTeach,
    startBrowserTeach,
    stopBrowserTeach,
    sendCardFile,
    addPageText,
  } = useConversationViewScope();
  const { t } = useText();
  const serverId = () => props.server?.id ?? "";
  const tabs = createMemo(() => orderedBrowserTabs(serverId(), allBrowserTabs()));
  // Any member who sees a tab reads its profile label, from a host that serves `browser-profiles-v1`.
  // An admin also reads the proxy of each profile.
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
    // The order is read to change it, not to run again when it changes.
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

  /**
   * The dock is the composer of the conversation, so a tab of another agent brings its chat: the page stays
   * open, and the dock sends, stops and edits the queue of the agent that owns the tab.
   */
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
    // The tab with the lowest index is the first to open again, so each one goes back to its place.
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

  /**
   * Save sends one short message of the user with the steps in a file, so the chat stays easy to read.
   * When the chat cannot send now, the steps go to the end of the draft as text.
   */
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

  // The session of the sign-in stays in main only while this dialog can finish it.
  onCleanup(localSignIn.cancel);

  return (
    <BrowserFullView
      open={browserExpandedOpen()}
      macWindowControls={props.platform === "darwin"}
      shortcuts={props.runtime ? undefined : props.platform === "darwin" ? "mac" : "pc"}
      tabs={tabs()}
      activeTab={activeBrowserTab()}
      history={browserSessionHistory(serverId())}
      canReopen={canReopenBrowserTab(serverId())}
      controlForTab={browserControlForTab}
      controllerForTab={browserControllerForTab}
      ownerForTab={browserTabOwner}
      profileForTab={profileForTab}
      onActivateTab={activateTab}
      onCloseTabs={closeTabs}
      onNewTab={(afterId) => openTab(BROWSER_NEW_TAB_URL, afterId === undefined ? {} : { afterId })}
      onDuplicateTab={(tabId) => {
        const tab = tabs().find((entry) => entry.id === tabId);
        if (tab) void openTab(tab.url, { afterId: tab.id });
      }}
      onMoveTab={(tabId, index) => moveBrowserTab(serverId(), tabs(), tabId, index)}
      onReopenTab={() => {
        const closed = takeClosedBrowserTab(serverId());
        if (closed) void openTab(closed.url, { index: closed.index });
      }}
      onReload={(tabId) => void reloadBrowserTab(tabId)}
      onStop={(tabId) => void stopBrowserTab(tabId)}
      onNavigate={(tabId, direction) => void navigateBrowserTab(tabId, direction)}
      onOpenAddress={(url, tabId) => void openBrowserAddress(url, tabId === undefined)}
      // A host's tab can show in Picture in Picture only through the live view.
      canEnterPip={
        !props.runtime && (props.server?.kind !== "remote" || serverSupportsCapability(props.server, "browser-view"))
      }
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
      onSignInLocally={localSignIn.canStart(activeBrowserTab()) ? localSignIn.start : undefined}
      teach={teach()}
      // A local tab is a native view above this window, so its dock goes in the overlay above the page.
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
