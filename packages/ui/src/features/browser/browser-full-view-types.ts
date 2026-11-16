import type { BrowserControlSession, BrowserTab, BrowserTabProfile } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "@openbot/ui/data";
import type { JSX } from "@solidjs/web";
import type { BrowserViewRuntime } from "./BrowserLiveView";
import type { BrowserHistoryEntry } from "./browser-suggestions";
import type { BrowserShortcutPlatform } from "./browser-view-shortcuts";

/** The profile of a tab. `proxy`: the name of its proxy, when the user can see the proxies of the server. */
export type BrowserTabLabel = BrowserTabProfile & { proxy?: string | undefined };

export interface BrowserTeachBarProps {
  agentName: string;
  /** When the recording started, in milliseconds. `null`: no recording yet. */
  startedAt: number | null;
  /** The host has not answered a start or a stop yet. */
  pending: boolean;
  onStart: () => void;
  /** Ends the recording and gives its steps to the agent. */
  onSave: () => void;
  /** Ends the teach view. A recording is deleted. */
  onClose: () => void;
}

export interface BrowserFullViewProps {
  open: boolean;
  /** Every tab, in the order of the top row. */
  tabs: readonly BrowserTab[];
  activeTab: BrowserTab | undefined;
  /** The pages of this session, the most recent first, for the address suggestions. */
  history: readonly BrowserHistoryEntry[];
  /** Whether a closed tab can open again. */
  canReopen: boolean;
  controlForTab: (tab: BrowserTab) => BrowserControlSession | undefined;
  /** The agent that controls the tab now. */
  controllerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  /** The agent that opened the tab, or undefined for a tab of the user. */
  ownerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  /** The browser profile of the tab. Undefined for a tab in the shared profile, which shows no label. */
  profileForTab?: ((tab: BrowserTab) => BrowserTabLabel | undefined) | undefined;
  onActivateTab: (tabId: string) => void;
  onCloseTabs: (tabIds: readonly string[]) => void;
  /** Opens a new tab after `afterId`, or at the end. The address field gets the focus when it resolves. */
  onNewTab: (afterId?: string) => Promise<unknown>;
  onDuplicateTab: (tabId: string) => void;
  /** Moves the tab so that it ends at `index`. */
  onMoveTab: (tabId: string, index: number) => void;
  onReopenTab: () => void;
  onReload: (tabId: string) => void;
  onStop: (tabId: string) => void;
  onNavigate: (tabId: string, direction: "back" | "forward") => void;
  /** Opens the address in the tab, or in a new tab when there is none. */
  onOpenAddress: (url: string, tabId: string | undefined) => void;
  onSurface: (element: HTMLDivElement | undefined) => void;
  /** The tab to draw here, for a host whose browser is not a view on this screen. Local: `null`. */
  liveViewTabId: string | null;
  liveViewRuntime: BrowserViewRuntime;
  /** Whether the host pastes and copies for the live view. */
  liveViewClipboard: boolean;
  canCloseTabs?: boolean;
  /** False where the page cannot leave the window, such as the web app. */
  canEnterPip?: boolean;
  onBack: () => void;
  onEnterPip: () => void;
  /**
   * Opens a sign-in for the tab on this computer, for a server whose address a site refuses. Absent where
   * the host cannot take one, or where this app cannot open a window.
   */
  onSignInLocally?: ((tabId: string) => void) | undefined;
  /**
   * Whether the window draws the macOS traffic lights over this view. The view is portaled to
   * `document.body`, so it cannot read the platform class of `.app-frame`.
   */
  macWindowControls?: boolean;
  /**
   * The keys of other browsers work in the view, as on this platform. The web client leaves them to the
   * user's browser, so it gives no platform.
   */
  shortcuts?: BrowserShortcutPlatform | undefined;
  /**
   * The user shows a task to the agent: a bar above the page starts, saves or discards the recording of
   * the steps, and the dock is hidden. Absent: the usual view.
   */
  teach?: BrowserTeachBarProps | undefined;
  /** The island, the queue and the composer of the tab's agent, over the page. */
  dock?: JSX.Element;
  /**
   * Dialogs of the view, such as a sign-in on this computer. They render in the view, so that a dialog
   * portal finds the owner of its clicks when the view itself is in a portal.
   */
  dialogs?: JSX.Element;
}

/** Only a host that reports the history state can stop a load, so an older host keeps Reload. */
export function browserTabStoppable(tab: BrowserTab | undefined): boolean {
  return tab?.loading === true && tab.canGoBack !== undefined;
}

/** The label of a tab's browser profile, with its proxy. The session of one agent has no name. */
export function browserTabProfileLabel(t: AppTranslate, profile: BrowserTabLabel): string {
  if (profile.name === null) return t("browser.profiles.agentTabLabel");
  return profile.proxy === undefined
    ? t("browser.profiles.tabLabel", { name: profile.name })
    : t("browser.profiles.tabLabelProxy", { name: profile.name, proxy: profile.proxy });
}
